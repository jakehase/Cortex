import { watchCampaign } from '../../packages/campaign-runtime/index.mjs';
import { paths } from './plan.mjs';

const state = await watchCampaign(paths.campaign, { timeoutMs: Number(process.env.LP_STACK_WATCH_TIMEOUT_MS || 10000), intervalMs: 250 });
console.log(JSON.stringify({
  ready: state.stopAllowed,
  supervisor: state.supervisor,
  done: state.done,
  reason: state.stopReason,
  queuedIterations: state.worker?.queuedIterations?.length || 0
}, null, 2));
