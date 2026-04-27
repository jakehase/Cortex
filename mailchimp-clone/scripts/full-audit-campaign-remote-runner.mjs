import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { buildHeartbeatSummary } from './lib/full-audit-campaign-liveness.mjs';
import { buildNotifierEligibilityPayload, deriveCanonicalStatuses, resolveCampaignBlocker } from './lib/full-audit-campaign-state.mjs';
import { buildRepoWideSyncPathspecs, parsePorcelainStatus, statusRepresentsDeletion } from './lib/full-audit-campaign-sync-pathspecs.mjs';
import { expandEquivalentFocusIds, extractVerifiedFocusIdsFromPatchQueue, mailchimpParityFocusIds, normalizeFocusIds } from './lib/orchestrator-real-repo-clean-plan.mjs';
import { MAILCHIMP_CANONICAL_ONE_PASS_PLAN } from './lib/mailchimp-canonical-one-pass-plan-data.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const REMOTE_BASE = path.dirname(ROOT);
const RUN_ID = process.env.MAILCHIMP_FULL_AUDIT_RUN_ID || `manual-${Date.now()}`;
const REMOTE_RUNS_ROOT = process.env.MAILCHIMP_REMOTE_RUNS_ROOT || path.join(REMOTE_BASE, 'mailchimp-runs');
const RUN_ROOT = path.join(REMOTE_RUNS_ROOT, RUN_ID);
const WORKTREE_PATH = path.join(REMOTE_BASE, `mailchimp-worktree-${RUN_ID}`);
const ARTIFACT_ROOT = process.env.MAILCHIMP_ORCHESTRATOR_ARTIFACT_ROOT || path.join(RUN_ROOT, 'artifacts', 'implementation_runs', RUN_ID);
const STATUS_PATH = path.join(ARTIFACT_ROOT, 'remote_execution_status.json');
const TERMINAL_STATUS_PATH = path.join(ARTIFACT_ROOT, 'remote_execution_terminal.json');
const TARGETED_FOCUS_CREDIT_PATH = path.join(ARTIFACT_ROOT, 'targeted_focus_credit.json');
const BENCHMARK_PROGRESS_PATH = path.join(ARTIFACT_ROOT, 'benchmark_progress.json');
const IMPLEMENTATION_MODE_STATUS_PATH = path.join(ARTIFACT_ROOT, 'implementation_mode_status.json');
const CANONICAL_SUMMARY_PATH = path.join(ARTIFACT_ROOT, 'canonical_summary.json');
const NOTIFIER_ELIGIBILITY_PATH = path.join(ARTIFACT_ROOT, 'notifier_eligibility.json');
const BASELINE_COMMIT_PATH = path.join(ARTIFACT_ROOT, 'baseline_commit.json');
const WORKTREE_MANIFEST_PATH = path.join(ARTIFACT_ROOT, 'worktree_manifest.json');
const BASELINE_OVERLAY_PATH = path.join(ARTIFACT_ROOT, 'baseline_overlay.json');
const BLOCKER_PATH = path.join(ARTIFACT_ROOT, 'blocker_report.json');
const PROGRESS_STATE_PATH = path.join(ARTIFACT_ROOT, 'parity_progress_state.json');
const ITERATION_LAUNCH_ENV_PATH = path.join(ARTIFACT_ROOT, 'iteration_launch_env.json');
const STRICT_GAP_INVENTORY_SOURCE_PATH = path.join(ROOT, 'artifacts', 'full_audit_campaign', 'strict_1to1_gap_inventory.json');
const STRICT_GAP_INVENTORY_DEST_PATH = path.join(ARTIFACT_ROOT, 'full_audit_campaign', 'strict_1to1_gap_inventory.json');
const BENCHMARK_CONTRACT_SOURCE_PATH = path.join(ROOT, 'artifacts', 'full_audit_campaign', 'one_pass_run_contract.latest.json');
const BENCHMARK_CONTRACT_DEST_PATH = path.join(ARTIFACT_ROOT, 'full_audit_campaign', 'one_pass_run_contract.latest.json');
const MAX_NO_PROGRESS_ITERATIONS = Math.max(1, Number(process.env.MAILCHIMP_MAX_NO_PROGRESS_ITERATIONS || 12));
const MAX_RECOVERABLE_INFRA_RETRIES = Math.max(1, Number(process.env.MAILCHIMP_MAX_RECOVERABLE_INFRA_RETRIES || 3));
const MIN_FREE_INODES_FOR_WORKTREE = Math.max(10_000, Number(process.env.MAILCHIMP_MIN_FREE_INODES_FOR_WORKTREE || 500_000));
const STALE_WORKTREE_RETENTION_COUNT = Math.max(0, Number(process.env.MAILCHIMP_STALE_WORKTREE_RETENTION_COUNT || 10));
const STALE_WORKTREE_MIN_AGE_MS = Math.max(0, Number(process.env.MAILCHIMP_STALE_WORKTREE_MIN_AGE_MS || 30 * 60 * 1000));
const DEPENDENCY_LINKS_PATH = path.join(ARTIFACT_ROOT, 'dependency_links.json');
const LOG_PATH = path.join(ARTIFACT_ROOT, 'remote_execution.log');
const DELEGATE_SCRIPT = path.join(WORKTREE_PATH, 'scripts', 'orchestrator-real-repo-clean-run.mjs');
const MAX_ITERATIONS = Number(process.env.MAILCHIMP_REMOTE_MAX_ITERATIONS || 200);
const HEARTBEAT_MS = Number(process.env.MAILCHIMP_REMOTE_HEARTBEAT_MS || 15_000);
const STRICT_GAP_SINGLE_PASS = String(process.env.MAILCHIMP_STRICT_GAP_SEQUENCE || '').trim() === '1'
  && String(process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY || '').trim() === '1';
const ITERATION_EPHEMERAL_ARTIFACTS = Object.freeze([
  'live_runs',
  'merge',
  'recovery',
  'canonical_summary.json',
  'completion_summary.json',
  'blocker_report.json',
  'program_state.json',
  'supervisor_status.json',
  'live_execution_summary.json',
  'patch_queue_report.json',
  'launch_checklist.json',
  'loc_accounting.json',
  'implementation_mode_status.json',
  'notifier_eligibility.json',
  'scale_qualification.json',
  'selected_tier_summary.json',
  'selected_tier_supervisor.json',
  path.join('validation', 'validation_index.json')
]);
const HEARTBEAT_ARTIFACTS = [
  'work_graph.json',
  'campaign_state.json',
  'program_state.json',
  'completion_summary.json',
  'blocker_report.json',
  'supervisor_status.json',
  'canonical_summary.json',
  'notifier_eligibility.json',
  'implementation_mode_status.json',
  'launch_checklist.json',
  'loc_accounting.json'
].map((name) => path.join(ARTIFACT_ROOT, name));
const OVERLAY_PATHSPECS = buildRepoWideSyncPathspecs();
const SIGNAL_EXIT_CODES = Object.freeze({ SIGINT: 130, SIGTERM: 143 });
const PRODUCT_SURFACE_PROGRESS_EXCLUDES = Object.freeze([
  'artifacts/',
  'tests/',
  'scripts/',
  'docs/',
  'state/',
  'backups/',
  '_tmp/',
  '_logs/'
]);
const DEFAULT_PRODUCTION_CREDIT_EXCLUDED_PREFIXES = Object.freeze([
  'packages/product-factory/'
]);

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath, payload) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

function rmIfExists(filePath) {
  try {
    fs.rmSync(filePath, { recursive: true, force: true });
  } catch {}
}

function clearIterationEphemeralArtifacts() {
  for (const relativePath of ITERATION_EPHEMERAL_ARTIFACTS) rmIfExists(path.join(ARTIFACT_ROOT, relativePath));
}

function hasSelectedTierLiveWork(liveExecutionSummary = null) {
  return Number(liveExecutionSummary?.shardCount || 0) > 0
    || Number(liveExecutionSummary?.mergedShardCount || 0) > 0
    || Number(liveExecutionSummary?.metrics?.mergedPatchCount || 0) > 0;
}

function resolvePlannedFocusWorkUnitIds(workGraph = null) {
  if (!Array.isArray(workGraph?.workUnits)) return [];
  return Array.from(new Set(workGraph.workUnits
    .map((unit) => {
      const unitId = String(unit?.id || '').trim();
      const focusId = String(unit?.metadata?.focusId || '').trim();
      if (unitId.startsWith('focus.')) return unitId;
      if (focusId.startsWith('focus.')) return focusId;
      if (unit?.lane === 'parity_focus') return unitId || focusId || null;
      if (unit?.metadata?.strictGap === true && (unitId || focusId)) return unitId || focusId;
      return null;
    })
    .filter((focusId) => typeof focusId === 'string' && focusId.startsWith('focus.'))));
}

function blockerText(blocker) {
  if (typeof blocker === 'string') return blocker;
  if (blocker && typeof blocker.blocker === 'string') return blocker.blocker;
  return '';
}

