import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { markNotifierDelivered, loadCampaign } from '../../large-project-capability-stack/packages/campaign-runtime/index.mjs';
import { emitSessionEvent, DEFAULT_THREAD_CONTEXT } from './lib/full-audit-campaign-cortex-transport.mjs';
import { resolveCampaignRunBinding, resolveMirroredArtifactPath } from './lib/full-audit-campaign-run-binding.mjs';
import { resolveProgramPaths, resolveProgramScriptArg, resolveProgramSession } from './lib/orchestration-program-config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const paths = resolveProgramPaths(ROOT);
const session = resolveProgramSession();
const THREAD_CONTEXT = DEFAULT_THREAD_CONTEXT;

function readJson(filePath, fallback = null) { try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return fallback; } }
function writeJson(filePath, payload) { fs.mkdirSync(path.dirname(filePath), { recursive: true }); fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`); }

const runBinding = resolveCampaignRunBinding({
  rootDir: ROOT,
  artifactDir: paths.artifactDir,
  currentRunPath: paths.currentRunPath,
  workerStatusPath: paths.workerStatusPath
});
const currentRun = runBinding.currentRun;
const summaryPath = resolveMirroredArtifactPath(ROOT, runBinding.workerStatus, 'completionSummaryPath', paths.summaryPath);
const currentRunId = currentRun?.runId || runBinding.runId || null;
const summary = readJson(summaryPath, null);
const notification = readJson(paths.notifyPath, null);
const state = loadCampaign(paths.programStatePath);
if (!currentRunId || summary?.runId !== currentRunId || notification?.runId !== currentRunId) {
  console.error('Current run id, summary, and notification state do not agree.');
  process.exit(1);
}
const success = Boolean(summary?.supervisorConfirmedCompletion && state?.supervisor?.status === 'green');
const blocked = Boolean(!success && (state?.supervisor?.blocker || summary?.requestedOutcome?.blocker));
const headline = summary?.headline || state?.supervisor?.headline || null;
const blockerKind = summary?.blockerKind || state?.supervisor?.blockerKind || null;
const deliveredSummary = success
  ? `Full-audit campaign complete: run=${currentRunId}`
  : blockerKind === 'strict_1to1_ceiling' && summary?.orchestrationConfirmedCompletion
    ? `Orchestration passed, full-clone strict 1:1 ceiling still red: run=${currentRunId}`
    : `Full-audit campaign blocker delivered: run=${currentRunId}`;
if (!notification?.awaitingNotifier || notification?.delivered) {
  console.error('Notification is not eligible or is already delivered.');
  process.exit(1);
}
if (!success && !blocked) {
  console.error('Full-audit campaign is neither green nor blocker-ready for notification.');
  process.exit(1);
}
const kind = success ? 'success' : 'blocker';
markNotifierDelivered(paths.programStatePath, `${resolveProgramScriptArg('notify')} ${kind} delivered (${currentRunId})`);
writeJson(paths.notifyPath, {
  ...notification,
  delivered: true,
  deliveredAt: new Date().toISOString(),
  awaitingNotifier: false,
  notifier: resolveProgramScriptArg('notify'),
  kind,
  runId: currentRunId,
  note: success
    ? 'Delivered current run success notification.'
    : blockerKind === 'strict_1to1_ceiling' && summary?.orchestrationConfirmedCompletion
      ? 'Delivered current run strict 1:1 ceiling notification after orchestration passed.'
      : 'Delivered current run blocker notification.'
});
emitSessionEvent({
  artifactRoot: paths.artifactDir,
  event: success ? 'session.finished' : 'session.failed',
  summary: deliveredSummary,
  threadContext: THREAD_CONTEXT,
  sessionId: session.id,
  project: session.project,
  repoPath: ROOT,
  extra: {
    runId: currentRunId,
    matrixStatus: summary?.matrixStatus || null,
    parityStatus: summary?.parityStatus || null,
    blocker: state?.supervisor?.blocker || summary?.requestedOutcome?.blocker || null,
    blockerKind,
    headline,
    orchestrationConfirmedCompletion: Boolean(summary?.orchestrationConfirmedCompletion),
    notifyKind: kind
  }
});
console.log(success
  ? `Full-audit campaign complete for run ${currentRunId}`
  : JSON.stringify({ status: 'blocked', runId: currentRunId, headline, blockerKind, supervisor: state?.supervisor || null }, null, 2));
