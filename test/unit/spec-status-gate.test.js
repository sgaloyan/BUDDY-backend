// Tests for the spec-status CI gate.
//
// Derived from specs/spec-status-gate.spec.md §7. Each test maps to one acceptance
// criterion and exercises the pure `evaluateGate` export only — no git, no filesystem,
// no network. The CLI wrapper supplies the I/O; the decision logic is what matters here.
//
// The rule under test (§5, R-1): fail iff the PR changes something under src/ AND a
// spec it touches is not Approved or Implemented.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { evaluateGate, parseStatus, isSpecPath } from '../../.github/scripts/spec-status-gate.mjs';

// Minimal spec fixtures — only the header matters to the gate.
const specWith = (status) =>
  [
    '# Spec: Example',
    '',
    `> **Status:** ${status}`,
    '> **Slice:** Slice N — example',
    '',
    '## 1. Summary',
  ].join('\n');

const NO_STATUS_LINE = ['# Spec: Example', '', '> **Slice:** Slice N — example'].join('\n');

// The real specs/_template.spec.md header: deliberately unparseable, must be excluded
// by path before its status is ever read (§3.1).
const TEMPLATE = [
  '# Spec: <Feature Name>',
  '',
  '> **Status:** Draft | Approved | Implemented',
].join('\n');

describe('evaluateGate — the core rule (R-1)', () => {
  test('src/ change + a Draft spec fails, naming the spec', () => {
    const result = evaluateGate({
      changedFiles: ['src/services/invite.service.js', 'specs/invites.spec.md'],
      specContents: { 'specs/invites.spec.md': specWith('Draft') },
    });

    assert.equal(result.ok, false);
    assert.deepEqual(result.violations, [{ path: 'specs/invites.spec.md', status: 'Draft' }]);
  });

  test('src/ change + an Approved spec passes', () => {
    const result = evaluateGate({
      changedFiles: ['src/services/invite.service.js', 'specs/invites.spec.md'],
      specContents: { 'specs/invites.spec.md': specWith('Approved') },
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.violations, []);
  });

  test('src/ change + an Implemented spec passes', () => {
    const result = evaluateGate({
      changedFiles: ['src/services/auth.service.js', 'specs/auth.spec.md'],
      specContents: { 'specs/auth.spec.md': specWith('Implemented') },
    });

    assert.equal(result.ok, true);
  });

  test('two Draft specs alongside a src/ change both appear in violations', () => {
    const result = evaluateGate({
      changedFiles: ['src/app.js', 'specs/invites.spec.md', 'specs/profiles.spec.md'],
      specContents: {
        'specs/invites.spec.md': specWith('Draft'),
        'specs/profiles.spec.md': specWith('Draft'),
      },
    });

    assert.equal(result.ok, false);
    assert.deepEqual(result.violations.map((v) => v.path).sort(), [
      'specs/invites.spec.md',
      'specs/profiles.spec.md',
    ]);
  });
});

describe('evaluateGate — what must NOT be blocked', () => {
  // R-2: iterating on a Draft spec is step 1 of the loop. A gate that blocks it is
  // hostile to the process it exists to enforce.
  test('spec-only PR with a Draft spec passes', () => {
    const result = evaluateGate({
      changedFiles: ['specs/invites.spec.md'],
      specContents: { 'specs/invites.spec.md': specWith('Draft') },
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.violations, []);
  });

  // R-3: the deliberate hole. Bugfixes to already-shipped code touch no spec, and
  // failing them would make the gate unusable.
  test('src/ change touching no spec passes, with nothing checked', () => {
    const result = evaluateGate({
      changedFiles: ['src/services/auth.service.js', 'src/lib/logger.js'],
      specContents: {},
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.checked, []);
  });

  // R-4: step 3 of the loop explicitly allows tests before implementation.
  test('test/ change + a Draft spec passes when src/ is untouched', () => {
    const result = evaluateGate({
      changedFiles: ['test/integration/invites.test.js', 'specs/invites.spec.md'],
      specContents: { 'specs/invites.spec.md': specWith('Draft') },
    });

    assert.equal(result.ok, true);
  });
});

describe('evaluateGate — fails closed on an unreadable status (R-5)', () => {
  // The status field is the process's only machine-checkable claim about itself.
  // A value the machine cannot read is a degraded state, and a degraded state must
  // announce itself rather than pass quietly.
  test('a spec with no Status: line is a violation', () => {
    const result = evaluateGate({
      changedFiles: ['src/app.js', 'specs/invites.spec.md'],
      specContents: { 'specs/invites.spec.md': NO_STATUS_LINE },
    });

    assert.equal(result.ok, false);
    assert.deepEqual(result.violations, [{ path: 'specs/invites.spec.md', status: null }]);
  });

  test('a spec with an unrecognized status word is a violation', () => {
    const result = evaluateGate({
      changedFiles: ['src/app.js', 'specs/invites.spec.md'],
      specContents: { 'specs/invites.spec.md': specWith('Shipped') },
    });

    assert.equal(result.ok, false);
    assert.equal(result.violations[0].status, null);
  });
});

describe('evaluateGate — non-feature files under specs/ are ignored (§3.1)', () => {
  // The template's status line reads "Draft | Approved | Implemented" by design.
  // Parsing it would turn every PR that touches the template red.
  test('specs/_template.spec.md is ignored alongside a src/ change', () => {
    const result = evaluateGate({
      changedFiles: ['src/app.js', 'specs/_template.spec.md'],
      specContents: { 'specs/_template.spec.md': TEMPLATE },
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.checked, []);
  });

  test('specs/README.md is ignored alongside a src/ change', () => {
    const result = evaluateGate({
      changedFiles: ['src/app.js', 'specs/README.md'],
      specContents: { 'specs/README.md': '# Specs\n' },
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.checked, []);
  });
});

describe('evaluateGate — a passing run still shows its work', () => {
  // Silence must not be the same shape as success: a pass that examined specs has to
  // be able to say which ones, so the notice is never empty when work was done.
  test('checked lists every spec examined, with its status', () => {
    const result = evaluateGate({
      changedFiles: ['src/app.js', 'specs/auth.spec.md', 'specs/invites.spec.md'],
      specContents: {
        'specs/auth.spec.md': specWith('Implemented'),
        'specs/invites.spec.md': specWith('Approved'),
      },
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.checked, [
      { path: 'specs/auth.spec.md', status: 'Implemented' },
      { path: 'specs/invites.spec.md', status: 'Approved' },
    ]);
  });
});

describe('parseStatus', () => {
  test('reads the canonical header line', () => {
    assert.equal(parseStatus(specWith('Approved')), 'Approved');
  });

  test('returns null for a missing line, a template line, and a lowercase word', () => {
    assert.equal(parseStatus(NO_STATUS_LINE), null);
    assert.equal(parseStatus(TEMPLATE), null);
    assert.equal(parseStatus(specWith('approved')), null);
  });
});

describe('isSpecPath', () => {
  test('matches feature specs only', () => {
    assert.equal(isSpecPath('specs/auth.spec.md'), true);
    assert.equal(isSpecPath('specs/_template.spec.md'), false);
    assert.equal(isSpecPath('specs/README.md'), false);
    assert.equal(isSpecPath('specs/nested/other.spec.md'), false);
    assert.equal(isSpecPath('docs/ai-sdlc.md'), false);
  });
});
