import { watchCampaign } from '../../large-project-capability-stack/packages/campaign-runtime/index.mjs';
import { PROGRAM_STATE_PATH } from './lib/wave2-integration-enterprise-plan.mjs';

const timeoutMs = Number(process.env.MAILCLONE_WATCH_TIMEOUT_MS || 10000);
const result = await watchCampaign(PROGRAM_STATE_PATH, { timeoutMs, intervalMs: 250 });
console.log(JSON.stringify({ ready: result.stopAllowed, supervisor: result.supervisor, done: result.done, reason: result.stopReason }, null, 2));
