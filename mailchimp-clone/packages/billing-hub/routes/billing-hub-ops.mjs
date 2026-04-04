import { buildBillingHubSnapshot, createBillingHubReadinessBoard } from '../service-billing-hub.mjs';

export function createBillingHubOpsRoutes(basePath = '/ops/billing-hub') {
  const snapshot = buildBillingHubSnapshot();
  return [
    { id: 'billing-hub.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createBillingHubReadinessBoard(snapshot) },
    { id: 'billing-hub.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'billing-hub.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

