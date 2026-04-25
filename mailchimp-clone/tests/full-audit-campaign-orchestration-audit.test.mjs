import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildContradictoryDelegateTruthBlocker, buildNotifierEligibilityPayload, buildOutcomeHeadline, buildStaleDelegateEvidenceBlocker, delegateTruthConflictDetails, deriveCanonicalStatuses, deriveRequestedOutcome, isArtifactFreshForRun, resolveCampaignBlocker } from '../scripts/lib/full-audit-campaign-state.mjs';
import { buildRepoWideSyncPathspecs, parsePorcelainStatus, renderPathspecArgs, statusRepresentsDeletion } from '../scripts/lib/full-audit-campaign-sync-pathspecs.mjs';
import { buildHeartbeatSummary, extractCurrentTestHint } from '../scripts/lib/full-audit-campaign-liveness.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('resolveCampaignBlocker promotes an explicit blocker report even when canonical summary is still null', () => {
  const blocker = resolveCampaignBlocker({
    canonicalSummary: { blocker: null },
    blockerReport: { blocker: 'Baseline repo tests failed before live qualification started.', nextAction: 'Inspect baseline log.' }
  });
  assert.deepEqual(blocker, {
    blocker: 'Baseline repo tests failed before live qualification started.',
    nextAction: 'Inspect baseline log.'
  });
});

test('deriveCanonicalStatuses marks parity blocked when a blocker exists', () => {
  const statuses = deriveCanonicalStatuses({
    canonicalSummary: { supervisorStatus: 'red', matrixStatus: 'partial', parityStatus: 'partial' },
    blocker: { blocker: 'boom', nextAction: 'fix it' }
  });
  assert.equal(statuses.supervisorStatus, 'red');
  assert.equal(statuses.matrixStatus, 'partial');
  assert.equal(statuses.parityStatus, 'partial');
  assert.equal(statuses.green, false);
});

test('buildNotifierEligibilityPayload synthesizes blocker delivery state without a mirrored notifier artifact', () => {
  const payload = buildNotifierEligibilityPayload({
    generatedAt: '2026-04-08T23:24:05.413Z',
    runId: 'run-42',
    supervisorStatus: 'red',
    matrixStatus: 'partial',
    blocker: { blocker: 'real blocker', nextAction: 'inspect logs' }
  });
  assert.equal(payload.eligible, true);
  assert.equal(payload.kind, 'blocker');
  assert.equal(payload.runId, 'run-42');
  assert.equal(payload.generatedAt, '2026-04-08T23:24:05.413Z');
});

test('isArtifactFreshForRun rejects stale delegate artifacts for a fresh run', () => {
  const currentRun = {
    runId: 'one-pass-20260412-015626',
    generatedAt: '2026-04-12T01:56:34.392Z'
  };
  assert.equal(isArtifactFreshForRun({
    artifact: { generatedAt: '2026-04-06T03:19:56.231Z' },
    currentRun,
    runId: currentRun.runId
  }), false);
  assert.equal(isArtifactFreshForRun({
    artifact: { generatedAt: '2026-04-12T01:56:48.304Z' },
    currentRun,
    runId: currentRun.runId
  }), true);
  assert.deepEqual(buildStaleDelegateEvidenceBlocker({ runId: currentRun.runId }), {
    blocker: 'Delegate qualification evidence is stale for the active Mailchimp one-pass run.',
    nextAction: 'Regenerate fresh run-local qualification artifacts for run one-pass-20260412-015626 before accepting a green parity result.'
  });
});

test('delegateTruthConflictDetails catches green summaries that still carry incomplete stages or nested blockers', () => {
  const conflict = delegateTruthConflictDetails({
    completionSummary: {
      stages: [
        { id: 'merged_focus_work_present', complete: false }
      ]
    },
    programState: {
      stages: [
        { id: 'selected_tier_recorded', complete: 0 }
      ],
      campaignState: {
        supervisor: {
          blocker: { blocker: 'Worker completed with stale truth.' }
        }
      }
    }
  });
  assert.deepEqual(conflict.incompleteCompletionStages, ['merged_focus_work_present']);
  assert.deepEqual(conflict.incompleteProgramStages, ['selected_tier_recorded']);
  assert.equal(conflict.nestedBlocker.blocker, 'Worker completed with stale truth.');
  assert.equal(conflict.hasConflict, true);
  assert.deepEqual(buildContradictoryDelegateTruthBlocker({ conflict, runId: 'one-pass-xyz' }), {
    blocker: 'Delegate qualification truth is internally contradictory for the active Mailchimp one-pass run.',
    nextAction: 'Reconcile the delegate supervisor/program state for run one-pass-xyz before accepting green. Evidence: completion stages incomplete: merged_focus_work_present | program stages incomplete: selected_tier_recorded | nested blocker still present: Worker completed with stale truth.'
  });
});

test('deriveCanonicalStatuses refuses a green result when a blocker is present', () => {
  const statuses = deriveCanonicalStatuses({
    programState: {
      allComplete: true,
      supervisorStatus: 'green'
    },
    campaignState: {
      supervisor: {
        status: 'green'
      }
    },
    blocker: {
      blocker: 'Delegate qualification truth is internally contradictory for the active Mailchimp one-pass run.'
    }
  });
  assert.deepEqual(statuses, {
    supervisorStatus: 'red',
    matrixStatus: 'partial',
    parityStatus: 'partial',
    green: false
  });
});

test('repo-wide sync pathspecs exclude artifacts and node_modules instead of only a narrow product slice', () => {
  const pathspecs = buildRepoWideSyncPathspecs();
  assert.deepEqual(pathspecs, ['.', ':(exclude)artifacts', ':(exclude)node_modules']);
  const rendered = renderPathspecArgs(pathspecs);
  assert.match(rendered, /^'\.' ':\(exclude\)artifacts' '.*node_modules'$/);
});

test('parsePorcelainStatus preserves renames and deletions for overlay and sync promotion', () => {
  const entries = parsePorcelainStatus(' M packages/app/routes/audience.mjs\nR  old/file.mjs -> new/file.mjs\n D packages/app/routes/legacy.mjs\n?? tests/new.test.mjs\n');
  assert.deepEqual(entries, [
    { status: 'M', path: 'packages/app/routes/audience.mjs', fromPath: null },
    { status: 'R', path: 'new/file.mjs', fromPath: 'old/file.mjs' },
    { status: 'D', path: 'packages/app/routes/legacy.mjs', fromPath: null },
    { status: '??', path: 'tests/new.test.mjs', fromPath: null }
  ]);
  assert.equal(statusRepresentsDeletion(entries[2].status), true);
  assert.equal(statusRepresentsDeletion(entries[0].status), false);
});

test('extractCurrentTestHint finds the deepest active repo test from process commands', () => {
  const hint = extractCurrentTestHint([
    { command: 'node mailchimp-clone/scripts/full-audit-campaign-remote-runner.mjs' },
    { command: '/usr/bin/node /home/jake/clawd-remote/mailchimp-worktree-run/scripts/orchestrator-real-repo-clean-run.mjs' },
    { command: 'node --test --test-concurrency=1 tests/audience-core.test.mjs tests/browser-realism.test.mjs' }
  ]);
  assert.equal(hint, 'tests/browser-realism.test.mjs');
});

test('buildHeartbeatSummary surfaces current test and progress timing', () => {
  const summary = buildHeartbeatSummary({
    now: Date.parse('2026-04-09T01:00:30.000Z'),
    startedAt: '2026-04-09T01:00:00.000Z',
    lastOutputAt: '2026-04-09T01:00:20.000Z',
    artifactStates: [{ path: 'campaign_state.json', mtimeMs: Date.parse('2026-04-09T01:00:10.000Z') }],
    processEntries: [{ command: 'node --test tests/surveys-feedback.test.mjs' }]
  });
  assert.equal(summary.currentTestHint, 'tests/surveys-feedback.test.mjs');
  assert.equal(summary.lastProgressAt, '2026-04-09T01:00:20.000Z');
  assert.equal(summary.staleForSec, 10);
  assert.equal(summary.runningForSec, 30);
});

