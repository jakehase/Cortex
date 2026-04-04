import { buildAttributionAdvisorSnapshot, createAttributionAdvisorReadinessBoard } from '../service-attribution-advisor.mjs';

export function createAttributionAdvisorOpsRoutes(basePath = '/ops/attribution-advisor') {
  const snapshot = buildAttributionAdvisorSnapshot();
  return [
    { id: 'attribution-advisor.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAttributionAdvisorReadinessBoard(snapshot) },
    { id: 'attribution-advisor.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'attribution-advisor.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

