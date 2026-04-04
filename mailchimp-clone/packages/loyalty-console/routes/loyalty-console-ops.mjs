import { buildLoyaltyConsoleSnapshot, createLoyaltyConsoleReadinessBoard } from '../service-loyalty-console.mjs';

export function createLoyaltyConsoleOpsRoutes(basePath = '/ops/loyalty-console') {
  const snapshot = buildLoyaltyConsoleSnapshot();
  return [
    { id: 'loyalty-console.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createLoyaltyConsoleReadinessBoard(snapshot) },
    { id: 'loyalty-console.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'loyalty-console.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

