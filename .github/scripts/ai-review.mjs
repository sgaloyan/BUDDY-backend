// AI code review for a pull request.
//
// Reads a unified diff, sends it to the Anthropic API along with the specs in
// /specs (the source of truth per docs/ai-sdlc.md), and writes a markdown review
// to the output path. The workflow posts that file as a PR comment.
//
// Usage: node .github/scripts/ai-review.mjs <diff-path> <output-path>

import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const MODEL = 'claude-sonnet-4-6';
const SPECS_DIR = 'specs';

// Token budget. These two numbers are load-bearing: thinking tokens are drawn from
// the same max_tokens pool as the visible answer, so an implicit thinking budget can
// consume the entire allowance and leave no text block at all. That is exactly what
// happened on the first live run (see docs/ai-sdlc.md -> "the silent empty review").
//
// Tradeoff: `adaptive` thinking lets the model decide how deeply to reason, which is
// usually the better default — but "usually" is doing real work in that sentence, and
// what it costs here is the guarantee that any answer comes back at all. We take the
// explicit budget instead: thinking is capped at THINKING_BUDGET_TOKENS, and max_tokens
// sits well above it, so MAX_TOKENS - THINKING_BUDGET_TOKENS is reserved for the review
// text and thinking cannot touch it. We trade some reasoning depth on the hardest diffs
// for the certainty that a review is always emitted. For a bounded, well-scoped task
// like reviewing one PR's diff, 8k thinking tokens is ample.
const THINKING_BUDGET_TOKENS = 8_000;
const MAX_TOKENS = 24_000; // leaves >=16k for the visible review

// The diff is the only unbounded input here. This is not about the context window —
// 200k tokens of context was never the constraint. It is about thinking pressure: a
// bigger diff makes the model reason longer, and long reasoning is what starves the
// text budget. Cap the diff so a huge PR degrades into an honestly-labelled partial
// review rather than a silent one.
const MAX_DIFF_CHARS = 40_000;

const SYSTEM_PROMPT = `You are reviewing a pull request for BUDDY, a Node/Express + Mongoose API.

BUDDY is built spec-first: every feature has a spec in /specs, and the spec — not the
code and not the tests — is the source of truth. Code and tests must conform to it.
The relevant specs are included below; review the diff against them.

Report only findings in these four categories:

1. Spec-contract violations — the code contradicts a spec in /specs: wrong status code,
   wrong response shape, a validation or business rule that does not match, a documented
   acceptance criterion that the code does not satisfy.
2. Security issues — auth/authz gaps, secret or password leakage into responses or logs,
   injection, unsafe token handling.
3. Correctness bugs — logic that produces a wrong result. Pay particular attention to
   the classes of bug a passing test suite does not catch: concurrent interleavings and
   check-then-write races, silent truncation or coercion at a dependency boundary, and
   failure paths that are never exercised.
4. Error handling — unhandled rejections, swallowed errors, error paths that themselves
   throw, incorrect status codes on failure.

The test suite already covers what the spec anticipated, and it is green. Do not restate
what a passing test already proves. Your value is in what tests structurally cannot see.

Out of scope, do not report: formatting, naming preferences, style, or lint concerns —
a linter already gates those.

For each finding give: the file and line, the category, a one-sentence statement of the
defect, and a concrete failure scenario (specific inputs or interleaving -> wrong
result). Order findings most severe first. Be specific and concise; do not pad.

If you find nothing worth reporting, say so plainly in one line. A short honest review is
more useful than an invented one — do not manufacture findings to look thorough.

Format the response as GitHub-flavored markdown. Do not open with a preamble or a summary
of the diff; lead with the findings.`;

function readSpecs() {
  let files;
  try {
    // _template.spec.md is the blank starting point for new specs, not a contract —
    // including it would feed the reviewer placeholder text as if it were a rule.
    files = readdirSync(SPECS_DIR).filter((f) => f.endsWith('.spec.md') && !f.startsWith('_'));
  } catch {
    return '(no /specs directory found)';
  }
  if (files.length === 0) return '(no specs found in /specs)';
  return files
    .map((f) => `--- ${SPECS_DIR}/${f} ---\n${readFileSync(join(SPECS_DIR, f), 'utf8')}`)
    .join('\n\n');
}

// Split a unified diff into whole per-file chunks and keep as many as fit in
// MAX_DIFF_CHARS. Cutting at a file boundary keeps every hunk the reviewer sees
// syntactically intact — a diff sliced mid-hunk invites confident nonsense about
// code that was never actually shown.
export function capDiff(diff) {
  if (diff.length <= MAX_DIFF_CHARS) return { diff, omitted: [] };

  // Keep the leading "diff --git" on each chunk; the split point is the boundary.
  const chunks = diff.split(/^(?=diff --git )/m).filter((c) => c.trim() !== '');

  const kept = [];
  const omitted = [];
  let size = 0;
  for (const chunk of chunks) {
    const name = chunk.match(/^diff --git a\/(\S+)/)?.[1] ?? '(unknown file)';
    // Once over budget, omit every remaining file — do not keep cherry-picking
    // small ones, which would present an arbitrary subset as if it were the diff.
    if (omitted.length > 0 || size + chunk.length > MAX_DIFF_CHARS) {
      omitted.push(name);
      continue;
    }
    kept.push(chunk);
    size += chunk.length;
  }

  // A single file larger than the whole budget: keep it, truncated, rather than
  // returning nothing at all.
  if (kept.length === 0 && chunks.length > 0) {
    return {
      diff: chunks[0].slice(0, MAX_DIFF_CHARS),
      omitted: omitted.slice(1),
      firstFileTruncated: true,
    };
  }

  return { diff: kept.join(''), omitted };
}

