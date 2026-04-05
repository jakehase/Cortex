import { buildAnalyticsAdvisorSnapshot, createAnalyticsAdvisorReadinessBoard } from '../service-analytics-advisor.mjs';

export function createAnalyticsAdvisorOpsRoutes(basePath = '/ops/analytics-advisor') {
  const snapshot = buildAnalyticsAdvisorSnapshot();
  return [
    { id: 'analytics-advisor.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAnalyticsAdvisorReadinessBoard(snapshot) },
    { id: 'analytics-advisor.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'analytics-advisor.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

