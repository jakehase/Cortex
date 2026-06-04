import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { deriveCampaignContinuation, recoverCampaign, setSupervisor } from '../../large-project-capability-stack/packages/campaign-runtime/index.mjs';
import { buildObjectiveExpansionPlan } from '../../large-project-capability-stack/packages/objective-surface-decomposer/index.mjs';
import { buildContradictoryDelegateTruthBlocker, buildNotifierEligibilityPayload, buildOutcomeHeadline, buildStaleDelegateEvidenceBlocker, delegateTruthConflictDetails, deriveCanonicalStatuses, deriveProductThroughputEvidence, deriveRequestedOutcome, isArtifactFreshForRun, resolveCampaignBlocker } from './lib/full-audit-campaign-state.mjs';
import { writeMailchimpCanonicalTruthPreflight } from './lib/mailchimp-canonical-truth-preflight.mjs';
import { resolveCampaignRunBinding, resolveMirroredArtifactPath } from './lib/full-audit-campaign-run-binding.mjs';
import { resolveProgramEnvKeys, resolveProgramPaths } from './lib/orchestration-program-config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PROGRAM_ENV = resolveProgramEnvKeys();
const PROGRAM_PATHS = resolveProgramPaths(ROOT);
const ARTIFACT_DIR = PROGRAM_PATHS.artifactDir;
const CURRENT_RUN_PATH = PROGRAM_PATHS.currentRunPath;
const STRICT_1TO1_CONTRACT_PATH = path.join(ROOT, 'strict_1to1_contract.json');
const CONTRACT_PATH_CANDIDATES = [
  path.join(ARTIFACT_DIR, 'one_pass_run_contract.latest.json'),
  STRICT_1TO1_CONTRACT_PATH
];
const PROGRAM_STATE_PATH = PROGRAM_PATHS.programStatePath;
const SUMMARY_PATH = PROGRAM_PATHS.summaryPath;
const NOTIFY_PATH = PROGRAM_PATHS.notifyPath;
const BLOCKER_PATH = PROGRAM_PATHS.blockerPath;
const THRESHOLD_EVALUATION_PATH = path.join(ARTIFACT_DIR, 'threshold_evaluation.json');
const MAILCHIMP_TRUTH_PREFLIGHT_PATH = path.join(ARTIFACT_DIR, 'mailchimp_truth_preflight.json');
const AUTONOMY_SOAK_PROOF_PATH = path.join(ARTIFACT_DIR, 'autonomy_soak_proof.json');
const SYNC_STATUS_PATH = PROGRAM_PATHS.syncStatusPath;
const REPORTS_DIR = PROGRAM_PATHS.reportsDir;
const STATUS_REPORT_PATH = PROGRAM_PATHS.supervisorStatusPath;
const SOAK_FULL_RUNTIME = process.env[PROGRAM_ENV.soakFullRuntime] === '1';
const STRICT_1TO1_SUPERVISOR_SCRIPT = path.join(ROOT, 'scripts', 'strict-1to1-supervisor.mjs');
const STRICT_1TO1_STATE_PATH = path.join(ROOT, 'artifacts', 'strict_1to1', 'supervisor_state.json');
const STRICT_1TO1_BLOCKER_PATH = path.join(ROOT, 'artifacts', 'strict_1to1', 'blocker_report.json');
const STRICT_1TO1_INVENTORY_REDUCTION_PATH = path.join(ROOT, 'artifacts', 'strict_1to1', 'strict_1to1_gap_inventory_reduction.json');
const OBJECTIVE_EXPANSION_PLAN_PATH = path.join(ARTIFACT_DIR, 'objective_expansion_plan.json');
const DEFAULT_PRODUCTION_CREDIT_EXCLUDED_PREFIXES = Object.freeze([
  'packages/product-factory/'
]);
const DEFAULT_PRODUCT_PARITY_CHANGED_LINES_PER_SURFACE = 10;
const DEFAULT_PRODUCT_PARITY_NET_LINES_PER_SURFACE = 5;

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function normalizeRequestedContract(rawContract = null, strict1to1Contract = null) {
  const contract = rawContract && typeof rawContract === 'object' ? { ...rawContract } : {};
  const fallback = strict1to1Contract && typeof strict1to1Contract === 'object' ? strict1to1Contract : {};
  const envRequestedFidelity = String(process.env.ORCHESTRATOR_REQUESTED_FIDELITY || '').trim();
  const requestedFidelity = String(envRequestedFidelity || contract.requestedFidelity || contract.fidelity || fallback.requestedFidelity || '').trim();
  if (requestedFidelity) contract.requestedFidelity = requestedFidelity;
  if (!contract.stopCondition && fallback.stopCondition) contract.stopCondition = fallback.stopCondition;
  return contract;
}

function uniqueStrings(values) {
  return Array.from(new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean)));
}

