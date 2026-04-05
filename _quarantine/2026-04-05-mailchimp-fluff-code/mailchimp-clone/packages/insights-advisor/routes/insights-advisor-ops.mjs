import { buildInsightsAdvisorSnapshot, createInsightsAdvisorReadinessBoard } from '../service-insights-advisor.mjs';

export function createInsightsAdvisorOpsRoutes(basePath = '/ops/insights-advisor') {
  const snapshot = buildInsightsAdvisorSnapshot();
  return [
    { id: 'insights-advisor.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createInsightsAdvisorReadinessBoard(snapshot) },
    { id: 'insights-advisor.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'insights-advisor.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

