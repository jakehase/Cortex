import { buildLoyaltyHubSnapshot, createLoyaltyHubReadinessBoard } from '../service-loyalty-hub.mjs';

export function createLoyaltyHubOpsRoutes(basePath = '/ops/loyalty-hub') {
  const snapshot = buildLoyaltyHubSnapshot();
  return [
    { id: 'loyalty-hub.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createLoyaltyHubReadinessBoard(snapshot) },
    { id: 'loyalty-hub.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'loyalty-hub.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