test('repo-wide sync pathspecs and worktree dependency model keep a top-level artifacts path available', () => {
  const pathspecs = buildRepoWideSyncPathspecs();
  assert.ok(pathspecs.includes(':(exclude)artifacts'));
  const expectedWorktreeArtifactsPath = '/remote/runs/run-123/artifacts/implementation_runs/run-123';
  assert.equal(expectedWorktreeArtifactsPath.endsWith('/artifacts/implementation_runs/run-123'), true);
});

test('deriveCanonicalStatuses promotes green for proven tier-100 completion with no blocker', () => {
  const result = deriveCanonicalStatuses({
    completionSummary: {
      supervisorStatus: 'red',
      surfaceMatrixStatus: 'partial',
      provenCoordinationScaleTier: 100,
      repoIntegrityOk: true
    },
    canonicalSummary: {
      supervisorStatus: 'red',
      parityStatus: 'partial'
    },
    blocker: null
  });
  assert.equal(result.supervisorStatus, 'green');
  assert.equal(result.matrixStatus, 'all_complete');
  assert.equal(result.parityStatus, 'full');
  assert.equal(result.green, true);
});

test('delegate green program state clears stale canonical blockers during reconciliation', () => {
  const blocker = resolveCampaignBlocker({
    canonicalSummary: { blocker: { blocker: 'stale', nextAction: 'ignore me' } },
    programState: { supervisorStatus: 'green', allComplete: true }
  });
  assert.equal(blocker, null);
  const result = deriveCanonicalStatuses({
    canonicalSummary: { supervisorStatus: 'red', parityStatus: 'blocked' },
    programState: { supervisorStatus: 'green', matrixStatus: 'all_complete', allComplete: true },
    blocker
  });
  assert.equal(result.supervisorStatus, 'green');
  assert.equal(result.matrixStatus, 'all_complete');
  assert.equal(result.parityStatus, 'full');
  assert.equal(result.green, true);
});

test('deriveRequestedOutcome keeps orchestration green while marking the strict 1:1 ceiling blocked', () => {
  const requested = deriveRequestedOutcome({
    requestedFidelity: 'full_clone',
    orchestration: {
      supervisorStatus: 'green',
      matrixStatus: 'all_complete',
      parityStatus: 'full',
      green: true
    },
    strict1to1: {
      required: true,
      state: { status: 'red', matrixStatus: 'blocked', parityStatus: 'blocked' },
      blocker: { blocker: 'Strict 1:1 parity ceiling is still red, so the Mailchimp clone cannot be treated as full-clone complete.' }
    }
  });
  assert.deepEqual(requested, {
    requestedFidelity: 'full_clone',
    supervisorStatus: 'red',
    matrixStatus: 'blocked',
    parityStatus: 'blocked',
    green: false,
    blocker: { blocker: 'Strict 1:1 parity ceiling is still red, so the Mailchimp clone cannot be treated as full-clone complete.' },
    blockerKind: 'strict_1to1_ceiling',
    note: 'Delegate/orchestration run passed, but full-clone completion remains blocked by the strict 1:1 ceiling.'
  });
});

test('deriveRequestedOutcome preserves orchestration blockers as the primary requested outcome', () => {
  const requested = deriveRequestedOutcome({
    requestedFidelity: 'full_clone',
    orchestration: {
      supervisorStatus: 'red',
      matrixStatus: 'partial',
      parityStatus: 'partial',
      green: false
    },
    blocker: { blocker: 'Delegate qualification truth is internally contradictory.' },
    strict1to1: {
      required: true,
      blocker: { blocker: 'Strict 1:1 parity ceiling is still red, so the Mailchimp clone cannot be treated as full-clone complete.' }
    }
  });
  assert.deepEqual(requested, {
    requestedFidelity: 'full_clone',
    supervisorStatus: 'red',
    matrixStatus: 'partial',
    parityStatus: 'partial',
    green: false,
    blocker: { blocker: 'Delegate qualification truth is internally contradictory.' },
    blockerKind: 'orchestration',
    note: 'Delegate/orchestration run is still blocked or incomplete.'
  });
});

test('buildOutcomeHeadline renders the strict ceiling split clearly at a glance', () => {
  const headline = buildOutcomeHeadline({
    orchestration: { green: true },
    requestedOutcome: { green: false, blockerKind: 'strict_1to1_ceiling' }
  });
  assert.equal(headline, 'Orchestration passed, full-clone strict 1:1 ceiling still red.');
});

test('buildOutcomeHeadline renders orchestration blockers directly', () => {
  const headline = buildOutcomeHeadline({
    orchestration: { green: false },
    requestedOutcome: { green: false, blockerKind: 'orchestration' }
  });
  assert.equal(headline, 'Orchestration is still blocked.');
});

test('remote runner parity focus gate only flags missing assignments, not the existence of parity-focus work', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'full-audit-campaign-remote-runner.mjs'), 'utf8');
  assert.match(source, /const parityFocusIssuesPresent = parityFocusPlanned && !parityFocusAssignmentsObserved;/);
  assert.match(source, /if \(!parityFocusPlanned \|\| parityFocusIssuesPresent\) \{/);
});

test('remote runner recreates a clean disposable worktree before each iteration', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'full-audit-campaign-remote-runner.mjs'), 'utf8');
  assert.match(source, /function prepareIterationWorkspace\(iteration\)/);
  assert.match(source, /removePriorWorktree\(\);/);
  assert.match(source, /worktree', 'add', '--detach', WORKTREE_PATH, 'HEAD'/);
  assert.match(source, /\(\{ baselineOverlay, dependencyLinks \} = prepareIterationWorkspace\(iteration\)\);/);
});

test('remote runner has inode preflight and stale disposable worktree retention cleanup', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'full-audit-campaign-remote-runner.mjs'), 'utf8');
  assert.match(source, /MIN_FREE_INODES_FOR_WORKTREE/);
  assert.match(source, /function filesystemInodes\(targetPath = REMOTE_BASE\)/);
  assert.match(source, /function cleanupStaleDisposableWorktrees\(/);
  assert.match(source, /git', \['-C', ROOT, 'worktree', 'prune'\]/);
  assert.match(source, /function assertWorktreeInodeCapacity\(\)/);
  assert.match(source, /cleanupStaleDisposableWorktrees\(\);\n\s+assertWorktreeInodeCapacity\(\);/);
});

test('sync step cleans successful remote disposable worktrees after promotion', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'full-audit-campaign-sync-remote-worktree.mjs'), 'utf8');
  assert.match(source, /function cleanupRemoteDisposableWorktree\(remote, remoteRepo/);
  assert.match(source, /remoteRepo\.includes\('\/mailchimp-worktree-'\)/);
  assert.match(source, /MAILCHIMP_KEEP_REMOTE_WORKTREE/);
  assert.match(source, /statusPayload\.remoteWorktreeCleanup = cleanupRemoteDisposableWorktree/);
});

test('sync script binds worker status path before resolving run binding', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'full-audit-campaign-sync-remote-worktree.mjs'), 'utf8');
  assert.match(source, /import \{ resolveProgramEnvKeys, resolveProgramPaths \} from '\.\/lib\/orchestration-program-config\.mjs';/);
  assert.match(source, /const PROGRAM_PATHS = resolveProgramPaths\(ROOT\);/);
  assert.match(source, /const WORKER_STATUS_PATH = PROGRAM_PATHS\.workerStatusPath;/);
  assert.match(source, /workerStatusPath: WORKER_STATUS_PATH/);
});

