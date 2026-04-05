import { buildEcommerceAdvisorSnapshot, createEcommerceAdvisorReadinessBoard } from '../service-ecommerce-advisor.mjs';

export function createEcommerceAdvisorOpsRoutes(basePath = '/ops/ecommerce-advisor') {
  const snapshot = buildEcommerceAdvisorSnapshot();
  return [
    { id: 'ecommerce-advisor.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createEcommerceAdvisorReadinessBoard(snapshot) },
    { id: 'ecommerce-advisor.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'ecommerce-advisor.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

