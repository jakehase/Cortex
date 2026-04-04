import { buildLoyaltyWatchtowerSnapshot, createLoyaltyWatchtowerReadinessBoard } from '../service-loyalty-watchtower.mjs';

export function createLoyaltyWatchtowerOpsRoutes(basePath = '/ops/loyalty-watchtower') {
  const snapshot = buildLoyaltyWatchtowerSnapshot();
  return [
    { id: 'loyalty-watchtower.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createLoyaltyWatchtowerReadinessBoard(snapshot) },
    { id: 'loyalty-watchtower.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'loyalty-watchtower.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

