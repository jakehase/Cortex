import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { deriveCampaignContinuation, initializeCampaign, installProcessTerminationPersistence } from '../../large-project-capability-stack/packages/campaign-runtime/index.mjs';
import { buildMailchimpParityFocusWorkGraph, extractVerifiedFocusIdsFromPatchQueue, mailchimpParityFocusIds } from './lib/orchestrator-real-repo-clean-plan.mjs';
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
function blockerText(blocker) {
  if (typeof blocker === 'string') return blocker;
  if (blocker && typeof blocker.blocker === 'string') return blocker.blocker;
  return '';
}
function deriveCompletedFocusIds(iterationRecord = null) {
  const parityFocusIds = mailchimpParityFocusIds();
  const mergedFocusIds = new Set(normalizeFocusIds(iterationRecord?.mergedFocusIds || []));
  if (mergedFocusIds.size > 0) return parityFocusIds.filter((focusId) => mergedFocusIds.has(focusId));
  return [];
}
function deriveNextFocusFromSurfaceMatrix(surfaceMatrix = null) {
  const parityFocusIds = mailchimpParityFocusIds();
  const surfaces = Array.isArray(surfaceMatrix?.surfaces) ? surfaceMatrix.surfaces : [];
  return surfaces
    .filter((surface) => surface && !['all_complete', 'proven_complete', 'complete'].includes(surface.status))
    .map((surface) => `focus.${String(surface.id || '').trim()}`)
    .filter((focusId) => parityFocusIds.includes(focusId));
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
  if (/no-op|ungrounded patch candidate|rejected patch|rejected without resolution/i.test(text)) return 'empty_or_rejected_patch_work';
  if (/selected live qualification tier reported green without any live shard work/i.test(text)) return 'empty_live_work';
  return null;
}
function consecutiveNoProgressIterations(records = []) {
  const streak = [];
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index];
    const reason = classifyNoProgressReason(record);
    if (!reason) break;
    streak.unshift({ ...record, noProgressReason: reason });
  }
  return streak;
}
function buildNoProgressAudit(records = []) {
  const streak = consecutiveNoProgressIterations(records);
  const repeatedNextFocus = streak.length > 0
    ? streak.every((record) => normalizeFocusIds(record.nextFocus).join(',') === normalizeFocusIds(streak[0].nextFocus).join(','))
    : false;
  return {
    generatedAt: new Date().toISOString(),
    campaignRunId: CAMPAIGN_RUN_ID,
    maxNoProgressIterations: MAX_NO_PROGRESS_ITERATIONS,
    streakLength: streak.length,
    repeatedNextFocus,
    recentIterations: streak.map((record) => ({
      iteration: record.iteration,
      runId: record.runId,
      blockerKind: record.blockerKind || null,
      blocker: blockerText(record.blocker),
      noProgressReason: record.noProgressReason,
      nextFocus: normalizeFocusIds(record.nextFocus)
    }))
  };
}
function readJsonForRun(file, runId, fallback = null) {
  const data = readJson(file, fallback);
  if (!data || typeof data !== 'object') return fallback;
  if (data.runId && data.runId !== runId) return fallback;
  return data;
}
function runIdFor(iteration) { return `${CAMPAIGN_RUN_ID}-iter-${String(iteration).padStart(3, '0')}`; }

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
  const prelaunchGates = contract?.prelaunchGates && typeof contract.prelaunchGates === 'object'
    ? contract.prelaunchGates
    : null;
  if (!prelaunchGates) {
    return {
      generatedAt: new Date().toISOString(),
      evaluated: false,
      pass: true,
      contractPath: fs.existsSync(CONTRACT_PATH) ? path.relative(ROOT, CONTRACT_PATH) : null,
      benchmarkId: contract?.benchmarkId || null,
      prelaunchGates: null,
      observed: null,
      failures: []
    };
  }

  const plan = buildMailchimpParityFocusWorkGraph();
  const workUnits = Array.isArray(plan?.workGraph?.workUnits) ? plan.workGraph.workUnits : [];
  const observed = {
    executableProductShards: workUnits.length,
    distinctFocusLanes: uniqueStrings(workUnits.map((unit) => unit?.lane)).length,
    realFileContractsOk: workUnits.every((unit) => Array.isArray(unit?.allowedFiles)
      && unit.allowedFiles.length > 0
      && unit?.metadata?.assignmentContract?.artifactKind === 'product_diff'),
    selectedFocusIds: uniqueStrings(workUnits.map((unit) => unit?.id)),
    selectedFocusLanes: uniqueStrings(workUnits.map((unit) => unit?.lane)),
    strictGapSequenceMode: Boolean(plan?.workGraph?.summary?.strictGapSequenceMode),
    strictGapCount: Number(plan?.workGraph?.summary?.strictGapCount || 0),
    generatedAt: new Date().toISOString()
  };
  const failures = [];

  const minShards = Number(prelaunchGates.minimumExecutableProductShards);
  if (Number.isFinite(minShards) && observed.executableProductShards < minShards) {
    failures.push({ field: 'minimumExecutableProductShards', comparator: '>=', required: minShards, observed: observed.executableProductShards });
  }
  const minLanes = Number(prelaunchGates.minimumFocusLanes);
  if (Number.isFinite(minLanes) && observed.distinctFocusLanes < minLanes) {
    failures.push({ field: 'minimumFocusLanes', comparator: '>=', required: minLanes, observed: observed.distinctFocusLanes });
  }
  if (prelaunchGates.requireRealFileContracts === true && !observed.realFileContractsOk) {
    failures.push({ field: 'requireRealFileContracts', comparator: '===', required: true, observed: observed.realFileContractsOk });
  }

  return {
    generatedAt: new Date().toISOString(),
    evaluated: true,
    pass: failures.length === 0,
    contractPath: path.relative(ROOT, CONTRACT_PATH),
    benchmarkId: contract?.benchmarkId || null,
    prelaunchGates,
    observed,
    failures
  };
}