function parseJsonMaybe(value, fallback = null) {
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function toIsoString(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function minutesBetween(start, end) {
  const startMs = Date.parse(start || '');
  const endMs = Date.parse(end || '');
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return null;
  return Number(((endMs - startMs) / 60000).toFixed(2));
}

function extractMergedPatchLanes(mergedEntries = []) {
  return uniqueStrings(mergedEntries.flatMap((entry) => {
    const metadata = entry?.metadata || {};
    const implementationMetadata = metadata?.implementation?.metadata || {};
    const parsedStdout = parseJsonMaybe(metadata?.implementation?.stdout, null);
    const parsedStdoutMetadata = parsedStdout?.metadata || {};
    const contextLane = metadata?.contextPack?.shard?.lane;
    return [
      contextLane,
      implementationMetadata.focusGroup,
      implementationMetadata.rawFocusGroup,
      parsedStdout?.focusGroup,
      parsedStdoutMetadata.focusGroup,
      parsedStdoutMetadata.rawFocusGroup
    ];
  }));
}

function roundMetric(value, digits = 2) {
  return Number.isFinite(Number(value)) ? Number(Number(value).toFixed(digits)) : null;
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
  const excludedPatterns = uniqueStrings([
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

function currentProductDiffStats() {
  const result = spawnSync('git', ['-C', ROOT, 'diff', '--numstat', '--', 'apps', 'packages', 'plugins'], {
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 1024 * 1024 * 20
  });
  if (result.status !== 0 || result.error) {
    return { ok: false, files: 0, added: 0, deleted: 0, net: 0, error: String(result.stderr || result.stdout || result.error?.message || 'git diff failed').trim() };
  }
  let files = 0;
  let added = 0;
  let deleted = 0;
  for (const line of String(result.stdout || '').trim().split(/\r?\n/).filter(Boolean)) {
    const [addText, deleteText] = line.split(/\s+/);
    const add = Number(addText);
    const del = Number(deleteText);
    if (!Number.isFinite(add) || !Number.isFinite(del)) continue;
    files += 1;
    added += add;
    deleted += del;
  }
  return {
    ok: true,
    files,
    added,
    deleted,
    net: added - deleted,
    trackedFiles: files,
    trackedAdded: added,
    untrackedFilesExcluded: true,
    note: 'Control-plane diff excludes untracked files; threshold product LOC is derived from per-run promoted loc_accounting artifacts.'
  };
}

function promotedProductLocFromAccounting(locAccounting = null, contract = null) {
  const policy = productionCreditPolicy(contract);
  const mergedPatchCount = Number(locAccounting?.mergedPatchCount || 0);
  const incrementalProductCode = locAccounting?.incremental?.counts?.productCode || null;
  const incrementalChangedLines = Number(incrementalProductCode?.added || 0) + Number(incrementalProductCode?.deleted || 0);
  const incrementalFileCount = Number(incrementalProductCode?.files || 0);
  if (locAccounting?.incremental?.ok === true && (mergedPatchCount === 0 || incrementalChangedLines === 0 || incrementalFileCount === 0)) {
    return {
      files: [],
      added: 0,
      deleted: 0,
      net: 0,
      changedLines: 0,
      excludedFiles: [],
      currentIterationGate: {
        credited: false,
        reason: mergedPatchCount === 0 ? 'selected_tier_merged_patch_count_zero' : 'no_current_iteration_product_delta',
        mergedPatchCount,
        incrementalProductCode
      },
      creditPolicy: {
        requireAllowedFileMatch: policy.requireAllowedFileMatch,
        allowedFileCount: policy.allowedFiles.size,
        excludedPatterns: policy.excludedPatterns
      }
    };
  }
  const productCodeFiles = Array.isArray(locAccounting?.productCodeFiles) ? locAccounting.productCodeFiles : [];
  const credited = [];
  const excluded = [];
  for (const fileEntry of productCodeFiles) {
    const filePath = normalizeRepoPath(fileEntry?.path || fileEntry?.file || fileEntry?.relativePath || '');
    const eligibility = productionCreditEligibility(filePath, policy);
    const entry = {
      path: filePath,
      added: Number(fileEntry?.added || 0),
      deleted: Number(fileEntry?.deleted || 0),
      net: Number(fileEntry?.net ?? (Number(fileEntry?.added || 0) - Number(fileEntry?.deleted || 0))),
      reason: eligibility.reason
    };
    if (eligibility.eligible) credited.push(entry);
    else excluded.push(entry);
  }
  const sum = (field) => credited.reduce((total, entry) => total + (Number.isFinite(Number(entry[field])) ? Number(entry[field]) : 0), 0);
  return {
    files: credited.map((entry) => entry.path).filter(Boolean),
    added: sum('added'),
    deleted: sum('deleted'),
    net: sum('net'),
    changedLines: sum('added') + sum('deleted'),
    excludedFiles: excluded.filter((entry) => entry.path),
    currentIterationGate: {
      credited: true,
      reason: 'selected_tier_admitted_product_delta_present',
      mergedPatchCount,
      incrementalProductCode
    },
    creditPolicy: {
      requireAllowedFileMatch: policy.requireAllowedFileMatch,
      allowedFileCount: policy.allowedFiles.size,
      excludedPatterns: policy.excludedPatterns
    }
  };
}

function implicitBenchmarkThresholds(contract = null) {
  if (contract?.goThresholds && typeof contract.goThresholds === 'object') return contract.goThresholds;
  const surfaces = Array.isArray(contract?.scope?.surfaces) ? contract.scope.surfaces : [];
  const benchmarkClass = String(contract?.benchmarkClass || '').trim();
  const requiresDirectProductEvidence = benchmarkClass === 'product_parity_scope'
    || surfaces.some((surface) => Array.isArray(surface?.tickRule)
      && surface.tickRule.some((rule) => /direct product-runtime code change|product evidence/i.test(String(rule || ''))));
  if (!requiresDirectProductEvidence || surfaces.length === 0) return null;
  return {
    minimumProductDiffChangedLines: surfaces.length * DEFAULT_PRODUCT_PARITY_CHANGED_LINES_PER_SURFACE,
    minimumProductDiffFiles: surfaces.length,
    minimumNetProductAddedLines: surfaces.length * DEFAULT_PRODUCT_PARITY_NET_LINES_PER_SURFACE,
    minimumNetProductFiles: surfaces.length,
    minimumDistinctFocusLanes: surfaces.length,
    maximumNoOpRate: 0.02,
    minimumVerificationIntegrity: 0.95,
    truthIntegrityContradictions: 0,
    implicit: true,
    reason: 'Product parity-scope contracts must prove direct promoted product diff even when goThresholds are omitted.'
  };
}

function campaignIterationRunIds(currentRun = null, canonicalSummary = null) {
  const campaignRunId = String(currentRun?.campaignRunId || '').trim();
  const fallbackRunId = String(canonicalSummary?.runId || currentRun?.runId || '').trim();
  const prefix = campaignRunId || fallbackRunId.replace(/-iter-\d+$/, '');
  const runsDir = path.join(ARTIFACT_DIR, 'runs');
  if (!prefix || !fs.existsSync(runsDir)) return [];
  return fs.readdirSync(runsDir)
    .filter((entry) => entry.startsWith(`${prefix}-iter-`))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
}

function isProgressContinuationBlockerText(value) {
  const text = String(value || '').toLowerCase();
  return text.includes('partial parity-surface reduction was proven')
    || text.includes('remaining red surfaces are still open');
}

function shouldCountRepeatBlocker({ blockerText = null, hasPromotedProductWork = false } = {}) {
  const text = String(blockerText || '').trim();
  if (!text) return false;
  // A partial-progress message is a continuation status while useful product work
  // is being accepted. Counting it as a repeated blocker turns successful long
  // runs into false threshold failures.
  if (hasPromotedProductWork && isProgressContinuationBlockerText(text)) return false;
  return true;
}

function autonomySoakProofEndAt({ autonomySoakProof = null, currentRun = null, canonicalSummary = null } = {}) {
  if (!autonomySoakProof || autonomySoakProof.status !== 'complete') return null;
  const proofCampaignRunId = String(autonomySoakProof.campaignRunId || '').trim();
  const currentCampaignRunId = String(currentRun?.campaignRunId || '').trim();
  if (proofCampaignRunId && currentCampaignRunId && proofCampaignRunId !== currentCampaignRunId) return null;
  const proofRunId = String(autonomySoakProof.basedOnRunId || autonomySoakProof.runId || '').trim();
  const currentRunId = String(currentRun?.runId || '').trim();
  if (proofRunId && currentRunId && proofRunId !== currentRunId) return null;
  const proofMs = Date.parse(String(autonomySoakProof.generatedAt || ''));
  const canonicalMs = Date.parse(String(canonicalSummary?.generatedAt || ''));
  if (!Number.isFinite(proofMs)) return null;
  if (Number.isFinite(canonicalMs) && proofMs < canonicalMs) return null;
  return new Date(proofMs).toISOString();
}

function aggregateBenchmarkObserved({ contract = null, currentRun = null, canonicalSummary = null, delegateLiveExecutionSummary = null, delegatePatchQueueReport = null, autonomySoakProof = null } = {}) {
  const runIds = campaignIterationRunIds(currentRun, canonicalSummary);
  const productFiles = new Set();
  const focusLanes = new Set();
  const agentIds = new Set();
  let productDiffChangedLines = 0;
  let netProductAddedLines = 0;
  let netProductDeletedLines = 0;
  let netProductNetLines = 0;
  let mergedPatchCount = 0;
  let shardOutputCount = 0;
  let totalPatchCandidates = 0;
  let noOpPatchCount = 0;
  let repeatBlockerCount = 0;
  let blockerEventCount = 0;
  let verifiedMergedPatchCount = 0;
  let truthIntegrityContradictions = 0;
  let previousBlockerText = null;
  let candidateProgressDiscardedLines = 0;
  let candidateProgressDiscardedFiles = 0;
  const excludedProductFiles = new Map();

  for (const runId of runIds) {
    const delegateDir = path.join(ARTIFACT_DIR, 'runs', runId, 'delegate');
    const benchmarkProgress = readJson(path.join(delegateDir, 'benchmark_progress.json'), null);
    const patchQueueReport = readJson(path.join(delegateDir, 'patch_queue_report.json'), null);
    const liveExecutionSummary = readJson(path.join(delegateDir, 'live_execution_summary.json'), null);
    const locAccounting = readJson(path.join(delegateDir, 'loc_accounting.json'), null);
    const canonical = readJson(path.join(delegateDir, 'canonical_summary.json'), null);
    const blockerReport = readJson(path.join(delegateDir, 'blocker_report.json'), null);
    const benchmarkObserved = benchmarkProgress?.observed && typeof benchmarkProgress.observed === 'object'
      ? benchmarkProgress.observed
      : null;
    const promotedLoc = promotedProductLocFromAccounting(locAccounting, contract);
    const selectedTierMergedPatchCount = Number(liveExecutionSummary?.metrics?.mergedPatchCount ?? locAccounting?.mergedPatchCount ?? 0);
    const selectedTierHasAdmittedWork = selectedTierMergedPatchCount > 0 && promotedLoc.changedLines > 0 && promotedLoc.files.length > 0;

    for (const filePath of promotedLoc.files) productFiles.add(filePath);
    for (const excluded of promotedLoc.excludedFiles) excludedProductFiles.set(excluded.path, excluded.reason);
    productDiffChangedLines += promotedLoc.changedLines;
    netProductAddedLines += promotedLoc.added;
    netProductDeletedLines += promotedLoc.deleted;
    netProductNetLines += promotedLoc.net;

    if (benchmarkObserved) {
      if (!selectedTierHasAdmittedWork) {
        candidateProgressDiscardedLines += Number(benchmarkObserved.productDiffChangedLines || 0);
        candidateProgressDiscardedFiles += Number(benchmarkObserved.productDiffFiles || (Array.isArray(benchmarkObserved.productFiles) ? benchmarkObserved.productFiles.length : 0) || 0);
        truthIntegrityContradictions += Number(benchmarkObserved.mergedPatchCount || 0) > 0 ? 1 : 0;
      } else {
      const observedChangedLines = Number(benchmarkObserved.productDiffChangedLines || 0);
      const observedProductFiles = Number(benchmarkObserved.productDiffFiles || (Array.isArray(benchmarkObserved.productFiles) ? benchmarkObserved.productFiles.length : 0) || 0);
      if (observedChangedLines > promotedLoc.changedLines || observedProductFiles > promotedLoc.files.length) {
        // benchmark_progress is candidate/worker telemetry. The scored product
        // diff above is intentionally derived from promoted loc_accounting, so
        // extra candidate lines are discarded evidence, not a truth-layer
        // contradiction by themselves.
        candidateProgressDiscardedLines += Math.max(0, observedChangedLines - promotedLoc.changedLines);
        candidateProgressDiscardedFiles += Math.max(0, observedProductFiles - promotedLoc.files.length);
      }
      for (const lane of Array.isArray(benchmarkObserved.focusLanes) ? benchmarkObserved.focusLanes : []) {
        const normalized = String(lane || '').trim();
        if (normalized) focusLanes.add(normalized);
      }
      for (const agentId of Array.isArray(benchmarkObserved.agentIds) ? benchmarkObserved.agentIds : []) {
        const normalized = String(agentId || '').trim();
        if (normalized) agentIds.add(normalized);
      }
      mergedPatchCount += Number(benchmarkObserved.mergedPatchCount || 0);
      shardOutputCount += Number(benchmarkObserved.shardOutputCount || 0);
      totalPatchCandidates += Number(benchmarkObserved.totalPatchCandidates || 0);
      noOpPatchCount += Number(benchmarkObserved.noOpPatchCount || 0);
      const observedBlockerText = String(canonical?.blocker?.blocker || blockerReport?.blocker || benchmarkObserved.lastBlockerText || '').trim();
      if (shouldCountRepeatBlocker({ blockerText: observedBlockerText, hasPromotedProductWork: promotedLoc.changedLines > 0 || promotedLoc.files.length > 0 })) {
        repeatBlockerCount += Number(benchmarkObserved.repeatBlockerCount || 0);
        blockerEventCount += Number(benchmarkObserved.blockerEventCount || 0);
      }
      verifiedMergedPatchCount += Number(benchmarkObserved.verifiedMergedPatchCount || 0);
      truthIntegrityContradictions += Number(benchmarkObserved.truthIntegrityContradictions || 0);
      continue;
      }
    }

    const mergedEntries = Array.isArray(patchQueueReport?.merged) ? patchQueueReport.merged : [];
    const rejectedEntries = Array.isArray(patchQueueReport?.rejected) ? patchQueueReport.rejected : [];
    const hadAcceptedProductWork = mergedEntries.length > 0 || Number(liveExecutionSummary?.metrics?.mergedPatchCount || 0) > 0;

    totalPatchCandidates += mergedEntries.length + rejectedEntries.length;
    noOpPatchCount += rejectedEntries.filter((entry) => entry?.rejectionCategory === 'no_op').length;
    mergedPatchCount += Number(liveExecutionSummary?.metrics?.mergedPatchCount || mergedEntries.length || 0);
    shardOutputCount += Number(liveExecutionSummary?.metrics?.shardOutputCount || 0);

    for (const entry of mergedEntries) {
      extractMergedPatchLanes([entry]).forEach((lane) => focusLanes.add(lane));
      if (entry?.agentId) agentIds.add(String(entry.agentId));
      const verifiers = Array.isArray(entry?.metadata?.verifierResults) ? entry.metadata.verifierResults : [];
      if (verifiers.length > 0 && verifiers.every((result) => result?.ok === true && result?.skipped !== true)) {
        verifiedMergedPatchCount += 1;
      }
    }

    const blockerText = String(canonical?.blocker?.blocker || blockerReport?.blocker || '').trim() || null;
    if (shouldCountRepeatBlocker({ blockerText, hasPromotedProductWork: promotedLoc.changedLines > 0 || promotedLoc.files.length > 0 })) {
      blockerEventCount += 1;
      if (blockerText === previousBlockerText) repeatBlockerCount += 1;
      previousBlockerText = blockerText;
    } else if (promotedLoc.changedLines > 0 || promotedLoc.files.length > 0 || !blockerText) {
      previousBlockerText = null;
    }
    if (canonical?.supervisorStatus === 'green' && (canonical?.blocker || (Array.isArray(canonical?.nextFocus) && canonical.nextFocus.length > 0))) {
      truthIntegrityContradictions += 1;
    }
  }

  const fallbackMergedEntries = Array.isArray(delegatePatchQueueReport?.merged) ? delegatePatchQueueReport.merged : [];
  const observedMergedPatchCount = mergedPatchCount > 0 ? mergedPatchCount : Number(delegateLiveExecutionSummary?.metrics?.mergedPatchCount || fallbackMergedEntries.length || 0);
  const verificationIntegrity = observedMergedPatchCount > 0
    ? roundMetric(verifiedMergedPatchCount / observedMergedPatchCount)
    : 1;
  const controlPlaneProductDiff = currentProductDiffStats();
  const autonomyEndAt = autonomySoakProofEndAt({ autonomySoakProof, currentRun, canonicalSummary }) || canonicalSummary?.generatedAt || null;

  return {
    autonomyMinutes: minutesBetween(currentRun?.campaignStartedAt || currentRun?.startedAt || currentRun?.generatedAt || null, autonomyEndAt),
    autonomyEndAt,
    autonomySoakProof: autonomySoakProofEndAt({ autonomySoakProof, currentRun, canonicalSummary }) ? {
      path: path.relative(ROOT, AUTONOMY_SOAK_PROOF_PATH),
      generatedAt: autonomySoakProof.generatedAt,
      mode: autonomySoakProof.mode || null
    } : null,
    productDiffChangedLines,
    productDiffFiles: productFiles.size,
    netProductAddedLines,
    netProductDeletedLines,
    netProductNetLines,
    netProductFiles: productFiles.size,
    netProductDiffOk: controlPlaneProductDiff.ok,
    netProductDiffError: controlPlaneProductDiff.error || null,
    controlPlaneProductDiff,
    distinctFocusLanes: focusLanes.size,
    distinctAgentIds: agentIds.size,
    mergedPatchCount: observedMergedPatchCount,
    shardOutputCount: shardOutputCount > 0 ? shardOutputCount : Number(delegateLiveExecutionSummary?.metrics?.shardOutputCount || 0),
    noOpRate: totalPatchCandidates > 0 ? roundMetric(noOpPatchCount / totalPatchCandidates) : 0,
    repeatBlockerRate: blockerEventCount > 0
      ? roundMetric(repeatBlockerCount / blockerEventCount)
      : (runIds.length > 0 ? roundMetric(repeatBlockerCount / runIds.length) : 0),
    verificationIntegrity,
    truthIntegrityContradictions,
    candidateProgressDiscardedLines,
    candidateProgressDiscardedFiles,
    excludedProductFiles: Array.from(excludedProductFiles, ([filePath, reason]) => ({ path: filePath, reason })),
    generatedAt: new Date().toISOString(),
    runId: canonicalSummary?.runId || currentRun?.runId || null,
    startedAt: toIsoString(currentRun?.campaignStartedAt || currentRun?.startedAt || currentRun?.generatedAt || null),
    completedAt: toIsoString(canonicalSummary?.generatedAt || null)
  };
}

function evaluateBenchmarkThresholdGate({ contract = null, currentRun = null, canonicalSummary = null, delegateLiveExecutionSummary = null, delegatePatchQueueReport = null, autonomySoakProof = null } = {}) {
  const thresholds = implicitBenchmarkThresholds(contract);
  if (!thresholds) {
    return {
      evaluated: false,
      pass: true,
      blocker: null,
      blockerKind: null,
      matrixStatus: null,
      parityStatus: null,
      thresholds: null,
      observed: null,
      failures: []
    };
  }

  const observed = aggregateBenchmarkObserved({
    contract,
    currentRun,
    canonicalSummary,
    delegateLiveExecutionSummary,
    delegatePatchQueueReport,
    autonomySoakProof
  });

  const failures = [];
  const compareMinimum = ({ thresholdField, observedField, label }) => {
    const required = thresholds?.[thresholdField];
    if (!Number.isFinite(Number(required))) return;
    const observedValue = Number(observed[observedField]);
    if (!Number.isFinite(observedValue) || observedValue < Number(required)) {
      failures.push({ thresholdField, observedField, label, comparator: '>=', required: Number(required), observed: Number.isFinite(observedValue) ? observedValue : null });
    }
  };
  const compareMaximum = ({ thresholdField, observedField, label }) => {
    const required = thresholds?.[thresholdField];
    if (!Number.isFinite(Number(required))) return;
    const observedValue = Number(observed[observedField]);
    if (!Number.isFinite(observedValue) || observedValue > Number(required)) {
      failures.push({ thresholdField, observedField, label, comparator: '<=', required: Number(required), observed: Number.isFinite(observedValue) ? observedValue : null });
    }
  };
  const compareEquality = ({ thresholdField, observedField, label }) => {
    const required = thresholds?.[thresholdField];
    if (!Number.isFinite(Number(required))) return;
    const observedValue = Number(observed[observedField]);
    if (!Number.isFinite(observedValue) || observedValue !== Number(required)) {
      failures.push({ thresholdField, observedField, label, comparator: '=', required: Number(required), observed: Number.isFinite(observedValue) ? observedValue : null });
    }
  };

  compareMinimum({ thresholdField: 'minimumAutonomyMinutes', observedField: 'autonomyMinutes', label: 'Autonomy minutes' } );
  compareMinimum({ thresholdField: 'minimumProductDiffChangedLines', observedField: 'productDiffChangedLines', label: 'Product diff changed lines' } );
  compareMinimum({ thresholdField: 'minimumProductDiffFiles', observedField: 'productDiffFiles', label: 'Product diff files' } );
  compareMinimum({ thresholdField: 'minimumNetProductAddedLines', observedField: 'netProductAddedLines', label: 'Net product added lines' } );
  compareMinimum({ thresholdField: 'minimumNetProductNetLines', observedField: 'netProductNetLines', label: 'Net product net lines' } );
  compareMinimum({ thresholdField: 'minimumNetProductFiles', observedField: 'netProductFiles', label: 'Net product files' } );
  compareMinimum({ thresholdField: 'minimumDistinctFocusLanes', observedField: 'distinctFocusLanes', label: 'Distinct focus lanes' } );
  compareMinimum({ thresholdField: 'minimumDistinctAgentIds', observedField: 'distinctAgentIds', label: 'Distinct agent ids' } );
  compareMaximum({ thresholdField: 'maximumNoOpRate', observedField: 'noOpRate', label: 'No-op rate' } );
  compareMaximum({ thresholdField: 'maximumRepeatBlockerRate', observedField: 'repeatBlockerRate', label: 'Repeat-blocker rate' } );
  compareMinimum({ thresholdField: 'minimumVerificationIntegrity', observedField: 'verificationIntegrity', label: 'Verification integrity' } );
  compareEquality({ thresholdField: 'truthIntegrityContradictions', observedField: 'truthIntegrityContradictions', label: 'Truth contradictions' } );

  if (failures.length === 0) {
    return {
      evaluated: true,
      pass: true,
      blocker: null,
      blockerKind: null,
      matrixStatus: 'all_complete',
      parityStatus: 'full',
      thresholds,
      observed,
      failures
    };
  }

  return {
    evaluated: true,
    pass: false,
    blockerKind: 'benchmark_threshold_gate',
    matrixStatus: 'blocked',
    parityStatus: 'blocked',
    thresholds,
    observed,
    failures,
    blocker: {
      blocker: 'Production-creation benchmark thresholds were not met, so this run cannot score green.',
      nextAction: failures.map((failure) => `${failure.label}: observed ${failure.observed ?? 'unknown'}, required ${failure.comparator} ${failure.required}`),
      thresholdEvaluation: {
        benchmarkId: contract?.benchmarkId || null,
        benchmarkTier: contract?.benchmarkTier || null,
        fidelity: contract?.requestedFidelity || contract?.fidelity || null,
        observed,
        thresholds,
        failures
      }
    }
  };
}

function writeJson(filePath, payload) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

function rmIfExists(filePath) {
  try {
    fs.rmSync(filePath, { force: true });
  } catch {}
}

function freshRunBoundArtifactPath(artifactPath, { currentRun = null, runId = null, timestampKeys = ['generatedAt', 'createdAt', 'startedAt'], requireRunMatch = false } = {}) {
  if (!artifactPath || !fs.existsSync(artifactPath)) return null;
  const artifact = readJson(artifactPath, null);
  if (!artifact) return null;
  return isArtifactFreshForRun({
    artifact,
    currentRun,
    runId,
    timestampKeys,
    requireRunMatch
  })
    ? artifactPath
    : null;
}

function liveRemoteProgress(workerStatus = null, currentRun = null, runId = null) {
  const remoteExecutionStatus = workerStatus?.remoteExecutionStatus || null;
  if (!remoteExecutionStatus || remoteExecutionStatus.running !== true) return { active: false, latestIteration: null };
  const freshRemoteStatus = isArtifactFreshForRun({
    artifact: remoteExecutionStatus,
    currentRun,
    runId,
    requireRunMatch: false,
    timestampKeys: ['heartbeatAt', 'generatedAt', 'lastOutputAt', 'finishedAt']
  });
  if (!freshRemoteStatus) return { active: false, latestIteration: null };
  const latestIteration = Array.isArray(remoteExecutionStatus.iterations) ? remoteExecutionStatus.iterations.at(-1) || null : null;
  const latestBlockerText = String(latestIteration?.blocker?.blocker || '');
  const active = latestIteration?.freshProgressDetected === true
    || /partial parity-surface reduction was proven|remaining red surfaces are still open/i.test(latestBlockerText);
  return { active, latestIteration };
}

function shouldContinueAutonomySoak({ orchestration = null, benchmarkThresholdGate = null, currentRun = null } = {}) {
  if (!orchestration?.green) return false;
  if (benchmarkThresholdGate?.pass !== false || benchmarkThresholdGate?.blockerKind !== 'benchmark_threshold_gate') return false;
  const failures = Array.isArray(benchmarkThresholdGate.failures) ? benchmarkThresholdGate.failures : [];
  const onlyAutonomyMissing = failures.length === 1
    && failures.every((failure) => failure?.thresholdField === 'minimumAutonomyMinutes' || failure?.observedField === 'autonomyMinutes');
  if (!SOAK_FULL_RUNTIME && !onlyAutonomyMissing) return false;
  const deadlineMs = Date.parse(currentRun?.campaignDeadlineAt || currentRun?.deadlineAt || '');
  return Number.isFinite(deadlineMs) && Date.now() < deadlineMs;
}

function buildTargetedSemanticReplaySurfaceMatrix({ runId = null, replay = null, contract = null } = {}) {
  const focusIds = uniqueStrings([
    ...(Array.isArray(replay?.verifiedTargetFocusIds) ? replay.verifiedTargetFocusIds : []),
    ...(Array.isArray(replay?.progressDelta) ? replay.progressDelta : []),
    ...(Array.isArray(replay?.targetFocusIds) ? replay.targetFocusIds : [])
  ].filter((focusId) => String(focusId || '').startsWith('focus.')));
  return {
    generatedAt: new Date().toISOString(),
    runId,
    contractBenchmarkId: contract?.benchmarkId || null,
    fidelity: contract?.requestedFidelity || contract?.fidelity || null,
    status: 'all_complete',
    matrixStatus: 'all_complete',
    scopeMode: 'targeted_semantic_replay',
    truthBoundary: contract?.truthModel?.nonCompletionRule || 'Scoped targeted replay satisfaction is not broad full-clone parity.',
    surfaces: focusIds.map((focusId) => ({
      id: focusId.replace(/^focus\./, ''),
      focusId,
      issueIds: [focusId],
      status: 'all_complete',
      evidence: {
        targetedSemanticReplaySatisfied: replay?.satisfied === true,
        stopReason: replay?.stopReason || null,
        liveWorkRequired: replay?.liveWorkRequired === true,
        preflightCreditAllowed: replay?.preflightCreditAllowed === true
      }
    }))
  };
}

function evaluateStrict1To1Ceiling(contract = {}, strict1to1Contract = null) {
  const requestedFidelity = String(contract?.requestedFidelity || strict1to1Contract?.requestedFidelity || '').trim().toLowerCase();
  if (requestedFidelity !== 'full_clone') {
    return { required: false, state: null, blocker: null, supervisorExitCode: null };
  }
  if (fs.existsSync(STRICT_1TO1_SUPERVISOR_SCRIPT)) {
    spawnSync(process.execPath, [STRICT_1TO1_SUPERVISOR_SCRIPT], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 120_000,
      maxBuffer: 1024 * 1024 * 40
    });
  }
  const state = readJson(STRICT_1TO1_STATE_PATH, null);
  const strictBlocker = readJson(STRICT_1TO1_BLOCKER_PATH, null);
  const strictInventoryReduction = state?.strictInventoryReduction || readJson(STRICT_1TO1_INVENTORY_REDUCTION_PATH, null);
  if (!state || state.status === 'green') {
    return { required: true, state, blocker: null, supervisorExitCode: 0 };
  }
  return {
    required: true,
    state,
    supervisorExitCode: 1,
    blocker: {
      blocker: 'Strict 1:1 parity ceiling is still red, so the Mailchimp clone cannot be treated as full-clone complete.',
      nextAction: strictBlocker?.nextAction || 'Expand the canonical Mailchimp parity surface inventory and evidence until the strict 1:1 supervisor turns green.',
      strict1to1: {
        status: state.status || null,
        matrixStatus: state.matrixStatus || null,
        deepParityEstimate: state.deepParityEstimate || null,
        exactRemainingGaps: state.exactRemainingGaps || strictBlocker?.exactRemainingGaps || [],
        strictInventoryReduction
      }
    }
  };
}

const runBinding = resolveCampaignRunBinding({
  rootDir: ROOT,
  artifactDir: ARTIFACT_DIR,
  currentRunPath: CURRENT_RUN_PATH,
  workerStatusPath: path.join(REPORTS_DIR, '100_agent_worker_status.json')
});
const currentRun = runBinding.currentRun;
const contractPath = CONTRACT_PATH_CANDIDATES.find((candidate) => fs.existsSync(candidate)) || CONTRACT_PATH_CANDIDATES[0];
const strict1to1Contract = readJson(STRICT_1TO1_CONTRACT_PATH, null);
const contract = normalizeRequestedContract(readJson(contractPath, {}), strict1to1Contract);
const oldNotification = readJson(NOTIFY_PATH, {});
const runId = process.env[PROGRAM_ENV.runId] || runBinding.runId || currentRun?.runId || null;
const runDir = runId ? path.join(ARTIFACT_DIR, 'runs', runId) : null;
const delegateDir = runDir ? path.join(runDir, 'delegate') : null;
const workerStatus = runBinding.workerStatus;
const workerMirroredCanonicalSummaryPath = resolveMirroredArtifactPath(ROOT, workerStatus, 'canonicalSummaryPath', null);
const mirroredDelegateRoot = workerMirroredCanonicalSummaryPath && fs.existsSync(workerMirroredCanonicalSummaryPath)
  ? path.dirname(workerMirroredCanonicalSummaryPath)
  : null;
const mirroredCanonicalSummaryPath = resolveMirroredArtifactPath(ROOT, workerStatus, 'canonicalSummaryPath', mirroredDelegateRoot ? path.join(mirroredDelegateRoot, 'canonical_summary.json') : (delegateDir ? path.join(delegateDir, 'canonical_summary.json') : null));
const mirroredDelegateProgramStatePath = resolveMirroredArtifactPath(ROOT, workerStatus, 'programStatePath', mirroredDelegateRoot ? path.join(mirroredDelegateRoot, 'program_state.json') : (delegateDir ? path.join(delegateDir, 'program_state.json') : null));
const mirroredDelegateBlockerPath = resolveMirroredArtifactPath(ROOT, workerStatus, 'blockerPath', mirroredDelegateRoot ? path.join(mirroredDelegateRoot, 'blocker_report.json') : (delegateDir ? path.join(delegateDir, 'blocker_report.json') : null));
const delegateSurfaceMatrixPath = resolveMirroredArtifactPath(ROOT, workerStatus, 'surfaceMatrixPath', mirroredDelegateRoot ? path.join(mirroredDelegateRoot, 'surface_matrix.json') : (delegateDir ? path.join(delegateDir, 'surface_matrix.json') : null));
const notifierEligibilityPath = resolveMirroredArtifactPath(ROOT, workerStatus, 'notifierEligibilityPath', mirroredDelegateRoot ? path.join(mirroredDelegateRoot, 'notifier_eligibility.json') : (delegateDir ? path.join(delegateDir, 'notifier_eligibility.json') : null));
const delegateLiveExecutionSummaryPath = resolveMirroredArtifactPath(ROOT, workerStatus, 'liveExecutionSummaryPath', mirroredDelegateRoot ? path.join(mirroredDelegateRoot, 'live_execution_summary.json') : (delegateDir ? path.join(delegateDir, 'live_execution_summary.json') : null));
const delegatePatchQueueReportPath = resolveMirroredArtifactPath(ROOT, workerStatus, 'patchQueueReportPath', mirroredDelegateRoot ? path.join(mirroredDelegateRoot, 'patch_queue_report.json') : (delegateDir ? path.join(delegateDir, 'patch_queue_report.json') : null));
const controlPlaneCanonicalSummaryPath = path.join(ARTIFACT_DIR, 'canonical_summary.json');
const controlPlaneDelegateProgramStatePath = path.join(ARTIFACT_DIR, 'delegate_program_state.json');
const controlPlaneDelegateBlockerPath = path.join(ARTIFACT_DIR, 'delegate_blocker_report.json');
const controlPlaneSurfaceMatrixPath = path.join(ARTIFACT_DIR, 'surface_matrix.json');
if (mirroredCanonicalSummaryPath && fs.existsSync(mirroredCanonicalSummaryPath)) {
  fs.copyFileSync(mirroredCanonicalSummaryPath, controlPlaneCanonicalSummaryPath);
}
if (mirroredDelegateProgramStatePath && fs.existsSync(mirroredDelegateProgramStatePath)) {
  fs.copyFileSync(mirroredDelegateProgramStatePath, controlPlaneDelegateProgramStatePath);
}
if (mirroredDelegateBlockerPath && fs.existsSync(mirroredDelegateBlockerPath)) {
  fs.copyFileSync(mirroredDelegateBlockerPath, controlPlaneDelegateBlockerPath);
}
if (delegateSurfaceMatrixPath && fs.existsSync(delegateSurfaceMatrixPath)) {
  fs.copyFileSync(delegateSurfaceMatrixPath, controlPlaneSurfaceMatrixPath);
}
const canonicalSummaryPath = freshRunBoundArtifactPath(controlPlaneCanonicalSummaryPath, {
  currentRun,
  runId,
  requireRunMatch: true
}) || freshRunBoundArtifactPath(mirroredCanonicalSummaryPath, {
  currentRun,
  runId,
  requireRunMatch: true
});
if (!canonicalSummaryPath) rmIfExists(controlPlaneCanonicalSummaryPath);
const delegateProgramStatePath = freshRunBoundArtifactPath(controlPlaneDelegateProgramStatePath, {
  currentRun,
  runId,
  requireRunMatch: false,
  timestampKeys: ['generatedAt', 'updatedAt', 'startedAt']
}) || freshRunBoundArtifactPath(mirroredDelegateProgramStatePath, {
  currentRun,
  runId,
  requireRunMatch: false,
  timestampKeys: ['generatedAt', 'updatedAt', 'startedAt']
});
if (!delegateProgramStatePath) rmIfExists(controlPlaneDelegateProgramStatePath);
const delegateBlockerPath = freshRunBoundArtifactPath(controlPlaneDelegateBlockerPath, {
  currentRun,
  runId,
  requireRunMatch: false,
  timestampKeys: ['generatedAt', 'updatedAt', 'startedAt']
}) || freshRunBoundArtifactPath(mirroredDelegateBlockerPath, {
  currentRun,
  runId,
  requireRunMatch: false,
  timestampKeys: ['generatedAt', 'updatedAt', 'startedAt']
});
if (!delegateBlockerPath) rmIfExists(controlPlaneDelegateBlockerPath);
const workerBlockerPath = freshRunBoundArtifactPath(BLOCKER_PATH, {
  currentRun,
  runId,
  requireRunMatch: false,
  timestampKeys: ['generatedAt', 'updatedAt', 'startedAt']
});
const canonicalSummary = canonicalSummaryPath ? readJson(canonicalSummaryPath, null) : null;
const delegateProgramState = delegateProgramStatePath ? readJson(delegateProgramStatePath, null) : null;
const delegateBlocker = delegateBlockerPath ? readJson(delegateBlockerPath, null) : null;
const workerBlocker = workerBlockerPath ? readJson(workerBlockerPath, null) : null;
const notifierEligibilityArtifact = notifierEligibilityPath ? readJson(notifierEligibilityPath, null) : null;
const delegateLiveExecutionSummary = delegateLiveExecutionSummaryPath ? readJson(delegateLiveExecutionSummaryPath, null) : null;
const delegatePatchQueueReport = delegatePatchQueueReportPath ? readJson(delegatePatchQueueReportPath, null) : null;
const syncStatus = readJson(SYNC_STATUS_PATH, null);
const autonomySoakProof = readJson(AUTONOMY_SOAK_PROOF_PATH, null);
const remoteProgress = liveRemoteProgress(workerStatus, currentRun, runId);
const targetedSemanticReplay = syncStatus?.remoteRuntimeStatus?.targetedSemanticReplay || null;
const targetedSemanticReplaySatisfied = String(syncStatus?.remoteRuntimeStatus?.phase || '') === 'remote_execution_target_satisfied'
  && targetedSemanticReplay?.satisfied === true;

const freshDelegateEvidence = isArtifactFreshForRun({
  artifact: delegateProgramState,
  currentRun,
  runId,
  requireRunMatch: false,
  timestampKeys: ['generatedAt', 'startedAt', 'createdAt']
}) && isArtifactFreshForRun({
  artifact: delegateLiveExecutionSummary,
  currentRun,
  runId,
  requireRunMatch: false
}) && isArtifactFreshForRun({
  artifact: delegatePatchQueueReport,
  currentRun,
  runId,
  requireRunMatch: false
});
const delegateTruthConflict = delegateTruthConflictDetails({
  completionSummary: canonicalSummary,
  programState: delegateProgramState
});
const strict1to1 = evaluateStrict1To1Ceiling(contract, strict1to1Contract);
const requestedFidelity = contract.requestedFidelity || strict1to1Contract?.requestedFidelity || 'full_clone';
const mailchimpTruthPreflight = writeMailchimpCanonicalTruthPreflight({
  workspaceRoot: path.resolve(ROOT, '..'),
  outputPath: MAILCHIMP_TRUTH_PREFLIGHT_PATH
});

let orchestrationBlocker = null;
let nextFocus = canonicalSummary?.nextFocus || delegateProgramState?.nextFocus || [];
if (targetedSemanticReplaySatisfied) {
  nextFocus = [];
  writeJson(controlPlaneSurfaceMatrixPath, buildTargetedSemanticReplaySurfaceMatrix({
    runId,
    replay: targetedSemanticReplay,
    contract
  }));
}

if (!runId) {
  orchestrationBlocker = {
    blocker: 'Current run id is missing on the control plane.',
    nextAction: 'Regenerate current_run.json or re-run the worker so run binding is restored.',
    runId,
    currentRun
  };
} else {
  orchestrationBlocker = resolveCampaignBlocker({ canonicalSummary, programState: delegateProgramState, blockerReport: delegateBlocker || workerBlocker, workerStatus });
  if (targetedSemanticReplaySatisfied) {
    orchestrationBlocker = null;
  }
  if (remoteProgress.active) {
    orchestrationBlocker = null;
  }
  if (!orchestrationBlocker && canonicalSummary?.supervisorStatus === 'green' && !freshDelegateEvidence) {
    orchestrationBlocker = buildStaleDelegateEvidenceBlocker({ runId, currentRun });
  }
  if (!orchestrationBlocker && canonicalSummary?.supervisorStatus === 'green' && delegateTruthConflict.hasConflict) {
    orchestrationBlocker = buildContradictoryDelegateTruthBlocker({ conflict: delegateTruthConflict, runId });
  }
  if (!orchestrationBlocker && canonicalSummary?.supervisorStatus === 'green') {
    const landingEvidence = syncStatus?.runId === runId ? syncStatus?.canonicalLandingEvidence : null;
    if (!landingEvidence || landingEvidence.ok !== true) {
      orchestrationBlocker = {
        blocker: 'Supervisor green is blocked because no new product-surface diff was proven landed in the canonical checkout.',
        nextAction: 'Fix remote baseline/path sync and rerun; do not credit parity surfaces from patch admission alone.',
        runId,
        blockerKind: 'canonical_landing_evidence_missing',
        canonicalLandingEvidence: landingEvidence || null,
        syncStatusPath: path.relative(ROOT, SYNC_STATUS_PATH)
      };
    }
  }
}

const orchestration = targetedSemanticReplaySatisfied
  ? {
      supervisorStatus: 'green',
      matrixStatus: 'all_complete',
      parityStatus: 'parity_for_scope',
      green: true,
      targetedSemanticReplaySatisfied: true
    }
  : deriveCanonicalStatuses({ canonicalSummary, programState: delegateProgramState, blocker: orchestrationBlocker });
const productThroughput = deriveProductThroughputEvidence({
  liveExecutionSummary: delegateLiveExecutionSummary,
  patchQueueReport: delegatePatchQueueReport,
  syncStatus
});
const benchmarkThresholdGate = !orchestrationBlocker && orchestration.green
  ? evaluateBenchmarkThresholdGate({
      contract,
      currentRun,
      canonicalSummary,
      delegateLiveExecutionSummary,
      delegatePatchQueueReport,
      autonomySoakProof
    })
  : {
      evaluated: false,
      pass: false,
      blocker: null,
      blockerKind: null,
      matrixStatus: null,
      parityStatus: null,
      thresholds: contract?.goThresholds || null,
      observed: null,
      failures: []
    };
writeJson(THRESHOLD_EVALUATION_PATH, {
  generatedAt: new Date().toISOString(),
  runId,
  benchmarkId: contract?.benchmarkId || null,
  benchmarkTier: contract?.benchmarkTier || null,
  fidelity: requestedFidelity,
  evaluated: benchmarkThresholdGate.evaluated,
  pass: benchmarkThresholdGate.pass,
  thresholds: benchmarkThresholdGate.thresholds,
  observed: benchmarkThresholdGate.observed,
  failures: benchmarkThresholdGate.failures,
  blocker: benchmarkThresholdGate.blocker || null
});
const requestedOutcome = deriveRequestedOutcome({
  requestedFidelity,
  orchestration,
  blocker: orchestrationBlocker,
  strict1to1,
  benchmarkGate: benchmarkThresholdGate,
  productThroughput,
  truthPreflight: mailchimpTruthPreflight
});
const finalBlocker = requestedOutcome.blocker || null;
const requestedAgentCount = Number(contract?.scope?.requestedAgentCount || contract?.requestedAgentCount || contract?.requestedAgents || 25) || 25;
const objectiveExpansionPlan = requestedFidelity === 'full_clone'
  ? buildObjectiveExpansionPlan({
    repoPath: ROOT,
    objective: {
      id: 'mailchimp_full_clone',
      title: 'Build a truthful full Mailchimp 1:1 clone from the canonical product objective, expanding missing architecture surfaces until strict supervisor green or real blocker.',
      requestedFidelity
    },
    requestedAgentCount,
    architectureEpics: true,
    stage: 'dynamic_final_boss_expansion',
    maxEpics: 5,
    currentSurfaceMatrix: strict1to1?.state || (fs.existsSync(controlPlaneSurfaceMatrixPath) ? readJson(controlPlaneSurfaceMatrixPath, null) : null),
    currentWorkCount: Array.isArray(nextFocus) ? nextFocus.length : 0,
    scopeAlreadySatisfied: orchestration.green === true && (!Array.isArray(nextFocus) || nextFocus.length === 0),
    supervisorState: {
      status: requestedOutcome.supervisorStatus,
      matrixStatus: requestedOutcome.matrixStatus,
      parityStatus: requestedOutcome.parityStatus,
      blockerKind: requestedOutcome.blockerKind || null,
      requestedFidelity
    }
  })
  : null;
if (objectiveExpansionPlan) {
  writeJson(OBJECTIVE_EXPANSION_PLAN_PATH, objectiveExpansionPlan);
}
let continuation = deriveCampaignContinuation({
  green: requestedOutcome.green,
  blocker: finalBlocker,
  blockerKind: requestedOutcome.blockerKind || null,
  nextFocus,
  requestedFidelity,
  matrixStatus: requestedOutcome.matrixStatus,
  parityStatus: requestedOutcome.parityStatus,
  currentWorkCount: Array.isArray(nextFocus) ? nextFocus.length : 0,
  scopeAlreadySatisfied: orchestration.green === true && (!Array.isArray(nextFocus) || nextFocus.length === 0),
  remainingObjectiveIds: objectiveExpansionPlan?.remainingObjectiveIds || strict1to1?.state?.remainingGaps || [],
  objectiveExpansionPlan: objectiveExpansionPlan ? {
    ...objectiveExpansionPlan,
    path: path.relative(ROOT, OBJECTIVE_EXPANSION_PLAN_PATH)
  } : null
});
if (shouldContinueAutonomySoak({ orchestration, benchmarkThresholdGate, currentRun })) {
  continuation = {
    ...continuation,
    blockerSemantics: 'retryable',
    decision: 'continue_next_iteration',
    shouldContinue: true,
    shouldStop: false
  };
}
const headline = buildOutcomeHeadline({ orchestration, requestedOutcome });
const notifierEligibility = buildNotifierEligibilityPayload({
  runId,
  supervisorStatus: requestedOutcome.supervisorStatus,
  matrixStatus: requestedOutcome.matrixStatus,
  blocker: continuation.shouldContinue ? null : finalBlocker,
  generatedAt: new Date().toISOString()
});

recoverCampaign(PROGRAM_STATE_PATH, {
  mode: 'persistent',
  stopCondition: contract.stopCondition || 'supervisor_green_or_blocker_report',
  contractPath: contractPath || null,
  matrixPath: fs.existsSync(controlPlaneSurfaceMatrixPath) ? controlPlaneSurfaceMatrixPath : null
});
setSupervisor(PROGRAM_STATE_PATH, {
  status: requestedOutcome.supervisorStatus,
  blocker: finalBlocker,
  blockerKind: requestedOutcome.blockerKind || null,
  matrixStatus: requestedOutcome.matrixStatus,
  parityStatus: requestedOutcome.parityStatus,
  note: requestedOutcome.note,
  nextFocus,
  requestedFidelity,
  currentWorkCount: Array.isArray(nextFocus) ? nextFocus.length : 0,
  scopeAlreadySatisfied: orchestration.green === true && (!Array.isArray(nextFocus) || nextFocus.length === 0),
  remainingObjectiveIds: objectiveExpansionPlan?.remainingObjectiveIds || strict1to1?.state?.remainingGaps || [],
  objectiveExpansionPlan: objectiveExpansionPlan ? {
    path: path.relative(ROOT, OBJECTIVE_EXPANSION_PLAN_PATH),
    shouldExpand: objectiveExpansionPlan.shouldExpand,
    reason: objectiveExpansionPlan.reason,
    mode: objectiveExpansionPlan.mode,
    expansionSurfaceCount: objectiveExpansionPlan.expansionSurfaceCount,
    expansionWorkUnitCount: objectiveExpansionPlan.expansionWorkUnitCount,
    remainingObjectiveIds: objectiveExpansionPlan.remainingObjectiveIds,
    truthBoundary: objectiveExpansionPlan.truthBoundary
  } : null,
  continuationDecision: continuation.decision,
  continuation
});

const notificationState = {
  delivered: oldNotification?.runId === runId ? Boolean(oldNotification.delivered) : false,
  deliveredAt: oldNotification?.runId === runId ? oldNotification.deliveredAt || null : null,
  awaitingNotifier: Boolean(notifierEligibility.eligible && !(oldNotification?.runId === runId && oldNotification?.delivered)),
  kind: notifierEligibility.kind || null,
  runId,
  updatedAt: new Date().toISOString(),
  blocker: continuation.shouldContinue ? null : finalBlocker,
  blockerKind: requestedOutcome.blockerKind || null,
  continuationDecision: continuation.decision
};

const programState = readJson(PROGRAM_STATE_PATH, {});
programState.generatedAt = new Date().toISOString();
programState.runId = runId;
programState.currentRun = currentRun;
programState.nextFocus = nextFocus;
programState.supervisor = {
  ...programState.supervisor,
  status: requestedOutcome.supervisorStatus,
  matrixStatus: requestedOutcome.matrixStatus,
  parityStatus: requestedOutcome.parityStatus,
  blocker: finalBlocker,
  blockerKind: requestedOutcome.blockerKind || null,
  note: requestedOutcome.note,
  headline,
  orchestration,
  requestedOutcome,
  canonicalSummaryPath: canonicalSummaryPath ? path.relative(ROOT, canonicalSummaryPath) : null,
  delegateBlockerPath: delegateBlockerPath ? path.relative(ROOT, delegateBlockerPath) : null,
  workerBlockerPath: workerBlockerPath ? path.relative(ROOT, workerBlockerPath) : null,
  delegateSurfaceMatrixPath: delegateSurfaceMatrixPath ? path.relative(ROOT, delegateSurfaceMatrixPath) : null,
  surfaceMatrixPath: fs.existsSync(controlPlaneSurfaceMatrixPath) ? path.relative(ROOT, controlPlaneSurfaceMatrixPath) : null,
  notifierEligibilityPath: notifierEligibilityPath ? path.relative(ROOT, notifierEligibilityPath) : null,
  delegateEvidenceFresh: freshDelegateEvidence,
  delegateTruthConflict,
  remoteProgress,
  strict1to1,
  objectiveExpansionPlanPath: objectiveExpansionPlan ? path.relative(ROOT, OBJECTIVE_EXPANSION_PLAN_PATH) : null,
  objectiveExpansionPlan: objectiveExpansionPlan ? {
    shouldExpand: objectiveExpansionPlan.shouldExpand,
    reason: objectiveExpansionPlan.reason,
    mode: objectiveExpansionPlan.mode,
    expansionSurfaceCount: objectiveExpansionPlan.expansionSurfaceCount,
    expansionWorkUnitCount: objectiveExpansionPlan.expansionWorkUnitCount,
    remainingObjectiveIds: objectiveExpansionPlan.remainingObjectiveIds,
    truthBoundary: objectiveExpansionPlan.truthBoundary
  } : null,
  thresholdEvaluationPath: path.relative(ROOT, THRESHOLD_EVALUATION_PATH),
  benchmarkThresholdGate,
  productThroughput,
  mailchimpTruthPreflightPath: path.relative(ROOT, MAILCHIMP_TRUTH_PREFLIGHT_PATH),
  mailchimpTruthPreflight,
  continuationDecision: continuation.decision,
  continuation,
  delegateLiveExecutionSummaryPath: delegateLiveExecutionSummaryPath ? path.relative(ROOT, delegateLiveExecutionSummaryPath) : null,
  delegatePatchQueueReportPath: delegatePatchQueueReportPath ? path.relative(ROOT, delegatePatchQueueReportPath) : null,
  syncStatusPath: path.relative(ROOT, SYNC_STATUS_PATH),
  canonicalLandingEvidence: syncStatus?.canonicalLandingEvidence || null
};
programState.stopAllowed = continuation.shouldStop;
programState.done = continuation.shouldStop;
programState.stopReason = continuation.decision === 'stop_green'
  ? 'supervisor_green'
  : continuation.decision === 'stop_claim_blocked'
    ? 'supervisor_claim_blocked'
    : continuation.decision === 'stop_blocked'
      ? 'supervisor_red_with_blocker'
      : 'continue';
programState.workerStatusPath = path.relative(ROOT, path.join(REPORTS_DIR, '100_agent_worker_status.json'));
programState.workerStatus = workerStatus;

const summary = {
  generatedAt: new Date().toISOString(),
  runId,
  fidelity: requestedFidelity,
  targetPath: contract.targetPath || ROOT,
  stopCondition: contract.stopCondition || 'supervisor_green_or_blocker_report',
  matrixStatus: requestedOutcome.matrixStatus,
  supervisorStatus: requestedOutcome.supervisorStatus,
  parityStatus: requestedOutcome.parityStatus,
  nextFocus,
  blocker: finalBlocker,
  blockerKind: requestedOutcome.blockerKind || null,
  note: requestedOutcome.note,
  headline,
  orchestration,
  requestedOutcome,
  canonicalSummaryPath: canonicalSummaryPath ? path.relative(ROOT, canonicalSummaryPath) : null,
  delegateBlockerPath: delegateBlockerPath ? path.relative(ROOT, delegateBlockerPath) : null,
  workerBlockerPath: workerBlockerPath ? path.relative(ROOT, workerBlockerPath) : null,
  delegateSurfaceMatrixPath: delegateSurfaceMatrixPath ? path.relative(ROOT, delegateSurfaceMatrixPath) : null,
  surfaceMatrixPath: fs.existsSync(controlPlaneSurfaceMatrixPath) ? path.relative(ROOT, controlPlaneSurfaceMatrixPath) : null,
  notifierEligibilityPath: notifierEligibilityPath ? path.relative(ROOT, notifierEligibilityPath) : null,
  delegateEvidenceFresh: freshDelegateEvidence,
  delegateTruthConflict,
  remoteProgress,
  strict1to1,
  objectiveExpansionPlanPath: objectiveExpansionPlan ? path.relative(ROOT, OBJECTIVE_EXPANSION_PLAN_PATH) : null,
  objectiveExpansionPlan: objectiveExpansionPlan ? {
    shouldExpand: objectiveExpansionPlan.shouldExpand,
    reason: objectiveExpansionPlan.reason,
    mode: objectiveExpansionPlan.mode,
    expansionSurfaceCount: objectiveExpansionPlan.expansionSurfaceCount,
    expansionWorkUnitCount: objectiveExpansionPlan.expansionWorkUnitCount,
    remainingObjectiveIds: objectiveExpansionPlan.remainingObjectiveIds,
    truthBoundary: objectiveExpansionPlan.truthBoundary
  } : null,
  thresholdEvaluationPath: path.relative(ROOT, THRESHOLD_EVALUATION_PATH),
  benchmarkThresholdGate,
  productThroughput,
  mailchimpTruthPreflightPath: path.relative(ROOT, MAILCHIMP_TRUTH_PREFLIGHT_PATH),
  mailchimpTruthPreflight,
  continuationDecision: continuation.decision,
  continuation,
  orchestrationConfirmedCompletion: orchestration.green,
  supervisorConfirmedCompletion: requestedOutcome.green
};

writeJson(PROGRAM_STATE_PATH, programState);
writeJson(SUMMARY_PATH, summary);
writeJson(NOTIFY_PATH, notificationState);
writeJson(STATUS_REPORT_PATH, {
  generatedAt: new Date().toISOString(),
  runId,
  supervisorStatus: requestedOutcome.supervisorStatus,
  matrixStatus: requestedOutcome.matrixStatus,
  parityStatus: requestedOutcome.parityStatus,
  blocker: finalBlocker,
  blockerKind: requestedOutcome.blockerKind || null,
  note: requestedOutcome.note,
  headline,
  orchestration,
  requestedOutcome,
  canonicalSummary,
  delegateLiveExecutionSummary,
  delegatePatchQueueReport,
  delegateBlocker,
  workerBlocker,
  remoteProgress,
  strict1to1,
  objectiveExpansionPlanPath: objectiveExpansionPlan ? path.relative(ROOT, OBJECTIVE_EXPANSION_PLAN_PATH) : null,
  objectiveExpansionPlan: objectiveExpansionPlan ? {
    shouldExpand: objectiveExpansionPlan.shouldExpand,
    reason: objectiveExpansionPlan.reason,
    mode: objectiveExpansionPlan.mode,
    expansionSurfaceCount: objectiveExpansionPlan.expansionSurfaceCount,
    expansionWorkUnitCount: objectiveExpansionPlan.expansionWorkUnitCount,
    remainingObjectiveIds: objectiveExpansionPlan.remainingObjectiveIds,
    truthBoundary: objectiveExpansionPlan.truthBoundary
  } : null,
  thresholdEvaluationPath: path.relative(ROOT, THRESHOLD_EVALUATION_PATH),
  benchmarkThresholdGate,
  productThroughput,
  mailchimpTruthPreflight,
  continuationDecision: continuation.decision,
  continuation,
  notifierEligibility,
  currentRun,
  workerStatus
});
if (finalBlocker && continuation.shouldStop) writeJson(BLOCKER_PATH, finalBlocker); else rmIfExists(BLOCKER_PATH);

console.log(JSON.stringify({
  runId,
  supervisorStatus: requestedOutcome.supervisorStatus,
  matrixStatus: requestedOutcome.matrixStatus,
  parityStatus: requestedOutcome.parityStatus,
  blocker: finalBlocker,
  blockerKind: requestedOutcome.blockerKind || null,
  requestedOutcome,
  productThroughput,
  mailchimpTruthPreflight: { ok: mailchimpTruthPreflight.ok, guardrail: mailchimpTruthPreflight.guardrail },
  headline
}, null, 2));
process.exit(requestedOutcome.green ? 0 : finalBlocker ? 1 : 2);
