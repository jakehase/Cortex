import { buildCreativeAdvisorSnapshot, createCreativeAdvisorReadinessBoard } from '../service-creative-advisor.mjs';

export function createCreativeAdvisorOpsRoutes(basePath = '/ops/creative-advisor') {
  const snapshot = buildCreativeAdvisorSnapshot();
  return [
    { id: 'creative-advisor.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCreativeAdvisorReadinessBoard(snapshot) },
    { id: 'creative-advisor.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'creative-advisor.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

