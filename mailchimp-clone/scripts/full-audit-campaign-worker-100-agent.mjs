import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runDelegatedCampaignWorker, writeJson } from '../../large-project-capability-stack/packages/campaign-runtime/index.mjs';
import { composeTransportStatus, emitSessionEvent, DEFAULT_THREAD_CONTEXT } from './lib/full-audit-campaign-cortex-transport.mjs';
import { loadExecutionBoundaryPolicy, evaluateExecutionPlacement, buildExecutionBoundaryBlocker, resolveHostRole } from './lib/full-audit-campaign-architecture.mjs';
import { submitRemoteCampaignWorker } from './lib/full-audit-campaign-remote-execution.mjs';
import { resolveCampaignRunBinding } from './lib/full-audit-campaign-run-binding.mjs';
import { ORCHESTRATION_PROGRAM_SPEC, applyProgramRuntimeDefaults, resolveProgramEnvKeys, resolveProgramPaths, resolveProgramScriptPath, resolveProgramSession } from './lib/orchestration-program-config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PROGRAM_ENV = resolveProgramEnvKeys();
const PROGRAM_PATHS = resolveProgramPaths(ROOT);
const PROGRAM_SESSION = resolveProgramSession();

function makeGeneratedRunId(prefix = 'one-pass-launch') {
  return `${prefix}-${new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-')}`;
}

function resolveRunId() {
  const requested = String(process.env[PROGRAM_ENV.runId] || '').trim();
  if (!requested || requested === 'default') return makeGeneratedRunId();
  return requested;
}

const RUN_ID = resolveRunId();
const ARTIFACT_DIR = PROGRAM_PATHS.artifactDir;
const RUNS_DIR = path.join(ARTIFACT_DIR, 'runs');
const RUN_DIR = path.join(RUNS_DIR, RUN_ID);
const REPORTS_DIR = PROGRAM_PATHS.reportsDir;
const WORKER_STATE_PATH = PROGRAM_PATHS.workerStatePath;
const BLOCKER_PATH = PROGRAM_PATHS.blockerPath;
const CURRENT_RUN_PATH = PROGRAM_PATHS.currentRunPath;
const DELEGATE_SCRIPT = resolveProgramScriptPath(ROOT, 'delegate');
const DELEGATE_ARTIFACT_ROOT = path.join(ROOT, 'artifacts', 'qualification', 'orchestrator_real_repo_clean_baseline');
const DELEGATE_COMPLETION_SUMMARY = path.join(DELEGATE_ARTIFACT_ROOT, 'canonical_summary.json');
const DELEGATE_PROGRAM_STATE = path.join(DELEGATE_ARTIFACT_ROOT, 'program_state.json');
const DELEGATE_BLOCKER = path.join(DELEGATE_ARTIFACT_ROOT, 'blocker_report.json');
const DELEGATE_SUPERVISOR = path.join(DELEGATE_ARTIFACT_ROOT, 'supervisor_status.json');
const DELEGATE_TIER_TRACE = path.join(DELEGATE_ARTIFACT_ROOT, 'tier_trace.json');
const LOG_PATH = path.join(REPORTS_DIR, '100_agent_worker.log');
const STATUS_MIRROR_PATH = PROGRAM_PATHS.workerStatusPath;
const TRANSPORT_STATUS_PATH = PROGRAM_PATHS.transportStatusPath;
const THREAD_CONTEXT = DEFAULT_THREAD_CONTEXT;
const AGENT_COUNT = 100;

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

applyProgramRuntimeDefaults({ rootDir: ROOT });

ensureDir(ARTIFACT_DIR);
ensureDir(RUNS_DIR);
ensureDir(RUN_DIR);
ensureDir(REPORTS_DIR);

const transportStatus = composeTransportStatus({ artifactRoot: ARTIFACT_DIR, threadContext: THREAD_CONTEXT });
const existingBinding = resolveCampaignRunBinding({
  rootDir: ROOT,
  artifactDir: ARTIFACT_DIR,
  currentRunPath: CURRENT_RUN_PATH,
  workerStatusPath: STATUS_MIRROR_PATH
});
const preservedCurrentRun = existingBinding.currentRun?.runId === RUN_ID
  && typeof existingBinding.currentRun === 'object'
  ? existingBinding.currentRun
  : null;
