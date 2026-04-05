import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { composeTransportStatus, emitSessionEvent, DEFAULT_THREAD_CONTEXT } from './lib/full-audit-campaign-cortex-transport.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'full_audit_campaign');
const REPORTS_DIR = path.join(ARTIFACT_DIR, 'reports');
const WORKER_STATE_PATH = path.join(ARTIFACT_DIR, 'worker_state.json');
const DELEGATE_SCRIPT = path.join(ROOT, 'scripts', 'orchestrator-real-repo-clean-run.mjs');
const DELEGATE_ARTIFACT_ROOT = path.join(ROOT, 'artifacts', 'qualification', 'orchestrator_real_repo_clean_baseline');
const DELEGATE_COMPLETION_SUMMARY = path.join(DELEGATE_ARTIFACT_ROOT, 'completion_summary.json');
const DELEGATE_PROGRAM_STATE = path.join(DELEGATE_ARTIFACT_ROOT, 'program_state.json');
const DELEGATE_BLOCKER = path.join(DELEGATE_ARTIFACT_ROOT, 'blocker_report.json');
const LOG_PATH = path.join(REPORTS_DIR, '100_agent_worker.log');
const STATUS_MIRROR_PATH = path.join(REPORTS_DIR, '100_agent_worker_status.json');
const THREAD_CONTEXT = DEFAULT_THREAD_CONTEXT;

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function updateWorkerState(patch) {
  const prior = readJson(WORKER_STATE_PATH, {});
  const next = {
    ...prior,
    role: 'real_repo_100_agent_orchestrator',
    delegateScript: path.relative(ROOT, DELEGATE_SCRIPT),
    delegateArtifactRoot: path.relative(ROOT, DELEGATE_ARTIFACT_ROOT),
    threadContext: THREAD_CONTEXT,
    updatedAt: new Date().toISOString(),
    ...patch
  };
  writeJson(WORKER_STATE_PATH, next);
  return next;
}

ensureDir(ARTIFACT_DIR);
ensureDir(REPORTS_DIR);

const transportStatus = composeTransportStatus({ artifactRoot: ARTIFACT_DIR, threadContext: THREAD_CONTEXT });
const startedAtIso = readJson(WORKER_STATE_PATH, {})?.startedAt || new Date().toISOString();
updateWorkerState({
  status: 'running',
  phase: 'delegated_to_100_agent_path',
  startedAt: startedAtIso,
  threadBindingReady: transportStatus?.threadBinding?.active || false,
  externalClawhipRuntimeActive: transportStatus?.active?.externalClawhipRuntimeActive || false,
  transportStatusPath: path.relative(ROOT, path.join(ARTIFACT_DIR, 'cortex_transport', 'transport_status.json')),
  note: 'Full-audit campaign worker delegated to the cleaned-baseline 100-agent real-repo orchestrator path with Cortex-owned transport/memory scaffolding and thread-binding readiness checks.'
});

emitSessionEvent({
  artifactRoot: ARTIFACT_DIR,
  event: 'session.started',
  summary: 'Started the cleaned-baseline 100-agent full-clone delegate worker.',
  threadContext: THREAD_CONTEXT,
  sessionId: 'mailchimp-full-clone-100-agent',
  project: 'mailchimp-clone',
  repoPath: ROOT,
  extra: {
    delegateScript: path.relative(ROOT, DELEGATE_SCRIPT),
    delegateArtifactRoot: path.relative(ROOT, DELEGATE_ARTIFACT_ROOT),
    transportStatus
  }
});

writeJson(STATUS_MIRROR_PATH, {
  generatedAt: new Date().toISOString(),
  ok: null,
  running: true,
  phase: 'delegate_starting',
  logPath: path.relative(ROOT, LOG_PATH),
  delegateArtifactRoot: path.relative(ROOT, DELEGATE_ARTIFACT_ROOT),
  transportStatusPath: path.relative(ROOT, path.join(ARTIFACT_DIR, 'cortex_transport', 'transport_status.json')),
  note: 'Delegate launch started. This file exists immediately so the worker cannot disappear without leaving state.'
});

