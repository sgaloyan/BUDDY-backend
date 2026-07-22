// Regression guard for the silent-empty-review bug.
//
// History (docs/ai-sdlc.md -> "Failure mode: the silent empty review"): the reviewer
// once posted a correct header, a correct footer, and nothing in between. It did not
// error. To anyone skimming the PR it was indistinguishable from "found no issues" —
// a hollow pass that quietly bought false confidence.
//
// The contract these tests defend: a degraded run must ANNOUNCE itself. Silence must
// never be the same shape as success. If someone loosens the fail-loud handling in
// .github/scripts/ai-review.mjs, these tests must go red.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { renderReview, capDiff } from '../../.github/scripts/ai-review.mjs';

// Fixtures mirroring real API response shapes.

// The actual failing response: adaptive thinking consumed the whole max_tokens budget,
// so no text block was ever emitted.
const truncatedResponse = {
  content: [{ type: 'thinking', thinking: 'x'.repeat(4000), signature: 'sig' }],
  stop_reason: 'max_tokens',
  usage: { input_tokens: 23206, output_tokens: 24000 },
};

const emptyResponse = {
  content: [],
  stop_reason: 'end_turn',
  usage: { input_tokens: 23206, output_tokens: 0 },
};

const healthyResponse = {
  content: [
    { type: 'thinking', thinking: 'reasoning...', signature: 'sig' },
    { type: 'text', text: '**1. `src/services/auth.service.js:42`** — check-then-write race.' },
  ],
  stop_reason: 'end_turn',
  usage: { input_tokens: 23206, output_tokens: 180 },
};

describe('renderReview — fail-loud contract', () => {
  test('stop_reason max_tokens is announced as truncated, not rendered as a pass', () => {
    const { markdown, warnings } = renderReview(truncatedResponse, {});

    assert.ok(markdown.includes('⚠️'), 'must carry a visible warning marker');
    assert.match(markdown, /Review incomplete/);
    assert.match(markdown, /stop_reason: max_tokens/);
    assert.ok(warnings.length >= 1, 'must report at least one warning');
  });

  test('a response with no text block says nothing was reviewed', () => {
    const { markdown, review } = renderReview(truncatedResponse, {});

    assert.equal(review, '', 'no text block means no extracted review');
    assert.match(markdown, /not an all-clear/i);
    assert.match(markdown, /nothing was reviewed/i);
    assert.match(markdown, /No review text was produced/);
  });

  test('zero content blocks is still announced', () => {
    const { markdown, warnings } = renderReview(emptyResponse, {});

    assert.match(markdown, /Review incomplete/);
    assert.match(markdown, /not an all-clear/i);
    assert.ok(warnings.length >= 1);
  });

  // The precise shape of the original bug. This is the assertion that matters most:
  // the output must not be a bare header+footer with an empty middle.
  test('REGRESSION: degraded output is never a hollow header+footer', () => {
    for (const response of [truncatedResponse, emptyResponse]) {
      const { markdown } = renderReview(response, {});

      // Strip the header line, the footer block, and all horizontal rules; whatever
      // remains is what a reader actually sees as the review body.
      const middle = markdown
        .replace(/^### AI review/, '')
        .replace(/<sub>[\s\S]*<\/sub>/, '')
        .replace(/^---$/gm, '')
        .trim();

      assert.notEqual(middle, '', 'body must never be empty — that reads as an all-clear');
      assert.ok(
        middle.includes('⚠️'),
        'a degraded run must warn in the visible body, not just in logs',
      );
    }
  });

  test('a healthy response renders the review and raises no incompleteness warning', () => {
    const { markdown, warnings, review } = renderReview(healthyResponse, {});

    assert.match(markdown, /check-then-write race/);
    assert.equal(review, healthyResponse.content[1].text);
    assert.equal(warnings.length, 0, 'a good response must not be flagged as degraded');
    assert.ok(!markdown.includes('⚠️'), 'no warning marker on a clean run');
  });

  test('a truncated diff is disclosed with the omitted filenames', () => {
    const { markdown, warnings } = renderReview(healthyResponse, {
      truncated: true,
      omitted: ['src/services/auth.service.js', 'test/integration/auth.signup.test.js'],
    });

    assert.match(markdown, /Partial review/);
    assert.match(markdown, /not \*\*reviewed\*\*|not reviewed/);
    assert.match(markdown, /src\/services\/auth\.service\.js/);
    assert.match(markdown, /test\/integration\/auth\.signup\.test\.js/);
    assert.equal(warnings.length, 1);
  });
});

describe('capDiff — diff budget', () => {
  const fileChunk = (name, size) =>
    `diff --git a/${name} b/${name}\n--- a/${name}\n+++ b/${name}\n@@ -1 +1 @@\n+${'x'.repeat(size)}\n`;

  test('a diff under budget passes through untouched', () => {
    const small = fileChunk('src/a.js', 100);
    const { diff, omitted } = capDiff(small);

    assert.equal(diff, small);
    assert.deepEqual(omitted, []);
  });

  test('an over-budget diff drops whole files and names them', () => {
    const big = fileChunk('src/kept.js', 30_000) + fileChunk('src/dropped.js', 30_000);
    const { diff, omitted } = capDiff(big);

    assert.ok(diff.length < big.length, 'diff must shrink');
    assert.deepEqual(omitted, ['src/dropped.js']);
    assert.ok(diff.includes('src/kept.js'), 'the kept file stays');
    assert.ok(!diff.includes('src/dropped.js'), 'the dropped file is gone');
  });

  test('kept chunks stay whole — never cut mid-hunk', () => {
    const big = fileChunk('src/a.js', 20_000) + fileChunk('src/b.js', 30_000);
    const { diff } = capDiff(big);

    // Every retained chunk must still start with a proper file header.
    for (const chunk of diff.split(/^(?=diff --git )/m).filter(Boolean)) {
      assert.match(chunk, /^diff --git a\/\S+ b\/\S+\n/);
    }
  });

  test('a single file larger than the whole budget is truncated, not dropped', () => {
    const huge = fileChunk('src/huge.js', 60_000);
    const { diff, firstFileTruncated } = capDiff(huge);

    assert.equal(firstFileTruncated, true);
    assert.ok(diff.length > 0, 'must still send something to review');
    assert.ok(diff.startsWith('diff --git a/src/huge.js'));
  });
});
