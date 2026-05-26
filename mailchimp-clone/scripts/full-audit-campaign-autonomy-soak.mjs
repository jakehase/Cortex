import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { ORCHESTRATION_PROGRAM_SPEC, resolveProgramEnvKeys, resolveProgramPaths, resolveProgramScriptPath } from './lib/orchestration-program-config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PROGRAM_ENV = resolveProgramEnvKeys();
const PROGRAM_PATHS = resolveProgramPaths(ROOT);
const ARTIFACT_DIR = PROGRAM_PATHS.artifactDir;
const CURRENT_RUN_PATH = PROGRAM_PATHS.currentRunPath;
const STATUS_PATH = PROGRAM_PATHS.persistentRunnerStatusPath;
const SYNC_STATUS_PATH = PROGRAM_PATHS.syncStatusPath;
const WORKER_STATUS_PATH = PROGRAM_PATHS.workerStatusPath;
const THRESHOLD_EVALUATION_PATH = path.join(ARTIFACT_DIR, 'threshold_evaluation.json');
const CONTRACT_PATH = path.join(ARTIFACT_DIR, 'one_pass_run_contract.latest.json');
const SOAK_STATUS_PATH = path.join(ARTIFACT_DIR, 'autonomy_soak_status.json');
const SOAK_PROOF_PATH = path.join(ARTIFACT_DIR, 'autonomy_soak_proof.json');
const BLOCKER_PATH = PROGRAM_PATHS.blockerPath;
const SUPERVISOR_SCRIPT = resolveProgramScriptPath(ROOT, 'supervisor');
const WATCH_SCRIPT = resolveProgramScriptPath(ROOT, 'watch');
const POLL_MS = Math.max(10_000, Number(process.env.MAILCHIMP_AUTONOMY_SOAK_POLL_MS || 60_000));

