import { buildBillingWatchtowerSnapshot, createBillingWatchtowerReadinessBoard } from '../service-billing-watchtower.mjs';

export function createBillingWatchtowerOpsRoutes(basePath = '/ops/billing-watchtower') {
  const snapshot = buildBillingWatchtowerSnapshot();
  return [
    { id: 'billing-watchtower.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createBillingWatchtowerReadinessBoard(snapshot) },
    { id: 'billing-watchtower.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'billing-watchtower.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

