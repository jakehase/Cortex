import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { deriveCampaignContinuation, deriveObjectiveExpansion, initializeCampaign, installProcessTerminationPersistence } from '../../large-project-capability-stack/packages/campaign-runtime/index.mjs';
import { buildMailchimpParityFocusWorkGraph, extractVerifiedFocusIdsFromPatchQueue, fullCloneObjectiveInventory, mailchimpParityFocusIds, strictGapAlreadySatisfied, strictGapStructuralAlreadySatisfied, strictGapSwarmAlreadySatisfied } from './lib/orchestrator-real-repo-clean-plan.mjs';
import { ORCHESTRATION_PROGRAM_SPEC, resolveProgramEnvKeys, resolveProgramPaths, resolveProgramScriptPath } from './lib/orchestration-program-config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PROGRAM_ENV = resolveProgramEnvKeys();
const PROGRAM_PATHS = resolveProgramPaths(ROOT);
const ARTIFACT_DIR = PROGRAM_PATHS.artifactDir;
const RUNS_DIR = path.join(ARTIFACT_DIR, 'runs');
const CURRENT_RUN_PATH = PROGRAM_PATHS.currentRunPath;
const STATUS_PATH = PROGRAM_PATHS.persistentRunnerStatusPath;
const LOG_PATH = path.join(ARTIFACT_DIR, 'persistent_runner.log');
const CONTRACT_PATH = path.join(ARTIFACT_DIR, 'one_pass_run_contract.latest.json');
const PRELAUNCH_GATE_PATH = path.join(ARTIFACT_DIR, 'prelaunch_gate_evaluation.json');
const WORKER_SCRIPT = resolveProgramScriptPath(ROOT, 'worker');
const SYNC_SCRIPT = resolveProgramScriptPath(ROOT, 'sync');
const SUPERVISOR_SCRIPT = resolveProgramScriptPath(ROOT, 'supervisor');
const WATCH_SCRIPT = resolveProgramScriptPath(ROOT, 'watch');
const PROGRAM_STATE_PATH = PROGRAM_PATHS.programStatePath;
const SUMMARY_PATH = PROGRAM_PATHS.summaryPath;
const BLOCKER_PATH = PROGRAM_PATHS.blockerPath;
const SURFACE_MATRIX_PATH = path.join(ARTIFACT_DIR, 'surface_matrix.json');
const SYNC_STATUS_PATH = PROGRAM_PATHS.syncStatusPath;
const WORKER_STATUS_PATH = PROGRAM_PATHS.workerStatusPath;
const SUPERVISOR_STATUS_PATH = PROGRAM_PATHS.supervisorStatusPath;
const MAX_ITERATIONS = process.env[PROGRAM_ENV.maxIterations]
  ? Number(process.env[PROGRAM_ENV.maxIterations])
  : null;
const MAX_RUNTIME_HOURS = Math.max(1, Number(process.env[PROGRAM_ENV.maxRuntimeHours] || ORCHESTRATION_PROGRAM_SPEC.defaults.maxRuntimeHours));
const SOAK_FULL_RUNTIME = process.env[PROGRAM_ENV.soakFullRuntime] === '1';
const MAX_RUNTIME_MS = MAX_RUNTIME_HOURS * 60 * 60 * 1000;
const CAMPAIGN_RUN_ID = process.env[PROGRAM_ENV.campaignRunId] || `campaign-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${crypto.randomBytes(3).toString('hex')}`;
const STARTED_AT_MS = Date.now();
const DEADLINE_AT_MS = STARTED_AT_MS + MAX_RUNTIME_MS;
const GENERATOR_SUITE_PATH = path.join(ROOT, 'tests', 'implement-worker.regressions.test.mjs');
const GENERATOR_PREFLIGHT_PATH = path.join(ARTIFACT_DIR, 'generator_preflight.json');
const NO_PROGRESS_AUDIT_PATH = path.join(ARTIFACT_DIR, 'no_progress_audit.json');
const MAX_NO_PROGRESS_ITERATIONS = Math.max(1, Number(process.env[PROGRAM_ENV.noProgressIterationLimit] || ORCHESTRATION_PROGRAM_SPEC.defaults.noProgressIterationLimit));
const STRICT_GAP_INVENTORY_PATH = path.join(ARTIFACT_DIR, 'strict_1to1_gap_inventory.json');
const CONTINUE_UNTIL_GLOBAL_PARITY = process.env.MAILCHIMP_CONTINUE_UNTIL_GLOBAL_PARITY === '1';

