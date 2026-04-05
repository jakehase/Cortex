import { buildLoyaltyGridSnapshot, createLoyaltyGridReadinessBoard } from '../service-loyalty-grid.mjs';

export function createLoyaltyGridOpsRoutes(basePath = '/ops/loyalty-grid') {
  const snapshot = buildLoyaltyGridSnapshot();
  return [
    { id: 'loyalty-grid.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createLoyaltyGridReadinessBoard(snapshot) },
    { id: 'loyalty-grid.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'loyalty-grid.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