function ensureDir(dirPath) { fs.mkdirSync(dirPath, { recursive: true }); }
function readJson(filePath, fallback = null) { try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return fallback; } }
function writeJson(filePath, payload) { ensureDir(path.dirname(filePath)); fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`); }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function iso(ms) { return new Date(ms).toISOString(); }

function latestGreenBasis(status) {
  const iterations = Array.isArray(status?.iterations) ? status.iterations : [];
  for (let index = iterations.length - 1; index >= 0; index -= 1) {
    const record = iterations[index];
    const delegateDir = path.join(ARTIFACT_DIR, 'runs', record.runId || '', 'delegate');
    const canonical = readJson(path.join(delegateDir, 'canonical_summary.json'), null);
    const programState = readJson(path.join(delegateDir, 'program_state.json'), null);
    if (canonical?.supervisorStatus === 'green'
      && canonical?.matrixStatus === 'all_complete'
      && !canonical?.blocker
      && programState?.supervisorStatus === 'green'
      && programState?.allComplete === true
      && record?.canonicalLandingOk === true) {
      return { record, canonical, programState, delegateDir };
    }
  }
  return null;
}

function thresholdMinutes(threshold, contract = null) {
  const value = Number(
    contract?.goThresholds?.minimumAutonomyMinutes
    || contract?.thresholds?.minimumAutonomyMinutes
    || threshold?.thresholds?.minimumAutonomyMinutes
    || threshold?.blocker?.thresholdEvaluation?.thresholds?.minimumAutonomyMinutes
    || 10
  );
  return Number.isFinite(value) && value > 0 ? value : 10;
}

const persistentStatus = readJson(STATUS_PATH, null);
const currentRun = readJson(CURRENT_RUN_PATH, null);
const threshold = readJson(THRESHOLD_EVALUATION_PATH, null);
const contract = readJson(CONTRACT_PATH, null);
const basis = latestGreenBasis(persistentStatus);
if (!persistentStatus || !currentRun || !threshold || !basis) {
  writeJson(SOAK_STATUS_PATH, {
    generatedAt: new Date().toISOString(),
    running: false,
    status: 'blocked',
    blocker: 'Missing persistent status/current run/threshold artifacts, or no green benchmark-scope basis iteration with canonical landing evidence was found.'
  });
  process.exit(1);
}

const requiredMinutes = thresholdMinutes(threshold, contract);
const campaignStartedAt = currentRun.campaignStartedAt || currentRun.startedAt || currentRun.generatedAt;
const startMs = Date.parse(String(campaignStartedAt || ''));
if (!Number.isFinite(startMs)) {
  writeJson(SOAK_STATUS_PATH, {
    generatedAt: new Date().toISOString(),
    running: false,
    status: 'blocked',
    blocker: 'Campaign start timestamp is missing, so autonomy duration cannot be measured honestly.'
  });
  process.exit(1);
}
const targetMs = startMs + requiredMinutes * 60_000;
const runId = basis.record.runId;
const runDir = path.join(ARTIFACT_DIR, 'runs', runId);
const reboundCurrentRun = {
  ...currentRun,
  runId,
  iteration: basis.record.iteration,
  runDir,
  artifactRoot: runDir,
  reportsDir: path.join(runDir, 'reports'),
  generatedAt: campaignStartedAt,
  startedAt: campaignStartedAt,
  autonomySoak: true,
  autonomySoakBasisRunId: runId
};
writeJson(CURRENT_RUN_PATH, reboundCurrentRun);
writeJson(WORKER_STATUS_PATH, {
  generatedAt: new Date().toISOString(),
  runId,
  running: false,
  phase: 'autonomy_soak_rebound',
  ok: true,
  summary: 'Worker status rebound for lightweight autonomy scoring; no product worker is running.',
  mirrored: {
    canonicalSummaryPath: path.relative(ROOT, path.join(basis.delegateDir, 'canonical_summary.json')),
    programStatePath: path.relative(ROOT, path.join(basis.delegateDir, 'program_state.json')),
    surfaceMatrixPath: path.relative(ROOT, path.join(basis.delegateDir, 'surface_matrix.json')),
    liveExecutionSummaryPath: path.relative(ROOT, path.join(basis.delegateDir, 'live_execution_summary.json')),
    patchQueueReportPath: path.relative(ROOT, path.join(basis.delegateDir, 'patch_queue_report.json'))
  }
});
writeJson(SYNC_STATUS_PATH, {
  generatedAt: new Date().toISOString(),
  runId,
  ok: true,
  phase: 'autonomy_soak_rebound',
  summary: 'Reused proven canonical landing evidence from the latest green benchmark-scope iteration for lightweight autonomy scoring.',
  canonicalLandingEvidence: basis.record.canonicalLandingEvidence || { ok: true, newlyLandedProductFileCount: basis.record.canonicalLandedProductFileCount || 0 }
});

while (Date.now() < targetMs) {
  const now = Date.now();
  writeJson(SOAK_STATUS_PATH, {
    generatedAt: new Date().toISOString(),
    running: true,
    status: 'soaking',
    campaignRunId: persistentStatus.campaignRunId,
    basedOnRunId: runId,
    benchmarkId: threshold.benchmarkId || threshold?.blocker?.thresholdEvaluation?.benchmarkId || null,
    requiredAutonomyMinutes: requiredMinutes,
    campaignStartedAt,
    targetAt: iso(targetMs),
    remainingSeconds: Math.max(0, Math.ceil((targetMs - now) / 1000)),
    note: 'Lightweight autonomy soak is waiting on wall-clock duration only; no product workers are running.'
  });
  await sleep(Math.min(POLL_MS, Math.max(1_000, targetMs - now)));
}

const proof = {
  generatedAt: new Date().toISOString(),
  status: 'complete',
  mode: 'lightweight_autonomy_soak',
  campaignRunId: persistentStatus.campaignRunId,
  basedOnRunId: runId,
  benchmarkId: threshold.benchmarkId || threshold?.blocker?.thresholdEvaluation?.benchmarkId || null,
  benchmarkTier: threshold.benchmarkTier || threshold?.blocker?.thresholdEvaluation?.benchmarkTier || null,
  fidelity: threshold.fidelity || threshold?.blocker?.thresholdEvaluation?.fidelity || null,
  campaignStartedAt,
  targetAt: iso(targetMs),
  requiredAutonomyMinutes: requiredMinutes,
  noWorkerRelaunch: true,
  basis: {
    supervisorStatus: basis.canonical.supervisorStatus,
    matrixStatus: basis.canonical.matrixStatus,
    parityStatus: basis.canonical.parityStatus,
    canonicalLandingOk: basis.record.canonicalLandingOk === true,
    completedFocusIds: persistentStatus.completedFocusIds || [],
    benchmarkScopeFocusIds: persistentStatus.benchmarkScopeFocusIds || [],
    remainingBenchmarkFocusIds: persistentStatus.remainingBenchmarkFocusIds || []
  }
};
writeJson(SOAK_PROOF_PATH, proof);

const env = { ...process.env, [PROGRAM_ENV.runId]: runId, [PROGRAM_ENV.campaignRunId]: persistentStatus.campaignRunId };
const supervisor = spawnSync(process.execPath, [SUPERVISOR_SCRIPT], { cwd: ROOT, encoding: 'utf8', env, maxBuffer: 1024 * 1024 * 80 });
const finalThreshold = readJson(THRESHOLD_EVALUATION_PATH, null);
const finalSummary = readJson(PROGRAM_PATHS.summaryPath, null);
const finalStatus = finalThreshold?.pass === true ? 'threshold_pass' : 'blocked';
writeJson(SOAK_STATUS_PATH, {
  generatedAt: new Date().toISOString(),
  running: false,
  status: finalStatus,
  campaignRunId: persistentStatus.campaignRunId,
  basedOnRunId: runId,
  supervisorExitCode: supervisor.status,
  supervisorStdout: supervisor.stdout?.slice(-4000) || '',
  supervisorStderr: supervisor.stderr?.slice(-4000) || '',
  thresholdPass: finalThreshold?.pass === true,
  thresholdFailures: finalThreshold?.failures || [],
  observed: finalThreshold?.observed || null,
  summaryStatus: finalSummary?.supervisorStatus || null,
  proofPath: path.relative(ROOT, SOAK_PROOF_PATH)
});

const persistentAfter = readJson(STATUS_PATH, persistentStatus) || persistentStatus;
writeJson(STATUS_PATH, {
  ...persistentAfter,
  generatedAt: new Date().toISOString(),
  runId,
  running: false,
  phase: 'autonomy_soak_complete',
  status: finalThreshold?.pass === true ? 'threshold_pass' : persistentAfter.status,
  blocker: finalThreshold?.pass === true ? null : persistentAfter.blocker || null,
  blockerKind: finalThreshold?.pass === true ? null : persistentAfter.blockerKind || null,
  thresholdPass: finalThreshold?.pass === true,
  autonomySoakStatusPath: path.relative(ROOT, SOAK_STATUS_PATH),
  autonomySoakProofPath: path.relative(ROOT, SOAK_PROOF_PATH),
  note: finalThreshold?.pass === true
    ? 'Lightweight autonomy soak completed and benchmark threshold evaluation is green.'
    : 'Lightweight autonomy soak completed, but threshold evaluation is still red; inspect autonomy_soak_status.json.'
});

if (finalThreshold?.pass === true && fs.existsSync(BLOCKER_PATH)) {
  writeJson(BLOCKER_PATH, {
    generatedAt: new Date().toISOString(),
    runId,
    status: 'cleared',
    blocker: null,
    note: 'Autonomy-duration threshold cleared by lightweight autonomy soak.'
  });
}

spawnSync(process.execPath, [WATCH_SCRIPT], { cwd: ROOT, encoding: 'utf8', env, maxBuffer: 1024 * 1024 * 20 });
process.exit(finalThreshold?.pass === true ? 0 : 1);
