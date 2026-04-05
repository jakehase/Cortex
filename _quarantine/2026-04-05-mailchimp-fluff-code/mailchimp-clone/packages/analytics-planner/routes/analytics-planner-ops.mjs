import { buildAnalyticsPlannerSnapshot, createAnalyticsPlannerReadinessBoard } from '../service-analytics-planner.mjs';

export function createAnalyticsPlannerOpsRoutes(basePath = '/ops/analytics-planner') {
  const snapshot = buildAnalyticsPlannerSnapshot();
  return [
    { id: 'analytics-planner.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAnalyticsPlannerReadinessBoard(snapshot) },
    { id: 'analytics-planner.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'analytics-planner.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