async function main() {
  const [diffPath, outputPath] = process.argv.slice(2);
  if (!diffPath || !outputPath) {
    console.error('Usage: ai-review.mjs <diff-path> <output-path>');
    process.exit(1);
  }

  let diff = readFileSync(diffPath, 'utf8');
  if (diff.trim() === '') {
    writeFileSync(outputPath, '### AI review\n\nNo reviewable changes in this diff.\n');
    return;
  }

  const { diff: cappedDiff, omitted, firstFileTruncated } = capDiff(diff);
  const truncated = omitted.length > 0 || Boolean(firstFileTruncated);

  const client = new Anthropic(); // reads ANTHROPIC_API_KEY from the environment

  // Streamed, not blocking. A max_tokens this generous puts the request over the
  // SDK's 10-minute non-streaming ceiling, and it refuses such calls outright — so
  // "give the answer room to breathe" and "await a single blocking response" are
  // mutually exclusive here. We stream and reassemble; finalMessage() yields the
  // same Message shape a blocking call would, stop_reason and usage included.
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    thinking: { type: 'enabled', budget_tokens: THINKING_BUDGET_TOKENS },
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          `<specs>\n${readSpecs()}\n</specs>`,
          `<pull_request>\nTitle: ${process.env.PR_TITLE ?? '(none)'}\n\n${process.env.PR_BODY || '(no description)'}\n</pull_request>`,
          `<diff${truncated ? ' truncated="true"' : ''}>\n${cappedDiff}\n</diff>`,
          truncated
            ? `Note: the diff was too large to include in full. These files were omitted and you have NOT seen them: ${omitted.join(', ')}. Review only what is present, and do not speculate about the omitted files.`
            : 'Review this diff.',
        ].join('\n\n'),
      },
    ],
  });
  const response = await stream.finalMessage();

  const { markdown, warnings, review } = renderReview(response, {
    truncated,
    omitted,
    firstFileTruncated,
  });

  writeFileSync(outputPath, markdown);

  console.log(
    `stop_reason=${response.stop_reason} ` +
      `blocks=[${response.content.map((b) => b.type).join(', ')}] ` +
      `text_chars=${review.length} ` +
      `usage=${JSON.stringify(response.usage)}`,
  );
  if (warnings.length > 0) {
    console.error(
      `::warning title=AI review degraded::stop_reason=${response.stop_reason}, text_chars=${review.length}`,
    );
  }
}

// Turn an API response into the markdown posted on the PR. Pure — no I/O, no network —
// so the fail-loud contract below is directly testable. See test/unit/ai-review.test.js.
//
// The contract: a run that produced no usable review MUST NOT render as a clean pass.
// An empty body under a normal header reads as "found nothing", which is the most
// dangerous thing this script can say when it has in fact said nothing.
export function renderReview(response, { truncated, omitted, firstFileTruncated } = {}) {
  const textBlocks = response.content.filter((block) => block.type === 'text');
  const review = textBlocks
    .map((block) => block.text)
    .join('\n')
    .trim();

  const warnings = [];
  if (response.stop_reason === 'max_tokens') {
    warnings.push(
      `**⚠️ Review incomplete — the response was truncated** (\`stop_reason: max_tokens\`). ` +
        `The model hit the ${MAX_TOKENS.toLocaleString()}-token output limit before finishing. ` +
        `Anything below is partial; treat it as unreviewed.`,
    );
  }
  if (review === '') {
    warnings.push(
      `**⚠️ Review incomplete — the model returned no review text.** ` +
        `The response contained ${response.content.length} block(s) ` +
        `(${response.content.map((b) => b.type).join(', ') || 'none'}) but no usable text. ` +
        `**This is not an all-clear — nothing was reviewed.** See the workflow logs.`,
    );
  }
  if (truncated) {
    const omittedList = (omitted ?? []).map((f) => `\`${f}\``).join(', ');
    warnings.push(
      firstFileTruncated
        ? `**⚠️ Partial review** — the first file alone exceeded the ${MAX_DIFF_CHARS.toLocaleString()}-char diff budget and was cut short.` +
            (omittedList ? ` Also not reviewed: ${omittedList}.` : '')
        : `**⚠️ Partial review** — the diff exceeded the ${MAX_DIFF_CHARS.toLocaleString()}-char budget. ` +
            `These files were **not reviewed**: ${omittedList}.`,
    );
  }

  const banner = warnings.length > 0 ? `${warnings.join('\n\n')}\n\n---\n\n` : '';
  const body = review === '' ? '_No review text was produced._' : review;

  const footer = [
    '',
    '---',
    `<sub>🤖 Automated review by \`${MODEL}\` — advisory only, this does not block merge.`,
    'Findings may be wrong; close anything you disagree with.</sub>',
  ].join('\n');

  return {
    markdown: `### AI review\n\n${banner}${body}\n${footer}\n`,
    warnings,
    review,
  };
}

// Only run when executed directly, so tests can import renderReview/capDiff without
// firing a real review.
const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  main().catch((err) => {
    // Exit non-zero so the failure is visible and debuggable. The workflow marks this
    // step continue-on-error, so an API problem annotates the run without blocking the
    // PR — this review is advisory and must never gate a merge on Anthropic uptime.
    if (err instanceof Anthropic.APIError) {
      console.error(
        `::warning title=AI review failed::Anthropic API error ${err.status}: ${err.message}`,
      );
    } else {
      console.error(`::warning title=AI review failed::${err.message}`);
    }
    process.exit(1);
  });
}
