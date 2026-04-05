import { buildLoyaltyAdvisorSnapshot, createLoyaltyAdvisorReadinessBoard } from '../service-loyalty-advisor.mjs';

export function createLoyaltyAdvisorOpsRoutes(basePath = '/ops/loyalty-advisor') {
  const snapshot = buildLoyaltyAdvisorSnapshot();
  return [
    { id: 'loyalty-advisor.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createLoyaltyAdvisorReadinessBoard(snapshot) },
    { id: 'loyalty-advisor.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'loyalty-advisor.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

