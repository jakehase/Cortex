import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { markNotifierDelivered, loadCampaign } from '../../large-project-capability-stack/packages/campaign-runtime/index.mjs';
import { emitSessionEvent, DEFAULT_THREAD_CONTEXT } from './lib/full-audit-campaign-cortex-transport.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'full_audit_campaign');
const PROGRAM_STATE_PATH = path.join(ARTIFACT_DIR, 'program_state.json');
const SUMMARY_PATH = path.join(ARTIFACT_DIR, 'completion_summary.json');
const NOTIFY_PATH = path.join(ARTIFACT_DIR, 'notification_state.json');
const THREAD_CONTEXT = DEFAULT_THREAD_CONTEXT;

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

const summary = readJson(SUMMARY_PATH, null);
const state = loadCampaign(PROGRAM_STATE_PATH);
if (!summary?.supervisorConfirmedCompletion || state?.supervisor?.status !== 'green') {
  console.error('Full-audit campaign supervisor has not confirmed completion.');
  process.exit(1);
}

markNotifierDelivered(PROGRAM_STATE_PATH, 'full-audit-campaign delivered');
const notificationState = {
  delivered: true,
  deliveredAt: new Date().toISOString(),
  notifier: 'scripts/full-audit-campaign-notify.mjs',
  supervisorStatus: state.supervisor.status,
  matrixStatus: summary.matrixStatus,
  parityStatus: summary.parityStatus,
  note: 'Full-audit campaign delivered after delegated real-repo qualification completed.'
};
fs.writeFileSync(NOTIFY_PATH, JSON.stringify(notificationState, null, 2));

emitSessionEvent({
  artifactRoot: ARTIFACT_DIR,
  event: 'session.finished',
  summary: `Full-audit campaign delivered: supervisor=${state.supervisor.status}, matrix=${summary.matrixStatus}`,
  threadContext: THREAD_CONTEXT,
  sessionId: 'mailchimp-full-clone-100-agent',
  project: 'mailchimp-clone',
  repoPath: ROOT,
  extra: {
    matrixStatus: summary.matrixStatus,
    parityStatus: summary.parityStatus,
    blocker: summary.blocker || null
  }
});

console.log(`Full-audit campaign complete: supervisor=${state.supervisor.status}, matrix=${summary.matrixStatus}`);
