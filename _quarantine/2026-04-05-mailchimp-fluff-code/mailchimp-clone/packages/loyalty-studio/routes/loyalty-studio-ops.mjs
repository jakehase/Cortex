import { buildLoyaltyStudioSnapshot, createLoyaltyStudioReadinessBoard } from '../service-loyalty-studio.mjs';

export function createLoyaltyStudioOpsRoutes(basePath = '/ops/loyalty-studio') {
  const snapshot = buildLoyaltyStudioSnapshot();
  return [
    { id: 'loyalty-studio.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createLoyaltyStudioReadinessBoard(snapshot) },
    { id: 'loyalty-studio.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'loyalty-studio.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

