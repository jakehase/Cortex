import { buildSubscriptionOpsSnapshot, createSubscriptionOpsChecklist } from '../service-subscription-ops.mjs';

export function createSubscriptionOpsOpsRoutes(basePath = '/ops/subscription-ops') {
  const snapshot = buildSubscriptionOpsSnapshot();
  return [
    { id: 'subscription-ops.ops.health', method: 'GET', path: basePath + '/health', checklist: createSubscriptionOpsChecklist(snapshot) },
    { id: 'subscription-ops.ops.policies', method: 'GET', path: basePath + '/policies', policies: snapshot.policies },
    { id: 'subscription-ops.ops.metrics', method: 'GET', path: basePath + '/metrics', scorecards: snapshot.workspace.scorecards }
  ];
}