function ensureDir(dirPath) { fs.mkdirSync(dirPath, { recursive: true }); }
function writeJson(filePath, payload) { ensureDir(path.dirname(filePath)); fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`); }
function readJson(filePath, fallback = null) { try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return fallback; } }
function appendLog(text) { ensureDir(path.dirname(LOG_PATH)); fs.appendFileSync(LOG_PATH, text); }
function uniqueStrings(values = []) {
  return Array.from(new Set((Array.isArray(values) ? values : [])
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)));
}
function normalizeFocusIds(values = []) {
  return Array.from(new Set((Array.isArray(values) ? values : [])
    .map((entry) => String(entry || '').trim())
    .filter((entry) => entry.startsWith('focus.'))));
}
const CANONICAL_SURFACE_NEXT_FOCUS_ALIASES = Object.freeze({
  C_data_model_and_persistence_parity: [
    'focus.account_workspace_setup',
    'focus.settings_domains',
    'focus.signup_onboarding'
  ],
  E_reporting_analytics_parity: [
    'focus.reports_overview',
    'focus.report_detail'
  ],
  F_ai_predictive_optimization_parity: [
    'focus.campaign_wizard',
    'focus.email_builder',
    'focus.send_schedule_review',
    'focus.automation_journey_builder'
  ],
  L_audience_crm_segmentation_parity: [
    'focus.audience_overview',
    'focus.contacts_table',
    'focus.contact_profile',
    'focus.segments',
    'focus.tags_groups_interests'
  ],
  O_final_parity_proof_gate: []
});
function normalizeContinuationFocusIds(values = []) {
  const raw = Array.isArray(values) ? values : [];
  return normalizeFocusIds(raw.flatMap((entry) => {
    const text = String(entry || '').trim();
    if (!text) return [];
    const aliasKey = text.startsWith('focus.') ? text.slice('focus.'.length) : text;
    if (Object.hasOwn(CANONICAL_SURFACE_NEXT_FOCUS_ALIASES, aliasKey)) return CANONICAL_SURFACE_NEXT_FOCUS_ALIASES[aliasKey];
    if (text.startsWith('focus.')) return [text];
    return [`focus.${text}`];
  }));
}
function strictGapFocusId(gap = {}) {
  return `focus.${String(gap?.id || '').trim()}`;
}
function strictGapSaturationCreditEnabled() {
  return process.env.MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION !== '1';
}
function normalizeFocusIdSet(values = []) {
  if (values && typeof values[Symbol.iterator] === 'function') return new Set(normalizeFocusIds(Array.from(values)));
  return new Set(normalizeFocusIds(values));
}
function globalParityInventoryGaps() {
  if (typeof fullCloneObjectiveInventory === 'function') return fullCloneObjectiveInventory();
  const inventory = readJson(STRICT_GAP_INVENTORY_PATH, null);
  return Array.isArray(inventory?.gaps) ? inventory.gaps : [];
}
function remainingGlobalParityFocusIds(completedFocusIdsInput = new Set(), excludedFocusIdsInput = new Set()) {
  if (!CONTINUE_UNTIL_GLOBAL_PARITY) return [];
  const gaps = globalParityInventoryGaps();
  const completed = normalizeFocusIdSet(completedFocusIdsInput);
  const excluded = normalizeFocusIdSet(excludedFocusIdsInput);
  const excludedFocusIdsRemainRepairWork = requestedFullClone(readJson(CONTRACT_PATH, null));
  return gaps
    .filter((gap) => !strictGapSaturationCreditEnabled() || !strictGapAlreadySatisfied(gap.id))
    .filter((gap) => !strictGapSwarmAlreadySatisfied(gap))
    .filter((gap) => !strictGapStructuralAlreadySatisfied(gap))
    .map((gap) => strictGapFocusId(gap))
    .filter((focusId) => focusId !== 'focus.' && !completed.has(focusId) && (excludedFocusIdsRemainRepairWork || !excluded.has(focusId)));
}
function globalParityFocusIdSet() {
  const gaps = globalParityInventoryGaps();
  return new Set(gaps.map((gap) => strictGapFocusId(gap)).filter((focusId) => focusId !== 'focus.'));
}
function fullCloneBroadObjectiveFocusIds() {
  return normalizeFocusIds(globalParityInventoryGaps()
    .filter((gap) => gap?.broadFullCloneObjective === true)
    .filter((gap) => !strictGapSwarmAlreadySatisfied(gap))
    .filter((gap) => !strictGapStructuralAlreadySatisfied(gap))
    .map((gap) => strictGapFocusId(gap)));
}
function shouldReopenFullCloneFrontier({ contract = null, matrixStatus = null, parityStatus = null, blockerKind = null, remainingGlobalFocusIds = [] } = {}) {
  if (!requestedFullClone(contract)) return false;
  if (normalizeFocusIds(remainingGlobalFocusIds).length > 0) return false;
  const matrix = String(matrixStatus || '').trim();
  const parity = String(parityStatus || '').trim().toLowerCase();
  const exhausted = blockerKind === 'zero_work_scoped_green'
    || matrix === 'scope_satisfied_zero_work'
    || matrix === 'all_complete';
  const fullCloneUnmet = !['full', 'full_clone'].includes(parity) || blockerKind === 'zero_work_scoped_green';
  return exhausted && fullCloneUnmet && fullCloneBroadObjectiveFocusIds().length > 0;
}
function reopenFullCloneFrontierFocusIds(completedFocusIdsInput = new Set()) {
  const completed = completedFocusIdsInput && typeof completedFocusIdsInput.delete === 'function' && typeof completedFocusIdsInput.has === 'function'
    ? completedFocusIdsInput
    : normalizeFocusIdSet(completedFocusIdsInput);
  const reopened = fullCloneBroadObjectiveFocusIds();
  for (const focusId of reopened) completed.delete(focusId);
  return reopened;
}
function requestedFullClone(contract = null) {
  return String(process.env.ORCHESTRATOR_REQUESTED_FIDELITY
    || contract?.fidelity
    || contract?.requestedFidelity
    || '').trim() === 'full_clone';
}
function continuousProductRunRequested(contract = null) {
  if (requestedFullClone(contract)) return true;
  const fidelity = String(process.env.ORCHESTRATOR_REQUESTED_FIDELITY
    || contract?.fidelity
    || contract?.requestedFidelity
    || '').trim();
  return ['production_slice', 'parity_for_scope'].includes(fidelity)
    && CONTINUE_UNTIL_GLOBAL_PARITY
    && SOAK_FULL_RUNTIME;
}
function requestedAgentCount() {
  return Math.max(1, Number(process.env[PROGRAM_ENV.requestedAgentCount] || process.env.ORCHESTRATOR_REQUESTED_AGENT_COUNT || 1));
}
function blockerText(blocker) {
  if (typeof blocker === 'string') return blocker;
  if (blocker && typeof blocker.blocker === 'string') return blocker.blocker;
  return '';
}
function patchEntryFocusId(entry = null) {
  return normalizeFocusIds([
    entry?.shardId,
    entry?.taskId,
    entry?.focusId,
    entry?.metadata?.contextPack?.shard?.id,
    entry?.metadata?.contextPack?.shard?.rootWorkUnitId,
    entry?.metadata?.implementation?.metadata?.surfaceFocusId
      ? `focus.${entry.metadata.implementation.metadata.surfaceFocusId}`
      : null
  ])[0] || null;
}
function patchEntryProductFiles(entry = null) {
  return uniqueStrings([
    ...(Array.isArray(entry?.filePaths) ? entry.filePaths : []),
    ...(Array.isArray(entry?.modifiedFiles) ? entry.modifiedFiles : []),
    ...(Array.isArray(entry?.paths) ? entry.paths : []),
    ...(Array.isArray(entry?.metadata?.implementation?.modifiedFiles) ? entry.metadata.implementation.modifiedFiles : [])
  ].filter((filePath) => String(filePath || '').startsWith('apps/')
    || String(filePath || '').startsWith('packages/')
    || String(filePath || '').startsWith('public/')
    || String(filePath || '').startsWith('src/')));
}
function landedProductFilesFromSyncStatus(syncStatus = null) {
  const files = Array.isArray(syncStatus?.canonicalLandingEvidence?.files)
    ? syncStatus.canonicalLandingEvidence.files
    : [];
  return new Set(files
    .filter((entry) => entry?.changedInCanonicalCheckout === true || entry?.alreadyMatchedBeforeSync === true)
    .map((entry) => String(entry.path || '').trim())
    .filter(Boolean));
}
function deriveCompletedFocusIds(iterationRecord = null, patchQueueReport = null, syncStatus = null) {
  if (syncStatus?.canonicalLandingEvidence?.ok !== true) return [];
  const parityFocusIds = CONTINUE_UNTIL_GLOBAL_PARITY ? globalParityFocusIdSet() : new Set(mailchimpParityFocusIds());
  const landedProductFiles = landedProductFilesFromSyncStatus(syncStatus);
  if (landedProductFiles.size === 0) return [];
  const credited = new Set();
  for (const entry of (Array.isArray(patchQueueReport?.merged) ? patchQueueReport.merged : [])) {
    const focusId = patchEntryFocusId(entry);
    if (!focusId || !parityFocusIds.has(focusId)) continue;
    const touchedFiles = patchEntryProductFiles(entry);
    if (touchedFiles.some((filePath) => landedProductFiles.has(filePath))) credited.add(focusId);
  }
  const mergedFocusIds = new Set(normalizeFocusIds(iterationRecord?.mergedFocusIds || []));
  return Array.from(credited).filter((focusId) => mergedFocusIds.has(focusId));
}
function deriveNextFocusFromSurfaceMatrix(surfaceMatrix = null) {
  const parityFocusIds = new Set(mailchimpParityFocusIds());
  const surfaces = Array.isArray(surfaceMatrix?.surfaces) ? surfaceMatrix.surfaces : [];
  return normalizeFocusIds(surfaces
    .filter((surface) => surface && !['all_complete', 'proven_complete', 'complete'].includes(surface.status))
    .flatMap((surface) => Array.isArray(surface.issueIds) && surface.issueIds.length > 0
      ? surface.issueIds
      : [`focus.${String(surface.id || '').trim()}`]))
    .filter((focusId) => parityFocusIds.size === 0 || parityFocusIds.has(focusId));
}

function firstNonEmptyFocusList(...candidates) {
  for (const candidate of candidates) {
    const normalized = normalizeContinuationFocusIds(candidate || []);
    if (normalized.length > 0) return normalized;
  }
  return [];
}
function delegateContinuationWaveIndex(runDir = null) {
  const workGraph = runDir ? readJson(path.join(runDir, 'delegate', 'work_graph.json'), null) : null;
  return Number(workGraph?.summary?.continuationWaveIndex
    ?? workGraph?.workGraph?.summary?.continuationWaveIndex
    ?? 0) || 0;
}
function advanceFullCloneContinuationWaveFloor(runDir = null) {
  const currentFloor = Number(process.env.MAILCHIMP_FULL_CLONE_CONTINUATION_MIN_WAVE || 0) || 0;
  const observedWave = delegateContinuationWaveIndex(runDir);
  const nextWave = Math.max(currentFloor, observedWave, 0) + 1;
  process.env.MAILCHIMP_FULL_CLONE_CONTINUATION_MIN_WAVE = String(nextWave);
  return nextWave;
}
function deriveCompletedFocusIdsFromSurfaceMatrix(surfaceMatrix = null) {
  const parityFocusIds = new Set(mailchimpParityFocusIds());
  const surfaces = Array.isArray(surfaceMatrix?.surfaces) ? surfaceMatrix.surfaces : [];
  return normalizeFocusIds(surfaces
    .filter((surface) => surface && ['all_complete', 'proven_complete', 'complete'].includes(surface.status))
    .flatMap((surface) => Array.isArray(surface.issueIds) && surface.issueIds.length > 0
      ? surface.issueIds
      : [`focus.${String(surface.id || '').trim()}`]))
    .filter((focusId) => parityFocusIds.has(focusId));
}
function deriveCompletedFocusIdsFromDelegateProgress(runDir = null, syncStatus = null) {
  if (!runDir || syncStatus?.canonicalLandingEvidence?.ok !== true) return [];
  const progress = readJson(path.join(runDir, 'delegate', 'benchmark_progress.json'), null);
  return normalizeFocusIds(Array.isArray(progress?.verifiedFocusIds) ? progress.verifiedFocusIds : []);
}
function hasControlPlaneSyncOrLandingFailure(record = null) {
  return Number(record?.syncExitCode || 0) !== 0
    || Boolean(record?.syncError)
    || record?.canonicalLandingOk === false
    || record?.canonicalLandingEvidence?.ok === false;
}
function shouldContinueFullCloneAfterProgress(record = null, contract = null) {
  if (!continuousProductRunRequested(contract)) return false;
  if (!CONTINUE_UNTIL_GLOBAL_PARITY) return false;
  if (Date.now() >= DEADLINE_AT_MS) return false;
  if (record?.green === true) return false;
  if (String(record?.parityStatus || '').trim().toLowerCase() === 'full') return false;
  if (hasControlPlaneSyncOrLandingFailure(record)) return false;
  if (!hasCanonicalLandingProgress(record)) return false;
  const text = blockerText(record?.blocker);
  const retryableParityBlocker = /partial parity-surface reduction was proven|remaining red surfaces are still open|no parity-surface reduction was proven by this iteration/i.test(text);
  const remoteWaveBoundary = Number(record?.workerExitCode || 0) === 2 || /remote_execution_iteration_cap_reached|iteration cap/i.test(String(record?.workerError || ''));
  return retryableParityBlocker || remoteWaveBoundary;
}
function deriveIterationContinuation(record) {
  const nextFocus = normalizeFocusIds(record?.nextFocus);
  const text = blockerText(record?.blocker);
  const sharedDecision = deriveCampaignContinuation({
    green: record?.green === true,
    blocker: text ? { blocker: text } : null,
    blockerKind: record?.blockerKind || null,
    nextFocus,
    syncOk: !(record?.syncExitCode !== 0 || record?.syncError),
    workerOk: !(record?.workerError),
    supervisorOk: !(record?.supervisorError)
  });
  const retryableText = /heartbeat|sync step failed|generator regression|selected live qualification tier reported green without any live shard work|rejected patch|clean-baseline qualification checks failed|execution boundary|partial parity-surface reduction was proven|remaining red surfaces are still open|no parity-surface reduction was proven by this iteration/i.test(text);
  if (hasControlPlaneSyncOrLandingFailure(record)) {
    return {
      ...sharedDecision,
      blockerSemantics: 'terminal_sync_or_landing_failure',
      decision: 'stop_blocked',
      shouldContinue: false,
      shouldStop: true
    };
  }
  if (classifyNoProgressReason(record) && hasCanonicalLandingProgress(record)) {
    return {
      ...sharedDecision,
      blockerSemantics: 'retryable',
      decision: 'continue_next_iteration',
      shouldContinue: true,
      shouldStop: false
    };
  }
  if (sharedDecision.decision === 'continue_next_iteration' && sharedDecision.blockerSemantics === 'retryable' && !retryableText) {
    return {
      ...sharedDecision,
      blockerSemantics: 'terminal',
      decision: 'stop_blocked',
      shouldContinue: false,
      shouldStop: true
    };
  }
  return sharedDecision;
}
function classifyNoProgressReason(record) {
  const text = blockerText(record?.blocker);
  if (!text || record?.blockerKind === 'strict_1to1_ceiling') return null;
  if (/no parity-surface reduction was proven by this iteration/i.test(text)) return 'no_surface_reduction';
  if (/selected live work produced no surviving product-code diff under mechanical LOC accounting/i.test(text)) return 'no_surviving_product_diff';
  if (/no-op|ungrounded patch candidate|rejected patch|rejected without resolution/i.test(text)) return 'empty_or_rejected_patch_work';
  if (/selected live qualification tier reported green without any live shard work/i.test(text)) return 'empty_live_work';
  if (/control-plane sync step failed after the remote audit iteration completed/i.test(text)) return 'post_remote_sync_failed';
  return null;
}
function canonicalLandingDelta(record = null) {
  return Number(record?.canonicalLandingEvidence?.newlyLandedProductFileCount
    ?? record?.canonicalLandedProductFileCount
    ?? 0) || 0;
}
function hasCanonicalLandingProgress(record = null) {
  return canonicalLandingDelta(record) > 0;
}
function isAutonomyOnlyThresholdGate(record = null, completedFocusIdsInput = new Set(), parityFocusIdsInput = null) {
  if (record?.blockerKind !== 'benchmark_threshold_gate') return false;
  const failures = Array.isArray(record?.blocker?.thresholdEvaluation?.failures)
    ? record.blocker.thresholdEvaluation.failures
    : [];
  const onlyAutonomyMissing = failures.length === 1
    && failures.every((failure) => failure?.thresholdField === 'minimumAutonomyMinutes' || failure?.observedField === 'autonomyMinutes');
  if (!onlyAutonomyMissing) return false;
  if (normalizeFocusIds(record?.nextFocus).length > 0) return false;
  const completedValues = completedFocusIdsInput && typeof completedFocusIdsInput[Symbol.iterator] === 'function'
    ? Array.from(completedFocusIdsInput)
    : completedFocusIdsInput;
  const completed = new Set(normalizeFocusIds(completedValues));
  const parityFocusIds = Array.isArray(parityFocusIdsInput) ? normalizeFocusIds(parityFocusIdsInput) : mailchimpParityFocusIds();
  return parityFocusIds.length > 0 && parityFocusIds.every((focusId) => completed.has(focusId));
}
function consecutiveNoProgressIterations(records = []) {
  const streak = [];
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index];
    const reason = classifyNoProgressReason(record);
    if (!reason || hasCanonicalLandingProgress(record)) break;
    streak.unshift({ ...record, noProgressReason: reason });
  }
  return streak;
}
function deriveFailedFocusIdsForRun(runDir) {
  const summary = readJson(path.join(runDir, 'delegate', 'live_execution_summary.json'), null);
  const failed = Array.isArray(summary?.metrics?.failedShards) ? summary.metrics.failedShards : [];
  return normalizeFocusIds(failed.map((entry) => entry?.shardId));
}

function failedFocusExclusionDelta(record = {}) {
  const alreadyExcluded = new Set(normalizeFocusIds(record.excludedFocusIds));
  return normalizeFocusIds(record.failedFocusIds).filter((focusId) => !alreadyExcluded.has(focusId));
}

function buildNoProgressAudit(records = []) {
  const streak = consecutiveNoProgressIterations(records);
  const repeatedNextFocus = streak.length > 0
    ? streak.every((record) => normalizeFocusIds(record.nextFocus).join(',') === normalizeFocusIds(streak[0].nextFocus).join(','))
    : false;
  const zeroMergedFocusProgress = streak.every((record) => normalizeFocusIds(record.mergedFocusIds).length === 0);
  const noCanonicalLandingDelta = streak.every((record) => !hasCanonicalLandingProgress(record));
  const freshFailedFocusExclusions = Array.from(new Set(streak.flatMap((record) => failedFocusExclusionDelta(record))));
  const noFailedFocusExclusionDelta = freshFailedFocusExclusions.length === 0;
  const onlyFailedLeafExclusionChurn = !noFailedFocusExclusionDelta && zeroMergedFocusProgress && noCanonicalLandingDelta;
  return {
    generatedAt: new Date().toISOString(),
    campaignRunId: CAMPAIGN_RUN_ID,
    maxNoProgressIterations: MAX_NO_PROGRESS_ITERATIONS,
    streakLength: streak.length,
    repeatedNextFocus,
    zeroMergedFocusProgress,
    noCanonicalLandingDelta,
    noFailedFocusExclusionDelta,
    onlyFailedLeafExclusionChurn,
    freshFailedFocusExclusions,
    terminal: streak.length >= MAX_NO_PROGRESS_ITERATIONS && noCanonicalLandingDelta && zeroMergedFocusProgress && (repeatedNextFocus || onlyFailedLeafExclusionChurn || noFailedFocusExclusionDelta),
    recentIterations: streak.map((record) => ({
      iteration: record.iteration,
      runId: record.runId,
      blockerKind: record.blockerKind || null,
      blocker: blockerText(record.blocker),
      noProgressReason: record.noProgressReason,
      canonicalLandingOk: record.canonicalLandingOk === true,
      canonicalLandedProductFileCount: canonicalLandingDelta(record),
      freshFailedFocusExclusions: failedFocusExclusionDelta(record),
      nextFocus: normalizeFocusIds(record.nextFocus)
    }))
  };
}
function latestGreenIterationRecord(records = []) {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index];
    if (record?.green === true) return record;
  }
  return null;
}
function readJsonForRun(file, runId, fallback = null) {
  const data = readJson(file, fallback);
  if (!data || typeof data !== 'object') return fallback;
  if (data.runId && data.runId !== runId) return fallback;
  return data;
}
function runIdFor(iteration) { return `${CAMPAIGN_RUN_ID}-iter-${String(iteration).padStart(3, '0')}`; }

function productBaselineDirtyAudit() {
  const pathspecs = ['apps', 'packages', 'public', 'src'];
  const status = spawnSync('git', ['-C', ROOT, 'status', '--porcelain', '-uall', '--', ...pathspecs], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 20
  });
  const diff = spawnSync('git', ['-C', ROOT, 'diff', '--no-ext-diff', '--unified=0', 'HEAD', '--', ...pathspecs], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 80
  });
  const entries = String(status.stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => ({ status: line.slice(0, 2).trim(), path: line.slice(3).trim() }))
    .filter((entry) => entry.path && !entry.path.startsWith('packages/app/full-clone-'));
  const markerCounts = {
    full_clone_remediation_leaf_evaluated: 0,
    'compact primary-product adoption marker': 0,
    'remaining-work remediation product slice for strict Mailchimp clone blockers': 0,
    '"fidelity": "full_clone"': 0,
    '"requirements": [': 0,
    '"remediationContracts": [': 0
  };
  const normalizedCounts = new Map();
  let addedNonblankLines = 0;
  for (const rawLine of String(diff.stdout || '').split(/\r?\n/)) {
    if (!rawLine.startsWith('+') || rawLine.startsWith('+++')) continue;
    const line = rawLine.slice(1).trim();
    if (!line) continue;
    addedNonblankLines += 1;
    for (const marker of Object.keys(markerCounts)) {
      if (line.includes(marker)) markerCounts[marker] += 1;
    }
    const normalized = line
      .replace(/['"`][^'"`]{12,}['"`]/g, '"<str>"')
      .replace(/\b\d{2,}\b/g, '<num>')
      .replace(/\s+/g, ' ')
      .trim();
    normalizedCounts.set(normalized, (normalizedCounts.get(normalized) || 0) + 1);
  }
  const uniqueNormalizedAddedLines = normalizedCounts.size;
  const duplicateAddedLineRatio = addedNonblankLines > 0
    ? Number(((addedNonblankLines - uniqueNormalizedAddedLines) / addedNonblankLines).toFixed(4))
    : 0;
  const markerLineCount = Object.values(markerCounts).reduce((sum, value) => sum + Number(value || 0), 0);
  const semanticBloatReasons = [];
  if (addedNonblankLines >= 500 && duplicateAddedLineRatio >= 0.55) semanticBloatReasons.push('high_duplicate_normalized_added_line_ratio');
  if (Number(markerCounts.full_clone_remediation_leaf_evaluated || 0) >= 20) semanticBloatReasons.push('repeated_remediation_marker_blocks');
  if (Number(markerCounts['"fidelity": "full_clone"'] || 0) >= 20 || Number(markerCounts['"remediationContracts": ['] || 0) >= 20) semanticBloatReasons.push('remediation_blueprint_boilerplate_concentration');
  if (markerLineCount >= 100 && markerLineCount / Math.max(1, addedNonblankLines) >= 0.03) semanticBloatReasons.push('marker_heavy_product_delta');
  const semanticBloatSuspect = semanticBloatReasons.length > 0;
  const allowDirtyProductBaseline = process.env.MAILCHIMP_ALLOW_DIRTY_PRODUCT_BASELINE === '1';
  return {
    ok: status.status === 0 && diff.status === 0 && (allowDirtyProductBaseline || entries.length === 0) && !semanticBloatSuspect,
    allowDirtyProductBaseline,
    dirtyProductFileCount: entries.length,
    dirtyProductFiles: entries.slice(0, 200),
    addedNonblankLinesApprox: addedNonblankLines,
    addedUniqueNormalizedLinesApprox: uniqueNormalizedAddedLines,
    duplicateAddedLineRatio,
    semanticBloatSuspect,
    semanticBloatReasons,
    markerCounts,
    statusExitCode: status.status,
    diffExitCode: diff.status
  };
}

