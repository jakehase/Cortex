import { buildBillingAdvisorSnapshot, createBillingAdvisorReadinessBoard } from '../service-billing-advisor.mjs';

export function createBillingAdvisorOpsRoutes(basePath = '/ops/billing-advisor') {
  const snapshot = buildBillingAdvisorSnapshot();
  return [
    { id: 'billing-advisor.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createBillingAdvisorReadinessBoard(snapshot) },
    { id: 'billing-advisor.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'billing-advisor.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

