import fs from 'node:fs';
import path from 'node:path';
import { watchCampaign, markNotifierDelivered } from '../../packages/campaign-runtime/index.mjs';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const ARTIFACT_ROOT = process.env.LP_STACK_ARTIFACT_ROOT || path.join(ROOT, 'artifacts', 'demo-campaign');
const statePath = path.join(ARTIFACT_ROOT, 'campaign_state.json');
const notificationPath = path.join(ARTIFACT_ROOT, 'notification_state.json');

const state = await watchCampaign(statePath, { timeoutMs: Number(process.env.DEMO_TIMEOUT_MS || 3000) });
const finalState = markNotifierDelivered(statePath, `notified:${state.stopReason}`);
const payload = {
  delivered: true,
  deliveredAt: finalState.notifier.deliveredAt,
  stopReason: finalState.stopReason,
  supervisorStatus: finalState.supervisor.status
};
fs.writeFileSync(notificationPath, JSON.stringify(payload, null, 2));
console.log(JSON.stringify(payload, null, 2));
