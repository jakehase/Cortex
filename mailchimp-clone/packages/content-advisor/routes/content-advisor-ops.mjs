import { buildContentAdvisorSnapshot, createContentAdvisorReadinessBoard } from '../service-content-advisor.mjs';

export function createContentAdvisorOpsRoutes(basePath = '/ops/content-advisor') {
  const snapshot = buildContentAdvisorSnapshot();
  return [
    { id: 'content-advisor.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createContentAdvisorReadinessBoard(snapshot) },
    { id: 'content-advisor.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'content-advisor.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

