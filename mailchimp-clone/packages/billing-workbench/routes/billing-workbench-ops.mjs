import { buildBillingWorkbenchSnapshot, createBillingWorkbenchReadinessBoard } from '../service-billing-workbench.mjs';

export function createBillingWorkbenchOpsRoutes(basePath = '/ops/billing-workbench') {
  const snapshot = buildBillingWorkbenchSnapshot();
  return [
    { id: 'billing-workbench.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createBillingWorkbenchReadinessBoard(snapshot) },
    { id: 'billing-workbench.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'billing-workbench.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