const FOCUS_TARGETED_TESTS = new Map(
  (MAILCHIMP_CANONICAL_ONE_PASS_PLAN.surfaceChecklist || []).map((surface) => [
    `focus.${String(surface.id || '').trim()}`,
    Array.isArray(surface.targetedTests)
      ? surface.targetedTests.map((entry) => String(entry || '').trim()).filter(Boolean)
      : []
  ])
);

function isNoParityReductionBlocker(blocker = null) {
  return typeof blocker?.blocker === 'string'
    && blocker.blocker.includes('No parity-surface reduction was proven by this iteration.');
}

function creditableFocusIdsForIteration({
  selectedTierHadLiveWork = false,
  blocker = null,
  patchQueueFocusIds = [],
  targetedTestVerifiedFocusIds = [],
  liveExecutionSummary = null
} = {}) {
  if (!selectedTierHadLiveWork) return [];
  const metrics = liveExecutionSummary?.metrics || {};
  const continuityFailures = Array.isArray(metrics?.continuityFailures) ? metrics.continuityFailures : [];
  const stateLossEvents = Number(metrics?.stateLossEvents || 0);
  const unstableExecution = stateLossEvents > 0 || continuityFailures.length > 0;
  if (unstableExecution) {
    return Array.from(new Set(targetedTestVerifiedFocusIds));
  }
  if (isNoParityReductionBlocker(blocker)) {
    return Array.from(new Set(targetedTestVerifiedFocusIds));
  }
  return Array.from(new Set([
    ...patchQueueFocusIds,
    ...targetedTestVerifiedFocusIds
  ]));
}

function uniqueNonEmptyStrings(values = []) {
  return Array.from(new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean)));
}

function extractMergedPatchLanes(mergedEntries = [], patchQueueFocusIds = []) {
  const derivedFocusLanes = normalizeFocusIds(patchQueueFocusIds)
    .map((focusId) => focusId.replace(/^focus\./, ''));
  return uniqueNonEmptyStrings([
    ...derivedFocusLanes,
    ...mergedEntries.flatMap((entry) => {
      const metadata = entry?.metadata || {};
      const implementationMetadata = metadata?.implementation?.metadata || {};
      let parsedStdout = null;
      if (typeof metadata?.implementation?.stdout === 'string') {
        try {
          parsedStdout = JSON.parse(metadata.implementation.stdout);
        } catch {}
      }
      const parsedStdoutMetadata = parsedStdout?.metadata || {};
      return [
        metadata?.contextPack?.shard?.lane,
        implementationMetadata.focusGroup,
        implementationMetadata.rawFocusGroup,
        parsedStdout?.focusGroup,
        parsedStdoutMetadata.focusGroup,
        parsedStdoutMetadata.rawFocusGroup
      ];
    })
  ]);
}

function collectVerifierResults(entry) {
  const nestedResults = [];
  for (const candidate of [entry?.metadata?.verifierResults, entry?.metadata?.implementation?.verifierResults]) {
    if (Array.isArray(candidate)) nestedResults.push(...candidate);
  }
  if (nestedResults.length > 0) return nestedResults;
  return Array.isArray(entry?.verifierResults) ? entry.verifierResults : [];
}

function extractProductSurfaceFiles(mergedEntries = []) {
  return uniqueNonEmptyStrings(mergedEntries.flatMap((entry) => {
    const filePaths = [];
    for (const candidate of [entry?.filePaths, entry?.modifiedFiles, entry?.paths, entry?.metadata?.implementation?.modifiedFiles]) {
      if (Array.isArray(candidate)) filePaths.push(...candidate);
    }
    return filePaths;
  }).filter((filePath) => !PRODUCT_SURFACE_PROGRESS_EXCLUDES.some((prefix) => String(filePath).startsWith(prefix))));
}