function runTerminalWatch() {
  const watch = spawnSync(process.execPath, [WATCH_SCRIPT], {
    cwd: ROOT,
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 1024 * 1024 * 20
  });
  appendLog(`===== terminal watch =====\n${watch.stdout || ''}${watch.stderr || ''}${watch.error ? `\n[spawn-error] ${String(watch.error.message || watch.error)}` : ''}`);
  return {
    exitCode: watch.status,
    signal: watch.signal,
    spawnError: watch.error ? String(watch.error.message || watch.error) : null
  };
}

function evaluateBenchmarkPrelaunchGate() {
  const contract = readJson(CONTRACT_PATH, null);
  const contractPrelaunchGates = contract?.prelaunchGates && typeof contract.prelaunchGates === 'object'
    ? contract.prelaunchGates
    : null;
  const agentCount = requestedAgentCount();
  const swarmGateRequired = requestedFullClone(contract) && agentCount >= 80;
  const prelaunchGates = {
    ...(contractPrelaunchGates || {}),
    ...(swarmGateRequired ? {
      minimumExecutableProductShards: Math.max(Number(contractPrelaunchGates?.minimumExecutableProductShards || 0), Math.floor(agentCount * 0.8)),
      minimumFocusLanes: Math.max(Number(contractPrelaunchGates?.minimumFocusLanes || 0), 8),
      requireRealFileContracts: true,
      requireSwarmMode: true,
      forbidStrictGapSequence: true,
      requireRolePlan: true,
      requireStrictHierarchicalPlan: true
    } : {})
  };

  const plan = buildMailchimpParityFocusWorkGraph();
  const workUnits = Array.isArray(plan?.workGraph?.workUnits) ? plan.workGraph.workUnits : [];
  const planSummary = plan?.workGraph?.summary || {};
  const surfaceMatrixStatus = String(plan?.surfaceMatrix?.status || '').trim();
  const scopeAlreadySatisfied = workUnits.length === 0 && surfaceMatrixStatus === 'all_complete';
  const selectedFocusLanes = uniqueStrings(workUnits.map((unit) => unit?.lane));
  const allSwarmFocusLanes = uniqueStrings(planSummary.allSwarmFocusLanes || []);
  const allExecutableFocusLanes = uniqueStrings(planSummary.allExecutableFocusLanes || planSummary.allSwarmFocusLanes || []);
  const allExecutableLeafCount = Number(planSummary.allExecutableLeafCount ?? planSummary.allSwarmLeafCount ?? 0);
  const allSaturatedExecutableLeafCount = Number(planSummary.allSaturatedExecutableLeafCount ?? planSummary.allSaturatedSwarmLeafCount ?? 0);
  const dirtyProductBaseline = productBaselineDirtyAudit();
  const observed = {
    executableProductShards: Math.max(workUnits.length, allExecutableLeafCount),
    runnableProductShards: workUnits.length,
    saturatedSwarmLeafCount: Number(planSummary.allSaturatedSwarmLeafCount || 0),
    saturatedExecutableLeafCount: allSaturatedExecutableLeafCount,
    distinctFocusLanes: Math.max(selectedFocusLanes.length, allExecutableFocusLanes.length),
    realFileContractsOk: workUnits.every((unit) => Array.isArray(unit?.allowedFiles)
      && unit.allowedFiles.length > 0
      && unit?.metadata?.assignmentContract?.artifactKind === 'product_diff'),
    selectedFocusIds: uniqueStrings(workUnits.map((unit) => unit?.id)),
    selectedFocusLanes,
    allSwarmFocusLanes,
    allExecutableFocusLanes,
    surfaceMatrixStatus,
    scopeAlreadySatisfied,
    scopedSurfaceCount: Array.isArray(plan?.surfaceMatrix?.surfaces) ? plan.surfaceMatrix.surfaces.length : 0,
    strictGapSequenceMode: Boolean(plan?.workGraph?.summary?.strictGapSequenceMode),
    swarmMode: plan?.workGraph?.summary?.swarmMode === true,
    structuralMode: plan?.workGraph?.summary?.structuralMode === true,
    frontierMode: plan?.workGraph?.summary?.frontierMode === true,
    remediationMode: plan?.workGraph?.summary?.remediationMode === true,
    continuationMode: plan?.workGraph?.summary?.continuationMode === true,
    continuationWaveIndex: plan?.workGraph?.summary?.continuationWaveIndex || null,
    allFrontierFocusLanes: uniqueStrings(planSummary.allFrontierFocusLanes || []),
    allFrontierLeafCount: Number(planSummary.allFrontierLeafCount || 0),
    saturatedFrontierLeafCount: Number(planSummary.allSaturatedFrontierLeafCount || 0),
    allRemediationFocusLanes: uniqueStrings(planSummary.allRemediationFocusLanes || []),
    allRemediationLeafCount: Number(planSummary.allRemediationLeafCount || 0),
    saturatedRemediationLeafCount: Number(planSummary.allSaturatedRemediationLeafCount || 0),
    allContinuationFocusLanes: uniqueStrings(planSummary.allContinuationFocusLanes || []),
    allContinuationLeafCount: Number(planSummary.allContinuationLeafCount || 0),
    saturatedContinuationLeafCount: Number(planSummary.allSaturatedContinuationLeafCount || 0),
    requestedAgentCount: agentCount,
    rolePlan: plan?.workGraph?.summary?.rolePlan || null,
    strictHierarchicalPlan: plan?.workGraph?.summary?.strictHierarchicalPlan || null,
    strictHierarchicalPlanCoverage: Number(plan?.workGraph?.summary?.strictHierarchicalPlan?.workUnitCoverage || 0),
    strictGapCount: Number(plan?.workGraph?.summary?.strictGapCount || 0),
    dirtyProductBaseline,
    generatedAt: new Date().toISOString()
  };
  const failures = [];

  const minShards = Number(prelaunchGates.minimumExecutableProductShards);
  if (!scopeAlreadySatisfied && Number.isFinite(minShards) && observed.executableProductShards < minShards) {
    failures.push({ field: 'minimumExecutableProductShards', comparator: '>=', required: minShards, observed: observed.executableProductShards });
  }
  const minLanes = Number(prelaunchGates.minimumFocusLanes);
  if (!scopeAlreadySatisfied && Number.isFinite(minLanes) && observed.distinctFocusLanes < minLanes) {
    failures.push({ field: 'minimumFocusLanes', comparator: '>=', required: minLanes, observed: observed.distinctFocusLanes });
  }
  if (!scopeAlreadySatisfied && prelaunchGates.requireRealFileContracts === true && !observed.realFileContractsOk) {
    failures.push({ field: 'requireRealFileContracts', comparator: '===', required: true, observed: observed.realFileContractsOk });
  }
  if (!scopeAlreadySatisfied && prelaunchGates.requireSwarmMode === true && observed.swarmMode !== true) {
    failures.push({ field: 'requireSwarmMode', comparator: '===', required: true, observed: observed.swarmMode });
  }
  if (!scopeAlreadySatisfied && prelaunchGates.forbidStrictGapSequence === true && observed.strictGapSequenceMode === true) {
    failures.push({ field: 'forbidStrictGapSequence', comparator: '===', required: false, observed: observed.strictGapSequenceMode });
  }
  if (!scopeAlreadySatisfied && prelaunchGates.requireRolePlan === true && !observed.rolePlan) {
    failures.push({ field: 'requireRolePlan', comparator: 'present', required: true, observed: false });
  }
  if (!scopeAlreadySatisfied && prelaunchGates.requireStrictHierarchicalPlan === true && (!observed.strictHierarchicalPlan || observed.strictHierarchicalPlanCoverage < 1)) {
    failures.push({ field: 'requireStrictHierarchicalPlan', comparator: 'coverage===1', required: true, observed: observed.strictHierarchicalPlanCoverage });
  }
  if (swarmGateRequired && !dirtyProductBaseline.ok) {
    failures.push({
      field: 'requireCleanProductBaseline',
      comparator: 'dirtyProductFileCount===0 && semanticBloatSuspect===false',
      required: true,
      observed: {
        dirtyProductFileCount: dirtyProductBaseline.dirtyProductFileCount,
        semanticBloatSuspect: dirtyProductBaseline.semanticBloatSuspect,
        duplicateAddedLineRatio: dirtyProductBaseline.duplicateAddedLineRatio
      }
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    evaluated: true,
    pass: failures.length === 0,
    contractPath: fs.existsSync(CONTRACT_PATH) ? path.relative(ROOT, CONTRACT_PATH) : null,
    benchmarkId: contract?.benchmarkId || null,
    prelaunchGates,
    swarmGateRequired,
    observed,
    failures
  };
}

ensureDir(ARTIFACT_DIR);
ensureDir(RUNS_DIR);
fs.rmSync(LOG_PATH, { force: true });
const generatorPreflightEnv = { ...process.env };
delete generatorPreflightEnv.ORCHESTRATOR_REQUESTED_FIDELITY;
delete generatorPreflightEnv.MAILCHIMP_USE_STRICT_GAP_INVENTORY;
delete generatorPreflightEnv.MAILCHIMP_STRICT_GAP_SEQUENCE;
delete generatorPreflightEnv.MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION;
const generatorPreflight = spawnSync(process.execPath, ['--test', '--test-concurrency=1', GENERATOR_SUITE_PATH], {
  cwd: ROOT,
  encoding: 'utf8',
  maxBuffer: 1024 * 1024 * 80,
  env: generatorPreflightEnv
});
appendLog(`===== generator preflight =====\n${generatorPreflight.stdout || ''}${generatorPreflight.stderr || ''}${generatorPreflight.error ? `\n[spawn-error] ${String(generatorPreflight.error.message || generatorPreflight.error)}` : ''}`);
writeJson(GENERATOR_PREFLIGHT_PATH, {
  generatedAt: new Date().toISOString(),
  ok: generatorPreflight.status === 0 && !generatorPreflight.error,
  exitCode: generatorPreflight.status,
  signal: generatorPreflight.signal,
  spawnError: generatorPreflight.error ? String(generatorPreflight.error.message || generatorPreflight.error) : null,
  stdoutTail: String(generatorPreflight.stdout || '').slice(-12000) || null,
  stderrTail: String(generatorPreflight.stderr || '').slice(-12000) || null,
  suite: path.relative(ROOT, GENERATOR_SUITE_PATH)
});
if (generatorPreflight.status !== 0 || generatorPreflight.error) {
  writeJson(STATUS_PATH, {
    generatedAt: new Date().toISOString(),
    running: false,
    campaignRunId: CAMPAIGN_RUN_ID,
    maxIterations: MAX_ITERATIONS,
    maxRuntimeHours: MAX_RUNTIME_HOURS,
    deadlineAt: new Date(DEADLINE_AT_MS).toISOString(),
    iterations: [],
    status: 'blocked',
    blocker: {
      blocker: 'Generator regression preflight failed before parity launch.',
      nextAction: 'Fix the implementation worker regression suite before relaunching the Mailchimp parity campaign.',
      suite: path.relative(ROOT, GENERATOR_SUITE_PATH),
      preflightPath: path.relative(ROOT, GENERATOR_PREFLIGHT_PATH)
    }
  });
  runTerminalWatch();
  process.exit(generatorPreflight.status || 1);
}
const prelaunchGate = evaluateBenchmarkPrelaunchGate();
writeJson(PRELAUNCH_GATE_PATH, prelaunchGate);
if (!prelaunchGate.pass) {
  const blocker = {
    blocker: 'Benchmark prelaunch gate failed, so this Mailchimp production-creation run should not launch.',
    nextAction: prelaunchGate.failures.map((failure) => `${failure.field}: observed ${failure.observed}, required ${failure.comparator} ${failure.required}`),
    prelaunchGate
  };
  writeJson(BLOCKER_PATH, blocker);
  writeJson(SUMMARY_PATH, {
    generatedAt: new Date().toISOString(),
    runId: null,
    fidelity: readJson(CONTRACT_PATH, null)?.fidelity || null,
    targetPath: ROOT,
    stopCondition: 'supervisor_green_or_blocker_report',
    matrixStatus: 'blocked',
    supervisorStatus: 'red',
    parityStatus: 'blocked',
    nextFocus: prelaunchGate.observed?.selectedFocusIds || [],
    blocker,
    blockerKind: 'benchmark_prelaunch_gate',
    note: 'Prelaunch gate failed before the worker started.',
    headline: 'Benchmark prelaunch gate blocked launch.',
    prelaunchGatePath: path.relative(ROOT, PRELAUNCH_GATE_PATH)
  });
  writeJson(STATUS_PATH, {
    generatedAt: new Date().toISOString(),
    running: false,
    campaignRunId: CAMPAIGN_RUN_ID,
    maxIterations: MAX_ITERATIONS,
    maxRuntimeHours: MAX_RUNTIME_HOURS,
    deadlineAt: new Date(DEADLINE_AT_MS).toISOString(),
    iterations: [],
    status: 'blocked_prelaunch',
    blocker,
    prelaunchGatePath: path.relative(ROOT, PRELAUNCH_GATE_PATH)
  });
  runTerminalWatch();
  process.exit(1);
}
if (prelaunchGate.observed?.scopeAlreadySatisfied === true) {
  const contract = readJson(CONTRACT_PATH, null);
  const legacyEnvCompletedFocusIds = normalizeFocusIds(String(process.env[PROGRAM_ENV.completedFocusIds] || '').split(','));
  const seededVerifiedCompletedFocusIds = normalizeFocusIds(String(process.env[PROGRAM_ENV.verifiedCompletedFocusIds] || '').split(','));
  const seededCompletedFocusIds = new Set(seededVerifiedCompletedFocusIds);
  const discardedLegacyCompletedFocusIds = legacyEnvCompletedFocusIds.filter((focusId) => !seededCompletedFocusIds.has(focusId));
  const remainingFullCloneFocusIds = requestedFullClone(contract)
    ? remainingGlobalParityFocusIds(seededCompletedFocusIds, new Set())
    : [];
  const objectiveExpansion = deriveObjectiveExpansion({
    requestedFidelity: contract?.fidelity || contract?.requestedFidelity || process.env.ORCHESTRATOR_REQUESTED_FIDELITY || null,
    matrixStatus: prelaunchGate.observed?.surfaceMatrixStatus || 'all_complete',
    parityStatus: 'not_full_clone',
    currentWorkCount: prelaunchGate.observed?.executableProductShards ?? 0,
    scopeAlreadySatisfied: true,
    remainingObjectiveIds: remainingFullCloneFocusIds
  });
  if (objectiveExpansion.shouldExpand) {
    writeJson(STATUS_PATH, {
      generatedAt: new Date().toISOString(),
      running: true,
      campaignRunId: CAMPAIGN_RUN_ID,
      maxIterations: MAX_ITERATIONS,
      maxRuntimeHours: MAX_RUNTIME_HOURS,
      deadlineAt: new Date(DEADLINE_AT_MS).toISOString(),
      iterations: [],
      completedFocusIds: Array.from(seededCompletedFocusIds),
      verifiedCompletedFocusIds: Array.from(seededCompletedFocusIds),
      discardedLegacyCompletedFocusIds,
      excludedFocusIds: [],
      status: 'expanding_objective_graph',
      remainingGlobalFocusIds: remainingFullCloneFocusIds,
      objectiveExpansion,
      prelaunchGatePath: path.relative(ROOT, PRELAUNCH_GATE_PATH),
      note: 'Current scoped graph is satisfied, but the requested full-clone objective is not; orchestration will expand to the remaining objective surfaces instead of stopping.'
    });
  } else if (shouldReopenFullCloneFrontier({
    contract,
    matrixStatus: prelaunchGate.observed?.surfaceMatrixStatus || 'all_complete',
    parityStatus: 'not_full_clone',
    blockerKind: null,
    remainingGlobalFocusIds: remainingFullCloneFocusIds
  })) {
    const reopenedFocusIds = reopenFullCloneFrontierFocusIds(seededCompletedFocusIds);
    process.env[PROGRAM_ENV.completedFocusIds] = Array.from(seededCompletedFocusIds).join(',');
    process.env[PROGRAM_ENV.verifiedCompletedFocusIds] = Array.from(seededCompletedFocusIds).join(',');
    writeJson(STATUS_PATH, {
      generatedAt: new Date().toISOString(),
      running: true,
      campaignRunId: CAMPAIGN_RUN_ID,
      maxIterations: MAX_ITERATIONS,
      maxRuntimeHours: MAX_RUNTIME_HOURS,
      deadlineAt: new Date(DEADLINE_AT_MS).toISOString(),
      iterations: [],
      completedFocusIds: Array.from(seededCompletedFocusIds),
      verifiedCompletedFocusIds: Array.from(seededCompletedFocusIds),
      discardedLegacyCompletedFocusIds,
      excludedFocusIds: [],
      status: 'expanding_objective_graph',
      remainingGlobalFocusIds: reopenedFocusIds,
      objectiveExpansion: {
        shouldExpand: true,
        reason: 'full_clone_frontier_reopened_after_finite_matrix_exhaustion',
        requestedFidelity: 'full_clone',
        matrixStatus: prelaunchGate.observed?.surfaceMatrixStatus || 'all_complete',
        parityStatus: 'not_full_clone',
        remainingObjectiveIds: reopenedFocusIds
      },
      prelaunchGatePath: path.relative(ROOT, PRELAUNCH_GATE_PATH),
      note: 'Finite scoped matrix is satisfied, but full-clone truth is still red; reopening broad full-clone frontier surfaces for more real product work instead of exiting scope-already-satisfied.'
    });
  } else if (requestedFullClone(contract)) {
    const strictCeilingBlocker = {
      blocker: 'Finite Mailchimp swarm graph is saturated, but strict 1:1 full-clone parity is still not proven.',
      nextAction: 'Do not relaunch zero-work swarm iterations. Build a new structural full-clone work program for the remaining strict-ceiling gaps, or explicitly accept this as a blocked full-clone claim rather than scoped parity completion.',
      blockerKind: 'strict_1to1_ceiling',
      prelaunchGatePath: path.relative(ROOT, PRELAUNCH_GATE_PATH),
      observed: prelaunchGate.observed
    };
    writeJson(BLOCKER_PATH, strictCeilingBlocker);
    const summary = {
      generatedAt: new Date().toISOString(),
      runId: null,
      fidelity: contract?.fidelity || contract?.requestedFidelity || 'full_clone',
      targetPath: ROOT,
      stopCondition: 'supervisor_green_or_blocker_report',
      matrixStatus: 'scope_satisfied_zero_work',
      supervisorStatus: 'red',
      parityStatus: 'not_full_clone',
      nextFocus: [],
      blocker: strictCeilingBlocker,
      blockerKind: 'strict_1to1_ceiling',
      note: 'All finite swarm leaf modules are already saturated; stopping with a claim blocker instead of reporting scoped parity green or spinning no-op workers.',
      headline: 'Finite swarm saturated; full-clone strict 1:1 ceiling still red.',
      prelaunchGatePath: path.relative(ROOT, PRELAUNCH_GATE_PATH)
    };
    writeJson(SUMMARY_PATH, summary);
    writeJson(STATUS_PATH, {
      generatedAt: new Date().toISOString(),
      running: false,
      campaignRunId: CAMPAIGN_RUN_ID,
      maxIterations: MAX_ITERATIONS,
      maxRuntimeHours: MAX_RUNTIME_HOURS,
      deadlineAt: new Date(DEADLINE_AT_MS).toISOString(),
      iterations: [],
      completedFocusIds: Array.from(seededCompletedFocusIds),
      verifiedCompletedFocusIds: Array.from(seededCompletedFocusIds),
      discardedLegacyCompletedFocusIds,
      excludedFocusIds: [],
      status: 'claim_blocked',
      blocker: strictCeilingBlocker,
      blockerKind: 'strict_1to1_ceiling',
      summary,
      prelaunchGatePath: path.relative(ROOT, PRELAUNCH_GATE_PATH)
    });
    runTerminalWatch();
    process.exit(1);
  } else {
  fs.rmSync(BLOCKER_PATH, { force: true });
  const summary = {
    generatedAt: new Date().toISOString(),
    runId: null,
    fidelity: contract?.fidelity || contract?.requestedFidelity || null,
    targetPath: ROOT,
    stopCondition: 'supervisor_green_or_blocker_report',
    matrixStatus: 'all_complete',
    supervisorStatus: 'green',
    parityStatus: 'parity_for_scope',
    nextFocus: [],
    blocker: null,
    blockerKind: null,
    note: 'Benchmark scope was already satisfied by real product surfaces, so no worker shards were launched.',
    headline: 'Benchmark scope already satisfied; no no-op worker launch needed.',
    prelaunchGatePath: path.relative(ROOT, PRELAUNCH_GATE_PATH)
  };
  writeJson(SUMMARY_PATH, summary);
  writeJson(PROGRAM_STATE_PATH, {
    version: 2,
    createdAt: new Date().toISOString(),
    mode: 'persistent',
    stopCondition: 'supervisor_green_or_blocker_report',
    contractPath: path.relative(ROOT, CONTRACT_PATH),
    graphPath: null,
    matrixPath: path.relative(ROOT, SURFACE_MATRIX_PATH),
    ledgerPath: null,
    worker: {
      steps: [],
      lastHeartbeatAt: null,
      activeIteration: null,
      iterations: [],
      nextIterationId: 1,
      queuedIterations: [],
      shouldRequeue: false,
      requeueCount: 0,
      lastRequeueReason: 'scope_already_satisfied'
    },
    supervisor: {
      status: 'green',
      blocker: null,
      blockerKind: null,
      matrixStatus: 'all_complete',
      parityStatus: 'parity_for_scope',
      updatedAt: summary.generatedAt,
      note: summary.note,
      headline: summary.headline
    },
    notifier: { delivered: false, deliveredAt: null, note: 'scope already satisfied' },
    stopAllowed: true,
    done: true,
    stopReason: 'scope_already_satisfied'
  });
  writeJson(PROGRAM_PATHS.notifyPath, {
    delivered: true,
    deliveredAt: new Date().toISOString(),
    awaitingNotifier: false,
    kind: 'scope_already_satisfied',
    runId: null,
    updatedAt: new Date().toISOString(),
    blocker: null,
    blockerKind: null,
    summary
  });
  writeJson(STATUS_PATH, {
    generatedAt: new Date().toISOString(),
    running: false,
    campaignRunId: CAMPAIGN_RUN_ID,
    maxIterations: MAX_ITERATIONS,
    maxRuntimeHours: MAX_RUNTIME_HOURS,
    deadlineAt: new Date(DEADLINE_AT_MS).toISOString(),
    iterations: [],
    completedFocusIds: Array.from(seededCompletedFocusIds),
    verifiedCompletedFocusIds: Array.from(seededCompletedFocusIds),
    discardedLegacyCompletedFocusIds,
    excludedFocusIds: [],
    status: 'scope_already_satisfied',
    summary,
    prelaunchGatePath: path.relative(ROOT, PRELAUNCH_GATE_PATH)
  });
  runTerminalWatch();
  process.exit(0);
  }
}
const iterations = [];
let overallStatus = 'running';
const legacyEnvCompletedFocusIds = normalizeFocusIds(String(process.env[PROGRAM_ENV.completedFocusIds] || '').split(','));
const completedFocusIds = new Set(normalizeFocusIds(String(process.env[PROGRAM_ENV.verifiedCompletedFocusIds] || '').split(',')));
const discardedLegacyCompletedFocusIds = legacyEnvCompletedFocusIds.filter((focusId) => !completedFocusIds.has(focusId));
const excludedFocusIds = new Set(normalizeFocusIds(String(process.env.MAILCHIMP_EXCLUDED_FOCUS_IDS || '').split(',')));
let directedNextFocusIds = normalizeContinuationFocusIds(String(process.env.MAILCHIMP_SEMANTIC_WORK_DIRECTOR_TARGET_FOCUS_IDS || '').split(','));

installProcessTerminationPersistence({
  persist: ({ type = 'signal', signal = null, error = null } = {}) => {
    writeJson(STATUS_PATH, {
      generatedAt: new Date().toISOString(),
      running: false,
      campaignRunId: CAMPAIGN_RUN_ID,
      maxIterations: MAX_ITERATIONS,
      maxRuntimeHours: MAX_RUNTIME_HOURS,
      deadlineAt: new Date(DEADLINE_AT_MS).toISOString(),
      iterations,
      completedFocusIds: Array.from(completedFocusIds),
      verifiedCompletedFocusIds: Array.from(completedFocusIds),
      discardedLegacyCompletedFocusIds,
      excludedFocusIds: Array.from(excludedFocusIds),
      status: 'terminated',
      note: 'Full-audit Mailchimp parity campaign terminated before writing a clean final status.',
      termination: {
        type,
        signal,
        error
      }
    });
  }
});

function seedIterationTruth({ runId, iteration, runDir }) {
  writeJson(CURRENT_RUN_PATH, {
    campaignRunId: CAMPAIGN_RUN_ID,
    runId,
    iteration,
    runDir: path.relative(ROOT, runDir),
    artifactRoot: path.relative(ROOT, runDir),
    reportsDir: path.relative(ROOT, path.join(runDir, 'reports')),
    generatedAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    campaignStartedAt: new Date(STARTED_AT_MS).toISOString(),
    campaignDeadlineAt: new Date(DEADLINE_AT_MS).toISOString(),
    maxRuntimeHours: MAX_RUNTIME_HOURS,
    soakFullRuntime: SOAK_FULL_RUNTIME,
    remoteArtifactRoot: null,
    remoteWorktree: null,
    remoteBaselineRepo: null
  });
  writeJson(SUPERVISOR_STATUS_PATH, {
    generatedAt: new Date().toISOString(),
    runId,
    supervisorStatus: 'running',
    matrixStatus: 'partial',
    parityStatus: null,
    summary: 'Supervisor pending current iteration completion.'
  });
  writeJson(BLOCKER_PATH, {
    generatedAt: new Date().toISOString(),
    runId,
    blocker: null,
    nextAction: null,
    phase: 'worker',
    status: 'pending'
  });
  writeJson(SUMMARY_PATH, {
    generatedAt: new Date().toISOString(),
    runId,
    supervisorStatus: 'running',
    matrixStatus: 'partial',
    parityStatus: null,
    blocker: null,
    nextFocus: [],
    summary: 'Current iteration in progress.'
  });
  writeJson(SYNC_STATUS_PATH, {
    generatedAt: new Date().toISOString(),
    runId,
    ok: null,
    phase: 'pending',
    summary: 'Sync pending current iteration completion.'
  });
  initializeCampaign(PROGRAM_STATE_PATH, {
    mode: 'persistent',
    stopCondition: 'supervisor_green_or_blocker_report',
    matrixPath: SURFACE_MATRIX_PATH
  });
  const seededProgramState = readJson(PROGRAM_STATE_PATH, {});
  seededProgramState.generatedAt = new Date().toISOString();
  seededProgramState.runId = runId;
  seededProgramState.summary = 'Program state pending current iteration completion.';
  seededProgramState.nextFocus = [];
  seededProgramState.supervisor = {
    ...seededProgramState.supervisor,
    status: 'running',
    matrixStatus: 'partial',
    blocker: null,
    blockerKind: null,
    parityStatus: null,
    continuationDecision: 'continue_next_iteration',
    continuation: {
      green: false,
      hasBlocker: false,
      blockerKind: null,
      blockerSemantics: 'none',
      nextFocus: [],
      decision: 'continue_next_iteration',
      shouldContinue: true,
      shouldStop: false
    }
  };
  seededProgramState.stopAllowed = false;
  seededProgramState.done = false;
  seededProgramState.stopReason = 'continue';
  writeJson(PROGRAM_STATE_PATH, seededProgramState);
  const workerStatus = readJson(WORKER_STATUS_PATH, null);
  if (!workerStatus || workerStatus.runId !== runId) {
    writeJson(WORKER_STATUS_PATH, {
      generatedAt: new Date().toISOString(),
      runId,
      running: true,
      phase: 'launching',
      ok: null,
      summary: 'Worker launching for current iteration.'
    });
  }
}

for (let iteration = 1; ; iteration += 1) {
  if (MAX_ITERATIONS !== null && iteration > MAX_ITERATIONS) break;
  if (Date.now() >= DEADLINE_AT_MS) break;
  const runId = runIdFor(iteration);
  const runDir = path.join(RUNS_DIR, runId);
  ensureDir(runDir);
  seedIterationTruth({ runId, iteration, runDir });
  writeJson(path.join(runDir, 'run_manifest.json'), {
    campaignRunId: CAMPAIGN_RUN_ID,
    runId,
    iteration,
    maxIterations: MAX_ITERATIONS,
    maxRuntimeHours: MAX_RUNTIME_HOURS,
    deadlineAt: new Date(DEADLINE_AT_MS).toISOString(),
    generatedAt: new Date().toISOString(),
    note: 'Current full-audit implementation run scoped by run id.'
  });
  const latestGreenIteration = latestGreenIterationRecord(iterations);
  if (SOAK_FULL_RUNTIME && latestGreenIteration && Date.now() < DEADLINE_AT_MS) {
    overallStatus = 'soaking_after_green';
  }
  const postGreenSoakActive = overallStatus === 'soaking_after_green' && Boolean(latestGreenIteration);
  writeJson(STATUS_PATH, {
    generatedAt: new Date().toISOString(),
    running: true,
    campaignRunId: CAMPAIGN_RUN_ID,
    runId,
    phase: 'worker',
    iteration,
    maxIterations: MAX_ITERATIONS,
    maxRuntimeHours: MAX_RUNTIME_HOURS,
    deadlineAt: new Date(DEADLINE_AT_MS).toISOString(),
    iterations,
    completedFocusIds: Array.from(completedFocusIds),
    verifiedCompletedFocusIds: Array.from(completedFocusIds),
    discardedLegacyCompletedFocusIds,
    excludedFocusIds: Array.from(excludedFocusIds),
    status: overallStatus,
    latestGreenIteration: latestGreenIteration
      ? { iteration: latestGreenIteration.iteration, runId: latestGreenIteration.runId }
      : null,
    soakState: postGreenSoakActive
      ? {
          active: true,
          reachedAtIteration: latestGreenIteration.iteration,
          reachedAtRunId: latestGreenIteration.runId,
          reason: 'full_runtime_soak_after_green',
          deadlineAt: new Date(DEADLINE_AT_MS).toISOString()
        }
      : { active: false },
    note: postGreenSoakActive
      ? 'Continuing full-runtime soak after a supervisor-green checkpoint because soak mode is enabled.'
      : 'Driving repeated full-audit Mailchimp parity iterations until supervisor green or blocker.'
  });

  const sharedEnv = {
    ...process.env,
    [PROGRAM_ENV.campaignRunId]: CAMPAIGN_RUN_ID,
    [PROGRAM_ENV.runId]: runId,
    [PROGRAM_ENV.completedFocusIds]: Array.from(completedFocusIds).join(','),
    [PROGRAM_ENV.verifiedCompletedFocusIds]: Array.from(completedFocusIds).join(','),
    MAILCHIMP_EXCLUDED_FOCUS_IDS: Array.from(excludedFocusIds).join(','),
    MAILCHIMP_SEMANTIC_WORK_DIRECTOR_TARGET_FOCUS_IDS: directedNextFocusIds.join(',')
  };
  const worker = spawnSync(process.execPath, [WORKER_SCRIPT], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1024 * 1024 * 200, env: sharedEnv });
  appendLog(`\n===== persistent parity iteration ${iteration} (${runId}): worker =====\n${worker.stdout || ''}${worker.stderr || ''}${worker.error ? `\n[spawn-error] ${String(worker.error.message || worker.error)}` : ''}`);
  const sync = spawnSync(process.execPath, [SYNC_SCRIPT], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1024 * 1024 * 120, env: sharedEnv });
  appendLog(`\n===== persistent parity iteration ${iteration} (${runId}): sync =====\n${sync.stdout || ''}${sync.stderr || ''}${sync.error ? `\n[spawn-error] ${String(sync.error.message || sync.error)}` : ''}`);
  const supervisor = spawnSync(process.execPath, [SUPERVISOR_SCRIPT], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1024 * 1024 * 80, env: sharedEnv });
  appendLog(`\n===== persistent parity iteration ${iteration} (${runId}): supervisor =====\n${supervisor.stdout || ''}${supervisor.stderr || ''}${supervisor.error ? `\n[spawn-error] ${String(supervisor.error.message || supervisor.error)}` : ''}`);

  const programState = readJsonForRun(PROGRAM_STATE_PATH, runId, {});
  const summary = readJsonForRun(SUMMARY_PATH, runId, {});
  const workerFailureBlocker = worker.status !== 0 ? {
    blocker: '100-agent worker failed before the control plane received fresh delegate evidence.',
    nextAction: 'Inspect persistent_runner.log and reports/100_agent_worker.log, repair the worker or remote submission path, then rerun the current full-audit iteration.',
    phase: 'worker',
    exitCode: worker.status,
    error: worker.error
      ? String(worker.error.message || worker.error)
      : String(worker.stderr || worker.stdout || '').trim().slice(-4000) || null,
    runId,
    iteration
  } : null;
  const syncFailureBlocker = sync.status !== 0 ? {
    blocker: 'Control-plane sync step failed after the remote audit iteration completed.',
    nextAction: 'Inspect full-audit-campaign-sync-remote-worktree.mjs and the sync stderr in persistent_runner.log, then rerun the current full-organism iteration.',
    phase: 'sync_remote_worktree',
    exitCode: sync.status,
    error: sync.error ? String(sync.error.message || sync.error) : null,
    runId,
    iteration
  } : null;
  const blockerReport = readJsonForRun(BLOCKER_PATH, runId, null);
  const surfaceMatrix = readJsonForRun(SURFACE_MATRIX_PATH, runId, null);
  const syncStatus = readJsonForRun(SYNC_STATUS_PATH, runId, null);
  const landingFailureBlocker = sync.status === 0 && syncStatus?.canonicalLandingEvidence?.ok === false ? {
    blocker: 'Remote patch sync did not land new product-surface changes in the canonical checkout.',
    nextAction: 'Verify remote baseline freshness and patch path mapping before crediting parity objectives, then rerun with a clean canonical baseline.',
    phase: 'sync_remote_worktree',
    runId,
    iteration,
    canonicalLandingEvidence: syncStatus.canonicalLandingEvidence
  } : null;
  const blocker = syncFailureBlocker || landingFailureBlocker || blockerReport?.blocker || summary?.blocker || programState?.supervisor?.blocker || workerFailureBlocker || null;
  if ((workerFailureBlocker || syncFailureBlocker || landingFailureBlocker) && !blockerReport?.blocker) {
    writeJson(BLOCKER_PATH, {
      generatedAt: new Date().toISOString(),
      ...(workerFailureBlocker || syncFailureBlocker || landingFailureBlocker)
    });
  }
  const delegatePatchQueueReport = readJson(path.join(runDir, 'delegate', 'patch_queue_report.json'), { merged: [] });
  const iterationRecord = {
    iteration,
    runId,
    workerExitCode: worker.status,
    syncExitCode: sync.status,
    supervisorExitCode: supervisor.status,
    workerError: worker.error ? String(worker.error.message || worker.error) : null,
    syncError: sync.error ? String(sync.error.message || sync.error) : null,
    supervisorError: supervisor.error ? String(supervisor.error.message || supervisor.error) : null,
    supervisorStatus: summary?.supervisorStatus || programState?.supervisor?.status || null,
    matrixStatus: summary?.matrixStatus || summary?.surfaceMatrixStatus || programState?.supervisor?.matrixStatus || null,
    parityStatus: summary?.parityStatus || null,
    blocker,
    blockerKind: summary?.blockerKind || programState?.supervisor?.blockerKind || null,
    continuationDecision: summary?.continuationDecision || programState?.supervisor?.continuationDecision || null,
    nextFocus: firstNonEmptyFocusList(summary?.nextFocus, blockerReport?.nextFocus, deriveNextFocusFromSurfaceMatrix(surfaceMatrix)),
    mergedFocusIds: extractVerifiedFocusIdsFromPatchQueue(delegatePatchQueueReport),
    canonicalLandingOk: syncStatus?.canonicalLandingEvidence?.ok === true,
    canonicalLandedProductFileCount: Number(syncStatus?.canonicalLandingEvidence?.newlyLandedProductFileCount || 0),
    canonicalLandingEvidence: syncStatus?.canonicalLandingEvidence || null,
    failedFocusIds: deriveFailedFocusIdsForRun(runDir),
    excludedFocusIds: Array.from(excludedFocusIds),
    runDir: path.relative(ROOT, runDir)
  };
  iterations.push(iterationRecord);
  writeJson(path.join(runDir, 'iteration_record.json'), iterationRecord);
  for (const focusId of deriveCompletedFocusIds(iterationRecord, delegatePatchQueueReport, syncStatus)) completedFocusIds.add(focusId);
  for (const focusId of deriveCompletedFocusIdsFromDelegateProgress(runDir, syncStatus)) completedFocusIds.add(focusId);
  for (const focusId of normalizeFocusIds(iterationRecord.failedFocusIds)) {
    if (!completedFocusIds.has(focusId)) excludedFocusIds.add(focusId);
  }

  const green = summary?.supervisorConfirmedCompletion === true
    || (!blocker && iterationRecord.supervisorStatus === 'green' && iterationRecord.matrixStatus === 'all_complete');
  iterationRecord.green = green;
  const delegateContinuationDecision = iterationRecord.continuationDecision || null;
  const derivedContinuation = deriveIterationContinuation(iterationRecord);
  const continuation = delegateContinuationDecision
    ? {
        ...derivedContinuation,
        decision: delegateContinuationDecision,
        shouldContinue: delegateContinuationDecision === 'continue_next_iteration',
        shouldStop: delegateContinuationDecision !== 'continue_next_iteration'
      }
    : derivedContinuation;
  if (iterationRecord.blockerKind === 'strict_1to1_ceiling'
    && process.env.ORCHESTRATOR_REQUESTED_FIDELITY === 'full_clone'
    && CONTINUE_UNTIL_GLOBAL_PARITY
    && Date.now() < DEADLINE_AT_MS
    && !hasControlPlaneSyncOrLandingFailure(iterationRecord)
    && hasCanonicalLandingProgress(iterationRecord)) {
    const nextContinuationWave = Number(process.env.MAILCHIMP_FULL_CLONE_CONTINUATION_MIN_WAVE || 0) || null;
    continuation.blockerSemantics = 'claim_blocked_but_progressing';
    continuation.decision = 'continue_next_iteration';
    continuation.shouldContinue = true;
    continuation.shouldStop = false;
    iterationRecord.nextContinuationWave = nextContinuationWave;
  }
  if (shouldContinueFullCloneAfterProgress(iterationRecord, readJson(CONTRACT_PATH, null))) {
    continuation.blockerSemantics = 'full_clone_wave_boundary_but_progressing';
    continuation.decision = 'continue_next_iteration';
    continuation.shouldContinue = true;
    continuation.shouldStop = false;
  }
  const terminalNoProgressReason = classifyNoProgressReason(iterationRecord);
  if (terminalNoProgressReason && !hasCanonicalLandingProgress(iterationRecord)) {
    continuation.blockerSemantics = 'terminal_no_progress';
    continuation.decision = 'stop_blocked';
    continuation.shouldContinue = false;
    continuation.shouldStop = true;
    iterationRecord.noProgressReason = terminalNoProgressReason;
    if (delegateContinuationDecision === 'continue_next_iteration') {
      iterationRecord.delegateContinuationDecisionIgnored = delegateContinuationDecision;
    }
  }
  iterationRecord.continuationDecision = continuation.decision;
  iterationRecord.blockerSemantics = continuation.blockerSemantics;
  const noProgressStreak = consecutiveNoProgressIterations(iterations);
  const noProgressAudit = buildNoProgressAudit(iterations);
  if (noProgressAudit.terminal) {
    writeJson(NO_PROGRESS_AUDIT_PATH, noProgressAudit);
    const noProgressBlocker = {
      blocker: `Persistent parity runner stopped after ${noProgressStreak.length} consecutive red iterations with no canonical product landing delta and no merged focus credit.`,
      nextAction: 'Inspect no_progress_audit.json, repair planner grounding/admission or product-diff generation before relaunching; do not count failed-leaf exclusion churn as productive progress.',
      auditPath: path.relative(ROOT, NO_PROGRESS_AUDIT_PATH),
      noProgressReason: noProgressStreak.at(-1)?.noProgressReason || null,
      nextFocus: normalizeFocusIds(iterationRecord.nextFocus)
    };
    writeJson(BLOCKER_PATH, {
      generatedAt: new Date().toISOString(),
      runId,
      ...noProgressBlocker,
      phase: 'persistent_runner',
      status: 'blocked'
    });
    writeJson(STATUS_PATH, {
      generatedAt: new Date().toISOString(),
      running: false,
      campaignRunId: CAMPAIGN_RUN_ID,
      iteration,
      maxIterations: MAX_ITERATIONS,
      maxRuntimeHours: MAX_RUNTIME_HOURS,
      deadlineAt: new Date(DEADLINE_AT_MS).toISOString(),
      iterations,
      completedFocusIds: Array.from(completedFocusIds),
      excludedFocusIds: Array.from(excludedFocusIds),
      status: 'blocked',
      blocker: noProgressBlocker,
      note: 'Full-audit Mailchimp parity campaign tripped the no-progress circuit breaker.'
    });
    runTerminalWatch();
    process.exit(1);
  }
  if (isAutonomyOnlyThresholdGate(iterationRecord, completedFocusIds)) {
    const autonomyBlocker = {
      blocker: 'Production-creation benchmark product work is complete, but the scored autonomy-duration threshold is still red.',
      nextAction: 'Do not relaunch zero-work implementation iterations. Run a lightweight wall-clock autonomy proof/supervisor soak, or lower the benchmark autonomy threshold for this production-slice run.',
      thresholdEvaluation: iterationRecord.blocker?.thresholdEvaluation || null,
      status: 'blocked_autonomy_threshold'
    };
    writeJson(BLOCKER_PATH, {
      generatedAt: new Date().toISOString(),
      runId,
      ...autonomyBlocker,
      phase: 'persistent_runner'
    });
    writeJson(STATUS_PATH, {
      generatedAt: new Date().toISOString(),
      running: false,
      campaignRunId: CAMPAIGN_RUN_ID,
      iteration,
      maxIterations: MAX_ITERATIONS,
      maxRuntimeHours: MAX_RUNTIME_HOURS,
      deadlineAt: new Date(DEADLINE_AT_MS).toISOString(),
      iterations,
      completedFocusIds: Array.from(completedFocusIds),
      excludedFocusIds: Array.from(excludedFocusIds),
      status: 'blocked_autonomy_threshold',
      blocker: autonomyBlocker,
      note: 'Full-audit Mailchimp parity campaign stopped instead of spinning zero-work iterations after all benchmark-scope focus ids were credited complete.'
    });
    runTerminalWatch();
    process.exit(1);
  }
  const softContinuation = continuation.shouldContinue;
  const hasBlocker = Boolean(blocker);
  const mappedNextFocusIds = normalizeContinuationFocusIds(iterationRecord.nextFocus);
  if (mappedNextFocusIds.length > 0) directedNextFocusIds = mappedNextFocusIds;
  if (green) {
    const remainingGlobalFocusIds = remainingGlobalParityFocusIds(completedFocusIds, excludedFocusIds);
    if (remainingGlobalFocusIds.length > 0) {
      overallStatus = 'running_until_global_parity_complete';
      writeJson(STATUS_PATH, {
        generatedAt: new Date().toISOString(),
        running: true,
        campaignRunId: CAMPAIGN_RUN_ID,
        iteration,
        maxIterations: MAX_ITERATIONS,
        maxRuntimeHours: MAX_RUNTIME_HOURS,
        deadlineAt: new Date(DEADLINE_AT_MS).toISOString(),
        iterations,
        completedFocusIds: Array.from(completedFocusIds),
        excludedFocusIds: Array.from(excludedFocusIds),
        status: overallStatus,
        latestGreenIteration: { iteration, runId },
        remainingGlobalFocusIds,
        note: 'Supervisor green reached for the current product wave, but global Mailchimp parity inventory still has remaining product surfaces; continuing without soak semantics.'
      });
      continue;
    }
    if (SOAK_FULL_RUNTIME && Date.now() < DEADLINE_AT_MS) {
      overallStatus = 'soaking_after_green';
      writeJson(STATUS_PATH, {
        generatedAt: new Date().toISOString(),
        running: true,
        campaignRunId: CAMPAIGN_RUN_ID,
        iteration,
        maxIterations: MAX_ITERATIONS,
        maxRuntimeHours: MAX_RUNTIME_HOURS,
        deadlineAt: new Date(DEADLINE_AT_MS).toISOString(),
        iterations,
        completedFocusIds: Array.from(completedFocusIds),
        excludedFocusIds: Array.from(excludedFocusIds),
        status: overallStatus,
        latestGreenIteration: { iteration, runId },
        soakState: {
          active: true,
          reachedAtIteration: iteration,
          reachedAtRunId: runId,
          reason: 'full_runtime_soak_after_green',
          deadlineAt: new Date(DEADLINE_AT_MS).toISOString()
        },
        note: 'Supervisor green reached, but full-runtime soak mode is enabled so the campaign will continue until the runtime budget expires unless a real blocker appears.'
      });
      continue;
    }
    overallStatus = 'green';
    writeJson(STATUS_PATH, { generatedAt: new Date().toISOString(), running: false, campaignRunId: CAMPAIGN_RUN_ID, iteration, maxIterations: MAX_ITERATIONS, maxRuntimeHours: MAX_RUNTIME_HOURS, deadlineAt: new Date(DEADLINE_AT_MS).toISOString(), iterations, completedFocusIds: Array.from(completedFocusIds), excludedFocusIds: Array.from(excludedFocusIds), status: overallStatus, note: 'Full-audit Mailchimp parity campaign reached supervisor green.' });
    runTerminalWatch();
    process.exit(0);
  }
  if (softContinuation) {
    overallStatus = 'running';
    writeJson(STATUS_PATH, {
      generatedAt: new Date().toISOString(),
      running: true,
      campaignRunId: CAMPAIGN_RUN_ID,
      iteration,
      maxIterations: MAX_ITERATIONS,
      maxRuntimeHours: MAX_RUNTIME_HOURS,
      deadlineAt: new Date(DEADLINE_AT_MS).toISOString(),
      iterations,
      completedFocusIds: Array.from(completedFocusIds),
      excludedFocusIds: Array.from(excludedFocusIds),
      status: overallStatus,
      note: `Continuing after partial Mailchimp progress, ${normalizeFocusIds(iterationRecord.nextFocus).length} canonical surfaces remain.`
    });
    continue;
  }
  if (hasBlocker && requestedFullClone(readJson(CONTRACT_PATH, null)) && !hasControlPlaneSyncOrLandingFailure(iterationRecord)) {
    const remainingGlobalFocusIds = remainingGlobalParityFocusIds(completedFocusIds, excludedFocusIds);
    const objectiveExpansion = deriveObjectiveExpansion({
      requestedFidelity: process.env.ORCHESTRATOR_REQUESTED_FIDELITY || readJson(CONTRACT_PATH, null)?.fidelity || readJson(CONTRACT_PATH, null)?.requestedFidelity || null,
      matrixStatus: iterationRecord.matrixStatus,
      parityStatus: iterationRecord.parityStatus,
      blockerKind: iterationRecord.blockerKind,
      currentWorkCount: 0,
      scopeAlreadySatisfied: iterationRecord.matrixStatus === 'all_complete' || iterationRecord.matrixStatus === 'scope_satisfied_zero_work',
      remainingObjectiveIds: remainingGlobalFocusIds,
      nextFocus: iterationRecord.nextFocus
    });
    if (objectiveExpansion.shouldExpand) {
      overallStatus = 'expanding_objective_graph';
      writeJson(STATUS_PATH, {
        generatedAt: new Date().toISOString(),
        running: true,
        campaignRunId: CAMPAIGN_RUN_ID,
        iteration,
        maxIterations: MAX_ITERATIONS,
        maxRuntimeHours: MAX_RUNTIME_HOURS,
        deadlineAt: new Date(DEADLINE_AT_MS).toISOString(),
        iterations,
        completedFocusIds: Array.from(completedFocusIds),
        excludedFocusIds: Array.from(excludedFocusIds),
        status: overallStatus,
        blockerKind: iterationRecord.blockerKind || null,
        remainingGlobalFocusIds,
        objectiveExpansion,
        note: 'Scoped graph was exhausted before the full-clone objective was satisfied; orchestration is expanding to the remaining objective surfaces instead of treating zero-work scoped green as terminal.'
      });
      continue;
    }
    if (shouldReopenFullCloneFrontier({
      contract: readJson(CONTRACT_PATH, null),
      matrixStatus: iterationRecord.matrixStatus,
      parityStatus: iterationRecord.parityStatus,
      blockerKind: iterationRecord.blockerKind,
      remainingGlobalFocusIds
    })) {
      const reopenedFocusIds = reopenFullCloneFrontierFocusIds(completedFocusIds);
      overallStatus = 'expanding_objective_graph';
      writeJson(STATUS_PATH, {
        generatedAt: new Date().toISOString(),
        running: true,
        campaignRunId: CAMPAIGN_RUN_ID,
        iteration,
        maxIterations: MAX_ITERATIONS,
        maxRuntimeHours: MAX_RUNTIME_HOURS,
        deadlineAt: new Date(DEADLINE_AT_MS).toISOString(),
        iterations,
        completedFocusIds: Array.from(completedFocusIds),
        excludedFocusIds: Array.from(excludedFocusIds),
        status: overallStatus,
        blockerKind: iterationRecord.blockerKind || null,
        remainingGlobalFocusIds: reopenedFocusIds,
        objectiveExpansion: {
          shouldExpand: true,
          reason: 'full_clone_frontier_reopened_after_finite_matrix_exhaustion',
          requestedFidelity: 'full_clone',
          matrixStatus: iterationRecord.matrixStatus || null,
          parityStatus: iterationRecord.parityStatus || null,
          blockerKind: iterationRecord.blockerKind || null,
          remainingObjectiveIds: reopenedFocusIds,
          nextFocus: normalizeFocusIds(iterationRecord.nextFocus)
        },
        note: 'Finite scoped graph was exhausted while full-clone truth stayed red; reopening broad full-clone frontier surfaces for another product-work wave instead of hard-blocking on zero-work scoped green.'
      });
      continue;
    }
  }
  if (hasBlocker) {
    overallStatus = continuation.decision === 'stop_claim_blocked' ? 'claim_blocked' : 'blocked';
    writeJson(STATUS_PATH, {
      generatedAt: new Date().toISOString(),
      running: false,
      campaignRunId: CAMPAIGN_RUN_ID,
      iteration,
      maxIterations: MAX_ITERATIONS,
      maxRuntimeHours: MAX_RUNTIME_HOURS,
      deadlineAt: new Date(DEADLINE_AT_MS).toISOString(),
      iterations,
      completedFocusIds: Array.from(completedFocusIds),
      excludedFocusIds: Array.from(excludedFocusIds),
      status: overallStatus,
      blocker,
      blockerKind: iterationRecord.blockerKind || null,
      continuationDecision: continuation.decision,
      note: continuation.decision === 'stop_claim_blocked'
        ? 'Orchestration stopped cleanly because only the final full-clone claim remains blocked.'
        : 'Full-audit Mailchimp parity campaign stopped on a real blocker.'
    });
    runTerminalWatch();
    process.exit(1);
  }
}

const runtimeBudgetReached = Date.now() >= DEADLINE_AT_MS;
overallStatus = runtimeBudgetReached ? 'runtime_budget_reached' : 'iteration_cap_reached';
writeJson(STATUS_PATH, {
  generatedAt: new Date().toISOString(),
  running: false,
  campaignRunId: CAMPAIGN_RUN_ID,
  maxIterations: MAX_ITERATIONS,
  maxRuntimeHours: MAX_RUNTIME_HOURS,
  deadlineAt: new Date(DEADLINE_AT_MS).toISOString(),
  iterations,
  completedFocusIds: Array.from(completedFocusIds),
  excludedFocusIds: Array.from(excludedFocusIds),
  status: overallStatus,
  note: runtimeBudgetReached
    ? 'Full-audit Mailchimp parity campaign hit the wall-clock runtime budget without green/blocker.'
    : 'Full-audit Mailchimp parity campaign hit the iteration cap without green/blocker.'
});
runTerminalWatch();
process.exit(runtimeBudgetReached ? 3 : 2);
