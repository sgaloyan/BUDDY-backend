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

const MODEL = 'claude-sonnet-4-6';
const SPECS_DIR = 'specs';

// The diff is the only unbounded input here. Cap it so a huge PR degrades into a
// partial review rather than a wall of tokens or a rejected request.
const MAX_DIFF_CHARS = 200_000;

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

  let truncated = false;
  if (diff.length > MAX_DIFF_CHARS) {
    diff = diff.slice(0, MAX_DIFF_CHARS);
    truncated = true;
  }

  const client = new Anthropic(); // reads ANTHROPIC_API_KEY from the environment

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          `<specs>\n${readSpecs()}\n</specs>`,
          `<pull_request>\nTitle: ${process.env.PR_TITLE ?? '(none)'}\n\n${process.env.PR_BODY || '(no description)'}\n</pull_request>`,
          `<diff${truncated ? ' truncated="true"' : ''}>\n${diff}\n</diff>`,
          truncated
            ? 'Note: the diff was truncated to fit. Review what is present and say so at the end.'
            : 'Review this diff.',
        ].join('\n\n'),
      },
    ],
  });

  const review = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();

  const footer = [
    '',
    '---',
    `<sub>🤖 Automated review by \`${MODEL}\` — advisory only, this does not block merge.`,
    'Findings may be wrong; close anything you disagree with.' +
      (truncated ? ' **The diff was truncated — this review is partial.**' : '') +
      '</sub>',
  ].join('\n');

  writeFileSync(outputPath, `### AI review\n\n${review}\n${footer}\n`);
  console.log(`Review written to ${outputPath} (${response.usage.output_tokens} output tokens)`);
}

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
