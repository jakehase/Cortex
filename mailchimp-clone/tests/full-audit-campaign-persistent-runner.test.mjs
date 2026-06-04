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

function loadHelpers({ env = {}, objectiveGaps = null } = {}) {
  const start = source.indexOf('function normalizeFocusIds');
  const end = source.indexOf('ensureDir(ARTIFACT_DIR);');
  assert.ok(start >= 0 && end > start, 'failed to locate persistent runner helper functions');
  const snippet = source.slice(start, end);
  const context = {
    exported: {},
    deriveCampaignContinuation,
    CONTINUE_UNTIL_GLOBAL_PARITY: true,
    SOAK_FULL_RUNTIME: env.MAILCHIMP_PARITY_SOAK_FULL_RUNTIME === '1',
    CAMPAIGN_RUN_ID: 'virtual-campaign',
    DEADLINE_AT_MS: Date.now() + 60_000,
    MAX_NO_PROGRESS_ITERATIONS: 1,
    STRICT_GAP_INVENTORY_PATH: '/virtual/strict_1to1_gap_inventory.json',
    CONTRACT_PATH: '/virtual/contract.json',
    process: { env },
    readJson: (filePath) => filePath === '/virtual/contract.json'
      ? { fidelity: env.ORCHESTRATOR_REQUESTED_FIDELITY || null }
      : { gaps: [{ id: 'already_done' }, { id: 'needs_work' }] },
    strictGapAlreadySatisfied: (gapId) => gapId === 'already_done',
    strictGapSwarmAlreadySatisfied: () => false,
    strictGapStructuralAlreadySatisfied: () => false,
    strictGapFrontierAlreadySatisfied: () => false,
    strictGapRemediationAlreadySatisfied: () => false,
    fullCloneObjectiveInventory: () => objectiveGaps || [{ id: 'already_done' }, { id: 'needs_work' }]
  };
  vm.runInNewContext(`${snippet}\nexported = { normalizeFocusIds, blockerText, hasControlPlaneSyncOrLandingFailure, continuousProductRunRequested, shouldContinueFullCloneAfterProgress, deriveIterationContinuation, classifyNoProgressReason, consecutiveNoProgressIterations, failedFocusExclusionDelta, buildNoProgressAudit, isAutonomyOnlyThresholdGate, remainingGlobalParityFocusIds, shouldReopenFullCloneFrontier, reopenFullCloneFrontierFocusIds };`, context);
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
  assert.equal(classifyNoProgressReason({ blocker: 'Selected live work produced no surviving product-code diff under mechanical LOC accounting.' }), 'no_surviving_product_diff');
  const streak = consecutiveNoProgressIterations([
    { iteration: 1, blocker: 'Partial parity-surface reduction was proven, but remaining red surfaces are still open.' },
    { iteration: 2, blocker: 'No parity-surface reduction was proven by this iteration.' },
    { iteration: 3, blocker: 'Planner emitted 1 no-op and 0 ungrounded patch candidate(s); no admissible parity-surface reduction was proven.' }
  ]);
  assert.deepEqual(Array.from(streak, (entry) => entry.iteration), [2, 3]);
});

test('persistent runner trips no-progress terminal even when only new failed subshards are being excluded', () => {
  const { failedFocusExclusionDelta, buildNoProgressAudit } = loadHelpers();
  const record = {
    iteration: 2,
    runId: 'iter-002',
    blocker: 'Selected live work produced no surviving product-code diff under mechanical LOC accounting.',
    blockerKind: 'orchestration',
    mergedFocusIds: [],
    nextFocus: ['focus.frontend_client_shell_state'],
    canonicalLandingOk: true,
    canonicalLandedProductFileCount: 0,
    excludedFocusIds: ['focus.prior_leaf'],
    failedFocusIds: ['focus.prior_leaf', 'focus.new_leaf']
  };
  assert.deepEqual(Array.from(failedFocusExclusionDelta(record)), ['focus.new_leaf']);
  const audit = buildNoProgressAudit([record]);
  assert.equal(audit.noFailedFocusExclusionDelta, false);
  assert.equal(audit.onlyFailedLeafExclusionChurn, true);
  assert.equal(audit.terminal, true);
  assert.deepEqual(Array.from(audit.freshFailedFocusExclusions), ['focus.new_leaf']);
});