const currentRun = {
  ...(preservedCurrentRun || {}),
  runId: RUN_ID,
  campaignRunId: preservedCurrentRun?.campaignRunId ?? `campaign-${RUN_ID}`,
  generatedAt: new Date().toISOString(),
  startedAt: preservedCurrentRun?.startedAt ?? new Date().toISOString(),
  artifactRoot: path.join(ARTIFACT_DIR, 'runs', RUN_ID),
  runDir: path.join(ARTIFACT_DIR, 'runs', RUN_ID),
  reportsDir: path.join(ARTIFACT_DIR, 'runs', RUN_ID, 'reports'),
  blockerPath: BLOCKER_PATH,
  programStatePath: WORKER_STATE_PATH,
  workerStatusPath: STATUS_MIRROR_PATH,
  transportStatusPath: TRANSPORT_STATUS_PATH,
  remoteArtifactRoot: preservedCurrentRun?.remoteArtifactRoot ?? null,
  remoteWorktree: preservedCurrentRun?.remoteWorktree ?? null,
  remoteBaselineRepo: preservedCurrentRun?.remoteBaselineRepo ?? null
};
writeJson(CURRENT_RUN_PATH, currentRun);
const { filePath: executionBoundaryPolicyPath, policy: executionBoundaryPolicy } = loadExecutionBoundaryPolicy({ repoRoot: ROOT });
const executionDecision = evaluateExecutionPlacement({
  policy: executionBoundaryPolicy,
  agentCount: AGENT_COUNT,
  hostRole: resolveHostRole({ policy: executionBoundaryPolicy }),
  requiresBrowserValidation: true,
  requiresRepoScaleQualification: true
});

