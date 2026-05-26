import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalizeFocusId, extractVerifiedFocusIdsFromPatchQueue, normalizeFocusIds } from '../scripts/lib/orchestrator-real-repo-clean-plan.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(
  path.join(__dirname, '..', 'scripts', 'full-audit-campaign-remote-runner.mjs'),
  'utf8'
);

test('focus id helpers collapse shard ids to canonical parity focus ids', () => {
  assert.equal(canonicalizeFocusId('focus.frontend_interaction_parity#2'), 'focus.frontend_interaction_parity');
  assert.deepEqual(
    normalizeFocusIds([
      'focus.frontend_interaction_parity#1',
      'focus.frontend_interaction_parity#2',
      'focus.frontend_interaction_parity'
    ]),
    ['focus.frontend_interaction_parity']
  );
});

test('patch queue proof credits canonical focus ids instead of shard ids', () => {
  assert.deepEqual(
    extractVerifiedFocusIdsFromPatchQueue({
      merged: [
        {
          shardId: 'focus.frontend_interaction_parity#1',
          metadata: { implementation: { modifiedFiles: ['packages/app/view.mjs'] } }
        },
        {
          taskId: 'focus.frontend_interaction_parity#2',
          metadata: { implementation: { modifiedFiles: ['packages/app/routes/public.mjs'] } }
        }
      ]
    }),
    ['focus.frontend_interaction_parity']
  );
});

test('remote runner preserves partial progress retry classes even when a blocker artifact exists', () => {
  assert.match(source, /if \(blocker && blockerClass === 'hard_blocker'\) blockerClass = null;/);
  assert.doesNotMatch(source, /if \(blocker\) blockerClass = null;/);
});

