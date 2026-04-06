import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runDelegatedCampaignWorker } from '../../large-project-capability-stack/packages/campaign-runtime/index.mjs';
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
const TRANSPORT_STATUS_PATH = path.join(ARTIFACT_DIR, 'cortex_transport', 'transport_status.json');
const THREAD_CONTEXT = DEFAULT_THREAD_CONTEXT;

process.env.ORCHESTRATOR_IMPLEMENTATION_PROFILE ||= 'mailchimp_parity_focus';
process.env.ORCHESTRATOR_IMPLEMENTATION_SCRIPT ||= path.join(ROOT, 'scripts', 'orchestrator-real-repo-clean-implement.mjs');

const transportStatus = composeTransportStatus({ artifactRoot: ARTIFACT_DIR, threadContext: THREAD_CONTEXT });
const result = runDelegatedCampaignWorker({
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
    sessionId: 'mailchimp-full-clone-100-agent',
    project: 'mailchimp-clone',
    repoPath,
    extra
  }),
  extraStart: {
    transportStatus
  }
});

console.log(JSON.stringify(result.statusMirror, null, 2));
process.exit(result.statusCode);
