import { buildLoyaltyIndexSnapshot, createLoyaltyIndexReadinessBoard } from '../service-loyalty-index.mjs';

export function createLoyaltyIndexOpsRoutes(basePath = '/ops/loyalty-index') {
  const snapshot = buildLoyaltyIndexSnapshot();
  return [
    { id: 'loyalty-index.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createLoyaltyIndexReadinessBoard(snapshot) },
    { id: 'loyalty-index.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'loyalty-index.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

