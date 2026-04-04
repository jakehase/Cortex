import { buildLoyaltyFoundrySnapshot, createLoyaltyFoundryReadinessBoard } from '../service-loyalty-foundry.mjs';

export function createLoyaltyFoundryOpsRoutes(basePath = '/ops/loyalty-foundry') {
  const snapshot = buildLoyaltyFoundrySnapshot();
  return [
    { id: 'loyalty-foundry.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createLoyaltyFoundryReadinessBoard(snapshot) },
    { id: 'loyalty-foundry.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'loyalty-foundry.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

