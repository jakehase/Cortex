import { buildAudienceAdvisorSnapshot, createAudienceAdvisorReadinessBoard } from '../service-audience-advisor.mjs';

export function createAudienceAdvisorOpsRoutes(basePath = '/ops/audience-advisor') {
  const snapshot = buildAudienceAdvisorSnapshot();
  return [
    { id: 'audience-advisor.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAudienceAdvisorReadinessBoard(snapshot) },
    { id: 'audience-advisor.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'audience-advisor.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

