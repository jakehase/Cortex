import { buildDataAdvisorSnapshot, createDataAdvisorReadinessBoard } from '../service-data-advisor.mjs';

export function createDataAdvisorOpsRoutes(basePath = '/ops/data-advisor') {
  const snapshot = buildDataAdvisorSnapshot();
  return [
    { id: 'data-advisor.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createDataAdvisorReadinessBoard(snapshot) },
    { id: 'data-advisor.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'data-advisor.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