try {
  const startedAt = Date.now();
  const result = spawnSync(process.execPath, [DELEGATE_SCRIPT], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 200
  });
  const combinedOutput = `${result.stdout || ''}${result.stderr || ''}${result.error ? `\n[spawn-error] ${String(result.error.message || result.error)}` : ''}`;
  fs.writeFileSync(LOG_PATH, combinedOutput);

  const delegateSummary = readJson(DELEGATE_COMPLETION_SUMMARY, null);
  const delegateProgramState = readJson(DELEGATE_PROGRAM_STATE, null);
  const delegateBlocker = readJson(DELEGATE_BLOCKER, null);
  const ok = result.status === 0 && !result.error;
  const statusMirror = {
    generatedAt: new Date().toISOString(),
    ok,
    running: false,
    exitCode: result.status,
    signal: result.signal,
    spawnError: result.error ? String(result.error.message || result.error) : null,
    durationMs: Date.now() - startedAt,
    logPath: path.relative(ROOT, LOG_PATH),
    delegateArtifactRoot: path.relative(ROOT, DELEGATE_ARTIFACT_ROOT),
    delegateCompletionSummary: delegateSummary,
    delegateProgramState,
    delegateBlocker,
    transportStatusPath: path.relative(ROOT, path.join(ARTIFACT_DIR, 'cortex_transport', 'transport_status.json'))
  };
  writeJson(STATUS_MIRROR_PATH, statusMirror);

  updateWorkerState({
    status: ok ? 'delegate_finished' : 'delegate_failed',
    phase: ok ? 'awaiting_supervisor_reconcile' : 'delegate_failed',
    finishedAt: new Date().toISOString(),
    ok,
    exitCode: result.status,
    signal: result.signal,
    spawnError: result.error ? String(result.error.message || result.error) : null,
    delegateSummaryPath: path.relative(ROOT, DELEGATE_COMPLETION_SUMMARY),
    delegateProgramStatePath: path.relative(ROOT, DELEGATE_PROGRAM_STATE),
    delegateBlockerPath: path.relative(ROOT, DELEGATE_BLOCKER),
    delegateStatusMirrorPath: path.relative(ROOT, STATUS_MIRROR_PATH),
    note: ok
      ? 'Cleaned-baseline 100-agent delegate script finished; full-audit supervisor should reconcile repo state and artifacts.'
      : 'Cleaned-baseline 100-agent delegate script failed; inspect the mirrored status, event stream, and delegate log.'
  });

  emitSessionEvent({
    artifactRoot: ARTIFACT_DIR,
    event: ok ? 'session.finished' : 'session.failed',
    summary: ok ? 'Cleaned-baseline 100-agent delegate finished.' : 'Cleaned-baseline 100-agent delegate failed.',
    threadContext: THREAD_CONTEXT,
    sessionId: 'mailchimp-full-clone-100-agent',
    project: 'mailchimp-clone',
    repoPath: ROOT,
    extra: {
      ok,
      exitCode: result.status,
      signal: result.signal,
      spawnError: result.error ? String(result.error.message || result.error) : null,
      delegateBlocker,
      delegateSummary
    }
  });

  console.log(JSON.stringify(statusMirror, null, 2));
  process.exit(ok ? 0 : 1);
} catch (error) {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  fs.writeFileSync(LOG_PATH, `${message}\n`);
  const statusMirror = {
    generatedAt: new Date().toISOString(),
    ok: false,
    running: false,
    phase: 'wrapper_exception',
    logPath: path.relative(ROOT, LOG_PATH),
    delegateArtifactRoot: path.relative(ROOT, DELEGATE_ARTIFACT_ROOT),
    wrapperError: message,
    transportStatusPath: path.relative(ROOT, path.join(ARTIFACT_DIR, 'cortex_transport', 'transport_status.json'))
  };
  writeJson(STATUS_MIRROR_PATH, statusMirror);
  updateWorkerState({
    status: 'delegate_failed',
    phase: 'wrapper_exception',
    finishedAt: new Date().toISOString(),
    ok: false,
    delegateStatusMirrorPath: path.relative(ROOT, STATUS_MIRROR_PATH),
    note: 'Wrapper itself failed before the delegate completed; inspect worker status and log.'
  });
  emitSessionEvent({
    artifactRoot: ARTIFACT_DIR,
    event: 'session.failed',
    summary: 'Cleaned-baseline 100-agent delegate wrapper failed before clean completion.',
    threadContext: THREAD_CONTEXT,
    sessionId: 'mailchimp-full-clone-100-agent',
    project: 'mailchimp-clone',
    repoPath: ROOT,
    extra: { wrapperError: message }
  });
  console.log(JSON.stringify(statusMirror, null, 2));
  process.exit(1);
}