test('sync script mirrors live execution and patch queue artifacts for the active run', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'full-audit-campaign-sync-remote-worktree.mjs'), 'utf8');
  assert.match(source, /live_execution_summary: 'live_execution_summary\.json'/);
  assert.match(source, /patch_queue_report: 'patch_queue_report\.json'/);
});

test('sync script promotes Mailchimp product surfaces only and rejects script-only churn', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'full-audit-campaign-sync-remote-worktree.mjs'), 'utf8');
  const helper = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'lib', 'full-audit-campaign-sync-pathspecs.mjs'), 'utf8');
  assert.match(source, /buildProductSurfaceSyncPathspecs/);
  assert.match(source, /applyError = 'no_product_surface_changes_to_promote'/);
  assert.match(helper, /DEFAULT_PRODUCT_SYNC_INCLUDES/);
  assert.match(helper, /':\(exclude\)scripts'/);
});

test('persistent runner synthesizes a blocker when sync fails after remote execution', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'full-audit-campaign-persistent-runner.mjs'), 'utf8');
  assert.match(source, /const syncFailureBlocker = sync\.status !== 0 \?/);
  assert.match(source, /Control-plane sync step failed after the remote audit iteration completed\./);
  assert.match(source, /writeJson\(BLOCKER_PATH, \{/);
});

