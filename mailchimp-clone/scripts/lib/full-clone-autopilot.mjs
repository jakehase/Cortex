import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { resolveProgramEnvKeys, resolveProgramPaths, resolveProgramScriptPath } from './orchestration-program-config.mjs';

export const AUTOPILOT_VERSION = 1;
export const FINAL_BOSS_CONTRACT_RELATIVE_PATH = 'docs/MAILCHIMP_FINAL_BOSS_FULL_CLONE_BENCHMARK_CONTRACT_2026-05-08.json';

export function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

export function writeJson(filePath, payload) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

export function normalizeFocusIds(values = []) {
  return Array.from(new Set((Array.isArray(values) ? values : [])
    .map((entry) => String(entry || '').trim())
    .filter((entry) => entry.startsWith('focus.'))));
}

function surfaceFocusId(surface = {}) {
  const direct = String(surface?.focusId || '').trim();
  if (direct.startsWith('focus.')) return direct;
  const fromIssues = Array.isArray(surface?.issueIds)
    ? surface.issueIds.find((id) => String(id || '').trim().startsWith('focus.'))
    : null;
  if (fromIssues) return String(fromIssues).trim();
  const id = String(surface?.id || '').trim();
  return id ? `focus.${id}` : null;
}

function incompleteSurfaceFocusIds(surfaceMatrix = {}) {
  const surfaces = Array.isArray(surfaceMatrix?.surfaces) ? surfaceMatrix.surfaces : [];
  return normalizeFocusIds(surfaces
    .filter((surface) => !['all_complete', 'proven_complete', 'complete'].includes(String(surface?.status || '').toLowerCase()))
    .map(surfaceFocusId));
}

function completedSurfaceFocusIds(surfaceMatrix = {}) {
  const surfaces = Array.isArray(surfaceMatrix?.surfaces) ? surfaceMatrix.surfaces : [];
  return normalizeFocusIds(surfaces
    .filter((surface) => ['all_complete', 'proven_complete', 'complete'].includes(String(surface?.status || '').toLowerCase()))
    .map(surfaceFocusId));
}

function wouldExhaustOpenFocusAfterRotation({ nextFocus = [], state = {}, surfaceMatrix = {} } = {}) {
  const incomplete = incompleteSurfaceFocusIds(surfaceMatrix);
  if (incomplete.length === 0) return false;
  const completed = new Set(normalizeFocusIds(state.completedFocusIds || []));
  const excludedAfterRotation = new Set(normalizeFocusIds([
    ...(state.excludedFocusIds || []),
    ...nextFocus
  ]));
  const stillOpen = incomplete.filter((focusId) => !completed.has(focusId) && !excludedAfterRotation.has(focusId));
  return stillOpen.length === 0;
}

function fileMtimeMs(filePath) {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return 0;
  }
}

function timestampMs(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function hasFreshImplementationRepair(snapshot = {}) {
  const implementationMtimeMs = Number(snapshot.implementationScriptMtimeMs || 0);
  const blockerGeneratedAtMs = Math.max(
    timestampMs(snapshot.blockerReport?.generatedAt),
    timestampMs(snapshot.persistentStatus?.generatedAt),
    timestampMs(snapshot.noProgressAudit?.generatedAt),
    timestampMs(snapshot.summary?.generatedAt)
  );
  return implementationMtimeMs > 0 && blockerGeneratedAtMs > 0 && implementationMtimeMs > blockerGeneratedAtMs;
}

function blockerText(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value.blocker === 'string') return value.blocker;
  return '';
}

function nestedBlocker(summary = {}) {
  return summary?.blocker || summary?.requestedOutcome?.blocker || null;
}

function productLandingDelta(summary = {}, syncStatus = {}) {
  return Number(summary?.productThroughput?.newlyLandedProductFileCount
    ?? syncStatus?.canonicalLandingEvidence?.newlyLandedProductFileCount
    ?? 0) || 0;
}

