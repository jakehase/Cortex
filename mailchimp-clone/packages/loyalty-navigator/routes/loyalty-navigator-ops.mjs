import { buildLoyaltyNavigatorSnapshot, createLoyaltyNavigatorReadinessBoard } from '../service-loyalty-navigator.mjs';

export function createLoyaltyNavigatorOpsRoutes(basePath = '/ops/loyalty-navigator') {
  const snapshot = buildLoyaltyNavigatorSnapshot();
  return [
    { id: 'loyalty-navigator.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createLoyaltyNavigatorReadinessBoard(snapshot) },
    { id: 'loyalty-navigator.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'loyalty-navigator.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