try {
  if (!executionDecision.allowLocal) {
    if (executionDecision.remoteRequired && executionBoundaryPolicy.remoteExecution?.enabled) {
      const remoteResult = await submitRemoteCampaignWorker({
        repoRoot: ROOT,
        artifactRoot: ARTIFACT_DIR,
        reportsDir: REPORTS_DIR,
        workerStatePath: WORKER_STATE_PATH,
        logPath: LOG_PATH,
        statusMirrorPath: STATUS_MIRROR_PATH,
        delegateArtifactRoot: DELEGATE_ARTIFACT_ROOT,
        delegateCompletionSummaryPath: DELEGATE_COMPLETION_SUMMARY,
        delegateProgramStatePath: DELEGATE_PROGRAM_STATE,
        delegateBlockerPath: DELEGATE_BLOCKER,
        controlPlaneBlockerPath: BLOCKER_PATH,
        transportStatusPath: TRANSPORT_STATUS_PATH,
        role: 'real_repo_100_agent_orchestrator',
        threadContext: THREAD_CONTEXT,
        transportStatus,
        remoteExecution: executionBoundaryPolicy.remoteExecution,
        policyPath: executionBoundaryPolicyPath,
        policy: executionBoundaryPolicy,
        executionDecision,
        requestedAgentCount: AGENT_COUNT,
        runId: RUN_ID,
        emitSessionEvent: ({ artifactRoot, event, summary, threadContext, repoPath, extra }) => emitSessionEvent({
          artifactRoot,
          event,
          summary,
          threadContext,
          sessionId: PROGRAM_SESSION.id,
          project: PROGRAM_SESSION.project,
          repoPath,
          extra
        })
      });
      console.log(JSON.stringify(remoteResult.statusMirror, null, 2));
      process.exit(remoteResult.statusCode);
    }

    const blocker = buildExecutionBoundaryBlocker({
      repoRoot: ROOT,
      policyPath: executionBoundaryPolicyPath,
      policy: executionBoundaryPolicy,
      decision: executionDecision,
      artifactRoot: ARTIFACT_DIR,
      extra: {
        campaign: ORCHESTRATION_PROGRAM_SPEC.programId,
        requestedAgentCount: AGENT_COUNT,
        remoteRunnerScript: path.relative(ROOT, resolveProgramScriptPath(ROOT, 'remoteRunner'))
      }
    });

    const workerState = writeJson(WORKER_STATE_PATH, {
      role: 'real_repo_100_agent_orchestrator',
      status: 'blocked_by_execution_boundary',
      phase: 'preflight_failed_before_delegate_launch',
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      requestedAgentCount: AGENT_COUNT,
      hostRole: executionDecision.hostRole,
      executionBoundaryPolicyPath: path.relative(ROOT, executionBoundaryPolicyPath),
      note: blocker.blocker
    });

    writeJson(BLOCKER_PATH, blocker);
    writeJson(STATUS_MIRROR_PATH, {
      generatedAt: new Date().toISOString(),
      ok: false,
      running: false,
      phase: 'blocked_by_execution_boundary',
      requestedAgentCount: AGENT_COUNT,
      hostRole: executionDecision.hostRole,
      logPath: path.relative(ROOT, LOG_PATH),
      transportStatusPath: path.relative(ROOT, TRANSPORT_STATUS_PATH),
      executionBoundaryPolicyPath: path.relative(ROOT, executionBoundaryPolicyPath),
      blocker
    });
    fs.writeFileSync(LOG_PATH, `${blocker.blocker}\n${blocker.nextAction}\n`);

    emitSessionEvent({
      artifactRoot: ARTIFACT_DIR,
      event: 'session.failed',
      summary: 'Blocked heavy local launch on control-plane host before the 100-agent worker farm started.',
      threadContext: THREAD_CONTEXT,
      sessionId: PROGRAM_SESSION.id,
      project: PROGRAM_SESSION.project,
      repoPath: ROOT,
      extra: {
        blocker,
        workerState,
        executionDecision,
        executionBoundaryPolicyPath: path.relative(ROOT, executionBoundaryPolicyPath)
      }
    });

    console.log(JSON.stringify({ ok: false, blocked: true, blocker }, null, 2));
    process.exit(1);
  }

  const result = await runDelegatedCampaignWorker({
    repoRoot: ROOT,
    artifactRoot: ARTIFACT_DIR,
    reportsDir: REPORTS_DIR,
    workerStatePath: WORKER_STATE_PATH,
    logPath: LOG_PATH,
    statusMirrorPath: STATUS_MIRROR_PATH,
    delegateScript: DELEGATE_SCRIPT,
    delegateArtifactRoot: DELEGATE_ARTIFACT_ROOT,
    delegateCompletionSummaryPath: DELEGATE_COMPLETION_SUMMARY,
    delegateProgramStatePath: DELEGATE_PROGRAM_STATE,
    delegateBlockerPath: DELEGATE_BLOCKER,
    delegateWatchPaths: [DELEGATE_SUPERVISOR, DELEGATE_TIER_TRACE],
    role: 'real_repo_100_agent_orchestrator',
    phase: 'delegated_to_100_agent_path',
    threadContext: THREAD_CONTEXT,
    transportStatus,
    transportStatusPath: TRANSPORT_STATUS_PATH,
    runningNote: 'Full-audit campaign worker delegated to the cleaned-baseline 100-agent real-repo orchestrator path with Cortex-owned transport/memory scaffolding and thread-binding readiness checks.',
    successNote: 'Cleaned-baseline 100-agent delegate script finished; full-audit supervisor should reconcile repo state and artifacts.',
    failureNote: 'Cleaned-baseline 100-agent delegate script failed; inspect the mirrored status, event stream, and delegate log.',
    wrapperFailureNote: 'Wrapper itself failed before the delegate completed; inspect worker status and log.',
    startSummary: 'Started the cleaned-baseline 100-agent full-clone delegate worker.',
    finishSummary: 'Cleaned-baseline 100-agent delegate finished.',
    failSummary: 'Cleaned-baseline 100-agent delegate failed.',
    wrapperFailSummary: 'Cleaned-baseline 100-agent delegate wrapper failed before clean completion.',
    emitSessionEvent: ({ artifactRoot, event, summary, threadContext, repoPath, extra }) => emitSessionEvent({
      artifactRoot,
      event,
      summary,
      threadContext,
      sessionId: PROGRAM_SESSION.id,
      project: PROGRAM_SESSION.project,
      repoPath,
      extra
    }),
    extraStart: {
      transportStatus,
      executionBoundaryPolicyPath: path.relative(ROOT, executionBoundaryPolicyPath),
      executionDecision
    }
  });

  console.log(JSON.stringify(result.statusMirror, null, 2));
  process.exit(result.statusCode);
} catch (error) {
  const errorText = error instanceof Error ? (error.stack || error.message) : String(error);
  const blocker = {
    generatedAt: new Date().toISOString(),
    runId: RUN_ID,
    blocker: '100-agent worker crashed before remote execution could hand back a blocker or success state.',
    nextAction: 'Inspect reports/100_agent_worker.log and the worker wrapper error, repair the remote submission path, then rerun the current campaign iteration.',
    phase: 'worker_wrapper',
    error: errorText
  };
  writeJson(BLOCKER_PATH, blocker);
  writeJson(WORKER_STATE_PATH, {
    role: 'real_repo_100_agent_orchestrator',
    status: 'worker_wrapper_failed',
    phase: 'worker_wrapper_failed',
    startedAt: currentRun.startedAt,
    updatedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    ok: false,
    runId: RUN_ID,
    requestedAgentCount: AGENT_COUNT,
    executionBoundaryPolicyPath: path.relative(ROOT, executionBoundaryPolicyPath),
    note: blocker.blocker,
    error: errorText
  });
  writeJson(STATUS_MIRROR_PATH, {
    generatedAt: new Date().toISOString(),
    runId: RUN_ID,
    ok: false,
    running: false,
    phase: 'worker_wrapper_failed',
    requestedAgentCount: AGENT_COUNT,
    logPath: path.relative(ROOT, LOG_PATH),
    transportStatusPath: path.relative(ROOT, TRANSPORT_STATUS_PATH),
    executionBoundaryPolicyPath: path.relative(ROOT, executionBoundaryPolicyPath),
    blocker,
    summary: 'Worker wrapper failed before remote execution could launch cleanly.'
  });
  fs.appendFileSync(LOG_PATH, `${errorText}\n`);
  console.error(errorText);
  process.exit(1);
}