test('persistent runner stops zero-work loops when only the autonomy threshold remains after all focus ids are credited', () => {
  const { isAutonomyOnlyThresholdGate } = loadHelpers();
  const record = {
    blockerKind: 'benchmark_threshold_gate',
    nextFocus: [],
    blocker: {
      thresholdEvaluation: {
        failures: [
          { thresholdField: 'minimumAutonomyMinutes', observedField: 'autonomyMinutes', observed: 0.49, required: 120 }
        ]
      }
    }
  };
  assert.equal(
    isAutonomyOnlyThresholdGate(record, new Set(['focus.one', 'focus.two']), ['focus.one', 'focus.two']),
    true
  );
  assert.equal(
    isAutonomyOnlyThresholdGate(record, new Set(['focus.one']), ['focus.one', 'focus.two']),
    false,
    'do not stop the runner before every benchmark-scope focus id has landed and been credited'
  );
});

test('persistent runner global parity continuation excludes mechanically satisfied and temporarily excluded strict gaps outside full-clone mode', () => {
  const { remainingGlobalParityFocusIds } = loadHelpers();
  assert.deepEqual(remainingGlobalParityFocusIds(new Set()), ['focus.needs_work']);
  assert.deepEqual(remainingGlobalParityFocusIds(new Set(), new Set(['focus.needs_work'])), []);
  assert.deepEqual(remainingGlobalParityFocusIds(new Set(['focus.needs_work'])), []);
});

test('persistent runner treats excluded full-clone focus ids as repair work and includes broad objectives', () => {
  const { remainingGlobalParityFocusIds } = loadHelpers({
    env: { ORCHESTRATOR_REQUESTED_FIDELITY: 'full_clone' },
    objectiveGaps: [{ id: 'needs_work' }, { id: 'api_keys_webhooks' }, { id: 'frontend_client_shell_state', broadFullCloneObjective: true }]
  });
  assert.deepEqual(
    remainingGlobalParityFocusIds(new Set(['focus.needs_work']), new Set(['focus.api_keys_webhooks'])),
    ['focus.api_keys_webhooks', 'focus.frontend_client_shell_state']
  );
});

test('persistent runner reopens broad full-clone frontier when finite matrix is exhausted but full-clone truth is red', () => {
  const { shouldReopenFullCloneFrontier, reopenFullCloneFrontierFocusIds } = loadHelpers({
    env: { ORCHESTRATOR_REQUESTED_FIDELITY: 'full_clone' },
    objectiveGaps: [
      { id: 'strict_done' },
      { id: 'frontend_client_shell_state', broadFullCloneObjective: true },
      { id: 'audience_identity_lifecycle', broadFullCloneObjective: true }
    ]
  });
  const completed = new Set([
    'focus.strict_done',
    'focus.frontend_client_shell_state',
    'focus.audience_identity_lifecycle'
  ]);
  assert.equal(shouldReopenFullCloneFrontier({
    contract: { fidelity: 'full_clone' },
    matrixStatus: 'scope_satisfied_zero_work',
    parityStatus: 'not_full_clone',
    blockerKind: 'zero_work_scoped_green',
    remainingGlobalFocusIds: []
  }), true);
  assert.deepEqual(Array.from(reopenFullCloneFrontierFocusIds(completed)), [
    'focus.frontend_client_shell_state',
    'focus.audience_identity_lifecycle'
  ]);
  assert.deepEqual(Array.from(completed), ['focus.strict_done']);
});

test('persistent runner continues after planner no-op blockers when canonical product landing progress was proven', () => {
  const { deriveIterationContinuation } = loadHelpers();
  const result = deriveIterationContinuation({
    blocker: 'Planner emitted 3 no-op and 0 ungrounded patch candidate(s); no admissible parity-surface reduction was proven.',
    blockerKind: 'orchestration',
    nextFocus: [],
    syncExitCode: 0,
    workerError: null,
    supervisorError: null,
    syncError: null,
    canonicalLandingOk: true,
    canonicalLandedProductFileCount: 1
  });
  assert.equal(result.decision, 'continue_next_iteration');
  assert.equal(result.shouldContinue, true);
});

