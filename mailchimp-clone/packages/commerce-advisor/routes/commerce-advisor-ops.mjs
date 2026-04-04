import { buildCommerceAdvisorSnapshot, createCommerceAdvisorReadinessBoard } from '../service-commerce-advisor.mjs';

export function createCommerceAdvisorOpsRoutes(basePath = '/ops/commerce-advisor') {
  const snapshot = buildCommerceAdvisorSnapshot();
  return [
    { id: 'commerce-advisor.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCommerceAdvisorReadinessBoard(snapshot) },
    { id: 'commerce-advisor.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'commerce-advisor.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