function mergedPatchCount(summary = {}, liveExecution = {}, patchQueue = {}) {
  return Number(summary?.productThroughput?.mergedPatchCount
    ?? liveExecution?.metrics?.mergedPatchCount
    ?? (Array.isArray(patchQueue?.merged) ? patchQueue.merged.length : 0)
    ?? 0) || 0;
}

function rejectionSummary(summary = {}, patchQueue = {}) {
  const fromSummary = summary?.blocker?.rejectionSummary || summary?.requestedOutcome?.blocker?.rejectionSummary;
  if (fromSummary && typeof fromSummary === 'object') return fromSummary;
  const counts = {};
  for (const rejected of Array.isArray(patchQueue?.rejected) ? patchQueue.rejected : []) {
    const key = String(rejected?.rejectionReason || rejected?.reason || rejected?.status || 'unknown');
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function nextFocusCandidates(snapshot = {}) {
  return normalizeFocusIds([
    ...(snapshot.summary?.nextFocus || []),
    ...(snapshot.blockerReport?.nextFocus || []),
    ...(snapshot.persistentStatus?.blocker?.nextFocus || []),
    ...(snapshot.noProgressAudit?.nextFocus || []),
    ...(snapshot.noProgressAudit?.streak?.at?.(-1)?.nextFocus || [])
  ]);
}

export function artifactPaths(rootDir) {
  const programPaths = resolveProgramPaths(rootDir);
  return {
    ...programPaths,
    noProgressAuditPath: path.join(programPaths.artifactDir, 'no_progress_audit.json'),
    surfaceMatrixPath: path.join(programPaths.artifactDir, 'surface_matrix.json'),
    liveExecutionSummaryPath: path.join(rootDir, 'artifacts', 'qualification', 'orchestrator_real_repo_clean_baseline', 'live_execution_summary.json'),
    patchQueueReportPath: path.join(rootDir, 'artifacts', 'qualification', 'orchestrator_real_repo_clean_baseline', 'patch_queue_report.json'),
    autopilotStatePath: path.join(programPaths.artifactDir, 'full_clone_autopilot_state.json'),
    launchScriptPath: path.join(rootDir, 'scripts', 'full-audit-campaign-launch.mjs'),
    implementationScriptPath: resolveProgramScriptPath(rootDir, 'implementation')
  };
}

export function readAutopilotState(statePath) {
  const state = readJson(statePath, null);
  if (state && typeof state === 'object') return {
    version: AUTOPILOT_VERSION,
    cycles: [],
    excludedFocusIds: [],
    completedFocusIds: [],
    lastAction: null,
    ...state,
    excludedFocusIds: normalizeFocusIds(state.excludedFocusIds || []),
    completedFocusIds: normalizeFocusIds(state.completedFocusIds || []),
    cycles: Array.isArray(state.cycles) ? state.cycles : []
  };
  return {
    version: AUTOPILOT_VERSION,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'new',
    cycles: [],
    excludedFocusIds: [],
    completedFocusIds: [],
    lastAction: null
  };
}

export function buildArtifactSnapshot(rootDir) {
  const paths = artifactPaths(rootDir);
  return {
    generatedAt: new Date().toISOString(),
    rootDir,
    paths,
    summary: readJson(paths.summaryPath, {}),
    persistentStatus: readJson(paths.persistentRunnerStatusPath, {}),
    blockerReport: readJson(paths.blockerPath, {}),
    programState: readJson(paths.programStatePath, {}),
    workerStatus: readJson(paths.workerStatusPath, {}),
    syncStatus: readJson(paths.syncStatusPath, {}),
    surfaceMatrix: readJson(paths.surfaceMatrixPath, {}),
    noProgressAudit: readJson(paths.noProgressAuditPath, {}),
    liveExecution: readJson(paths.liveExecutionSummaryPath, {}),
    patchQueue: readJson(paths.patchQueueReportPath, { merged: [], rejected: [] }),
    implementationScriptMtimeMs: fileMtimeMs(paths.implementationScriptPath)
  };
}

export function classifyAutopilot(snapshot = {}, state = {}) {
  const summary = snapshot.summary || {};
  const persistentStatus = snapshot.persistentStatus || {};
  const workerStatus = snapshot.workerStatus || {};
  const blocker = persistentStatus.blocker || snapshot.blockerReport?.blocker || nestedBlocker(summary) || null;
  const text = blockerText(blocker);
  const blockerKind = persistentStatus.blockerKind || summary.blockerKind || snapshot.blockerReport?.blockerKind || null;
  const nextFocus = nextFocusCandidates(snapshot);
  const matrixCompletedFocusIds = completedSurfaceFocusIds(snapshot.surfaceMatrix || {});
  const exhaustedAfterRotation = wouldExhaustOpenFocusAfterRotation({
    nextFocus,
    state,
    surfaceMatrix: snapshot.surfaceMatrix || {}
  });
  const freshImplementationRepair = hasFreshImplementationRepair(snapshot);
  const landingDelta = productLandingDelta(summary, snapshot.syncStatus || {});
  const mergedCount = mergedPatchCount(summary, snapshot.liveExecution || {}, snapshot.patchQueue || {});
  const rejections = rejectionSummary(summary, snapshot.patchQueue || {});
  const noProgressBlocked = persistentStatus.status === 'blocked'
    && /no-progress circuit breaker|consecutive red iterations|no canonical product landing delta/i.test(text);
  const plannerNoOp = /Planner emitted .*no-op|no admissible parity-surface reduction|zero_modified_files|no-op/i.test(text)
    || Number(rejections.no_op || rejections.zero_modified_files || 0) > 0;

  if (summary.fidelity === 'full_clone'
    && summary.supervisorConfirmedCompletion === true
    && summary.supervisorStatus === 'green'
    && ['full', 'full_clone'].includes(String(summary.parityStatus || '').toLowerCase())) {
    return {
      status: 'green',
      family: 'full_clone_green',
      action: 'finish',
      reason: 'Full-clone supervisor green is present.',
      nextFocus,
      landingDelta,
      mergedCount,
      blockerKind,
      blocker: null
    };
  }

  if (noProgressBlocked) {
    if (exhaustedAfterRotation && freshImplementationRepair && nextFocus.length > 0) {
      return {
        status: 'red',
        family: 'no_progress_repaired_focus',
        action: 'fix_then_relaunch',
        repairMode: 'unexclude_repaired_focus',
        reason: 'A fresh implementation repair exists for the only remaining no-progress focus; retry it instead of keeping it excluded.',
        nextFocus,
        completedFocusIds: matrixCompletedFocusIds,
        landingDelta,
        mergedCount,
        blockerKind,
        blocker,
        rejections,
        exhaustedAfterRotation,
        freshImplementationRepair
      };
    }
    return {
      status: 'red',
      family: 'no_progress_circuit',
      action: nextFocus.length > 0 && !exhaustedAfterRotation ? 'fix_then_relaunch' : 'hard_block',
      reason: 'Persistent runner stopped after repeated no-progress iterations.',
      nextFocus,
      completedFocusIds: matrixCompletedFocusIds,
      landingDelta,
      mergedCount,
      blockerKind,
      blocker,
      rejections,
      exhaustedAfterRotation,
      freshImplementationRepair
    };
  }

  if (blockerKind === 'strict_1to1_ceiling' && landingDelta > 0) {
    return {
      status: 'red',
      family: 'strict_ceiling_with_progress',
      action: 'relaunch',
      reason: 'Strict full-clone ceiling remains red, but product progress landed.',
      nextFocus,
      landingDelta,
      mergedCount,
      blockerKind,
      blocker,
      rejections
    };
  }

  if (plannerNoOp) {
    if (exhaustedAfterRotation && freshImplementationRepair && nextFocus.length > 0) {
      return {
        status: 'red',
        family: 'planner_noop_repaired_focus',
        action: 'fix_then_relaunch',
        repairMode: 'unexclude_repaired_focus',
        reason: 'A fresh implementation repair exists for the saturated planner focus; retry it instead of keeping it excluded.',
        nextFocus,
        completedFocusIds: matrixCompletedFocusIds,
        landingDelta,
        mergedCount,
        blockerKind,
        blocker,
        rejections,
        exhaustedAfterRotation,
        freshImplementationRepair
      };
    }
    return {
      status: 'red',
      family: 'planner_noop_or_rejected',
      action: nextFocus.length > 0 && !exhaustedAfterRotation ? 'fix_then_relaunch' : 'hard_block',
      reason: 'Planner/worker produced no admissible product patch.',
      nextFocus,
      completedFocusIds: matrixCompletedFocusIds,
      landingDelta,
      mergedCount,
      blockerKind,
      blocker,
      rejections,
      exhaustedAfterRotation,
      freshImplementationRepair
    };
  }

  if (workerStatus.running === true || persistentStatus.running === true || summary.supervisorStatus === 'running') {
    return {
      status: 'running',
      family: 'run_in_progress',
      action: 'wait',
      reason: 'A full-clone campaign is still running.',
      nextFocus,
      landingDelta,
      mergedCount,
      blockerKind,
      blocker,
      rejections
    };
  }

  if (text) {
    return {
      status: 'red',
      family: blockerKind || 'unclassified_blocker',
      action: 'hard_block',
      reason: 'Blocker is not in the autopilot autofix allowlist.',
      nextFocus,
      landingDelta,
      mergedCount,
      blockerKind,
      blocker,
      rejections
    };
  }

  return {
    status: 'unknown',
    family: 'no_current_truth',
    action: 'relaunch',
    reason: 'No terminal full-clone truth artifact was found.',
    nextFocus,
    landingDelta,
    mergedCount,
    blockerKind,
    blocker,
    rejections
  };
}

export function applyAutofix(classification, state) {
  const nextState = {
    ...state,
    updatedAt: new Date().toISOString(),
    excludedFocusIds: normalizeFocusIds(state.excludedFocusIds || []),
    completedFocusIds: normalizeFocusIds(state.completedFocusIds || []),
    cycles: Array.isArray(state.cycles) ? [...state.cycles] : []
  };
  if (classification.action !== 'fix_then_relaunch') {
    return { ok: true, changed: false, state: nextState, fix: null };
  }

  nextState.completedFocusIds = normalizeFocusIds([
    ...nextState.completedFocusIds,
    ...(classification.completedFocusIds || [])
  ]);

  const focusToRotate = normalizeFocusIds(classification.nextFocus || [])
    .filter((focusId) => !nextState.completedFocusIds.includes(focusId));
  if (focusToRotate.length === 0) {
    return {
      ok: false,
      changed: false,
      state: nextState,
      fix: {
        kind: 'no_autofix_without_focus',
        reason: 'Autopilot needs at least one focus id to rotate or repair.'
      }
    };
  }

  const before = new Set(nextState.excludedFocusIds);
  if (classification.repairMode === 'unexclude_repaired_focus') {
    const repaired = new Set(focusToRotate);
    nextState.excludedFocusIds = normalizeFocusIds(nextState.excludedFocusIds.filter((focusId) => !repaired.has(focusId)));
    const fix = {
      kind: 'unexclude_repaired_focus',
      focusIds: focusToRotate,
      reason: 'A code repair changed the implementation path for the saturated focus, so the focus is retried without marking it complete.'
    };
    nextState.lastFix = { ...fix, at: new Date().toISOString(), family: classification.family };
    return { ok: true, changed: true, state: nextState, fix };
  }
  for (const focusId of focusToRotate) before.add(focusId);
  nextState.excludedFocusIds = normalizeFocusIds(Array.from(before));
  const fix = {
    kind: 'rotate_saturated_focus',
    focusIds: focusToRotate,
    reason: 'A focus that repeatedly produced no product landing is temporarily excluded so other full-clone gaps can continue. This is not completion credit.'
  };
  nextState.lastFix = { ...fix, at: new Date().toISOString(), family: classification.family };
  return { ok: true, changed: true, state: nextState, fix };
}

function makeStamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z').replace('T', '-').replace(/Z$/, '');
}

export function buildRelaunchPlan({ rootDir, state, cycleIndex = 1, nowStamp = makeStamp() } = {}) {
  const paths = artifactPaths(rootDir);
  const envKeys = resolveProgramEnvKeys();
  const campaignRunId = `campaign-${nowStamp}-mailchimp-full-clone-autopilot-${String(cycleIndex).padStart(3, '0')}`;
  const env = {
    ORCHESTRATOR_REQUESTED_FIDELITY: 'full_clone',
    ORCHESTRATOR_IMPLEMENTATION_PROFILE: 'mailchimp_parity_focus',
    [envKeys.campaignRunId]: campaignRunId,
    [envKeys.runId]: `${campaignRunId}-launch`,
    [envKeys.productOnly]: '1',
    [envKeys.useBenchmarkScope]: '0',
    [envKeys.useStrictGapInventory]: '1',
    [envKeys.strictGapSequence]: '0',
    [envKeys.requestedAgentCount]: String(process.env[envKeys.requestedAgentCount] || '100'),
    [envKeys.maxRuntimeHours]: String(process.env[envKeys.maxRuntimeHours] || '6'),
    [envKeys.noProgressIterationLimit]: String(process.env[envKeys.noProgressIterationLimit] || '5'),
    [envKeys.onePassContractPath]: process.env[envKeys.onePassContractPath] || FINAL_BOSS_CONTRACT_RELATIVE_PATH,
    [envKeys.completedFocusIds]: normalizeFocusIds(state.completedFocusIds || []).join(','),
    MAILCHIMP_EXCLUDED_FOCUS_IDS: normalizeFocusIds(state.excludedFocusIds || []).join(','),
    MAILCHIMP_AUTOPILOT_CHILD: '1',
    MAILCHIMP_CONTINUE_UNTIL_GLOBAL_PARITY: '1',
    MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION: '1',
    MAILCHIMP_ENABLE_FULL_CLONE_FRONTIER_EXPANSION: '1',
    MAILCHIMP_ENABLE_FULL_CLONE_REMEDIATION_EXPANSION: '1',
    MAILCHIMP_ENABLE_FULL_CLONE_STRICT_REMEDIATION_EXPANSION: '1',
    MAILCHIMP_ENABLE_FULL_CLONE_CONTINUATION_EXPANSION: '1',
    MAILCHIMP_ENABLE_SEMANTIC_WORK_DIRECTOR: '1',
    MAILCHIMP_SEMANTIC_WORK_DIRECTOR_FORCE: '1',
    MAILCHIMP_SEMANTIC_WORK_DIRECTOR_SKIP_ADOPTED_PHASES: '0',
    MAILCHIMP_SEMANTIC_WORK_DIRECTOR_MAX_GAPS: process.env.MAILCHIMP_SEMANTIC_WORK_DIRECTOR_MAX_GAPS || '26',
    MAILCHIMP_ALLOW_SYNTHETIC_PARITY_DELTAS: '0',
    MAILCHIMP_ALLOW_BENCHMARK_GROUNDING_FALLBACK: '0'
  };
  return {
    campaignRunId,
    command: process.execPath,
    args: [paths.launchScriptPath],
    cwd: rootDir,
    env
  };
}

export function runRelaunch(plan, { dryRun = false, timeoutMs = 6 * 60 * 60 * 1000 } = {}) {
  if (dryRun) {
    return { ok: true, dryRun: true, exitCode: null, stdout: '', stderr: '', plan };
  }
  const result = spawnSync(plan.command, plan.args, {
    cwd: plan.cwd,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 1024 * 1024 * 200,
    env: { ...process.env, ...plan.env }
  });
  return {
    ok: result.status === 0 && !result.error,
    dryRun: false,
    exitCode: result.status,
    signal: result.signal,
    error: result.error ? String(result.error.message || result.error) : null,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    plan
  };
}

export function recordCycle(state, cycle) {
  const next = {
    ...state,
    version: AUTOPILOT_VERSION,
    updatedAt: new Date().toISOString(),
    status: cycle.classification?.status || state.status || 'unknown',
    lastAction: cycle.classification?.action || null,
    cycles: [...(Array.isArray(state.cycles) ? state.cycles : []), cycle]
  };
  return next;
}