test('persistent runner stops after red iterations when sync or canonical landing failed', () => {
  const { deriveIterationContinuation, hasControlPlaneSyncOrLandingFailure, shouldContinueFullCloneAfterProgress } = loadHelpers({
    env: { ORCHESTRATOR_REQUESTED_FIDELITY: 'full_clone' }
  });
  const failedSyncRecord = {
    blocker: 'Control-plane sync step failed after the remote audit iteration completed.',
    blockerKind: 'strict_1to1_ceiling',
    syncExitCode: 1,
    syncError: null,
    canonicalLandingOk: false,
    canonicalLandedProductFileCount: 0,
    canonicalLandingEvidence: { ok: false },
    workerExitCode: 1,
    workerError: 'remote_execution_iteration_cap_reached',
    nextFocus: ['focus.frontend_client_shell_state']
  };
  assert.equal(hasControlPlaneSyncOrLandingFailure(failedSyncRecord), true);
  assert.equal(shouldContinueFullCloneAfterProgress(failedSyncRecord, { fidelity: 'full_clone' }), false);
  const result = deriveIterationContinuation(failedSyncRecord);
  assert.equal(result.decision, 'stop_blocked');
  assert.equal(result.blockerSemantics, 'terminal_sync_or_landing_failure');
});

test('persistent runner keeps production-slice continuous runs moving after real canonical product progress', () => {
  const { continuousProductRunRequested, shouldContinueFullCloneAfterProgress } = loadHelpers({
    env: {
      ORCHESTRATOR_REQUESTED_FIDELITY: 'production_slice',
      MAILCHIMP_CONTINUE_UNTIL_GLOBAL_PARITY: '1',
      MAILCHIMP_PARITY_SOAK_FULL_RUNTIME: '1'
    }
  });
  const record = {
    blocker: 'Partial parity-surface reduction was proven, but remaining red surfaces are still open.',
    blockerKind: 'orchestration',
    syncExitCode: 0,
    syncError: null,
    canonicalLandingOk: true,
    canonicalLandedProductFileCount: 3,
    canonicalLandingEvidence: { ok: true, newlyLandedProductFileCount: 3 },
    workerExitCode: 1,
    workerError: null,
    parityStatus: 'partial',
    green: false
  };
  assert.equal(continuousProductRunRequested({ fidelity: 'production_slice' }), true);
  assert.equal(shouldContinueFullCloneAfterProgress(record, { fidelity: 'production_slice' }), true);
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
  assert.match(source, /const effectiveWorkerFailureBlocker = targetedSemanticReplaySatisfied \? null : workerFailureBlocker;/);
  assert.match(source, /let blocker = effectiveSyncFailureBlocker \|\| landingFailureBlocker \|\| artifactContractBlocker \|\| blockerReport\?\.blocker \|\| summary\?\.blocker \|\| programState\?\.supervisor\?\.blocker \|\| effectiveWorkerFailureBlocker \|\| null;/);
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
  assert.match(source, /function firstNonEmptyFocusList\(\.\.\.candidates\)/);
  assert.match(source, /nextFocus: targetedSemanticReplaySatisfied \? \[\] : firstNonEmptyFocusList\(summary\?\.nextFocus, blockerReport\?\.nextFocus, deriveNextFocusFromSurfaceMatrix\(surfaceMatrix\)\)/);
});