ensureDir(ARTIFACT_DIR);
ensureDir(RUNS_DIR);
fs.rmSync(LOG_PATH, { force: true });
const generatorPreflight = spawnSync(process.execPath, ['--test', '--test-concurrency=1', GENERATOR_SUITE_PATH], {
  cwd: ROOT,
  encoding: 'utf8',
  maxBuffer: 1024 * 1024 * 80
});
appendLog(`===== generator preflight =====\n${generatorPreflight.stdout || ''}${generatorPreflight.stderr || ''}${generatorPreflight.error ? `\n[spawn-error] ${String(generatorPreflight.error.message || generatorPreflight.error)}` : ''}`);
writeJson(GENERATOR_PREFLIGHT_PATH, {
  generatedAt: new Date().toISOString(),
  ok: generatorPreflight.status === 0 && !generatorPreflight.error,
  exitCode: generatorPreflight.status,
  signal: generatorPreflight.signal,
  spawnError: generatorPreflight.error ? String(generatorPreflight.error.message || generatorPreflight.error) : null,
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
const iterations = [];
let overallStatus = 'running';
const completedFocusIds = new Set(normalizeFocusIds(String(process.env[PROGRAM_ENV.completedFocusIds] || '').split(',')));

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
    status: overallStatus,
    note: 'Driving repeated full-audit Mailchimp parity iterations until supervisor green or blocker.'
  });

  const sharedEnv = {
    ...process.env,
    [PROGRAM_ENV.campaignRunId]: CAMPAIGN_RUN_ID,
    [PROGRAM_ENV.runId]: runId,
    [PROGRAM_ENV.completedFocusIds]: Array.from(completedFocusIds).join(',')
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
  const blocker = blockerReport?.blocker || summary?.blocker || programState?.supervisor?.blocker || workerFailureBlocker || syncFailureBlocker || null;
  if ((workerFailureBlocker || syncFailureBlocker) && !blockerReport?.blocker) {
    writeJson(BLOCKER_PATH, {
      generatedAt: new Date().toISOString(),
      ...(workerFailureBlocker || syncFailureBlocker)
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
    nextFocus: summary?.nextFocus || blockerReport?.nextFocus || deriveNextFocusFromSurfaceMatrix(surfaceMatrix),
    mergedFocusIds: extractVerifiedFocusIdsFromPatchQueue(delegatePatchQueueReport),
    runDir: path.relative(ROOT, runDir)
  };
  iterations.push(iterationRecord);
  writeJson(path.join(runDir, 'iteration_record.json'), iterationRecord);
  for (const focusId of deriveCompletedFocusIds(iterationRecord)) completedFocusIds.add(focusId);

  const green = summary?.supervisorConfirmedCompletion === true
    || (!blocker && iterationRecord.supervisorStatus === 'green' && iterationRecord.matrixStatus === 'all_complete');
  iterationRecord.green = green;
  const continuation = iterationRecord.continuationDecision
    ? {
        ...deriveIterationContinuation(iterationRecord),
        decision: iterationRecord.continuationDecision,
        shouldContinue: iterationRecord.continuationDecision === 'continue_next_iteration',
        shouldStop: iterationRecord.continuationDecision !== 'continue_next_iteration'
      }
    : deriveIterationContinuation(iterationRecord);
  iterationRecord.continuationDecision = continuation.decision;
  iterationRecord.blockerSemantics = continuation.blockerSemantics;
  const noProgressStreak = consecutiveNoProgressIterations(iterations);
  if (noProgressStreak.length >= MAX_NO_PROGRESS_ITERATIONS) {
    const audit = buildNoProgressAudit(iterations);
    writeJson(NO_PROGRESS_AUDIT_PATH, audit);
    const noProgressBlocker = {
      blocker: `Persistent parity runner stopped after ${noProgressStreak.length} consecutive no-progress iterations.`,
      nextAction: 'Inspect no_progress_audit.json, repair planner grounding or merge admission, then relaunch from the next real focus surface.',
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
      status: 'blocked',
      blocker: noProgressBlocker,
      note: 'Full-audit Mailchimp parity campaign tripped the no-progress circuit breaker.'
    });
    runTerminalWatch();
    process.exit(1);
  }
  const softContinuation = continuation.shouldContinue;
  const hasBlocker = Boolean(blocker);
  if (green) {
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
        status: overallStatus,
        note: 'Supervisor green reached, but full-runtime soak mode is enabled so the campaign will continue until the runtime budget expires unless a real blocker appears.'
      });
      continue;
    }
    overallStatus = 'green';
    writeJson(STATUS_PATH, { generatedAt: new Date().toISOString(), running: false, campaignRunId: CAMPAIGN_RUN_ID, iteration, maxIterations: MAX_ITERATIONS, maxRuntimeHours: MAX_RUNTIME_HOURS, deadlineAt: new Date(DEADLINE_AT_MS).toISOString(), iterations, status: overallStatus, note: 'Full-audit Mailchimp parity campaign reached supervisor green.' });
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
      status: overallStatus,
      note: `Continuing after partial Mailchimp progress, ${normalizeFocusIds(iterationRecord.nextFocus).length} canonical surfaces remain.`
    });
    continue;
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
  status: overallStatus,
  note: runtimeBudgetReached
    ? 'Full-audit Mailchimp parity campaign hit the wall-clock runtime budget without green/blocker.'
    : 'Full-audit Mailchimp parity campaign hit the iteration cap without green/blocker.'
});
runTerminalWatch();
process.exit(runtimeBudgetReached ? 3 : 2);