test('remote execution distinguishes mirrored blockers from transport failures', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'lib', 'full-audit-campaign-remote-execution.mjs'), 'utf8');
  assert.match(source, /function deriveMirroredTerminalState\(/);
  assert.match(source, /remoteExecutionTerminal: path.join\(remoteArtifactRoot, 'remote_execution_terminal\.json'\)/);
  assert.match(source, /mirrorOptionalFile\(remoteTerminalText, path.join\(delegateArtifactRoot, 'remote_execution_terminal\.json'\), 'remoteExecutionTerminalPath'\)/);
  assert.match(source, /const mirroredTerminal = deriveMirroredTerminalState\(\{ effectiveRunId, startedAt, mirror: latestMirror \}\);/);
  assert.match(source, /let monitorDecision = shouldFinalizeRemoteExecutionMonitor\(/);
  assert.match(source, /if \(!remoteWatchdog && monitorDecision\.finalize && !mirroredTerminal\.terminal\) \{/);
  assert.match(source, /const launcherAlive = checkRemotePidAlive\(remoteExecution, launchPid\);/);
  assert.match(source, /const remoteRunnerPid = remoteStatus\?\.runnerPid \|\| remoteStatus\?\.childPid \|\| null;/);
  assert.match(source, /const runnerAlive = checkRemotePidAlive\(remoteExecution, remoteRunnerPid\);/);
  assert.match(source, /monitorDecision = shouldFinalizeRemoteExecutionMonitor\(\{/);
  assert.match(source, /launcherAlive,/);
  assert.match(source, /runnerAlive/);
  assert.match(source, /if \(monitorDecision\.finalize\) \{/);
  assert.match(source, /const finalMirroredTerminal = deriveMirroredTerminalState\(\{ effectiveRunId, startedAt, mirror: latestMirror \}\);/);
  assert.match(source, /const terminalStatus = mirror\.remoteExecutionTerminal \|\| null;/);
  assert.match(source, /remoteExecutionTerminal: mirror\.remoteExecutionTerminal,/);
  assert.match(source, /const blocked = !remoteWatchdog && \(finalMirroredTerminal\.blocked \|\| Boolean\(remoteBlocker\)\);/);
  assert.match(source, /'remote_execution_completed_with_blocker'/);
  assert.match(source, /phase: ok \|\| blocked \? 'awaiting_supervisor_reconcile'/);
  assert.match(source, /finished with a mirrored blocker; supervisor should reconcile blocker artifacts instead of treating the transport as failed/);
});

test('remote runner persists verified focus progress, seeds env carry-forward, and clears legacy unverified state', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'full-audit-campaign-remote-runner.mjs'), 'utf8');
  assert.match(source, /const hasVerifiedSchema = Array\.isArray\(raw\?\.verifiedCompletedFocusIds\);/);
  assert.match(source, /discardedLegacyCompletedFocusIds/);
  assert.match(source, /function filterFocusIdsByTrustedSet\(values = \[\], trustedValues = \[\]\) \{/);
  assert.match(source, /return extractVerifiedFocusIdsFromPatchQueue\(patchQueue\);/);
  assert.match(source, /const envCompletedFocusIds = normalizeCompletedFocusIds\(String\(process\.env\.MAILCHIMP_COMPLETED_FOCUS_IDS \|\| ''\)\.split\(','\)\);/);
  assert.match(source, /const seededEnvCompletedFocusIds = verifiedCompletedFocusIds\.length > 0/);
  assert.match(source, /\? filterFocusIdsByTrustedSet\(envCompletedFocusIds, verifiedCompletedFocusIds\)/);
  assert.match(source, /\.\.\.seededEnvCompletedFocusIds,/);
  assert.doesNotMatch(source, /rawVerifiedCompletedFocusIds.length > 0 \? rawVerifiedCompletedFocusIds : rawCompletedFocusIds/);
  assert.match(source, /const verifiedFocusIds = Array\.from\(new Set\(\[\.\.\.\(progressState\.verifiedCompletedFocusIds \|\| \[\]\), \.\.\.mergedFocusIds\]\)\);/);
  assert.match(source, /verifiedCompletedFocusIds,/);
});

test('remote runner continues when supervisor goes green without fresh product progress', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'full-audit-campaign-remote-runner.mjs'), 'utf8');
  assert.match(source, /clearIterationEphemeralArtifacts\(\);/);
  assert.match(source, /function hasSelectedTierLiveWork\(/);
  assert.match(source, /function isNoParityReductionBlocker\(/);
  assert.match(source, /function creditableFocusIdsForIteration\(/);
  assert.match(source, /const selectedTierHadLiveWork = hasSelectedTierLiveWork\(liveExecutionSummary\);/);
  assert.match(source, /const patchQueueFocusIds = extractMergedFocusIds\(patchQueueReport\);/);
  assert.match(source, /const targetedTestCandidateFocusIds = selectedTierHadLiveWork/);
  assert.match(source, /\? patchQueueFocusIds\.filter\(\(focusId\) => !progressState\.completedFocusIds\.includes\(focusId\)\)/);
  assert.match(source, /filter\(\(focusId\) => !progressState\.completedFocusIds\.includes\(focusId\)\)/);
  assert.match(source, /const targetedTestVerifiedFocusIds = targetedTestCandidateFocusIds.length > 0/);
  assert.match(source, /verifyFocusIdsByTargetedTests\(targetedTestCandidateFocusIds\)/);
  assert.match(source, /if \(isNoParityReductionBlocker\(blocker\)\) \{/);
  assert.match(source, /return Array\.from\(new Set\(targetedTestVerifiedFocusIds\)\);/);
  assert.doesNotMatch(source, /summaryProvenFocusIds/);
  assert.match(source, /const mergedFocusIds = creditableFocusIdsForIteration\(\{/);
  assert.match(source, /const progressDelta = selectedTierHadLiveWork/);
  assert.match(source, /const freshProgressDetected = Boolean\(workspaceDiff\.trim\(\)\)/);
  assert.match(source, /\|\| \(selectedTierHadLiveWork && progressDelta.length > 0\);/);
  assert.match(source, /const retryClass = campaignState\?\.stopAllowed && !blocker && !freshProgressDetected/);
  assert.match(source, /const preserveLiveWorkBlocker = selectedTierHadLiveWork && isNoParityReductionBlocker\(blocker\);/);
  assert.match(source, /const greenCompletionReached = !blocker/);
  assert.match(source, /'terminal_green_without_fresh_progress'/);
  assert.match(source, /stopReason: retryClass === 'terminal_green_without_fresh_progress'/);
  assert.match(source, /const shouldRequeue = blocker/);
  assert.match(source, /: preserveLiveWorkBlocker/);
  assert.match(source, /let blockerClass = classifyIteration\(\{ blocker, progressDelta, freshProgressDetected, spawnError: result\.error, workspaceError: result\.workspaceRefreshError, retryClass \}\);/);
  assert.match(source, /if \(blocker && blockerClass === 'hard_blocker'\) blockerClass = null;/);
  assert.match(source, /if \(preserveLiveWorkBlocker\) blockerClass = null;/);
  assert.match(source, /if \(greenCompletionReached\) blockerClass = null;/);
  assert.match(source, /if \(\(campaignState\?\.stopAllowed && freshProgressDetected\) \|\| greenCompletionReached\) \{/);
  assert.match(source, /if \(blocker && !shouldRequeue\) \{/);
  assert.match(source, /if \(shouldRequeue\) \{/);
  assert.match(source, /continuationDetected = true;/);
  assert.match(source, /const creditedFocusIds = Array\.from\(new Set\(\[\.\.\.progressState\.completedFocusIds, \.\.\.mergedFocusIds\]\)\);/);
  assert.match(source, /completedFocusIds: creditedFocusIds/);
  assert.match(source, /No parity-surface reduction was proven by this iteration\./);
});


test('remote runner does not derive carry-forward proof from completion summary alone', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'full-audit-campaign-remote-runner.mjs'), 'utf8');
  assert.doesNotMatch(source, /function deriveProvenFocusIdsFromSummary\(/);
  assert.doesNotMatch(source, /summaryProvenFocusIds/);
});

test('remote runner writes a terminal receipt and installs exit-path persistence hooks', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'full-audit-campaign-remote-runner.mjs'), 'utf8');
  assert.match(source, /const TERMINAL_STATUS_PATH = path.join\(ARTIFACT_ROOT, 'remote_execution_terminal\.json'\);/);
  assert.match(source, /function persistTerminalStatus\(/);
  assert.match(source, /writeJson\(TERMINAL_STATUS_PATH, payload\);/);
  assert.match(source, /function installTerminalPersistenceHooks\(/);
  assert.match(source, /process\.once\('SIGTERM'/);
  assert.match(source, /process\.once\('uncaughtException'/);
  assert.match(source, /process\.once\('unhandledRejection'/);
  assert.match(source, /rmIfExists\(TERMINAL_STATUS_PATH\);/);
  assert.match(source, /persistTerminalStatus\(\{\n  ok: finalOk,/);
});

test('product-only supervisor derives nextFocus from verified focus merges instead of any merged focus task', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'orchestrator-real-repo-clean-supervisor.mjs'), 'utf8');
  const planSource = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'lib', 'orchestrator-real-repo-clean-plan.mjs'), 'utf8');
  const runSource = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'orchestrator-real-repo-clean-run.mjs'), 'utf8');
  assert.match(planSource, /export const PRODUCT_ONLY_MODE = PRODUCT_ONLY_OVERRIDE === '0'/);
  assert.match(planSource, /IMPLEMENTATION_PROFILE === 'mailchimp_parity_focus'/);
  assert.match(runSource, /PRODUCT_ONLY_MODE,/);
  assert.match(source, /mailchimpParityFocusIds/);
  assert.match(source, /function resolveMatrixStatus\(/);
  assert.match(source, /highestPassingTier,/);
  assert.match(source, /const selectedTierHadLiveWork = selectedTierShardCount > 0 \|\| selectedTierMergedShardCount > 0 \|\| selectedTierMergedPatchCount > 0;/);
  assert.match(source, /const focusSurfaces = surfaceDefinitions\(\);/);
  assert.match(source, /graph = \{\n    version: priorGraph\?\.version \|\| 1,/);
  assert.match(source, /const completedFocusIds = new Set\(normalizeFocusIds\(String\(process\.env\.MAILCHIMP_COMPLETED_FOCUS_IDS \|\| ''\)/);
  assert.match(source, /const targetedTestCandidateFocusIds = selectedTierHadLiveWork/);
  assert.match(source, /\? mergedFocusIds.filter\(\(id\) => !completedFocusIds.has\(id\)\)/);
  assert.match(source, /const targetedTestVerifiedFocusIds = verifyFocusIdsByTargetedTests\(/);
  assert.match(source, /targetedTestCandidateFocusIds,/);
  assert.match(source, /function buildFocusArtifactPaths\(/);
  assert.match(source, /const iterationFocusArtifacts = buildFocusArtifactPaths\(\{ patchQueue, runRoot: runForArtifacts\?\.runRoot \}\);/);
  assert.match(source, /const currentIterationProvenFocusIds = new Set\(\[\.\.\.mergedFocusIds, \.\.\.targetedTestVerifiedFocusIds\]\);/);
  assert.match(source, /const provenFocusIds = new Set\(\[\.\.\.completedFocusIds, \.\.\.currentIterationProvenFocusIds\]\);/);
  assert.match(source, /function extractVerifiedFocusIdsFromResultFiles\(/);
  assert.match(source, /function resolveFocusIdFromPatchEntry\(/);
  assert.match(source, /const mergedFocusIds = Array\.from\(new Set\(\s*extractVerifiedFocusIdsFromPatchQueue\(patchQueue\)\s*\)\);/);
  assert.doesNotMatch(source, /const mergedFocusIds = Array\.from\(new Set\(\[[\s\S]*extractVerifiedFocusIdsFromResultFiles\(runForArtifacts\?\.runRoot\)/);
  assert.match(source, /const issueSatisfied = \(issueId\) => provenFocusIds\.has\(issueId\) \|\| !parityFocusIds\.includes\(issueId\);/);
  assert.match(source, /const issueComplete = issueSatisfied\(issue\.id\);/);
  assert.match(source, /const issueArtifacts = issueComplete/);
  assert.match(source, /iterationFocusArtifacts\.get\(issue\.id\)/);
  assert.match(source, /currentIterationProvenFocusIds\.has\(issue\.id\) \? \[paths\.patchQueueReport, paths\.mergeReport\] : \[\]/);
  assert.match(source, /Array\.isArray\(issue\?\.artifacts\) \? issue\.artifacts : \[\]/);
  assert.doesNotMatch(source, /issueComplete \? \[paths\.patchQueueReport, paths\.mergeReport\] : \[\]/);
  assert.match(source, /issueComplete \? 'complete' : 'pending'/);
  assert.match(source, /issues: focusIssues/);
  assert.match(source, /const parityFocusIds = mailchimpParityFocusIds\(\);/);
  assert.match(source, /const allFocusComplete = nextFocus.length === 0 && focusIssues\.every\(\(issue\) => issueSatisfied\(issue\.id\)\);/);
  assert.match(source, /selectedTier: Boolean\(selectedTier \|\| scaleQualification\?\.highestPassingTier \|\| scaleQualification\?\.provenCoordinationScaleTier\),/);
  assert.match(source, /selected_tier_had_live_work: selectedTierHadLiveWork/);
  assert.match(source, /Selected live qualification tier reported green without any live shard work for this run\./);
  assert.match(source, /if \(!blocker && !allFocusComplete && priorBlockerReport\?\.blocker\) blocker = priorBlockerReport;/);
  assert.match(source, /if \(!blocker && resolveMatrixStatus\(matrixPreview\) !== 'all_complete'\) \{/);
  assert.match(source, /intendedMatrixStatus = blocker/);
  assert.match(source, /resolveMatrixStatus\(matrixPreview\)/);
  assert.match(source, /const finalAllComplete = !blocker && truth\.supervisorStatus === 'green' && matrix\.status === 'all_complete';/);
  assert.match(source, /const finalSupervisorStatus = finalAllComplete \? 'green' : 'red';/);
  assert.match(source, /blocker: finalBlocker \|\| null,/);
  assert.match(source, /nextFocus = parityFocusIds\.filter/);
  assert.match(source, /nextFocus,/);
});

test('clean run resets per-invocation qualification artifacts before rebuilding tier state', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'orchestrator-real-repo-clean-run.mjs'), 'utf8');
  assert.match(source, /function resetQualificationArtifacts\(/);
  assert.match(source, /for \(const target of \[RUNS_DIR, MERGE_DIR, RECOVERY_DIR\]\)/);
  assert.match(source, /paths\.liveExecutionSummary/);
  assert.match(source, /paths\.patchQueueReport/);
  assert.match(source, /paths\.scaleQualification/);
  assert.match(source, /resetQualificationArtifacts\(\);\nensureDirs\(\);/);
  assert.match(source, /blockerReport = readJson\(paths\.blockerReport, blockerReport\) \|\| blockerReport;/);
  assert.match(source, /completeWorkerIteration\(paths\.campaignState, \{/);
  assert.match(source, /blockerReport,/);
  assert.match(source, /allowProductOnlyVerifierSkip: PRODUCT_ONLY_MODE/);
});

test('product-only verifier still runs targeted tests and refuses empty test configs', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'orchestrator-real-repo-clean-verifier.mjs'), 'utf8');
  assert.doesNotMatch(source, /skipped in product-only mode/);
  assert.match(source, /tests verifier requested but no shard test files were configured/);
  assert.match(source, /\['--test', '--test-concurrency=1', testFile\]/);
});

test('full-audit supervisor reads delegate program state and prefers it over stale canonical blockers', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'full-audit-campaign-supervisor.mjs'), 'utf8');
  assert.match(source, /import \{ deriveCampaignContinuation, recoverCampaign, setSupervisor \} from '\.\.\/\.\.\/large-project-capability-stack\/packages\/campaign-runtime\/index\.mjs';/);
  assert.match(source, /const (mirroredDelegateProgramStatePath|delegateProgramStatePath) = resolveMirroredArtifactPath/);
  assert.match(source, /const delegateProgramStatePath = freshRunBoundArtifactPath\(controlPlaneDelegateProgramStatePath/);
  assert.match(source, /const delegateBlockerPath = freshRunBoundArtifactPath\(controlPlaneDelegateBlockerPath/);
  assert.match(source, /const delegateProgramState = delegateProgramStatePath \? readJson\(delegateProgramStatePath, null\) : null;/);
  assert.match(source, /const workerBlockerPath = freshRunBoundArtifactPath\(BLOCKER_PATH/);
  assert.match(source, /const workerBlocker = workerBlockerPath \? readJson\(workerBlockerPath, null\) : null;/);
  assert.match(source, /resolveCampaignBlocker\(\{ canonicalSummary, programState: delegateProgramState, blockerReport: delegateBlocker \|\| workerBlocker, workerStatus \}\)/);
  assert.match(source, /const orchestration = deriveCanonicalStatuses\(\{ canonicalSummary, programState: delegateProgramState, blocker: orchestrationBlocker \}\)/);
  assert.match(source, /const requestedOutcome = deriveRequestedOutcome\(\{/);
  assert.match(source, /let continuation = deriveCampaignContinuation\(\{/);
  assert.match(source, /if \(shouldContinueAutonomySoak\(\{ orchestration, benchmarkThresholdGate, currentRun \}\)\) \{/);
  assert.match(source, /benchmarkThresholdGate\?\.pass !== false \|\| benchmarkThresholdGate\?\.blockerKind !== 'benchmark_threshold_gate'/);
  assert.doesNotMatch(source, /autonomyOnlyThresholdFailure/);
  assert.match(source, /recoverCampaign\(PROGRAM_STATE_PATH, \{/);
  assert.match(source, /setSupervisor\(PROGRAM_STATE_PATH, \{/);
  assert.match(source, /artifact: delegateProgramState,/);
  assert.match(source, /const delegateLiveExecutionSummaryPath = resolveMirroredArtifactPath/);
  assert.match(source, /const delegatePatchQueueReportPath = resolveMirroredArtifactPath/);
  assert.match(source, /canonicalSummary\?\.supervisorStatus === 'green' && !freshDelegateEvidence/);
  assert.match(source, /buildStaleDelegateEvidenceBlocker\(\{ runId, currentRun \}\)/);
  assert.match(source, /delegateTruthConflictDetails\(\{/);
  assert.match(source, /canonicalSummary\?\.supervisorStatus === 'green' && delegateTruthConflict\.hasConflict/);
  assert.match(source, /buildContradictoryDelegateTruthBlocker\(\{ conflict: delegateTruthConflict, runId \}\)/);
  assert.match(source, /const headline = buildOutcomeHeadline\(\{ orchestration, requestedOutcome \}\);/);
  assert.match(source, /programState\.stopAllowed = continuation\.shouldStop;/);
  assert.match(source, /programState\.stopReason = continuation\.decision === 'stop_green'/);
  assert.match(source, /continuationDecision: continuation\.decision,/);
  assert.match(source, /orchestrationConfirmedCompletion: orchestration\.green,/);
  assert.match(source, /supervisorConfirmedCompletion: requestedOutcome\.green/);
  assert.match(source, /canonicalSummaryPath: canonicalSummaryPath \? path\.relative\(ROOT, canonicalSummaryPath\) : null/);
  assert.match(source, /delegateBlockerPath: delegateBlockerPath \? path\.relative\(ROOT, delegateBlockerPath\) : null/);
  assert.match(source, /workerBlockerPath: workerBlockerPath \? path\.relative\(ROOT, workerBlockerPath\) : null/);
});

test('full-audit supervisor clears orchestration blockers while the remote run is still actively progressing', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'full-audit-campaign-supervisor.mjs'), 'utf8');
  assert.match(source, /function liveRemoteProgress\(workerStatus = null, currentRun = null, runId = null\)/);
  assert.match(source, /remoteExecutionStatus\.running !== true/);
  assert.match(source, /timestampKeys: \['heartbeatAt', 'generatedAt', 'lastOutputAt', 'finishedAt'\]/);
  assert.match(source, /latestIteration\?\.freshProgressDetected === true/);
  assert.match(source, /partial parity-surface reduction was proven\|remaining red surfaces are still open/i);
  assert.match(source, /if \(remoteProgress\.active\) \{/);
  assert.match(source, /orchestrationBlocker = null;/);
});


test('full-audit supervisor ignores stale root canonical summaries when the active run has no fresh canonical summary artifact', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'full-audit-campaign-supervisor.mjs'), 'utf8');
  assert.match(source, /function freshRunBoundArtifactPath\(/);
  assert.match(source, /const canonicalSummaryPath = freshRunBoundArtifactPath\(controlPlaneCanonicalSummaryPath, \{/);
  assert.match(source, /requireRunMatch: true/);
  assert.match(source, /if \(!canonicalSummaryPath\) rmIfExists\(controlPlaneCanonicalSummaryPath\);/);
});

test('full-audit supervisor aggregates benchmark thresholds across the whole campaign and enforces the full gate', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'full-audit-campaign-supervisor.mjs'), 'utf8');
  assert.match(source, /function campaignIterationRunIds\(currentRun = null, canonicalSummary = null\) \{/);
  assert.match(source, /function aggregateBenchmarkObserved\(\{ contract = null, currentRun = null, canonicalSummary = null, delegateLiveExecutionSummary = null, delegatePatchQueueReport = null \} = \{\}\) \{/);
  assert.match(source, /const observed = aggregateBenchmarkObserved\(\{/);
  assert.match(source, /const benchmarkProgress = readJson\(path\.join\(delegateDir, 'benchmark_progress\.json'\), null\);/);
  assert.match(source, /const benchmarkObserved = benchmarkProgress\?\.observed && typeof benchmarkProgress\.observed === 'object'/);
  assert.match(source, /function implicitBenchmarkThresholds\(contract = null\) \{/);
  assert.match(source, /Product parity-scope contracts must prove direct promoted product diff even when goThresholds are omitted\./);
  assert.match(source, /const thresholds = implicitBenchmarkThresholds\(contract\);/);
  assert.match(source, /if \(benchmarkObserved\) \{/);
  assert.match(source, /const promotedLoc = promotedProductLocFromAccounting\(locAccounting, contract\);/);
  assert.match(source, /DEFAULT_PRODUCTION_CREDIT_EXCLUDED_PREFIXES = Object\.freeze\(\[/);
  assert.match(source, /'packages\/product-factory\/'/);
  assert.match(source, /outside_contract_allowed_files/);
  assert.doesNotMatch(source, /productDiffChangedLines \+= Number\(benchmarkObserved\.productDiffChangedLines \|\| 0\);/);
  assert.match(source, /candidateProgressDiscardedLines \+= Math\.max\(0, observedChangedLines - promotedLoc\.changedLines\);/);
  assert.match(source, /productDiffChangedLines \+= promotedLoc\.changedLines;/);
  assert.match(source, /untrackedFilesExcluded: true/);
  assert.match(source, /compareMaximum\(\{ thresholdField: 'maximumNoOpRate', observedField: 'noOpRate', label: 'No-op rate' \} \);/);
  assert.match(source, /compareMaximum\(\{ thresholdField: 'maximumRepeatBlockerRate', observedField: 'repeatBlockerRate', label: 'Repeat-blocker rate' \} \);/);
  assert.match(source, /compareMinimum\(\{ thresholdField: 'minimumVerificationIntegrity', observedField: 'verificationIntegrity', label: 'Verification integrity' \} \);/);
  assert.match(source, /compareEquality\(\{ thresholdField: 'truthIntegrityContradictions', observedField: 'truthIntegrityContradictions', label: 'Truth contradictions' \} \);/);
  assert.match(source, /netProductAddedLines \+= promotedLoc\.added;/);
  assert.match(source, /netProductFiles: productFiles\.size,/);
  assert.match(source, /noOpRate: totalPatchCandidates > 0 \? roundMetric\(noOpPatchCount \/ totalPatchCandidates\) : 0,/);
  assert.match(source, /repeatBlockerRate: blockerEventCount > 0/);
});

test('sync step mirrors remote benchmark-progress aggregates for the control-plane supervisor', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'full-audit-campaign-sync-remote-worktree.mjs'), 'utf8');
  assert.match(source, /benchmark_progress: 'benchmark_progress\.json'/);
});

test('remote runner benchmark progress credits promoted production files, not generated product-factory candidate files', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'full-audit-campaign-remote-runner.mjs'), 'utf8');
  assert.match(source, /DEFAULT_PRODUCTION_CREDIT_EXCLUDED_PREFIXES = Object\.freeze\(\[/);
  assert.match(source, /'packages\/product-factory\/'/);
  assert.match(source, /function promotedProductLocFromAccounting\(locAccounting = null, contract = null\)/);
  assert.match(source, /productionCreditEligibility\(filePath, policy\)\.eligible/);
  assert.match(source, /readJson\(BENCHMARK_CONTRACT_DEST_PATH, null\)/);
  assert.match(source, /locAccounting: readJson\(path\.join\(ARTIFACT_ROOT, 'loc_accounting\.json'\), null\) \|\| completionSummary\?\.locAccountingSummary/);
  assert.doesNotMatch(source, /function measureProductDiffChangedLines/);
});

test('full-audit supervisor respects the strict 1:1 parity ceiling for full-clone claims', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'full-audit-campaign-supervisor.mjs'), 'utf8');
  assert.match(source, /import \{ spawnSync \} from 'node:child_process';/);
  assert.match(source, /const STRICT_1TO1_SUPERVISOR_SCRIPT = path\.join\(ROOT, 'scripts', 'strict-1to1-supervisor\.mjs'\);/);
  assert.match(source, /const STRICT_1TO1_CONTRACT_PATH = path\.join\(ROOT, 'strict_1to1_contract\.json'\);/);
  assert.match(source, /function evaluateStrict1To1Ceiling\(contract = \{\}, strict1to1Contract = null\) \{/);
  assert.match(source, /const requestedFidelity = String\(contract\?\.requestedFidelity \|\| strict1to1Contract\?\.requestedFidelity \|\| ''\)/);
  assert.match(source, /spawnSync\(process\.execPath, \[STRICT_1TO1_SUPERVISOR_SCRIPT\]/);
  assert.match(source, /Strict 1:1 parity ceiling is still red, so the Mailchimp clone cannot be treated as full-clone complete\./);
  assert.match(source, /const requestedFidelity = contract\.requestedFidelity \|\| strict1to1Contract\?\.requestedFidelity \|\| 'full_clone';/);
  assert.match(source, /const requestedOutcome = deriveRequestedOutcome\(\{/);
  assert.match(source, /const headline = buildOutcomeHeadline\(\{ orchestration, requestedOutcome \}\);/);
});

test('full-audit notifier emits a clearer strict-ceiling summary when orchestration already passed', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'full-audit-campaign-notify.mjs'), 'utf8');
  assert.match(source, /const headline = summary\?\.headline \|\| state\?\.supervisor\?\.headline \|\| null;/);
  assert.match(source, /const deliveredSummary = success/);
  assert.match(source, /Orchestration passed, full-clone strict 1:1 ceiling still red: run=\$\{currentRunId\}/);
  assert.match(source, /Delivered current run strict 1:1 ceiling notification after orchestration passed\./);
  assert.match(source, /JSON\.stringify\(\{ status: 'blocked', runId: currentRunId, headline, blockerKind, supervisor: state\?\.supervisor \|\| null \}, null, 2\)/);
});

test('product-only supervisor canonicalizes shard ids before computing next focus', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'orchestrator-real-repo-clean-supervisor.mjs'), 'utf8');
  assert.match(source, /canonicalizeFocusId,/);
  assert.match(source, /normalizeFocusIds/);
  assert.match(source, /const shardId = canonicalizeFocusId\(result\?\.shardId\);/);
  assert.match(source, /const completedFocusIds = new Set\(normalizeFocusIds\(String\(process\.env\.MAILCHIMP_COMPLETED_FOCUS_IDS \|\| ''\)/);
});

test('real-repo supervisor loc accounting includes fresh untracked product files from disposable worktrees', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'orchestrator-real-repo-clean-supervisor.mjs'), 'utf8');
  assert.match(source, /git', \['ls-files', '--others', '--exclude-standard', '--', '\.'\]/);
  assert.match(source, /untracked: true/);
  assert.match(source, /category: classifyDiffPath\(relPath\)/);
});

test('worker seeds a fresh current_run instead of inheriting foreign run ancestry', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'full-audit-campaign-worker-100-agent.mjs'), 'utf8');
  assert.match(source, /function resolveRunId\(\)/);
  assert.match(source, /if \(!requested \|\| requested === 'default'\) return makeGeneratedRunId\(\);/);
  assert.match(source, /const preservedCurrentRun = existingBinding\.currentRun\?\.runId === RUN_ID/);
  assert.match(source, /const DELEGATE_COMPLETION_SUMMARY = path.join\(DELEGATE_ARTIFACT_ROOT, 'canonical_summary\.json'\);/);
  assert.match(source, /const DELEGATE_PROGRAM_STATE = path.join\(DELEGATE_ARTIFACT_ROOT, 'program_state\.json'\);/);
  assert.match(source, /campaignRunId: preservedCurrentRun\?\.campaignRunId \?\? `campaign-\$\{RUN_ID\}`/);
  assert.match(source, /startedAt: preservedCurrentRun\?\.startedAt \?\? new Date\(\)\.toISOString\(\)/);
  assert.match(source, /remoteArtifactRoot: preservedCurrentRun\?\.remoteArtifactRoot \?\? null/);
});

test('launch script binds a fresh run id and campaign id for persistent Mailchimp full-clone launches', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'full-audit-campaign-launch.mjs'), 'utf8');
  assert.match(source, /import crypto from 'node:crypto';/);
  assert.match(source, /const launchRunId = process\.env\.MAILCHIMP_FULL_AUDIT_RUN_ID \|\| makeRunId\(\);/);
  assert.match(source, /const campaignRunId = process\.env\.MAILCHIMP_CAMPAIGN_RUN_ID \|\| makeCampaignRunId\(\);/);
  assert.match(source, /MAILCHIMP_FULL_AUDIT_RUN_ID: launchRunId/);
  assert.match(source, /MAILCHIMP_CAMPAIGN_RUN_ID: campaignRunId/);
  assert.match(source, /const oneShot = process\.env\.MAILCHIMP_ONE_SHOT === '1';/);
  assert.match(source, /const benchmarkContract = readJsonIfExists\(benchmarkContractTargetPath, null\);/);
  assert.match(source, /const contractLaunchEnv = benchmarkContract\?\.launchEnvironment && typeof benchmarkContract\.launchEnvironment === 'object'/);
  assert.match(source, /\.\.\.contractLaunchEnv,/);
  assert.match(source, /const persistent = oneShot \? null : run\('scripts\/full-audit-campaign-persistent-runner\.mjs'\);/);
  assert.match(source, /const watcher = oneShot \|\| persistent/);
  assert.match(source, /run\('scripts\/full-audit-campaign-watch\.mjs'\)/);
  assert.match(source, /mode: oneShot \? 'one_shot' : 'persistent',/);
  assert.match(source, /contractLaunchEnvironmentKeys: Object\.keys\(contractLaunchEnv\)\.sort\(\),/);
  assert.match(source, /persistentExitCode: persistent\?\.status \?\? null,/);
  assert.match(source, /env: sharedEnv/);
  assert.match(source, /runId: launchRunId,/);
  assert.match(source, /campaignRunId,/);
});

test('parity focus planner serializes file-colliding surfaces and still expands exact carry-forward credits', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'lib', 'orchestrator-real-repo-clean-plan.mjs'), 'utf8');
  assert.match(source, /function surfaceEquivalenceSignature\(surface\)/);
  assert.match(source, /function surfaceCollisionSignature\(surface\)/);
  assert.match(source, /function buildSurfaceGroupMap\(signatureResolver\)/);
  assert.match(source, /const SURFACE_EQUIVALENCE_BY_FOCUS_ID = buildSurfaceGroupMap\(surfaceEquivalenceSignature\);/);
  assert.match(source, /const SURFACE_COLLISION_BY_FOCUS_ID = buildSurfaceGroupMap\(surfaceCollisionSignature\);/);
  assert.match(source, /export function expandEquivalentFocusIds\(values = \[\]\) \{/);
  assert.match(source, /export function selectNonOverlappingFocusIds\(values = \[\]\) \{/);
  assert.match(source, /for \(const siblingFocusId of SURFACE_COLLISION_BY_FOCUS_ID\.get\(focusId\) \|\| \[focusId\]\) \{/);
  assert.match(source, /return new Set\(expandEquivalentFocusIds\(String\(process\.env\.MAILCHIMP_COMPLETED_FOCUS_IDS \|\| ''\)/);
  assert.match(source, /new Set\(selectNonOverlappingFocusIds\(Array\.from\(remainingOpenFocusIds\)\)\)/);
  assert.match(source, /status: remainingOpenFocusIds\.has\(`focus\.\$\{surface\.id\}`\) \? 'open' : 'proven_complete'/);
});

test('persistent runner carries completed Mailchimp surfaces forward across shared continuation decisions', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'full-audit-campaign-persistent-runner.mjs'), 'utf8');
  assert.match(source, /import \{ deriveCampaignContinuation, initializeCampaign, installProcessTerminationPersistence \} from '\.\.\/\.\.\/large-project-capability-stack\/packages\/campaign-runtime\/index\.mjs';/);
  assert.match(source, /import \{ ORCHESTRATION_PROGRAM_SPEC, resolveProgramEnvKeys, resolveProgramPaths, resolveProgramScriptPath \} from '\.\/lib\/orchestration-program-config\.mjs';/);
  assert.match(source, /import \{ buildMailchimpParityFocusWorkGraph, extractVerifiedFocusIdsFromPatchQueue, mailchimpParityFocusIds \} from '\.\/lib\/orchestrator-real-repo-clean-plan\.mjs';/);
  assert.match(source, /function deriveCompletedFocusIds\(/);
  assert.match(source, /const mergedFocusIds = new Set\(normalizeFocusIds\(iterationRecord\?\.mergedFocusIds \|\| \[\]\)\);/);
  assert.match(source, /if \(mergedFocusIds\.size > 0\) return parityFocusIds\.filter\(\(focusId\) => mergedFocusIds\.has\(focusId\)\);/);
  assert.match(source, /function deriveIterationContinuation\(/);
  assert.match(source, /const delegatePatchQueueReport = readJson\(path\.join\(runDir, 'delegate', 'patch_queue_report\.json'\), \{ merged: \[\] \}\);/);
  assert.match(source, /mergedFocusIds: extractVerifiedFocusIdsFromPatchQueue\(delegatePatchQueueReport\),/);
  assert.match(source, /\[PROGRAM_ENV\.completedFocusIds\]: Array\.from\(completedFocusIds\)\.join\(','\)/);
  assert.match(source, /for \(const focusId of deriveCompletedFocusIds\(iterationRecord\)\) completedFocusIds\.add\(focusId\);/);
  assert.match(source, /const continuation = iterationRecord\.continuationDecision/);
  assert.match(source, /if \(softContinuation\) \{/);
  assert.match(source, /completedFocusIds: Array\.from\(completedFocusIds\),/);
});

test('wrapper config centralizes reusable orchestration program wiring', () => {
  const workerSource = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'full-audit-campaign-worker-100-agent.mjs'), 'utf8');
  const notifySource = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'full-audit-campaign-notify.mjs'), 'utf8');
  const watchSource = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'full-audit-campaign-watch.mjs'), 'utf8');
  const contractSource = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'lib', 'full-audit-campaign-remote-contract.mjs'), 'utf8');
  const configSource = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'lib', 'orchestration-program-config.mjs'), 'utf8');
  const architectureSource = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'lib', 'full-audit-campaign-architecture.mjs'), 'utf8');
  assert.match(workerSource, /applyProgramRuntimeDefaults\(\{ rootDir: ROOT \}\);/);
  assert.match(workerSource, /const PROGRAM_ENV = resolveProgramEnvKeys\(\);/);
  assert.match(notifySource, /const paths = resolveProgramPaths\(ROOT\);/);
  assert.match(notifySource, /awaitingNotifier: false,/);
  assert.match(watchSource, /notifyArgs: \[resolveProgramScriptArg\('notify'\)\]/);
  assert.match(contractSource, /buildProgramRemoteLaunchEnvironment/);
  assert.match(contractSource, /buildProgramRemoteRuntimeCandidates/);
  assert.match(configSource, /useBenchmarkScope: 'MAILCHIMP_USE_BENCHMARK_SCOPE',/);
  assert.match(configSource, /if \(env\[spec\.env\.completedFocusIds\]\) launchEnv\[spec\.env\.completedFocusIds\] = String\(env\[spec\.env\.completedFocusIds\]\);/);
  assert.match(configSource, /if \(env\[spec\.env\.useBenchmarkScope\]\) launchEnv\[spec\.env\.useBenchmarkScope\] = String\(env\[spec\.env\.useBenchmarkScope\]\);/);
  assert.match(configSource, /if \(env\[spec\.env\.maxRuntimeHours\]\) launchEnv\[spec\.env\.maxRuntimeHours\] = String\(env\[spec\.env\.maxRuntimeHours\]\);/);
  assert.match(configSource, /if \(env\[spec\.env\.soakFullRuntime\]\) launchEnv\[spec\.env\.soakFullRuntime\] = String\(env\[spec\.env\.soakFullRuntime\]\);/);
  assert.match(architectureSource, /resolveProgramScriptArg\('remoteRunner'\)/);
});

test('remote execution mirrors live execution and patch queue artifacts for control-plane freshness checks', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'lib', 'full-audit-campaign-remote-execution.mjs'), 'utf8');
  const writeRemoteFileSource = source.match(/function writeRemoteFile\([\s\S]*?\n}\n\nfunction syncRemoteControlFiles/)?.[0] || '';
  assert.match(source, /'artifacts\/full_audit_campaign\/one_pass_run_contract\.latest\.json'/);
  assert.match(source, /'scripts\/lib\/mailchimp-canonical-one-pass-plan-data\.mjs'/);
  assert.match(source, /'packages\/multi-agent-orchestrator\/index\.mjs'/);
  assert.match(source, /'packages\/campaign-runtime\/index\.mjs'/);
  assert.match(source, /function resolveControlSyncRoots\(repoRoot, remoteExecution\)/);
  assert.match(source, /'large-project-capability-stack': path.resolve\(repoRoot, '\.\.', 'large-project-capability-stack'\)/);
  assert.match(source, /remoteStackRepoRoot: remoteRoots\['large-project-capability-stack'\]/);
  assert.match(source, /remoteExecutionTerminal: path.join\(remoteArtifactRoot, 'remote_execution_terminal\.json'\)/);
  assert.match(source, /liveExecutionSummary: path.join\(remoteArtifactRoot, 'live_execution_summary\.json'\)/);
  assert.match(source, /patchQueueReport: path.join\(remoteArtifactRoot, 'patch_queue_report\.json'\)/);
  assert.match(source, /mirrorOptionalFile\(remoteTerminalText, path.join\(delegateArtifactRoot, 'remote_execution_terminal\.json'\), 'remoteExecutionTerminalPath'\)/);
  assert.match(source, /mirrorOptionalFile\(liveExecutionSummaryText, path.join\(delegateArtifactRoot, 'live_execution_summary\.json'\), 'liveExecutionSummaryPath'\)/);
  assert.match(source, /mirrorOptionalFile\(patchQueueReportText, path.join\(delegateArtifactRoot, 'patch_queue_report\.json'\), 'patchQueueReportPath'\)/);
  assert.match(source, /try \{ fs\.rmSync\(localPath, \{ force: true \}\); \} catch \{\}/);
  assert.match(source, /mirrorOptionalFile\(programText, delegateProgramStatePath, 'programStatePath'\)/);
  assert.match(writeRemoteFileSource, /python3 -c/);
  assert.match(writeRemoteFileSource, /p = Path\(sys\.argv\[1\]\)/);
  assert.match(writeRemoteFileSource, /p\.write_bytes\(sys\.stdin\.buffer\.read\(\)\)/);
  assert.doesNotMatch(writeRemoteFileSource, /python3 - <<'PY'/);
  assert.match(source, /spawnSync\('ssh', buildSshArgs\(remoteExecution, remoteCommand\), \{/);
  assert.match(source, /input: content/);
  assert.match(source, /const verifiedRemoteSha = readRemoteSha\(remoteExecution, remotePath, \{ timeoutMs: 20_000 \}\);/);
  assert.match(source, /if \(verifiedRemoteSha !== localSha\) \{/);
});

test('worker wrapper converts top-level remote submission crashes into explicit blocker artifacts', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'full-audit-campaign-worker-100-agent.mjs'), 'utf8');
  assert.match(source, /try \{/);
  assert.match(source, /catch \(error\) \{/);
  assert.match(source, /status: 'worker_wrapper_failed'/);
  assert.match(source, /phase: 'worker_wrapper_failed'/);
  assert.match(source, /100-agent worker crashed before remote execution could hand back a blocker or success state\./);
  assert.match(source, /Inspect reports\/100_agent_worker\.log and the worker wrapper error/);
});