test('remote runner rewrites absolute local benchmark contract paths for disposable worktrees', () => {
  assert.match(source, /const BENCHMARK_CONTRACT_ITERATION_ENV_PATH = path\.join\('artifacts', 'full_audit_campaign', 'one_pass_run_contract\.latest\.json'\);/);
  assert.match(source, /function resolveIterationBenchmarkContractEnvPath\(\) \{/);
  assert.match(source, /if \(!path\.isAbsolute\(requested\)\) return requested;/);
  assert.match(source, /return BENCHMARK_CONTRACT_ITERATION_ENV_PATH;/);
  assert.match(source, /const iterationBenchmarkContractPath = resolveIterationBenchmarkContractEnvPath\(\);/);
  assert.match(source, /iterationEnv\.MAILCHIMP_ONE_PASS_CONTRACT_PATH = iterationBenchmarkContractPath;/);
  assert.match(source, /effectiveBenchmarkContractEnvPath: iterationBenchmarkContractPath,/);
});

test('remote runner seeds remote progress from completed focus ids passed in the launch environment', () => {
  assert.match(source, /extractSuspectFocusIdsFromPatchQueue/);
  assert.match(source, /extractVerifiedFocusIdsFromPatchQueue/);
  assert.match(source, /return objectiveCreditFocusIds\(Array\.isArray\(value\) \? value : \[\]\);/);
  assert.match(source, /function legacyProgressStateLooksBloatContaminated\(raw = null\)/);
  assert.match(source, /productDiffChangedLines >= 100000/);
  assert.match(source, /function filterFocusIdsByTrustedSet\(values = \[\], trustedValues = \[\]\) \{/);
  assert.match(source, /const envCompletedFocusIds = normalizeCompletedFocusIds\(String\(process\.env\.MAILCHIMP_COMPLETED_FOCUS_IDS \|\| ''\)\.split\(','\)\);/);
  assert.match(source, /const envVerifiedCompletedFocusIds = normalizeCompletedFocusIds\(String\(process\.env\.MAILCHIMP_VERIFIED_COMPLETED_FOCUS_IDS \|\| ''\)\.split\(','\)\);/);
  assert.match(source, /const suspectCompletedFocusIds = normalizeCompletedFocusIds\(\[/);
  assert.match(source, /legacyProgressStateLooksBloatContaminated\(raw\) \? verifiedCompletedFocusIds : \[\]/);
  assert.match(source, /const trustedVerifiedCompletedFocusIds = verifiedCompletedFocusIds\.filter/);
  assert.match(source, /const seededEnvCompletedFocusIds = trustedVerifiedCompletedFocusIds\.length > 0/);
  assert.match(source, /\? filterFocusIdsByTrustedSet\(envCompletedFocusIds, trustedVerifiedCompletedFocusIds\)/);
  assert.match(source, /const seededCompletedFocusIds = normalizeCompletedFocusIds\(trustedVerifiedCompletedFocusIds\);/);
  assert.doesNotMatch(source, /\.\.\.seededEnvCompletedFocusIds,/);
  assert.match(source, /completedFocusIds: seededCompletedFocusIds,/);
  assert.match(source, /const envCompletedFocusIds = Array\.isArray\(next\?\.envCompletedFocusIds\) \? next\.envCompletedFocusIds : \[\];/);
  assert.match(source, /const verifiedCompletedFocusIds = normalizeCompletedFocusIds\(rawVerifiedCompletedFocusIds\)\s+\.filter/);
  assert.doesNotMatch(source, /rawVerifiedCompletedFocusIds\.length > 0 \? rawVerifiedCompletedFocusIds : rawCompletedFocusIds/);
  assert.match(source, /const completedFocusIds = normalizeCompletedFocusIds\(verifiedCompletedFocusIds\);/);
  assert.match(source, /const verifiedFocusIds = Array\.from\(new Set\(\[\.\.\.\(progressState\.verifiedCompletedFocusIds \|\| \[\]\), \.\.\.mergedFocusIds\]\)\);/);
  assert.match(source, /verifiedCompletedFocusIds: verifiedFocusIds,/);
  assert.match(source, /MAILCHIMP_VERIFIED_COMPLETED_FOCUS_IDS: Array\.isArray\(progressState\?\.verifiedCompletedFocusIds\) \? progressState\.verifiedCompletedFocusIds\.join\(','\) : '',/);
  assert.match(source, /if \(process\.env\.MAILCHIMP_USE_BENCHMARK_SCOPE\) iterationEnv\.MAILCHIMP_USE_BENCHMARK_SCOPE = process\.env\.MAILCHIMP_USE_BENCHMARK_SCOPE;/);
});

test('remote runner credits verified patch-queue proof when the current iteration produced live shard work', () => {
  assert.match(source, /const selectedTierHadLiveWork = hasSelectedTierLiveWork\(liveExecutionSummary\);/);
  assert.match(source, /const patchQueueFocusIds = extractMergedFocusIds\(patchQueueReport\);/);
  assert.match(source, /const targetedTestCandidateFocusIds = selectedTierHadLiveWork/);
  assert.match(source, /const patchQueueSuspectFocusIds = extractSuspectFocusIdsFromPatchQueue\(patchQueueReport\);/);
  assert.match(source, /!patchQueueSuspectFocusIds\.includes\(focusId\)/);
  assert.match(source, /semanticBloatCurrentIteration !== true/);
  assert.match(source, /filter\(\(focusId\) => !progressState\.completedFocusIds\.includes\(focusId\)\)/);
  assert.match(source, /const targetedTestVerifiedFocusIds = targetedTestCandidateFocusIds\.length > 0/);
  assert.match(source, /verifyFocusIdsByTargetedTests\(targetedTestCandidateFocusIds\)/);
  assert.match(source, /function creditableFocusIdsForIteration\(/);
  assert.match(source, /if \(isNoParityReductionBlocker\(blocker\)\) \{/);
  assert.match(source, /\.\.\.patchQueueFocusIds,/);
  assert.match(source, /\.\.\.targetedTestVerifiedFocusIds/);
  assert.doesNotMatch(source, /summaryProvenFocusIds/);
  assert.match(source, /const mergedFocusIds = creditableFocusIdsForIteration\(\{/);
  assert.match(source, /const creditedFocusIds = Array\.from\(new Set\(\[\.\.\.\(progressState\.verifiedCompletedFocusIds \|\| \[\]\), \.\.\.mergedFocusIds\]\)\);/);
  assert.match(source, /const gainedCreditedFocus = creditedFocusIds\.length > progressState\.completedFocusIds\.length;/);
  assert.match(source, /function hasVerifiedProductPatchProgress\(patchQueueReport = null\) \{/);
  assert.match(source, /const verifiedProductPatchProgressDetected = selectedTierHadLiveWork/);
  assert.match(source, /trustedPatchQueueFocusIds\.length > 0/);
  assert.match(source, /hasVerifiedProductPatchProgress\(patchQueueReport\);/);
  assert.match(source, /function deepArchitectureCreditRequired\(\) \{/);
  assert.match(source, /process\.env\.MAILCHIMP_REQUIRE_DEEP_ARCHITECTURE_CREDIT === '1'/);
  assert.match(source, /const freshProgressDetected = deepArchitectureCreditRequired\(\)/);
  assert.match(source, /\? \(selectedTierHadLiveWork && \(progressDelta\.length > 0 \|\| verifiedProductPatchProgressDetected\)\)/);
  assert.match(source, /: \(Boolean\(workspaceDiff\.trim\(\)\)/);
  assert.match(source, /const greenCompletionReached = !blocker\s+&& selectedTierHadLiveWork\s+&& statuses\.supervisorStatus === 'green'\s+&& statuses\.matrixStatus === 'all_complete';/);
  assert.match(source, /const retryClass = campaignState\?\.stopAllowed && !blocker && !freshProgressDetected && !greenCompletionReached/);
  assert.match(source, /const shouldRequeue = greenCompletionReached\s+\? false/);
  assert.match(source, /completedFocusIds: creditedFocusIds/);
  assert.match(source, /noProgressStreak: \(progressDelta\.length > 0 \|\| gainedCreditedFocus\) \? 0 : progressState\.noProgressStreak/);
});

test('remote runner does not treat repeated partial blocker text as fresh progress without new credited focus', () => {
  assert.match(source, /function classifyIteration\(\{ blocker = null, progressDelta = \[\], freshProgressDetected = false, spawnError = null, workspaceError = null, retryClass = null \}\) \{/);
  assert.match(source, /if \(progressDelta.length > 0 \|\| freshProgressDetected\) return 'partial_progress';/);
  assert.match(source, /if \(text.includes\('partial parity-surface reduction'\)\) return 'no_progress';/);
  assert.match(source, /let blockerClass = classifyIteration\(\{ blocker, progressDelta, freshProgressDetected, spawnError: result\.error, workspaceError: result\.workspaceRefreshError, retryClass \}\);/);
});

test('remote runner leaves verified partial-progress files in the disposable worktree for control-plane sync', () => {
  assert.match(source, /const PARTIAL_PROGRESS_PROMOTION_PATH = path\.join\(ARTIFACT_ROOT, 'partial_progress_promotion\.json'\);/);
  assert.match(source, /function recordVerifiedProductPatchFilesForControlPlanePromotion\(patchQueueReport = null\) \{/);
  assert.match(source, /const creditableEntries = deepArchitectureCreditRequired\(\)/);
  assert.match(source, /mergedEntries\.filter\(\(entry\) => extractVerifiedFocusIdsFromPatchQueue\(\{ merged: \[entry\] \}\)\.length > 0\)/);
  assert.match(source, /const productFiles = extractProductSurfaceFiles\(creditableEntries\);/);
  assert.match(source, /mode: 'control_plane_sync_from_disposable_worktree'/);
  assert.match(source, /writeJson\(PARTIAL_PROGRESS_PROMOTION_PATH, manifest\);/);
  assert.doesNotMatch(source, /fs\.copyFileSync\(sourcePath, targetPath\);/);
  assert.match(source, /remote partial-progress control-plane promotion manifest/);
  assert.match(source, /if \(blockerClass === 'partial_progress'\) \{/);
  assert.match(source, /recordVerifiedProductPatchFilesForControlPlanePromotion\(patchQueueReport\);/);
  assert.match(source, /continuationDetected = true;\s+break;/);
});

test('remote runner terminalizes repeated zero-work scoped green as a blocker, not ok=true', () => {
  assert.match(source, /let terminalNoProgressBlocker = null;/);
  assert.match(source, /terminalNoProgressBlocker = \{/);
  assert.match(source, /remote_no_progress_scoped_green/);
  assert.match(source, /do not report remote_execution_finished\/ok=true for a zero-work scoped-green loop/);
  assert.match(source, /writeJson\(BLOCKER_PATH, \{/);
  assert.match(source, /finalOk = false;/);
  assert.match(source, /finalExitCode = 1;/);
  assert.match(source, /blocker: terminalNoProgressBlocker,/);
});

test('remote runner treats strict-gap focus work as planned parity work and counts live shard evidence beyond live-run directories', () => {
  assert.match(source, /const STRICT_GAP_SINGLE_PASS = String\(process\.env\.MAILCHIMP_STRICT_GAP_SEQUENCE \|\| ''\)\.trim\(\) === '1'/);
  assert.match(source, /&& String\(process\.env\.MAILCHIMP_USE_STRICT_GAP_INVENTORY \|\| ''\)\.trim\(\) === '1';/);
  assert.doesNotMatch(source, /MAILCHIMP_USE_STRICT_GAP_INVENTORY: process\.env\.MAILCHIMP_USE_STRICT_GAP_INVENTORY \|\| '1'/);
  assert.doesNotMatch(source, /MAILCHIMP_STRICT_GAP_SEQUENCE: process\.env\.MAILCHIMP_STRICT_GAP_SEQUENCE \|\| '1'/);
  assert.match(source, /function resolvePlannedFocusWorkUnitIds\(workGraph = null\)/);
  assert.match(source, /const unitId = String\(unit\?\.id \|\| ''\)\.trim\(\);/);
  assert.match(source, /const focusId = String\(unit\?\.metadata\?\.focusId \|\| ''\)\.trim\(\);/);
  assert.match(source, /if \(unitId\.startsWith\('focus\.'\)\) return unitId;/);
  assert.match(source, /if \(unit\?\.metadata\?\.strictGap === true && \(unitId \|\| focusId\)\) return unitId \|\| focusId;/);
  assert.match(source, /const plannedFocusWorkUnitIds = resolvePlannedFocusWorkUnitIds\(workGraph\);/);
  assert.match(source, /const parityFocusPlanned = plannedFocusWorkUnitIds\.length > 0;/);
  assert.match(source, /const liveExecutionSummaryForMode = readJson\(path\.join\(ARTIFACT_ROOT, 'live_execution_summary\.json'\), null\);/);
  assert.match(source, /const patchQueueForMode = readJson\(path\.join\(ARTIFACT_ROOT, 'patch_queue_report\.json'\), \{ merged: \[\] \}\);/);
  assert.match(source, /\|\| hasSelectedTierLiveWork\(liveExecutionSummaryForMode\)/);
  assert.match(source, /\|\| extractMergedFocusIds\(patchQueueForMode\)\.length > 0;/);
  assert.match(source, /plannedFocusWorkUnitIds,/);
});

test('remote runner does not derive carry-forward proof from completion summary alone', () => {
  assert.doesNotMatch(source, /function deriveProvenFocusIdsFromSummary\(/);
  assert.doesNotMatch(source, /summaryProvenFocusIds/);
});

test('remote runner persists cumulative benchmark metrics across internal iterations', () => {
  assert.match(source, /const BENCHMARK_PROGRESS_PATH = path\.join\(ARTIFACT_ROOT, 'benchmark_progress\.json'\);/);
  assert.match(source, /function loadBenchmarkMetrics\(raw = null\) \{/);
  assert.match(source, /function accumulateBenchmarkMetrics\(\{/);
  assert.match(source, /benchmarkMetrics: loadBenchmarkMetrics\(raw\?\.benchmarkMetrics\),/);
  assert.match(source, /const benchmarkMetrics = accumulateBenchmarkMetrics\(\{/);
  assert.match(source, /benchmarkMetrics,/);
  assert.match(source, /writeJson\(BENCHMARK_PROGRESS_PATH, \{/);
  assert.match(source, /observed: summarizeBenchmarkMetrics\(progressState\?\.benchmarkMetrics\)/);
});

test('remote runner credits promoted product LOC incrementally instead of re-counting cumulative diff every iteration', () => {
  assert.match(source, /productLocCreditByFile: \{\}/);
  assert.match(source, /const previousChangedLines = Number\(locCreditByFile\[entry\.path\]\?\.changedLines \|\| 0\);/);
  assert.match(source, /const incrementalChangedLines = Math\.max\(0, currentChangedLines - previousChangedLines\);/);
  assert.match(source, /next\.productDiffChangedLines \+= promotedChangedLines;/);
});

test('remote runner forwards semantic director targeting env into live iterations', () => {
  assert.match(source, /'MAILCHIMP_REQUIRE_DEEP_ARCHITECTURE_CREDIT'/);
  assert.match(source, /'MAILCHIMP_SEMANTIC_WORK_DIRECTOR_TARGET_FOCUS_IDS'/);
  assert.match(source, /'MAILCHIMP_SEMANTIC_WORK_DIRECTOR_MAX_GAPS'/);
  assert.match(source, /'MAILCHIMP_SEMANTIC_WORK_DIRECTOR_SKIP_ADOPTED_PHASES'/);
  assert.match(source, /'MAILCHIMP_ENABLE_FULL_CLONE_CONTINUATION_EXPANSION'/);
});

test('remote runner stops targeted semantic replays after requested focus ids verify instead of continuing into no-op loops', () => {
  assert.match(source, /const TARGETED_SEMANTIC_REPLAY_STATUS_PATH = path\.join\(ARTIFACT_ROOT, 'targeted_semantic_replay_status\.json'\);/);
  assert.match(source, /function requestedSemanticTargetFocusIds\(\) \{/);
  assert.match(source, /MAILCHIMP_SEMANTIC_WORK_DIRECTOR_TARGET_FOCUS_IDS/);
  assert.match(source, /entry\.startsWith\('focus\.'\) \? entry : `focus\.\$\{entry\}`/);
  assert.match(source, /function evaluateTargetedSemanticReplay\(\{ verifiedFocusIds = \[\], iteration = null, progressDelta = \[\], freshProgressDetected = false, selectedTierHadLiveWork = false \} = \{\}\) \{/);
  assert.match(source, /satisfied: active && missingFocusIds\.length === 0,/);
  assert.match(source, /const targetedSemanticReplayStatus = evaluateTargetedSemanticReplay\(\{/);
  assert.match(source, /writeJson\(TARGETED_SEMANTIC_REPLAY_STATUS_PATH, targetedSemanticReplayStatus\);/);
  assert.match(source, /if \(targetedSemanticReplayStatus\.satisfied\) \{/);
  assert.match(source, /terminalTargetReplayStatus = targetedSemanticReplayStatus;/);
  assert.match(source, /phase: terminalTargetReplayStatus\s+\? 'remote_execution_target_satisfied'/);
  assert.match(source, /This is not a full-clone completion claim/);
});

test('remote runner preflights targeted semantic replay satisfaction before launching a no-op delegate', () => {
  assert.match(source, /const preflightTargetFocusIds = requestedSemanticTargetFocusIds\(\);/);
  assert.match(source, /const preflightVerifiedFocusIds = verifyFocusIdsByTargetedTests\(preflightTargetFocusIds\);/);
  assert.match(source, /writeBenchmarkProgress\(\{ progressState, iteration: 0 \}\);/);
  assert.match(source, /const preflightTargetStatus = evaluateTargetedSemanticReplay\(\{/);
  assert.match(source, /writeJson\(TARGETED_SEMANTIC_REPLAY_STATUS_PATH, preflightTargetStatus\);/);
  assert.match(source, /if \(preflightTargetStatus\.satisfied\) \{/);
  assert.match(source, /phase: 'remote_execution_target_satisfied'/);
  assert.match(source, /stopped before delegate launch because the requested targeted semantic focus set was already verified by targeted tests/);
  assert.match(source, /process\.exit\(0\);/);
});