function normalizeRepoPath(value) {
  return String(value || '').replace(/^\.\//, '').replace(/\\/g, '/').trim();
}

function pathMatchesCreditPattern(filePath, pattern) {
  const normalizedPath = normalizeRepoPath(filePath);
  const normalizedPattern = normalizeRepoPath(pattern);
  if (!normalizedPath || !normalizedPattern || !/[/*]/.test(normalizedPattern)) return false;
  if (normalizedPattern.endsWith('/**')) return normalizedPath.startsWith(normalizedPattern.slice(0, -3));
  if (normalizedPattern.endsWith('/*')) {
    const prefix = normalizedPattern.slice(0, -1);
    return normalizedPath.startsWith(prefix) && !normalizedPath.slice(prefix.length).includes('/');
  }
  if (!normalizedPattern.includes('*')) return normalizedPath === normalizedPattern;
  const [prefix, suffix = ''] = normalizedPattern.split('*');
  return normalizedPath.startsWith(prefix) && normalizedPath.endsWith(suffix);
}

function productionCreditPolicy(contract = null) {
  const surfaces = Array.isArray(contract?.scope?.surfaces) ? contract.scope.surfaces : [];
  const allowedFiles = new Set(surfaces.flatMap((surface) => Array.isArray(surface?.allowedFiles) ? surface.allowedFiles : [])
    .map(normalizeRepoPath)
    .filter(Boolean));
  const excludedPatterns = uniqueNonEmptyStrings([
    ...DEFAULT_PRODUCTION_CREDIT_EXCLUDED_PREFIXES.map((prefix) => `${prefix}**`),
    ...(Array.isArray(contract?.scope?.excludedCredit) ? contract.scope.excludedCredit : [])
  ]);
  return {
    allowedFiles,
    excludedPatterns,
    requireAllowedFileMatch: allowedFiles.size > 0,
    allowGeneratedProductFactoryCredit: contract?.productionCredit?.allowGeneratedProductFactoryCredit === true
  };
}

function productionCreditEligibility(filePath, policy = productionCreditPolicy()) {
  const normalized = normalizeRepoPath(filePath);
  if (!normalized) return { eligible: false, reason: 'missing_path' };
  if (!policy.allowGeneratedProductFactoryCredit && DEFAULT_PRODUCTION_CREDIT_EXCLUDED_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return { eligible: false, reason: 'generated_product_factory_scaffold' };
  }
  const excludedPattern = policy.excludedPatterns.find((pattern) => pathMatchesCreditPattern(normalized, pattern));
  if (excludedPattern) return { eligible: false, reason: `excluded_credit:${excludedPattern}` };
  if (policy.requireAllowedFileMatch && !policy.allowedFiles.has(normalized)) {
    return { eligible: false, reason: 'outside_contract_allowed_files' };
  }
  return { eligible: true, reason: null };
}

function promotedProductLocFromAccounting(locAccounting = null, contract = null) {
  const policy = productionCreditPolicy(contract);
  const productCodeFiles = Array.isArray(locAccounting?.productCodeFiles) ? locAccounting.productCodeFiles : [];
  const credited = [];
  for (const fileEntry of productCodeFiles) {
    const filePath = normalizeRepoPath(fileEntry?.path || fileEntry?.file || fileEntry?.relativePath || '');
    if (!productionCreditEligibility(filePath, policy).eligible) continue;
    credited.push({
      path: filePath,
      added: Number(fileEntry?.added || 0),
      deleted: Number(fileEntry?.deleted || 0)
    });
  }
  return {
    files: credited.map((entry) => entry.path).filter(Boolean),
    changedLines: credited.reduce((total, entry) => total + entry.added + entry.deleted, 0)
  };
}

function emptyBenchmarkMetrics() {
  return {
    productDiffChangedLines: 0,
    productFiles: [],
    focusLanes: [],
    agentIds: [],
    mergedPatchCount: 0,
    shardOutputCount: 0,
    totalPatchCandidates: 0,
    noOpPatchCount: 0,
    verifiedMergedPatchCount: 0,
    repeatBlockerCount: 0,
    blockerEventCount: 0,
    truthIntegrityContradictions: 0,
    previousBlockerText: null
  };
}

function loadBenchmarkMetrics(raw = null) {
  const metrics = raw && typeof raw === 'object' ? raw : {};
  return {
    ...emptyBenchmarkMetrics(),
    ...metrics,
    productDiffChangedLines: Number(metrics?.productDiffChangedLines || 0),
    productFiles: uniqueNonEmptyStrings(metrics?.productFiles || []),
    focusLanes: uniqueNonEmptyStrings(metrics?.focusLanes || []),
    agentIds: uniqueNonEmptyStrings(metrics?.agentIds || []),
    mergedPatchCount: Number(metrics?.mergedPatchCount || 0),
    shardOutputCount: Number(metrics?.shardOutputCount || 0),
    totalPatchCandidates: Number(metrics?.totalPatchCandidates || 0),
    noOpPatchCount: Number(metrics?.noOpPatchCount || 0),
    verifiedMergedPatchCount: Number(metrics?.verifiedMergedPatchCount || 0),
    repeatBlockerCount: Number(metrics?.repeatBlockerCount || 0),
    blockerEventCount: Number(metrics?.blockerEventCount || 0),
    truthIntegrityContradictions: Number(metrics?.truthIntegrityContradictions || 0),
    previousBlockerText: typeof metrics?.previousBlockerText === 'string' ? metrics.previousBlockerText : null
  };
}

function summarizeBenchmarkMetrics(benchmarkMetrics = null) {
  const metrics = loadBenchmarkMetrics(benchmarkMetrics);
  const mergedPatchCount = Number(metrics.mergedPatchCount || 0);
  const totalPatchCandidates = Number(metrics.totalPatchCandidates || 0);
  const blockerEventCount = Number(metrics.blockerEventCount || 0);
  const verifiedMergedPatchCount = Number(metrics.verifiedMergedPatchCount || 0);
  return {
    productDiffChangedLines: Number(metrics.productDiffChangedLines || 0),
    productDiffFiles: metrics.productFiles.length,
    distinctFocusLanes: metrics.focusLanes.length,
    distinctAgentIds: metrics.agentIds.length,
    mergedPatchCount,
    shardOutputCount: Number(metrics.shardOutputCount || 0),
    totalPatchCandidates,
    noOpPatchCount: Number(metrics.noOpPatchCount || 0),
    repeatBlockerCount: Number(metrics.repeatBlockerCount || 0),
    blockerEventCount,
    verifiedMergedPatchCount,
    verificationIntegrity: mergedPatchCount > 0
      ? Number((verifiedMergedPatchCount / mergedPatchCount).toFixed(2))
      : 1,
    noOpRate: totalPatchCandidates > 0
      ? Number((Number(metrics.noOpPatchCount || 0) / totalPatchCandidates).toFixed(2))
      : 0,
    repeatBlockerRate: blockerEventCount > 0
      ? Number((Number(metrics.repeatBlockerCount || 0) / blockerEventCount).toFixed(2))
      : 0,
    truthIntegrityContradictions: Number(metrics.truthIntegrityContradictions || 0),
    productFiles: metrics.productFiles,
    focusLanes: metrics.focusLanes,
    agentIds: metrics.agentIds,
    lastBlockerText: metrics.previousBlockerText || null
  };
}

function accumulateBenchmarkMetrics({
  benchmarkMetrics = null,
  patchQueueReport = null,
  liveExecutionSummary = null,
  locAccounting = null,
  blocker = null,
  freshProgressDetected = false
} = {}) {
  const next = loadBenchmarkMetrics(benchmarkMetrics);
  const mergedEntries = Array.isArray(patchQueueReport?.merged) ? patchQueueReport.merged : [];
  const rejectedEntries = Array.isArray(patchQueueReport?.rejected) ? patchQueueReport.rejected : [];
  const patchQueueFocusIds = extractMergedFocusIds(patchQueueReport);
  const productFiles = new Set(next.productFiles);
  const focusLanes = new Set(next.focusLanes);
  const agentIds = new Set(next.agentIds);
  const hasAcceptedProductWork = mergedEntries.length > 0 || Number(liveExecutionSummary?.metrics?.mergedPatchCount || 0) > 0;

  next.totalPatchCandidates += mergedEntries.length + rejectedEntries.length;
  next.noOpPatchCount += rejectedEntries.filter((entry) => entry?.rejectionCategory === 'no_op').length;
  next.mergedPatchCount += Number(liveExecutionSummary?.metrics?.mergedPatchCount || mergedEntries.length || 0);
  next.shardOutputCount += Number(liveExecutionSummary?.metrics?.shardOutputCount || 0);

  for (const lane of extractMergedPatchLanes(mergedEntries, patchQueueFocusIds)) focusLanes.add(lane);
  for (const agentId of uniqueNonEmptyStrings(mergedEntries.map((entry) => entry?.agentId))) agentIds.add(agentId);

  for (const entry of mergedEntries) {
    const verifiers = collectVerifierResults(entry);
    if (verifiers.length > 0 && verifiers.every((result) => result?.ok === true && result?.skipped !== true)) {
      next.verifiedMergedPatchCount += 1;
    }
  }

  let promotedChangedLines = 0;
  if (hasAcceptedProductWork) {
    const promotedLoc = promotedProductLocFromAccounting(locAccounting, readJson(BENCHMARK_CONTRACT_DEST_PATH, null));
    for (const filePath of promotedLoc.files) productFiles.add(filePath);
    next.productDiffChangedLines += promotedLoc.changedLines;
    promotedChangedLines = promotedLoc.changedLines;
  }

  const blockerLabel = blockerText(blocker).trim();
  const benchmarkFreshProgressDetected = freshProgressDetected || promotedChangedLines > 0 || productFiles.size > next.productFiles.length;
  const progressContinuationBlocker = /partial parity-surface reduction was proven|remaining red surfaces are still open/i.test(blockerLabel);
  if (blockerLabel && !(benchmarkFreshProgressDetected && progressContinuationBlocker)) {
    next.blockerEventCount += 1;
    if (next.previousBlockerText && next.previousBlockerText === blockerLabel && !benchmarkFreshProgressDetected) {
      next.repeatBlockerCount += 1;
    }
    next.previousBlockerText = blockerLabel;
  } else if (benchmarkFreshProgressDetected || !blockerLabel) {
    next.previousBlockerText = null;
  }

  next.productFiles = Array.from(productFiles);
  next.focusLanes = Array.from(focusLanes);
  next.agentIds = Array.from(agentIds);
  return next;
}

function writeBenchmarkProgress({ progressState = null, iteration = null }) {
  writeJson(BENCHMARK_PROGRESS_PATH, {
    generatedAt: new Date().toISOString(),
    runId: RUN_ID,
    iteration,
    completedFocusIds: normalizeCompletedFocusIds(progressState?.completedFocusIds || []),
    verifiedFocusIds: normalizeCompletedFocusIds(progressState?.verifiedCompletedFocusIds || []),
    observed: summarizeBenchmarkMetrics(progressState?.benchmarkMetrics)
  });
}

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function normalizeCompletedFocusIds(value) {
  return expandEquivalentFocusIds(Array.isArray(value) ? value : []);
}

function filterFocusIdsByTrustedSet(values = [], trustedValues = []) {
  const trustedFocusIds = new Set(normalizeCompletedFocusIds(trustedValues));
  return normalizeCompletedFocusIds(values)
    .filter((focusId) => trustedFocusIds.has(focusId));
}

function verifyFocusIdsByTargetedTests(focusIds) {
  const normalizedFocusIds = normalizeCompletedFocusIds(focusIds);
  if (!normalizedFocusIds.length) return [];

  const attempts = [];
  const verifiedFocusIds = [];
  for (const focusId of normalizedFocusIds) {
    const tests = Array.from(new Set((FOCUS_TARGETED_TESTS.get(focusId) || [])
      .filter((entry) => fs.existsSync(path.join(ROOT, entry)))));
    if (!tests.length) continue;
    const result = spawnSync(process.execPath, ['--test', ...tests], {
      cwd: ROOT,
      env: process.env,
      encoding: 'utf8',
      timeout: 180000,
      maxBuffer: 4 * 1024 * 1024
    });
    attempts.push({
      focusId,
      tests,
      exitCode: Number.isInteger(result.status) ? result.status : null,
      signal: result.signal || null
    });
    if (result.status === 0) verifiedFocusIds.push(focusId);
  }

  writeJson(TARGETED_FOCUS_CREDIT_PATH, {
    generatedAt: new Date().toISOString(),
    verifiedFocusIds,
    attempts
  });
  return verifiedFocusIds;
}

function loadProgressState() {
  const raw = readJson(PROGRESS_STATE_PATH, null) || {};
  const envCompletedFocusIds = normalizeCompletedFocusIds(String(process.env.MAILCHIMP_COMPLETED_FOCUS_IDS || '').split(','));
  const hasVerifiedSchema = Array.isArray(raw?.verifiedCompletedFocusIds);
  const verifiedCompletedFocusIds = normalizeCompletedFocusIds(hasVerifiedSchema ? raw.verifiedCompletedFocusIds : []);
  const legacyCompletedFocusIds = hasVerifiedSchema ? [] : normalizeCompletedFocusIds(raw?.completedFocusIds);
  const seededEnvCompletedFocusIds = verifiedCompletedFocusIds.length > 0
    ? filterFocusIdsByTrustedSet(envCompletedFocusIds, verifiedCompletedFocusIds)
    : envCompletedFocusIds;
  const seededCompletedFocusIds = normalizeCompletedFocusIds([
    ...seededEnvCompletedFocusIds,
    ...verifiedCompletedFocusIds
  ]);
  return {
    generatedAt: hasVerifiedSchema ? (raw.generatedAt || null) : null,
    completedFocusIds: seededCompletedFocusIds,
    verifiedCompletedFocusIds,
    benchmarkMetrics: loadBenchmarkMetrics(raw?.benchmarkMetrics),
    envCompletedFocusIds: seededEnvCompletedFocusIds,
    discardedLegacyCompletedFocusIds: legacyCompletedFocusIds,
    noProgressStreak: Number(raw?.noProgressStreak || 0),
    recoverableInfraRetries: Number(raw?.recoverableInfraRetries || 0),
    lastIteration: Number(raw?.lastIteration || 0)
  };
}

function saveProgressState(next) {
  const rawCompletedFocusIds = Array.isArray(next?.completedFocusIds) ? next.completedFocusIds : [];
  const rawVerifiedCompletedFocusIds = Array.isArray(next?.verifiedCompletedFocusIds) ? next.verifiedCompletedFocusIds : [];
  const envCompletedFocusIds = Array.isArray(next?.envCompletedFocusIds) ? next.envCompletedFocusIds : [];
  const verifiedCompletedFocusIds = normalizeCompletedFocusIds(rawVerifiedCompletedFocusIds);
  const seededEnvCompletedFocusIds = verifiedCompletedFocusIds.length > 0
    ? filterFocusIdsByTrustedSet(envCompletedFocusIds, verifiedCompletedFocusIds)
    : normalizeCompletedFocusIds(envCompletedFocusIds);
  const completedFocusIds = normalizeCompletedFocusIds([
    ...seededEnvCompletedFocusIds,
    ...rawCompletedFocusIds,
    ...verifiedCompletedFocusIds
  ]);
  const payload = {
    noProgressStreak: 0,
    recoverableInfraRetries: 0,
    lastIteration: 0,
    ...next,
    generatedAt: new Date().toISOString(),
    completedFocusIds,
    verifiedCompletedFocusIds,
    benchmarkMetrics: loadBenchmarkMetrics(next?.benchmarkMetrics),
    envCompletedFocusIds: seededEnvCompletedFocusIds,
    discardedLegacyCompletedFocusIds: []
  };
  writeJson(PROGRESS_STATE_PATH, payload);
  return payload;
}

function extractMergedFocusIds(patchQueue) {
  return extractVerifiedFocusIdsFromPatchQueue(patchQueue);
}

function classifyIteration({ blocker = null, progressDelta = [], freshProgressDetected = false, spawnError = null, workspaceError = null, retryClass = null }) {
  const text = String([blocker?.blocker, spawnError, workspaceError].filter(Boolean).join(' ')).toLowerCase();
  if (progressDelta.length > 0 || freshProgressDetected) return 'partial_progress';
  if (retryClass === 'terminal_green_without_fresh_progress') return 'no_progress';
  if (text.includes('partial parity-surface reduction')) return 'no_progress';
  if (text.includes('no parity-surface reduction')) return 'no_progress';
  if (
    text.includes('workspace refresh failed') ||
    text.includes('failed to prepare disposable worktree') ||
    text.includes('not a working tree') ||
    text.includes('heartbeat went stale') ||
    text.includes('state loss')
  ) return 'recoverable_infra';
  return blocker ? 'hard_blocker' : 'none';
}

function appendLog(text) {
  ensureDir(path.dirname(LOG_PATH));
  fs.appendFileSync(LOG_PATH, text);
}

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 200, ...opts });
}

function baselineHead() {
  const rev = run('git', ['-C', ROOT, 'rev-parse', 'HEAD']);
  return rev.status === 0 ? String(rev.stdout || '').trim() : null;
}

function filesystemInodes(targetPath = REMOTE_BASE) {
  const result = run('df', ['-Pi', targetPath], { timeout: 30_000 });
  if (result.status !== 0 || result.error) {
    return { ok: false, path: targetPath, error: String(result.stderr || result.stdout || result.error?.message || 'df failed').trim() };
  }
  const line = String(result.stdout || '').trim().split(/\r?\n/).at(-1) || '';
  const parts = line.trim().split(/\s+/);
  const inodes = Number(parts[1]);
  const used = Number(parts[2]);
  const free = Number(parts[3]);
  const usePercent = String(parts[4] || '').trim();
  return { ok: Number.isFinite(free), path: targetPath, filesystem: parts[0] || null, inodes, used, free, usePercent, raw: line };
}

function listDisposableWorktrees() {
  try {
    return fs.readdirSync(REMOTE_BASE, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('mailchimp-worktree-'))
      .map((entry) => {
        const fullPath = path.join(REMOTE_BASE, entry.name);
        let mtimeMs = 0;
        try { mtimeMs = fs.statSync(fullPath).mtimeMs; } catch {}
        return { fullPath, name: entry.name, mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
  } catch {
    return [];
  }
}

function cleanupStaleDisposableWorktrees({ retain = STALE_WORKTREE_RETENTION_COUNT, minAgeMs = STALE_WORKTREE_MIN_AGE_MS } = {}) {
  const now = Date.now();
  const worktrees = listDisposableWorktrees();
  const kept = [];
  const removed = [];
  for (let index = 0; index < worktrees.length; index += 1) {
    const entry = worktrees[index];
    if (entry.fullPath === WORKTREE_PATH || index < retain || now - entry.mtimeMs < minAgeMs) {
      kept.push(entry.fullPath);
      continue;
    }
    try {
      fs.rmSync(entry.fullPath, { recursive: true, force: true });
      removed.push(entry.fullPath);
    } catch (error) {
      appendLog(`\n[stale-worktree-cleanup-error] ${entry.fullPath}: ${String(error?.message || error)}\n`);
    }
  }
  const prune = run('git', ['-C', ROOT, 'worktree', 'prune'], { timeout: 120_000 });
  appendLog(`\n===== stale disposable worktree cleanup =====\n${JSON.stringify({ found: worktrees.length, retained: kept.length, removed: removed.length, retain, minAgeMs, inodeState: filesystemInodes() }, null, 2)}\n${prune.stdout || ''}${prune.stderr || ''}${prune.error ? `\n[spawn-error] ${String(prune.error.message || prune.error)}` : ''}`);
  return { found: worktrees.length, retained: kept.length, removed: removed.length };
}

function assertWorktreeInodeCapacity() {
  const inodeState = filesystemInodes();
  if (inodeState.ok && inodeState.free >= MIN_FREE_INODES_FOR_WORKTREE) return inodeState;
  throw new Error(`Insufficient free inodes for disposable worktree creation: free=${inodeState.free ?? 'unknown'}, required>=${MIN_FREE_INODES_FOR_WORKTREE}, filesystem=${inodeState.filesystem || 'unknown'}, use=${inodeState.usePercent || 'unknown'}`);
}

function removePriorWorktree() {
  const remove = run('git', ['-C', ROOT, 'worktree', 'remove', '--force', WORKTREE_PATH], { timeout: 120_000 });
  appendLog(`===== git worktree remove =====\n${remove.stdout || ''}${remove.stderr || ''}${remove.error ? `\n[spawn-error] ${String(remove.error.message || remove.error)}` : ''}`);
  fs.rmSync(WORKTREE_PATH, { recursive: true, force: true });
}

function collectBaselineOverlayRecords() {
  const status = run('git', ['-C', ROOT, 'status', '--porcelain', '-uall', '--', ...OVERLAY_PATHSPECS], { timeout: 120_000 });
  appendLog(`\n===== baseline overlay status =====\n${status.stdout || ''}${status.stderr || ''}${status.error ? `\n[spawn-error] ${String(status.error.message || status.error)}` : ''}`);
  if (status.status !== 0 || status.error) {
    throw new Error(`Failed to collect baseline overlay status: ${(status.stderr || status.stdout || status.error?.message || 'unknown git status failure').trim()}`);
  }
  return parsePorcelainStatus(String(status.stdout || ''));
}

function applyBaselineOverlayToWorktree() {
  const records = collectBaselineOverlayRecords();
  const operations = [];
  for (const record of records) {
    if (!record?.path) continue;
    const targetPath = path.join(WORKTREE_PATH, record.path);
    if (record.fromPath && record.fromPath !== record.path) {
      fs.rmSync(path.join(WORKTREE_PATH, record.fromPath), { recursive: true, force: true });
      operations.push({ type: 'remove_renamed_source', fromPath: record.fromPath });
    }
    if (statusRepresentsDeletion(record.status)) {
      fs.rmSync(targetPath, { recursive: true, force: true });
      operations.push({ type: 'delete', path: record.path, status: record.status });
      continue;
    }
    const sourcePath = path.join(ROOT, record.path);
    if (!fs.existsSync(sourcePath)) {
      operations.push({ type: 'skip_missing_source', path: record.path, status: record.status });
      continue;
    }
    ensureDir(path.dirname(targetPath));
    fs.cpSync(sourcePath, targetPath, { recursive: true, force: true });
    operations.push({ type: 'copy', path: record.path, status: record.status });
  }
  const manifest = {
    generatedAt: new Date().toISOString(),
    runId: RUN_ID,
    baselineRepo: ROOT,
    worktreePath: WORKTREE_PATH,
    recordCount: records.length,
    operations
  };
  writeJson(BASELINE_OVERLAY_PATH, manifest);
  return manifest;
}

function ensureWorktreeDependencyLink(name, sourcePath = path.join(ROOT, name)) {
  const targetPath = path.join(WORKTREE_PATH, name);
  ensureDir(sourcePath);
  try {
    const stat = fs.lstatSync(targetPath);
    if (stat.isSymbolicLink() && fs.realpathSync(targetPath) === fs.realpathSync(sourcePath)) {
      return { name, linked: true, reused: true, sourcePath, targetPath };
    }
    return { name, linked: false, reason: 'target_exists', sourcePath, targetPath };
  } catch {}
  ensureDir(path.dirname(targetPath));
  fs.symlinkSync(sourcePath, targetPath, 'dir');
  return { name, linked: true, reused: false, sourcePath, targetPath };
}

function linkWorktreeDependencies() {
  const links = [
    ensureWorktreeDependencyLink('node_modules'),
    ensureWorktreeDependencyLink('artifacts', ARTIFACT_ROOT)
  ];
  const manifest = {
    generatedAt: new Date().toISOString(),
    runId: RUN_ID,
    baselineRepo: ROOT,
    worktreePath: WORKTREE_PATH,
    links
  };
  writeJson(DEPENDENCY_LINKS_PATH, manifest);
  appendLog(`\n===== worktree dependency links =====\n${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

function mirrorStrictGapInventoryIntoArtifactRoot() {
  if (!fs.existsSync(STRICT_GAP_INVENTORY_SOURCE_PATH)) return null;
  ensureDir(path.dirname(STRICT_GAP_INVENTORY_DEST_PATH));
  fs.copyFileSync(STRICT_GAP_INVENTORY_SOURCE_PATH, STRICT_GAP_INVENTORY_DEST_PATH);
  const manifest = {
    generatedAt: new Date().toISOString(),
    runId: RUN_ID,
    sourcePath: STRICT_GAP_INVENTORY_SOURCE_PATH,
    destinationPath: STRICT_GAP_INVENTORY_DEST_PATH
  };
  appendLog(`\n===== strict gap inventory mirror =====\n${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

function mirrorBenchmarkContractIntoArtifactRoot() {
  if (!fs.existsSync(BENCHMARK_CONTRACT_SOURCE_PATH)) {
    if (String(process.env.MAILCHIMP_USE_BENCHMARK_SCOPE || '').trim() === '1') {
      throw new Error(`Benchmark scope is enabled but the benchmark contract is missing at ${BENCHMARK_CONTRACT_SOURCE_PATH}`);
    }
    return null;
  }
  ensureDir(path.dirname(BENCHMARK_CONTRACT_DEST_PATH));
  fs.copyFileSync(BENCHMARK_CONTRACT_SOURCE_PATH, BENCHMARK_CONTRACT_DEST_PATH);
  const manifest = {
    generatedAt: new Date().toISOString(),
    runId: RUN_ID,
    sourcePath: BENCHMARK_CONTRACT_SOURCE_PATH,
    destinationPath: BENCHMARK_CONTRACT_DEST_PATH
  };
  appendLog(`\n===== benchmark contract mirror =====\n${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

function prepareIterationWorkspace(iteration) {
  appendLog(`\n===== iteration ${iteration} workspace refresh =====\n`);
  removePriorWorktree();
  cleanupStaleDisposableWorktrees();
  assertWorktreeInodeCapacity();
  const worktree = run('git', ['-C', ROOT, 'worktree', 'add', '--detach', WORKTREE_PATH, 'HEAD']);
  if (worktree.status !== 0) {
    throw new Error(String(worktree.stderr || worktree.stdout || 'failed to create disposable worktree'));
  }
  const baselineOverlay = applyBaselineOverlayToWorktree();
  mirrorStrictGapInventoryIntoArtifactRoot();
  mirrorBenchmarkContractIntoArtifactRoot();
  const dependencyLinks = linkWorktreeDependencies();
  return { baselineOverlay, dependencyLinks };
}

function writeCanonicalArtifacts({ iteration, parityFocusIssuesPresent, parityFocusAssignmentsObserved }) {
  const campaignState = readJson(path.join(ARTIFACT_ROOT, 'campaign_state.json'), null);
  const programState = readJson(path.join(ARTIFACT_ROOT, 'program_state.json'), null);
  const completionSummary = readJson(path.join(ARTIFACT_ROOT, 'completion_summary.json'), null);
  const blockerReport = readJson(path.join(ARTIFACT_ROOT, 'blocker_report.json'), null);
  const blocker = resolveCampaignBlocker({ completionSummary, programState, campaignState, blockerReport });
  const { supervisorStatus, matrixStatus, parityStatus } = deriveCanonicalStatuses({ completionSummary, programState, campaignState, blocker });
  const canonicalSummary = {
    generatedAt: new Date().toISOString(),
    runId: RUN_ID,
    iteration,
    implementationProfile: process.env.ORCHESTRATOR_IMPLEMENTATION_PROFILE || null,
    implementationScript: process.env.ORCHESTRATOR_IMPLEMENTATION_SCRIPT || null,
    baselineRepo: ROOT,
    worktreePath: WORKTREE_PATH,
    artifactRoot: ARTIFACT_ROOT,
    supervisorStatus,
    matrixStatus,
    parityStatus,
    blocker,
    nextFocus: completionSummary?.nextFocus || [],
    launchChecklistPath: completionSummary?.launchChecklistPath || path.join(ARTIFACT_ROOT, 'launch_checklist.json'),
    locAccountingPath: completionSummary?.locAccountingPath || path.join(ARTIFACT_ROOT, 'loc_accounting.json'),
    locAccountingSummary: completionSummary?.locAccountingSummary || null,
    provenCoordinationScaleTier: completionSummary?.provenCoordinationScaleTier || programState?.provenCoordinationScaleTier || null,
    stopReason: completionSummary?.stopReason || campaignState?.stopReason || null,
    stopAllowed: Boolean(campaignState?.stopAllowed || blocker),
    parityFocusIssuesPresent,
    parityFocusAssignmentsObserved
  };
  writeJson(CANONICAL_SUMMARY_PATH, canonicalSummary);
  writeJson(NOTIFIER_ELIGIBILITY_PATH, buildNotifierEligibilityPayload({
    runId: RUN_ID,
    supervisorStatus,
    matrixStatus,
    blocker,
    generatedAt: canonicalSummary.generatedAt
  }));
}

function collectArtifactStates() {
  const states = [];
  for (const artifactPath of HEARTBEAT_ARTIFACTS) {
    try {
      const stat = fs.statSync(artifactPath);
      states.push({
        path: path.relative(ARTIFACT_ROOT, artifactPath),
        exists: true,
        size: stat.size,
        mtimeMs: stat.mtimeMs
      });
    } catch {
      states.push({ path: path.relative(ARTIFACT_ROOT, artifactPath), exists: false, size: 0, mtimeMs: null });
    }
  }
  const liveRunsPath = path.join(ARTIFACT_ROOT, 'live_runs');
  try {
    const entries = fs.readdirSync(liveRunsPath, { withFileTypes: true });
    const directories = entries.filter((entry) => entry.isDirectory()).length;
    const stat = fs.statSync(liveRunsPath);
    states.push({ path: 'live_runs', exists: true, size: directories, mtimeMs: stat.mtimeMs });
  } catch {
    states.push({ path: 'live_runs', exists: false, size: 0, mtimeMs: null });
  }
  return states;
}

function collectProcessEntries(rootPid) {
  if (!rootPid) return [];
  const ps = run('ps', ['-eo', 'pid=,ppid=,etime=,%cpu=,%mem=,stat=,command='], { timeout: 20_000 });
  if (ps.status !== 0 || ps.error) return [];
  const rows = String(ps.stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+)\s+(\d+)\s+(\S+)\s+([\d.]+)\s+([\d.]+)\s+(\S+)\s+(.*)$/);
      if (!match) return null;
      return {
        pid: Number(match[1]),
        ppid: Number(match[2]),
        etime: match[3],
        cpu: Number(match[4]),
        mem: Number(match[5]),
        stat: match[6],
        command: match[7]
      };
    })
    .filter(Boolean);
  const byParent = new Map();
  for (const row of rows) {
    const list = byParent.get(row.ppid) || [];
    list.push(row);
    byParent.set(row.ppid, list);
  }
  const rootRow = rows.find((row) => row.pid === rootPid);
  if (!rootRow) return [];
  const collected = [];
  const queue = [rootRow];
  const seen = new Set();
  while (queue.length) {
    const current = queue.shift();
    if (!current || seen.has(current.pid)) continue;
    seen.add(current.pid);
    collected.push(current);
    for (const child of byParent.get(current.pid) || []) queue.push(child);
  }
  return collected;
}

function buildRunningStatus({ iteration, iterationStartedAt, childPid, iterationResults, baselineOverlay, dependencyLinks, lastOutputAt }) {
  const artifactStates = collectArtifactStates();
  const processEntries = collectProcessEntries(childPid);
  const heartbeat = buildHeartbeatSummary({
    now: Date.now(),
    startedAt: iterationStartedAt,
    lastOutputAt,
    artifactStates,
    processEntries
  });
  return {
    generatedAt: new Date().toISOString(),
    running: true,
    runId: RUN_ID,
    host: os.hostname(),
    hostRole: process.env.MAILCHIMP_HOST_ROLE,
    baselineRepo: ROOT,
    worktreePath: WORKTREE_PATH,
    artifactRoot: ARTIFACT_ROOT,
    activeIteration: iteration,
    childPid,
    heartbeatAt: new Date().toISOString(),
    heartbeat,
    artifactStates,
    processEntries,
    iterations: iterationResults,
    baselineOverlay,
    dependencyLinks,
    note: 'Remote execution runner is advancing the Mailchimp persistent campaign on the execution plane.'
  };
}

let lastStatusPayload = null;
let terminalStatusWritten = false;
let lifecycleSnapshot = {
  iteration: 0,
  childPid: null,
  lastOutputAt: null,
  baselineOverlay: null,
  dependencyLinks: null,
  iterationResults: []
};

function writeExecutionStatus(payload) {
  lastStatusPayload = payload;
  writeJson(STATUS_PATH, payload);
  return payload;
}

function updateLifecycleSnapshot(updates = {}) {
  lifecycleSnapshot = {
    ...lifecycleSnapshot,
    ...updates,
    iterationResults: Array.isArray(updates.iterationResults)
      ? updates.iterationResults
      : lifecycleSnapshot.iterationResults
  };
}

function buildTerminalStatus({
  ok = false,
  phase = ok ? 'remote_execution_finished' : 'remote_execution_failed',
  note = null,
  exitCode = ok ? 0 : 1,
  signal = null,
  error = null,
  blocker = null,
  statusSource = 'remote_runner_terminalizer'
} = {}) {
  const base = lastStatusPayload && typeof lastStatusPayload === 'object' ? lastStatusPayload : {};
  const finishedAt = new Date().toISOString();
  return {
    generatedAt: finishedAt,
    running: false,
    terminal: true,
    ok,
    phase,
    statusSource,
    runId: RUN_ID,
    host: os.hostname(),
    hostRole: process.env.MAILCHIMP_HOST_ROLE,
    baselineRepo: ROOT,
    worktreePath: WORKTREE_PATH,
    artifactRoot: ARTIFACT_ROOT,
    activeIteration: lifecycleSnapshot.iteration || base.activeIteration || null,
    childPid: lifecycleSnapshot.childPid || base.childPid || null,
    heartbeatAt: finishedAt,
    finishedAt,
    lastOutputAt: lifecycleSnapshot.lastOutputAt || base.heartbeatAt || null,
    artifactStates: collectArtifactStates(),
    processEntries: collectProcessEntries(lifecycleSnapshot.childPid || base.childPid || null),
    iterations: lifecycleSnapshot.iterationResults || base.iterations || [],
    baselineOverlay: lifecycleSnapshot.baselineOverlay || base.baselineOverlay || null,
    dependencyLinks: lifecycleSnapshot.dependencyLinks || base.dependencyLinks || null,
    exitCode,
    signal,
    error: error ? String(error instanceof Error ? error.stack || error.message : error) : null,
    blocker: blocker || null,
    note: note || (ok
      ? 'Remote execution runner persisted a terminal completion record.'
      : 'Remote execution runner persisted a terminal failure record.')
  };
}

function persistTerminalStatus(options = {}) {
  if (terminalStatusWritten) return lastStatusPayload;
  const payload = buildTerminalStatus(options);
  terminalStatusWritten = true;
  lastStatusPayload = payload;
  writeJson(STATUS_PATH, payload);
  writeJson(TERMINAL_STATUS_PATH, payload);
  return payload;
}

function installTerminalPersistenceHooks() {
  const handleSignal = (signal) => {
    appendLog(`\n[terminal-signal] ${signal}\n`);
    persistTerminalStatus({
      ok: false,
      phase: 'remote_execution_interrupted',
      signal,
      exitCode: SIGNAL_EXIT_CODES[signal] || 1,
      note: `Remote execution runner received ${signal} and wrote a terminal receipt before exiting.`
    });
    process.exit(SIGNAL_EXIT_CODES[signal] || 1);
  };
  process.once('SIGINT', () => handleSignal('SIGINT'));
  process.once('SIGTERM', () => handleSignal('SIGTERM'));
  process.once('uncaughtException', (error) => {
    appendLog(`\n[uncaughtException]\n${String(error?.stack || error?.message || error)}\n`);
    persistTerminalStatus({
      ok: false,
      phase: 'remote_execution_failed',
      error,
      exitCode: 1,
      note: 'Remote execution runner hit an uncaught exception and wrote a terminal receipt before exiting.'
    });
    process.exit(1);
  });
  process.once('unhandledRejection', (error) => {
    appendLog(`\n[unhandledRejection]\n${String(error?.stack || error?.message || error)}\n`);
    persistTerminalStatus({
      ok: false,
      phase: 'remote_execution_failed',
      error,
      exitCode: 1,
      note: 'Remote execution runner hit an unhandled rejection and wrote a terminal receipt before exiting.'
    });
    process.exit(1);
  });
}

async function runIteration({ iteration, iterationResults, baselineOverlay, dependencyLinks, progressState }) {
  const iterationStartedAt = new Date().toISOString();
  const iterationEnv = {
    MAILCHIMP_REMOTE_EXECUTION_CONTEXT: '1',
    MAILCHIMP_FULL_AUDIT_RUN_ID: RUN_ID,
    MAILCHIMP_ORCHESTRATOR_ARTIFACT_ROOT: ARTIFACT_ROOT,
    MAILCHIMP_COMPLETED_FOCUS_IDS: Array.isArray(progressState?.completedFocusIds) ? progressState.completedFocusIds.join(',') : '',
    ORCHESTRATOR_IMPLEMENTATION_SCRIPT: process.env.ORCHESTRATOR_IMPLEMENTATION_SCRIPT || path.join(WORKTREE_PATH, 'scripts', 'orchestrator-real-repo-clean-implement.mjs'),
    ORCHESTRATOR_RESUME_CAMPAIGN: iteration > 1 ? '1' : '0'
  };
  if (process.env.MAILCHIMP_USE_BENCHMARK_SCOPE) iterationEnv.MAILCHIMP_USE_BENCHMARK_SCOPE = process.env.MAILCHIMP_USE_BENCHMARK_SCOPE;
  if (process.env.MAILCHIMP_ONE_PASS_CONTRACT_PATH) iterationEnv.MAILCHIMP_ONE_PASS_CONTRACT_PATH = process.env.MAILCHIMP_ONE_PASS_CONTRACT_PATH;
  if (process.env.ORCHESTRATOR_IMPLEMENTATION_PROFILE) iterationEnv.ORCHESTRATOR_IMPLEMENTATION_PROFILE = process.env.ORCHESTRATOR_IMPLEMENTATION_PROFILE;
  if (process.env.ORCHESTRATOR_TIERS) iterationEnv.ORCHESTRATOR_TIERS = process.env.ORCHESTRATOR_TIERS;
  if (process.env.ORCHESTRATOR_REQUESTED_FIDELITY) iterationEnv.ORCHESTRATOR_REQUESTED_FIDELITY = process.env.ORCHESTRATOR_REQUESTED_FIDELITY;
  if (process.env.MAILCHIMP_PRODUCT_ONLY) iterationEnv.MAILCHIMP_PRODUCT_ONLY = process.env.MAILCHIMP_PRODUCT_ONLY;
  if (process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY) iterationEnv.MAILCHIMP_USE_STRICT_GAP_INVENTORY = process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY;
  if (process.env.MAILCHIMP_STRICT_GAP_SEQUENCE) iterationEnv.MAILCHIMP_STRICT_GAP_SEQUENCE = process.env.MAILCHIMP_STRICT_GAP_SEQUENCE;
  writeJson(ITERATION_LAUNCH_ENV_PATH, {
    generatedAt: new Date().toISOString(),
    runId: RUN_ID,
    iteration,
    worktreePath: WORKTREE_PATH,
    strictGapInventorySourcePath: STRICT_GAP_INVENTORY_SOURCE_PATH,
    strictGapInventorySourceExists: fs.existsSync(STRICT_GAP_INVENTORY_SOURCE_PATH),
    strictGapInventoryDestPath: STRICT_GAP_INVENTORY_DEST_PATH,
    strictGapInventoryDestExists: fs.existsSync(STRICT_GAP_INVENTORY_DEST_PATH),
    benchmarkContractSourcePath: BENCHMARK_CONTRACT_SOURCE_PATH,
    benchmarkContractSourceExists: fs.existsSync(BENCHMARK_CONTRACT_SOURCE_PATH),
    benchmarkContractDestPath: BENCHMARK_CONTRACT_DEST_PATH,
    benchmarkContractDestExists: fs.existsSync(BENCHMARK_CONTRACT_DEST_PATH),
    env: iterationEnv
  });
  const child = spawn(process.execPath, [DELEGATE_SCRIPT], {
    cwd: WORKTREE_PATH,
    env: {
      ...process.env,
      ...iterationEnv
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let lastOutputAt = iterationStartedAt;
  let heartbeatCount = 0;
  updateLifecycleSnapshot({ iteration, childPid: child.pid, baselineOverlay, dependencyLinks, iterationResults, lastOutputAt });

  const onChunk = (chunk) => {
    lastOutputAt = new Date().toISOString();
    updateLifecycleSnapshot({ lastOutputAt });
    appendLog(String(chunk));
  };
  child.stdout.on('data', onChunk);
  child.stderr.on('data', onChunk);

  const heartbeatTimer = setInterval(() => {
    const payload = buildRunningStatus({ iteration, iterationStartedAt, childPid: child.pid, iterationResults, baselineOverlay, dependencyLinks, lastOutputAt });
    writeExecutionStatus(payload);
    heartbeatCount += 1;
    if (heartbeatCount % 2 === 0) {
      appendLog(`\n[heartbeat] iteration=${iteration} currentTest=${payload.heartbeat.currentTestHint || 'unknown'} staleForSec=${payload.heartbeat.staleForSec ?? 'n/a'} runningForSec=${payload.heartbeat.runningForSec ?? 'n/a'}\n`);
    }
  }, HEARTBEAT_MS);

  const result = await new Promise((resolve) => {
    let settled = false;
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      resolve({ status: 1, signal: null, error });
    });
    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      resolve({ status: code ?? 0, signal, error: null });
    });
  });

  clearInterval(heartbeatTimer);
  updateLifecycleSnapshot({ childPid: null, lastOutputAt });
  const finalHeartbeat = buildRunningStatus({ iteration, iterationStartedAt, childPid: child.pid, iterationResults, baselineOverlay, dependencyLinks, lastOutputAt });
  writeExecutionStatus(finalHeartbeat);
  if (result.error) appendLog(`\n[spawn-error] ${String(result.error.message || result.error)}\n`);
  return { ...result, childPid: child.pid, heartbeat: finalHeartbeat.heartbeat };
}

process.env.MAILCHIMP_REMOTE_EXECUTION_CONTEXT = '1';
process.env.MAILCHIMP_HOST_ROLE ||= 'execution_plane';
fs.rmSync(LOG_PATH, { force: true });
fs.rmSync(RUN_ROOT, { recursive: true, force: true });
rmIfExists(TERMINAL_STATUS_PATH);
removePriorWorktree();
ensureDir(RUN_ROOT);
installTerminalPersistenceHooks();

writeExecutionStatus({
  generatedAt: new Date().toISOString(),
  running: true,
  runId: RUN_ID,
  host: os.hostname(),
  hostRole: process.env.MAILCHIMP_HOST_ROLE,
  baselineRepo: ROOT,
  worktreePath: WORKTREE_PATH,
  artifactRoot: ARTIFACT_ROOT,
  heartbeatAt: new Date().toISOString(),
  note: 'Remote execution runner started on the execution plane with a disposable worktree.'
});
writeJson(BASELINE_COMMIT_PATH, { generatedAt: new Date().toISOString(), runId: RUN_ID, baselineRepo: ROOT, baselineCommit: baselineHead() });
writeJson(WORKTREE_MANIFEST_PATH, { generatedAt: new Date().toISOString(), runId: RUN_ID, baselineRepo: ROOT, worktreePath: WORKTREE_PATH, artifactRoot: ARTIFACT_ROOT });
writeJson(IMPLEMENTATION_MODE_STATUS_PATH, {
  generatedAt: new Date().toISOString(),
  runId: RUN_ID,
  implementationProfile: process.env.ORCHESTRATOR_IMPLEMENTATION_PROFILE,
  implementationScript: process.env.ORCHESTRATOR_IMPLEMENTATION_SCRIPT || null,
  parityFocusIssuesPresent: null,
  parityFocusAssignmentsObserved: false,
  baselineRepo: ROOT,
  worktreePath: WORKTREE_PATH,
  artifactRoot: ARTIFACT_ROOT,
  note: 'Implementation mode proof will be updated after work graph generation.'
});

let baselineOverlay = null;
let dependencyLinks = null;
try {
  ({ baselineOverlay, dependencyLinks } = prepareIterationWorkspace(0));
  updateLifecycleSnapshot({ baselineOverlay, dependencyLinks });
} catch (error) {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  appendLog(`\n===== worktree hydration failure =====\n${message}\n`);
  persistTerminalStatus({
    ok: false,
    phase: 'remote_execution_failed',
    error,
    exitCode: 1,
    note: 'Failed to prepare the disposable worktree before the first iteration.'
  });
  process.exit(1);
}

const iterationResults = [];
let finalExitCode = 1;
let finalSignal = null;
let finalSpawnError = null;
let finalOk = false;
let continuationDetected = false;
let lastHeartbeat = null;
let progressState = loadProgressState();

for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration += 1) {
  appendLog(`\n===== remote runner iteration ${iteration} =====\n`);
  clearIterationEphemeralArtifacts();
  try {
    ({ baselineOverlay, dependencyLinks } = prepareIterationWorkspace(iteration));
    updateLifecycleSnapshot({ iteration, baselineOverlay, dependencyLinks, iterationResults });
  } catch (error) {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    appendLog(`\n===== iteration ${iteration} workspace refresh failed =====\n${message}\n`);
    iterationResults.push({
      iteration,
      ok: false,
      remoteExecutionStatus: 'workspace_refresh_failed',
      exitCode: 1,
      signal: null,
      baselineOverlay,
      dependencyLinks,
      error: message,
      summary: null,
      dirtyFiles: [],
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString()
    });
    finalExitCode = 1;
    break;
  }
  const result = await runIteration({ iteration, iterationResults, baselineOverlay, dependencyLinks, progressState });
  const workGraph = readJson(path.join(ARTIFACT_ROOT, 'work_graph.json'), null);
  const liveRunsDir = path.join(ARTIFACT_ROOT, 'live_runs');
  const liveExecutionSummaryForMode = readJson(path.join(ARTIFACT_ROOT, 'live_execution_summary.json'), null);
  const patchQueueForMode = readJson(path.join(ARTIFACT_ROOT, 'patch_queue_report.json'), { merged: [] });
  const plannedFocusWorkUnitIds = resolvePlannedFocusWorkUnitIds(workGraph);
  const parityFocusPlanned = plannedFocusWorkUnitIds.length > 0;
  const parityFocusAssignmentsObserved = (fs.existsSync(liveRunsDir)
    ? fs.readdirSync(liveRunsDir, { withFileTypes: true }).some((entry) => entry.isDirectory())
    : false)
    || hasSelectedTierLiveWork(liveExecutionSummaryForMode)
    || extractMergedFocusIds(patchQueueForMode).length > 0;
  const parityFocusIssuesPresent = parityFocusPlanned && !parityFocusAssignmentsObserved;
  writeJson(IMPLEMENTATION_MODE_STATUS_PATH, {
    generatedAt: new Date().toISOString(),
    runId: RUN_ID,
    implementationProfile: process.env.ORCHESTRATOR_IMPLEMENTATION_PROFILE,
    implementationScript: process.env.ORCHESTRATOR_IMPLEMENTATION_SCRIPT || null,
    parityFocusIssuesPresent,
    parityFocusAssignmentsObserved,
    plannedFocusWorkUnitIds,
    baselineRepo: ROOT,
    worktreePath: WORKTREE_PATH,
    artifactRoot: ARTIFACT_ROOT,
    activeIteration: iteration
  });
  writeCanonicalArtifacts({ iteration, parityFocusIssuesPresent, parityFocusAssignmentsObserved });

  const campaignState = readJson(path.join(ARTIFACT_ROOT, 'campaign_state.json'), null);
  const programState = readJson(path.join(ARTIFACT_ROOT, 'program_state.json'), null);
  const completionSummary = readJson(path.join(ARTIFACT_ROOT, 'completion_summary.json'), null);
  const blockerReport = readJson(path.join(ARTIFACT_ROOT, 'blocker_report.json'), null);
  const blocker = resolveCampaignBlocker({ completionSummary, programState, campaignState, blockerReport });
  const liveExecutionSummary = readJson(path.join(ARTIFACT_ROOT, 'live_execution_summary.json'), null);
  const patchQueueReport = readJson(path.join(ARTIFACT_ROOT, 'patch_queue_report.json'), { merged: [] });
  const selectedTierHadLiveWork = hasSelectedTierLiveWork(liveExecutionSummary);
  const patchQueueFocusIds = extractMergedFocusIds(patchQueueReport);
  const trustedPatchQueueFocusIds = extractVerifiedFocusIdsFromPatchQueue(patchQueueReport);
  const targetedTestCandidateFocusIds = selectedTierHadLiveWork
    && /no parity-surface reduction was proven by this iteration|partial parity-surface reduction was proven/i.test(blockerText(blocker))
    ? trustedPatchQueueFocusIds.filter((focusId) => !progressState.completedFocusIds.includes(focusId))
    : [];
  const targetedTestVerifiedFocusIds = targetedTestCandidateFocusIds.length > 0
    ? verifyFocusIdsByTargetedTests(targetedTestCandidateFocusIds)
    : [];
  const mergedFocusIds = creditableFocusIdsForIteration({
    selectedTierHadLiveWork,
    blocker,
    patchQueueFocusIds: trustedPatchQueueFocusIds,
    targetedTestVerifiedFocusIds,
    liveExecutionSummary
  });
  const progressDelta = selectedTierHadLiveWork
    ? mergedFocusIds.filter((id) => !progressState.completedFocusIds.includes(id))
    : [];
  const workspaceDiff = typeof result.workspaceDiff === 'string' ? result.workspaceDiff : '';
  const freshProgressDetected = Boolean(workspaceDiff.trim())
    || (selectedTierHadLiveWork && progressDelta.length > 0);
  const retryClass = campaignState?.stopAllowed && !blocker && !freshProgressDetected
    ? 'terminal_green_without_fresh_progress'
    : null;
  const preserveLiveWorkBlocker = selectedTierHadLiveWork && isNoParityReductionBlocker(blocker);
  const statuses = deriveCanonicalStatuses({ completionSummary, programState, campaignState, blocker });
  const greenCompletionReached = !blocker
    && freshProgressDetected
    && statuses.supervisorStatus === 'green'
    && statuses.matrixStatus === 'all_complete';
  const benchmarkMetrics = accumulateBenchmarkMetrics({
    benchmarkMetrics: progressState.benchmarkMetrics,
    patchQueueReport,
    liveExecutionSummary,
    locAccounting: readJson(path.join(ARTIFACT_ROOT, 'loc_accounting.json'), null) || completionSummary?.locAccountingSummary,
    blocker,
    freshProgressDetected
  });
  const shouldRequeue = blocker
    ? false
    : retryClass === 'terminal_green_without_fresh_progress'
      ? true
      : preserveLiveWorkBlocker
        ? false
        : Boolean(campaignState?.worker?.shouldRequeue || result.continuationDetected);
  const iterationRecord = {
    iteration,
    exitCode: result.status,
    signal: result.signal,
    spawnError: result.error ? String(result.error.message || result.error) : null,
    stopAllowed: Boolean(campaignState?.stopAllowed || blocker),
    stopReason: retryClass === 'terminal_green_without_fresh_progress'
      ? 'supervisor_green_without_fresh_progress'
      : (campaignState?.stopReason || blocker?.blocker || null),
    shouldRequeue,
    queuedIterations: campaignState?.worker?.queuedIterations?.length || 0,
    selectedTierHadLiveWork,
    preserveLiveWorkBlocker,
    greenCompletionReached,
    supervisorStatus: statuses.supervisorStatus,
    matrixStatus: statuses.matrixStatus,
    blocker,
    highestPassingTier: completionSummary?.provenCoordinationScaleTier || programState?.provenCoordinationScaleTier || null,
    parityFocusIssuesPresent,
    parityFocusAssignmentsObserved,
    freshProgressDetected,
    heartbeat: result.heartbeat,
    childPid: result.childPid
  };
  iterationResults.push(iterationRecord);
  lastHeartbeat = result.heartbeat;
  updateLifecycleSnapshot({ iterationResults, baselineOverlay, dependencyLinks, lastOutputAt: result.heartbeat?.lastProgressAt || lifecycleSnapshot.lastOutputAt });
  writeExecutionStatus({
    generatedAt: new Date().toISOString(),
    running: true,
    runId: RUN_ID,
    host: os.hostname(),
    hostRole: process.env.MAILCHIMP_HOST_ROLE,
    baselineRepo: ROOT,
    worktreePath: WORKTREE_PATH,
    artifactRoot: ARTIFACT_ROOT,
    activeIteration: iteration,
    heartbeatAt: new Date().toISOString(),
    heartbeat: result.heartbeat,
    iterations: iterationResults,
    baselineOverlay,
    dependencyLinks,
    note: 'Remote execution runner is advancing the Mailchimp persistent campaign on the execution plane.'
  });

  finalExitCode = result.status || 0;
  finalSignal = result.signal;
  finalSpawnError = result.error ? String(result.error.message || result.error) : null;
  const creditedFocusIds = Array.from(new Set([...progressState.completedFocusIds, ...mergedFocusIds]));
  const verifiedFocusIds = Array.from(new Set([...(progressState.verifiedCompletedFocusIds || []), ...mergedFocusIds]));
  const gainedCreditedFocus = creditedFocusIds.length > progressState.completedFocusIds.length;
  progressState = saveProgressState({
    ...progressState,
    completedFocusIds: creditedFocusIds,
    verifiedCompletedFocusIds: verifiedFocusIds,
    benchmarkMetrics,
    lastIteration: iteration,
    noProgressStreak: (progressDelta.length > 0 || gainedCreditedFocus) ? 0 : progressState.noProgressStreak,
    recoverableInfraRetries: (progressDelta.length > 0 || gainedCreditedFocus) ? 0 : progressState.recoverableInfraRetries
  });
  writeBenchmarkProgress({ progressState, iteration });

  let blockerClass = classifyIteration({ blocker, progressDelta, freshProgressDetected, spawnError: result.error, workspaceError: result.workspaceRefreshError, retryClass });
  if (blocker && blockerClass === 'hard_blocker') blockerClass = null;
  if (preserveLiveWorkBlocker) blockerClass = null;
  if (greenCompletionReached) blockerClass = null;
  if (blockerClass === 'partial_progress') {
    progressState = saveProgressState({ ...progressState, noProgressStreak: 0, recoverableInfraRetries: 0, lastIteration: iteration });
    continuationDetected = true;
    continue;
  }
  if (blockerClass === 'recoverable_infra' && progressState.recoverableInfraRetries < MAX_RECOVERABLE_INFRA_RETRIES) {
    progressState = saveProgressState({ ...progressState, recoverableInfraRetries: progressState.recoverableInfraRetries + 1, lastIteration: iteration });
    continuationDetected = true;
    continue;
  }
  if (blockerClass === 'no_progress') {
    const nextNoProgressStreak = progressState.noProgressStreak + 1;
    progressState = saveProgressState({ ...progressState, noProgressStreak: nextNoProgressStreak, recoverableInfraRetries: 0, lastIteration: iteration });
    if (nextNoProgressStreak < MAX_NO_PROGRESS_ITERATIONS) {
      continuationDetected = true;
      continue;
    }
  }
  if (blocker) {
    finalOk = result.status === 0 && !result.error && !blocker;
    continuationDetected = false;
    break;
  }
  if (STRICT_GAP_SINGLE_PASS) {
    finalOk = result.status === 0 && !result.error && !blocker;
    continuationDetected = false;
    break;
  }
  if ((campaignState?.stopAllowed && freshProgressDetected) || greenCompletionReached) {
    finalOk = result.status === 0 && !result.error;
    continuationDetected = false;
    break;
  }
  if (blocker && !shouldRequeue) {
    finalOk = false;
    continuationDetected = false;
    break;
  }
  if (!parityFocusPlanned || parityFocusIssuesPresent) {
    finalOk = false;
    continuationDetected = false;
    break;
  }
  if (shouldRequeue) {
    progressState = saveProgressState({ ...progressState, recoverableInfraRetries: 0, lastIteration: iteration });
    continuationDetected = true;
    continue;
  }
  finalOk = result.status === 0 && !result.error;
  continuationDetected = false;
  break;
}

persistTerminalStatus({
  ok: finalOk,
  phase: finalOk
    ? 'remote_execution_finished'
    : continuationDetected
      ? 'remote_execution_iteration_cap_reached'
      : 'remote_execution_failed',
  exitCode: continuationDetected ? 2 : (finalExitCode || (finalSpawnError ? 1 : 0)),
  signal: finalSignal,
  error: finalSpawnError,
  note: continuationDetected
    ? 'Remote execution runner stopped after hitting the iteration cap while the persistent campaign still wanted to continue, and wrote a terminal receipt.'
    : finalOk
      ? 'Remote execution runner finished on the execution plane and wrote a terminal receipt.'
      : 'Remote execution runner finished without a clean success state and wrote a terminal receipt.'
});
if (continuationDetected) process.exit(2);
process.exit(finalExitCode || (finalSpawnError ? 1 : 0));
