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

test('remote runner seeds remote progress from completed focus ids passed in the launch environment', () => {
  assert.match(source, /import \{ expandEquivalentFocusIds, extractVerifiedFocusIdsFromPatchQueue, mailchimpParityFocusIds, normalizeFocusIds \} from '\.\/lib\/orchestrator-real-repo-clean-plan\.mjs';/);
  assert.match(source, /return expandEquivalentFocusIds\(Array\.isArray\(value\) \? value : \[\]\);/);
  assert.match(source, /function filterFocusIdsByTrustedSet\(values = \[\], trustedValues = \[\]\) \{/);
  assert.match(source, /const envCompletedFocusIds = normalizeCompletedFocusIds\(String\(process\.env\.MAILCHIMP_COMPLETED_FOCUS_IDS \|\| ''\)\.split\(','\)\);/);
  assert.match(source, /const seededEnvCompletedFocusIds = verifiedCompletedFocusIds\.length > 0/);
  assert.match(source, /\? filterFocusIdsByTrustedSet\(envCompletedFocusIds, verifiedCompletedFocusIds\)/);
  assert.match(source, /const seededCompletedFocusIds = normalizeCompletedFocusIds\(\[/);
  assert.match(source, /\.\.\.seededEnvCompletedFocusIds,/);
  assert.match(source, /completedFocusIds: seededCompletedFocusIds,/);
  assert.match(source, /const envCompletedFocusIds = Array\.isArray\(next\?\.envCompletedFocusIds\) \? next\.envCompletedFocusIds : \[\];/);
  assert.match(source, /const verifiedCompletedFocusIds = normalizeCompletedFocusIds\(rawVerifiedCompletedFocusIds\);/);
  assert.doesNotMatch(source, /rawVerifiedCompletedFocusIds\.length > 0 \? rawVerifiedCompletedFocusIds : rawCompletedFocusIds/);
  assert.match(source, /const completedFocusIds = normalizeCompletedFocusIds\(\[/);
  assert.match(source, /const verifiedFocusIds = Array\.from\(new Set\(\[\.\.\.\(progressState\.verifiedCompletedFocusIds \|\| \[\]\), \.\.\.mergedFocusIds\]\)\);/);
  assert.match(source, /verifiedCompletedFocusIds: verifiedFocusIds,/);
  assert.match(source, /if \(process\.env\.MAILCHIMP_USE_BENCHMARK_SCOPE\) iterationEnv\.MAILCHIMP_USE_BENCHMARK_SCOPE = process\.env\.MAILCHIMP_USE_BENCHMARK_SCOPE;/);
});

test('remote runner only credits proof when the current iteration produced live shard work', () => {
  assert.match(source, /const selectedTierHadLiveWork = hasSelectedTierLiveWork\(liveExecutionSummary\);/);
  assert.match(source, /const patchQueueFocusIds = extractMergedFocusIds\(patchQueueReport\);/);
  assert.match(source, /const targetedTestCandidateFocusIds = selectedTierHadLiveWork/);
  assert.match(source, /\? patchQueueFocusIds\.filter\(\(focusId\) => !progressState\.completedFocusIds\.includes\(focusId\)\)/);
  assert.match(source, /filter\(\(focusId\) => !progressState\.completedFocusIds\.includes\(focusId\)\)/);
  assert.match(source, /const targetedTestVerifiedFocusIds = targetedTestCandidateFocusIds\.length > 0/);
  assert.match(source, /verifyFocusIdsByTargetedTests\(targetedTestCandidateFocusIds\)/);
  assert.match(source, /function creditableFocusIdsForIteration\(/);
  assert.match(source, /if \(isNoParityReductionBlocker\(blocker\)\) \{/);
  assert.match(source, /return Array\.from\(new Set\(targetedTestVerifiedFocusIds\)\);/);
  assert.doesNotMatch(source, /summaryProvenFocusIds/);
  assert.match(source, /const mergedFocusIds = creditableFocusIdsForIteration\(\{/);
  assert.match(source, /const creditedFocusIds = Array\.from\(new Set\(\[\.\.\.progressState\.completedFocusIds, \.\.\.mergedFocusIds\]\)\);/);
  assert.match(source, /const gainedCreditedFocus = creditedFocusIds\.length > progressState\.completedFocusIds\.length;/);
  assert.match(source, /const freshProgressDetected = Boolean\(workspaceDiff\.trim\(\)\)/);
  assert.match(source, /\|\| \(selectedTierHadLiveWork && progressDelta.length > 0\);/);
  assert.doesNotMatch(source, /\|\| \(selectedTierHadLiveWork && \(progressDelta.length > 0 \|\| mergedFocusIds.length > 0\)\);/);
  assert.match(source, /completedFocusIds: creditedFocusIds/);
  assert.match(source, /noProgressStreak: \(progressDelta\.length > 0 \|\| gainedCreditedFocus\) \? 0 : progressState\.noProgressStreak/);
});

test('remote runner does not treat repeated partial blocker text as fresh progress without new credited focus', () => {
  assert.match(source, /function classifyIteration\(\{ blocker = null, progressDelta = \[\], freshProgressDetected = false, spawnError = null, workspaceError = null, retryClass = null \}\) \{/);
  assert.match(source, /if \(progressDelta.length > 0 \|\| freshProgressDetected\) return 'partial_progress';/);
  assert.match(source, /if \(text.includes\('partial parity-surface reduction'\)\) return 'no_progress';/);
  assert.match(source, /let blockerClass = classifyIteration\(\{ blocker, progressDelta, freshProgressDetected, spawnError: result\.error, workspaceError: result\.workspaceRefreshError, retryClass \}\);/);
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