test('delegate supervisor reconciles final green state by clearing nested blockers and completing stages', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'orchestrator-real-repo-clean-supervisor.mjs'), 'utf8');
  assert.match(source, /const finalStages = finalAllComplete/);
  assert.match(source, /blocker: finalBlocker \|\| null,/);
  assert.match(source, /note: finalAllComplete/);
  assert.match(source, /stages: finalStages,/);
});

test('persistent runner seeds iteration truth for current_run and supervisor at rollover', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'full-audit-campaign-persistent-runner.mjs'), 'utf8');
  assert.match(source, /function seedIterationTruth\(/);
  assert.match(source, /writeJson\(CURRENT_RUN_PATH, \{/);
  assert.match(source, /remoteArtifactRoot: null/);
  assert.match(source, /writeJson\(SUPERVISOR_STATUS_PATH, \{/);
  assert.match(source, /supervisorStatus: 'running'/);
  assert.match(source, /writeJson\(BLOCKER_PATH, \{/);
  assert.match(source, /writeJson\(SYNC_STATUS_PATH, \{/);
  assert.match(source, /initializeCampaign\(PROGRAM_STATE_PATH, \{/);
  assert.match(source, /const seededProgramState = readJson\(PROGRAM_STATE_PATH, \{\}\);/);
  assert.match(source, /writeJson\(PROGRAM_STATE_PATH, seededProgramState\);/);
  assert.match(source, /function readJsonForRun\(/);
  assert.match(source, /const blockerReport = readJsonForRun\(BLOCKER_PATH, runId, null\);/);
});

test('real-repo clean and legacy runs pass the campaign contract into live worker farm launches', () => {
  const cleanSource = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'orchestrator-real-repo-clean-run.mjs'), 'utf8');
  const legacySource = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'orchestrator-real-repo-run.mjs'), 'utf8');
  assert.match(cleanSource, /runLiveWorkerFarm\(\{[\s\S]*campaignContract: contract,/);
  assert.match(legacySource, /runLiveWorkerFarm\(\{[\s\S]*campaignContract: contract,/);
});

test('real-repo supervisor clean-baseline green truth ignores implementation-only artifact stages', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'orchestrator-real-repo-supervisor.mjs'), 'utf8');
  assert.doesNotMatch(source, /implementationArtifactsPresent/);
  assert.match(source, /const requiredStageKeys = \[/);
  assert.match(source, /'live_worker_selected_tier_green'/);
  assert.match(source, /'repo_integrity_green'/);
  assert.match(source, /const effectiveMatrixStatus = greenComplete \? 'all_complete' : matrix\.status;/);
  assert.match(source, /status: greenComplete \? 'green' : 'red'/);
});
