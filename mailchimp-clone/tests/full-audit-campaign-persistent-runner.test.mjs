import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { deriveCampaignContinuation } from '../../large-project-capability-stack/packages/campaign-runtime/index.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(
  path.join(__dirname, '..', 'scripts', 'full-audit-campaign-persistent-runner.mjs'),
  'utf8'
);

function loadHelpers() {
  const start = source.indexOf('function normalizeFocusIds');
  const end = source.indexOf('ensureDir(ARTIFACT_DIR);');
  assert.ok(start >= 0 && end > start, 'failed to locate persistent runner helper functions');
  const snippet = source.slice(start, end);
  const context = { exported: {}, deriveCampaignContinuation };
  vm.runInNewContext(`${snippet}\nexported = { normalizeFocusIds, blockerText, deriveIterationContinuation, classifyNoProgressReason, consecutiveNoProgressIterations };`, context);
  return context.exported;
}

test('persistent runner treats partial parity-surface reduction blocker as a soft continuation state', () => {
  const { deriveIterationContinuation } = loadHelpers();
  const result = deriveIterationContinuation({
    blocker: 'Partial parity-surface reduction was proven, but remaining red surfaces are still open.',
    nextFocus: ['focus.signup_onboarding', 'focus.dashboard_home'],
    syncExitCode: 0,
    workerError: null,
    supervisorError: null,
    syncError: null
  });
  assert.equal(result.decision, 'continue_next_iteration');
});

test('persistent runner treats a no-parity-reduction blocker with next focus as a continuation state', () => {
  const { deriveIterationContinuation } = loadHelpers();
  const result = deriveIterationContinuation({
    blocker: 'No parity-surface reduction was proven by this iteration.',
    nextFocus: ['focus.signup_onboarding'],
    syncExitCode: 0,
    workerError: null,
    supervisorError: null,
    syncError: null
  });
  assert.equal(result.decision, 'continue_next_iteration');
});

test('persistent runner counts consecutive no-progress iterations for the circuit breaker', () => {
  const { classifyNoProgressReason, consecutiveNoProgressIterations } = loadHelpers();
  assert.equal(classifyNoProgressReason({ blocker: 'No parity-surface reduction was proven by this iteration.' }), 'no_surface_reduction');
  const streak = consecutiveNoProgressIterations([
    { iteration: 1, blocker: 'Partial parity-surface reduction was proven, but remaining red surfaces are still open.' },
    { iteration: 2, blocker: 'No parity-surface reduction was proven by this iteration.' },
    { iteration: 3, blocker: 'Planner emitted 1 no-op and 0 ungrounded patch candidate(s); no admissible parity-surface reduction was proven.' }
  ]);
  assert.deepEqual(Array.from(streak, (entry) => entry.iteration), [2, 3]);
});

test('persistent runner does not treat a generic blocker with no next focus as a continuation state', () => {
  const { deriveIterationContinuation } = loadHelpers();
  const result = deriveIterationContinuation({
    blocker: 'Authentication failed before remote execution could start.',
    nextFocus: [],
    syncExitCode: 0,
    workerError: null,
    supervisorError: null,
    syncError: null
  });
  assert.equal(result.decision, 'stop_blocked');
});