test('persistent runner writes a no-progress audit and stops after repeated unchanged no-landing iterations', () => {
  assert.match(source, /const NO_PROGRESS_AUDIT_PATH = path\.join\(ARTIFACT_DIR, 'no_progress_audit\.json'\);/);
  assert.match(source, /const MAX_NO_PROGRESS_ITERATIONS = Math\.max\(1, Number\(process\.env\[PROGRAM_ENV\.noProgressIterationLimit\] \|\| ORCHESTRATION_PROGRAM_SPEC\.defaults\.noProgressIterationLimit\)\);/);
  assert.match(source, /function hasCanonicalLandingProgress\(record = null\)/);
  assert.match(source, /return canonicalLandingDelta\(record\) > 0;/);
  assert.match(source, /entry\?\.changedInCanonicalCheckout === true \|\| entry\?\.alreadyMatchedBeforeSync === true/);
  assert.match(source, /control-plane sync step failed after the remote audit iteration completed/i);
  assert.match(source, /canonicalLandingOk: targetedSemanticReplaySatisfied \|\| syncStatus\?\.canonicalLandingEvidence\?\.ok === true,/);
  assert.match(source, /canonicalLandedProductFileCount: targetedSemanticReplaySatisfied \? 0 : Number\(syncStatus\?\.canonicalLandingEvidence\?\.newlyLandedProductFileCount \|\| 0\),/);
  assert.match(source, /const noProgressStreak = consecutiveNoProgressIterations\(iterations\);/);
  assert.match(source, /const noProgressAudit = buildNoProgressAudit\(iterations\);/);
  assert.match(source, /if \(noProgressAudit\.terminal\) \{/);
  assert.match(source, /writeJson\(NO_PROGRESS_AUDIT_PATH, noProgressAudit\);/);
  assert.match(source, /no canonical product landing delta and no merged focus credit/);
  assert.match(source, /do not count failed-leaf exclusion churn as productive progress/);
  assert.match(source, /Full-audit Mailchimp parity campaign tripped the no-progress circuit breaker\./);
});

test('persistent runner lets terminal no-progress truth override delegate continue decisions', () => {
  assert.match(source, /const delegateContinuationDecision = iterationRecord\.continuationDecision \|\| null;/);
  assert.match(source, /const derivedContinuation = deriveIterationContinuation\(iterationRecord\);/);
  assert.match(source, /const terminalNoProgressReason = classifyNoProgressReason\(iterationRecord\);/);
  assert.match(source, /if \(terminalNoProgressReason && !hasCanonicalLandingProgress\(iterationRecord\)\) \{/);
  assert.match(source, /continuation\.blockerSemantics = 'terminal_no_progress';/);
  assert.match(source, /continuation\.decision = 'stop_blocked';/);
  assert.match(source, /iterationRecord\.delegateContinuationDecisionIgnored = delegateContinuationDecision;/);
});

test('persistent runner installs terminal persistence hooks and records claim-blocked stops distinctly', () => {
  assert.match(source, /import \{ ORCHESTRATION_PROGRAM_SPEC, resolveProgramEnvKeys, resolveProgramPaths, resolveProgramScriptPath \} from '\.\/lib\/orchestration-program-config\.mjs';/);
  assert.match(source, /deriveTopLevelIterationDecision, reduceRunState/);
  assert.match(source, /initializeCampaign, installProcessTerminationPersistence/);
  assert.match(source, /initializeCampaign\(PROGRAM_STATE_PATH, \{/);
  assert.match(source, /continuationDecision: 'continue_next_iteration',/);
  assert.match(source, /installProcessTerminationPersistence\(/);
  assert.match(source, /artifactRoot: ARTIFACT_DIR/);
  assert.match(source, /getRunStateInput: buildTerminationRunStateInput/);
  assert.match(source, /runStateName: 'run_state_truth\.json'/);
  assert.match(source, /terminalPersistenceError/);
  assert.match(source, /status: 'terminated'/);
  assert.match(source, /overallStatus = continuation\.decision === 'stop_claim_blocked' \? 'claim_blocked' : 'blocked';/);
  assert.match(source, /Orchestration stopped cleanly because only the final full-clone claim remains blocked\./);
});

test('persistent runner gates new iterations through shared run-state truth before worker spawn', () => {
  assert.match(source, /const RUN_STATE_TRUTH_NAME = 'run_state_truth\.json';/);
  assert.match(source, /const ITERATION_LAUNCH_GATE_PATH = path\.join\(ARTIFACT_DIR, 'iteration_launch_gate\.json'\);/);
  assert.match(source, /function evaluateIterationLaunchGate\(\{ iteration, runId, runDir \} = \{\}\) \{/);
  assert.match(source, /deriveTopLevelIterationDecision\(\{/);
  assert.match(source, /blockingDecisions = new Set\(\['must_wait_active_run', 'must_stop_truth_contradiction', 'must_stop_claim_blocked'\]\)/);
  assert.match(source, /if \(launchGate\.ok === false\) blockBeforeSpawnFromLaunchGate\(\{ gate: launchGate, runId, iteration \}\);/);
  assert.match(source, /const worker = spawnSync\(process\.execPath, \[WORKER_SCRIPT\]/);
});

test('persistent runner writes run-state truth and enforces the iteration artifact contract', () => {
  assert.match(source, /function evaluateIterationArtifactContract\(\{ runDir, includeRunState = true \} = \{\}\) \{/);
  assert.match(source, /remote_execution_status\.json/);
  assert.match(source, /function writeIterationRunStateTruth\(\{ runDir, runId, iteration, input = \{\}, phase = 'post_iteration' \} = \{\}\) \{/);
  assert.match(source, /reduceRunState\(input, \{ generatedAt \}\)/);
  assert.match(source, /writeJson\(path\.join\(runDir, RUN_STATE_TRUTH_NAME\), payload\);/);
  assert.match(source, /Iteration artifact contract is incomplete, so supervisor green cannot be credited\./);
  assert.match(source, /runStateTruth\.terminalState === 'contradiction_blocked'/);
});

test('launch wrapper has an opt-in full-clone autopilot relaunch guard without child recursion', () => {
  const launchSource = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'full-audit-campaign-launch.mjs'), 'utf8');
  assert.match(launchSource, /MAILCHIMP_FULL_CLONE_AUTOPILOT/);
  assert.match(launchSource, /MAILCHIMP_AUTOPILOT_CHILD !== '1'/);
  assert.match(launchSource, /run\('scripts\/full-clone-autopilot\.mjs'\)/);
  assert.match(launchSource, /autopilotExitCode/);
  assert.match(launchSource, /MAILCHIMP_ENABLE_SEMANTIC_WORK_DIRECTOR/);
  assert.match(launchSource, /\?\? '1'/);
});

test('persistent runner expands exhausted scoped graphs when the full-clone objective still has remaining surfaces', () => {
  assert.match(source, /deriveObjectiveExpansion/);
  assert.match(source, /function requestedFullClone\(contract = null\) \{/);
  assert.match(source, /status: 'expanding_objective_graph'/);
  assert.match(source, /Current scoped graph is satisfied, but the requested full-clone objective is not/);
  assert.match(source, /blockerKind: iterationRecord\.blockerKind/);
  assert.match(source, /Scoped graph was exhausted before the full-clone objective was satisfied/);
  assert.match(source, /remainingGlobalFocusIds/);
  assert.match(source, /full_clone_frontier_reopened_after_finite_matrix_exhaustion/);
  assert.match(source, /reopenFullCloneFrontierFocusIds\(completedFocusIds\)/);
});

test('persistent runner keeps full-clone campaigns moving only after clean canonical product landing progress', () => {
  assert.match(source, /function advanceFullCloneContinuationWaveFloor\(runDir = null\)/);
  assert.match(source, /MAILCHIMP_FULL_CLONE_CONTINUATION_MIN_WAVE/);
  assert.match(source, /function hasControlPlaneSyncOrLandingFailure\(record = null\)/);
  assert.match(source, /iterationRecord\.blockerKind === 'strict_1to1_ceiling'/);
  assert.match(source, /process\.env\.ORCHESTRATOR_REQUESTED_FIDELITY === 'full_clone'/);
  assert.match(source, /CONTINUE_UNTIL_GLOBAL_PARITY/);
  assert.match(source, /!hasControlPlaneSyncOrLandingFailure\(iterationRecord\)/);
  assert.match(source, /&& hasCanonicalLandingProgress\(iterationRecord\)/);
  assert.doesNotMatch(source, /claim_blocked_continue_until_strict_green/);
  assert.match(source, /function shouldContinueFullCloneAfterProgress\(record = null, contract = null\) \{/);
  assert.match(source, /function continuousProductRunRequested\(contract = null\) \{/);
  assert.match(source, /hasControlPlaneSyncOrLandingFailure\(record\)/);
  assert.match(source, /full_clone_wave_boundary_but_progressing/);
  assert.match(source, /partial parity-surface reduction was proven\|remaining red surfaces are still open\|no parity-surface reduction was proven by this iteration/i);
  assert.match(source, /remote_execution_iteration_cap_reached\|iteration cap/i);
  assert.match(source, /if \(shouldContinueFullCloneAfterProgress\(iterationRecord, readJson\(CONTRACT_PATH, null\)\)\) \{/);
  assert.match(source, /continuation\.decision = 'continue_next_iteration';/);
});

test('persistent runner carries remote benchmark progress across wave boundaries', () => {
  assert.match(source, /function deriveCompletedFocusIdsFromDelegateProgress\(runDir = null, syncStatus = null\) \{/);
  assert.match(source, /function isTargetedSemanticReplaySatisfied\(remoteExecutionStatus = null\) \{/);
  assert.match(source, /remote_execution_target_satisfied/);
  assert.match(source, /targetedSemanticReplay\?\.satisfied === true/);
  assert.match(source, /targetedSemanticReplayFocusIds\(remoteExecutionStatus\)/);
  assert.match(source, /path\.join\(runDir, 'delegate', 'benchmark_progress\.json'\)/);
  assert.match(source, /progress\?\.verifiedFocusIds/);
  assert.doesNotMatch(source, /progress\?\.completedFocusIds/);
  assert.match(source, /for \(const focusId of deriveCompletedFocusIdsFromDelegateProgress\(runDir, syncStatus\)\) completedFocusIds\.add\(focusId\);/);
});

test('persistent runner treats pre-verified targeted semantic replay as scoped green without requiring a fresh patch', () => {
  assert.match(source, /const targetedSemanticReplaySatisfied = isTargetedSemanticReplaySatisfied\(remoteExecutionStatus\);/);
  assert.match(source, /const effectiveSyncFailureBlocker = targetedSemanticReplaySatisfied \? null : syncFailureBlocker;/);
  assert.match(source, /syncExitCode: targetedSemanticReplaySatisfied \? 0 : sync\.status/);
  assert.match(source, /supervisorStatus: targetedSemanticReplaySatisfied \? 'green'/);
  assert.match(source, /matrixStatus: targetedSemanticReplaySatisfied \? 'all_complete'/);
  assert.match(source, /parityStatus: targetedSemanticReplaySatisfied \? 'parity_for_scope'/);
  assert.match(source, /targetedSemanticReplayLandingEvidence\(remoteExecutionStatus\)/);
  assert.match(source, /record\?\.targetedSemanticReplaySatisfied === true/);
  assert.match(source, /requestedFullClone\(activeContract\) && CONTINUE_UNTIL_GLOBAL_PARITY && remainingGlobalFocusIds\.length > 0/);
});

test('persistent runner preserves credited focus ids in in-flight status snapshots', () => {
  assert.match(source, /phase: 'worker'/);
  assert.match(source, /completedFocusIds: Array\.from\(completedFocusIds\),/);
  assert.match(source, /excludedFocusIds: Array\.from\(excludedFocusIds\),/);
  assert.match(source, /\[PROGRAM_ENV\.completedFocusIds\]: Array\.from\(completedFocusIds\)\.join\(','\),/);
});

test('persistent runner installs a 100-agent swarm prelaunch gate instead of allowing one-shard launches', () => {
  assert.match(source, /function requestedAgentCount\(\)/);
  assert.match(source, /swarmGateRequired = requestedFullClone\(contract\) && agentCount >= 80/);
  assert.match(source, /minimumExecutableProductShards: Math\.max\([^\n]+Math\.floor\(agentCount \* 0\.8\)/);
  assert.match(source, /requireSwarmMode: true/);
  assert.match(source, /forbidStrictGapSequence: true/);
  assert.match(source, /requireRolePlan: true/);
  assert.match(source, /requireStrictHierarchicalPlan: true/);
  assert.match(source, /strictHierarchicalPlanCoverage/);
});

test('persistent runner invokes the watch\/notify path before terminal exit', () => {
  assert.match(source, /const WATCH_SCRIPT = resolveProgramScriptPath\(ROOT, 'watch'\);/);
  assert.match(source, /function runTerminalWatch\(\) \{/);
  assert.match(source, /spawnSync\(process\.execPath, \[WATCH_SCRIPT\], \{/);
  assert.match(source, /===== terminal watch =====/);
  assert.match(source, /runTerminalWatch\(\);\n    process\.exit\(1\);/);
  assert.match(source, /runTerminalWatch\(\);\n    process\.exit\(0\);/);
});

test('persistent runner only carries forward focus ids with canonical landed product evidence', () => {
  assert.match(source, /function deriveCompletedFocusIds\(iterationRecord = null, patchQueueReport = null, syncStatus = null\) \{/);
  assert.match(source, /syncStatus\?\.canonicalLandingEvidence\?\.ok !== true/);
  assert.match(source, /landedProductFilesFromSyncStatus\(syncStatus\)/);
  assert.match(source, /patchEntryProductFiles\(entry\)/);
  assert.match(source, /touchedFiles\.some\(\(filePath\) => landedProductFiles\.has\(filePath\)\)/);
  assert.doesNotMatch(source, /const explicitFullCompletion = !iterationRecord\?\.blocker/);
  assert.match(source, /for \(const focusId of deriveCompletedFocusIds\(iterationRecord, delegatePatchQueueReport, syncStatus\)\) completedFocusIds\.add\(focusId\);/);
});
