import { buildCustomerAdvisorSnapshot, createCustomerAdvisorReadinessBoard } from '../service-customer-advisor.mjs';

export function createCustomerAdvisorOpsRoutes(basePath = '/ops/customer-advisor') {
  const snapshot = buildCustomerAdvisorSnapshot();
  return [
    { id: 'customer-advisor.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCustomerAdvisorReadinessBoard(snapshot) },
    { id: 'customer-advisor.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'customer-advisor.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