test('persistent runner synthesizes a real blocker when the worker exits before fresh delegate evidence arrives', () => {
  assert.match(source, /const workerFailureBlocker = worker\.status !== 0 \? \{/);
  assert.match(source, /100-agent worker failed before the control plane received fresh delegate evidence\./);
  assert.match(source, /const blocker = blockerReport\?\.blocker \|\| summary\?\.blocker \|\| programState\?\.supervisor\?\.blocker \|\| workerFailureBlocker \|\| syncFailureBlocker \|\| null;/);
});

test('persistent runner treats a strict 1:1 ceiling blocker with no next focus as stop-claim-blocked', () => {
  const { deriveIterationContinuation } = loadHelpers();
  const result = deriveIterationContinuation({
    blocker: 'Strict 1:1 parity ceiling is still red, so the Mailchimp clone cannot be treated as full-clone complete.',
    blockerKind: 'strict_1to1_ceiling',
    nextFocus: [],
    syncExitCode: 0,
    workerError: null,
    supervisorError: null,
    syncError: null
  });
  assert.equal(result.decision, 'stop_claim_blocked');
});

test('persistent runner defaults to a wall-clock runtime budget instead of a short fixed iteration cap', () => {
  assert.match(source, /const PROGRAM_ENV = resolveProgramEnvKeys\(\);/);
  assert.match(source, /const MAX_RUNTIME_HOURS = Math\.max\(1, Number\(process\.env\[PROGRAM_ENV\.maxRuntimeHours\] \|\| ORCHESTRATION_PROGRAM_SPEC\.defaults\.maxRuntimeHours\)\);/);
  assert.match(source, /const DEADLINE_AT_MS = STARTED_AT_MS \+ MAX_RUNTIME_MS;/);
  assert.match(source, /if \(Date\.now\(\) >= DEADLINE_AT_MS\) break;/);
  assert.match(source, /runtime_budget_reached/);
});

test('persistent runner falls back to remaining surface-matrix lanes when blocker nextFocus is missing', () => {
  assert.match(source, /const SURFACE_MATRIX_PATH = path\.join\(ARTIFACT_DIR, 'surface_matrix\.json'\);/);
  assert.match(source, /function deriveNextFocusFromSurfaceMatrix\(surfaceMatrix = null\)/);
  assert.match(source, /blockerKind: summary\?\.blockerKind \|\| programState\?\.supervisor\?\.blockerKind \|\| null,/);
  assert.match(source, /nextFocus: summary\?\.nextFocus \|\| blockerReport\?\.nextFocus \|\| deriveNextFocusFromSurfaceMatrix\(surfaceMatrix\)/);
});

test('persistent runner writes a no-progress audit and stops after the configured streak limit', () => {
  assert.match(source, /const NO_PROGRESS_AUDIT_PATH = path\.join\(ARTIFACT_DIR, 'no_progress_audit\.json'\);/);
  assert.match(source, /const MAX_NO_PROGRESS_ITERATIONS = Math\.max\(1, Number\(process\.env\[PROGRAM_ENV\.noProgressIterationLimit\] \|\| ORCHESTRATION_PROGRAM_SPEC\.defaults\.noProgressIterationLimit\)\);/);
  assert.match(source, /const noProgressStreak = consecutiveNoProgressIterations\(iterations\);/);
  assert.match(source, /if \(noProgressStreak\.length >= MAX_NO_PROGRESS_ITERATIONS\) \{/);
  assert.match(source, /writeJson\(NO_PROGRESS_AUDIT_PATH, audit\);/);
  assert.match(source, /Full-audit Mailchimp parity campaign tripped the no-progress circuit breaker\./);
});

test('persistent runner installs terminal persistence hooks and records claim-blocked stops distinctly', () => {
  assert.match(source, /import \{ ORCHESTRATION_PROGRAM_SPEC, resolveProgramEnvKeys, resolveProgramPaths, resolveProgramScriptPath \} from '\.\/lib\/orchestration-program-config\.mjs';/);
  assert.match(source, /initializeCampaign, installProcessTerminationPersistence/);
  assert.match(source, /initializeCampaign\(PROGRAM_STATE_PATH, \{/);
  assert.match(source, /continuationDecision: 'continue_next_iteration',/);
  assert.match(source, /installProcessTerminationPersistence\(/);
  assert.match(source, /status: 'terminated'/);
  assert.match(source, /overallStatus = continuation\.decision === 'stop_claim_blocked' \? 'claim_blocked' : 'blocked';/);
  assert.match(source, /Orchestration stopped cleanly because only the final full-clone claim remains blocked\./);
});

test('persistent runner invokes the watch\/notify path before terminal exit', () => {
  assert.match(source, /const WATCH_SCRIPT = resolveProgramScriptPath\(ROOT, 'watch'\);/);
  assert.match(source, /function runTerminalWatch\(\) \{/);
  assert.match(source, /spawnSync\(process\.execPath, \[WATCH_SCRIPT\], \{/);
  assert.match(source, /===== terminal watch =====/);
  assert.match(source, /runTerminalWatch\(\);\n    process\.exit\(1\);/);
  assert.match(source, /runTerminalWatch\(\);\n    process\.exit\(0\);/);
});

test('persistent runner only carries forward directly merged focus ids', () => {
  assert.match(source, /function deriveCompletedFocusIds\(iterationRecord = null\) \{/);
  assert.match(source, /const mergedFocusIds = new Set\(normalizeFocusIds\(iterationRecord\?\.mergedFocusIds \|\| \[\]\)\);/);
  assert.match(source, /if \(mergedFocusIds\.size > 0\) return parityFocusIds\.filter\(\(focusId\) => mergedFocusIds\.has\(focusId\)\);/);
  assert.doesNotMatch(source, /const explicitFullCompletion = !iterationRecord\?\.blocker/);
  assert.match(source, /for \(const focusId of deriveCompletedFocusIds\(iterationRecord\)\) completedFocusIds\.add\(focusId\);/);
});
