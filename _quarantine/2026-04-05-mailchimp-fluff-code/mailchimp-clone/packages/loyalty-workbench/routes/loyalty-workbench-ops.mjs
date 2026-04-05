import { buildLoyaltyWorkbenchSnapshot, createLoyaltyWorkbenchReadinessBoard } from '../service-loyalty-workbench.mjs';

export function createLoyaltyWorkbenchOpsRoutes(basePath = '/ops/loyalty-workbench') {
  const snapshot = buildLoyaltyWorkbenchSnapshot();
  return [
    { id: 'loyalty-workbench.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createLoyaltyWorkbenchReadinessBoard(snapshot) },
    { id: 'loyalty-workbench.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'loyalty-workbench.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

