// Spec-status gate for a pull request.
//
// Enforces principle 1 of docs/ai-sdlc.md — no implementation code ships alongside a
// spec still marked `Draft`. Slice 1 broke that rule silently: specs/auth.spec.md sat at
// `Draft` while its code ran in production, and nothing noticed, because the only thing
// checking was memory. This converts the rule into one that cannot be forgotten.
//
// Spec: specs/spec-status-gate.spec.md
// Usage: BASE_SHA=<sha> HEAD_SHA=<sha> node .github/scripts/spec-status-gate.mjs

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// The three canonical values. Anything else — including a missing line — is unreadable.
const CANONICAL_STATUSES = new Set(['Draft', 'Approved', 'Implemented']);

// The two that authorize implementation code to ship (spec §5, R-1).
const SHIPPABLE_STATUSES = new Set(['Approved', 'Implemented']);

const STATUS_LINE = /^>\s*\*\*Status:\*\*\s*(.+?)\s*$/m;

// Feature specs only: specs/<name>.spec.md, basename not starting with `_`.
// The underscore exclusion is load-bearing — specs/_template.spec.md carries the line
// "Status: Draft | Approved | Implemented", which is unparseable on purpose. Reading it
// as a real status would turn every PR that touches the template red.
const SPEC_PATH = /^specs\/([^/]+)\.spec\.md$/;

// Implementation code, and only this. Not test/ (the loop explicitly permits tests
// before implementation) and not .github/ (spec §8 — arguable, deliberately excluded).
const IMPLEMENTATION_PREFIX = 'src/';

export function isSpecPath(path) {
  const match = SPEC_PATH.exec(path);
  return match !== null && !match[1].startsWith('_');
}

export function parseStatus(contents) {
  const match = STATUS_LINE.exec(contents ?? '');
  if (match === null) return null;

  const value = match[1].trim();
  return CANONICAL_STATUSES.has(value) ? value : null;
}

// Pure: no I/O, so the whole decision is unit-testable. `specContents` maps a spec path
// to its file contents; the CLI below supplies them from disk.
export function evaluateGate({ changedFiles, specContents }) {
  const touchesImplementation = changedFiles.some((path) => path.startsWith(IMPLEMENTATION_PREFIX));

  const checked = changedFiles.filter(isSpecPath).map((path) => ({
    path,
    status: parseStatus(specContents[path]),
  }));

  // A null status fails this test too, which is the point: fail closed (§5, R-5).
  const violations = touchesImplementation
    ? checked.filter(({ status }) => !SHIPPABLE_STATUSES.has(status))
    : [];

  return { ok: violations.length === 0, violations, checked };
}

// Exit 2 — the check could not run. Never exit 0 on an indeterminate result: silence
// must not be the same shape as success (§5, R-7).
function cannotRun(detail) {
  console.error(`::error title=Spec gate could not run::${detail}`);
  process.exit(2);
}

function changedFilesBetween(base, head) {
  // --diff-filter=d drops deletions: a removed spec has no status to read and is not a
  // violation (§5, R-6).
  try {
    return execFileSync('git', ['diff', '--name-only', '--diff-filter=d', `${base}...${head}`], {
      encoding: 'utf8',
    })
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '');
  } catch (err) {
    const stderr = (err.stderr ?? '').toString().trim().replace(/\s+/g, ' ');
    return cannotRun(`git diff ${base}...${head} failed: ${stderr || err.message}`);
  }
}

function main() {
  const { BASE_SHA: base, HEAD_SHA: head } = process.env;

  const missing = [
    ['BASE_SHA', base],
    ['HEAD_SHA', head],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length > 0) {
    cannotRun(`${missing.join(' and ')} not set; cannot compute the PR diff.`);
  }

  const changedFiles = changedFilesBetween(base, head);

  const specContents = {};
  for (const path of changedFiles.filter(isSpecPath)) {
    try {
      specContents[path] = readFileSync(path, 'utf8');
    } catch {
      // Deletions are already filtered out, so an unreadable spec here is unexpected.
      // Leave it undefined: parseStatus returns null and it counts as a violation
      // rather than quietly disappearing from the check.
      specContents[path] = null;
    }
  }

  const { ok, violations, checked } = evaluateGate({ changedFiles, specContents });

  if (!ok) {
    for (const { path, status } of violations) {
      if (status === null) {
        console.error(
          `::error title=Spec status unreadable::${path} has no readable "Status:" line ` +
            `(expected Draft, Approved, or Implemented) and this PR changes implementation ` +
            `code under src/.`,
        );
      } else {
        console.error(
          `::error title=Spec not approved::${path} is ${status} but this PR changes ` +
            `implementation code under src/. Approve the spec first (docs/ai-sdlc.md, step 2).`,
        );
      }
    }
    process.exit(1);
  }

  // A passing run shows its work — a bare green check that examined nothing looks
  // identical to one that examined everything.
  const summary =
    checked.length === 0
      ? 'no feature specs were touched by this PR.'
      : checked.map(({ path, status }) => `${path} (${status})`).join(', ');

  console.log(`::notice title=Spec gate passed::${summary}`);
}

// Only run when executed directly, so the tests can import the pure parts.
const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  main();
}
