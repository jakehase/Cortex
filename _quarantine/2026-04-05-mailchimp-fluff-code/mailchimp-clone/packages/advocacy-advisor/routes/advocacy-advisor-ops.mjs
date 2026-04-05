import { buildAdvocacyAdvisorSnapshot, createAdvocacyAdvisorReadinessBoard } from '../service-advocacy-advisor.mjs';

export function createAdvocacyAdvisorOpsRoutes(basePath = '/ops/advocacy-advisor') {
  const snapshot = buildAdvocacyAdvisorSnapshot();
  return [
    { id: 'advocacy-advisor.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAdvocacyAdvisorReadinessBoard(snapshot) },
    { id: 'advocacy-advisor.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'advocacy-advisor.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

