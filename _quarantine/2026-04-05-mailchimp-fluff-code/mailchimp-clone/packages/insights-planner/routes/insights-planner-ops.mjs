import { buildInsightsPlannerSnapshot, createInsightsPlannerReadinessBoard } from '../service-insights-planner.mjs';

export function createInsightsPlannerOpsRoutes(basePath = '/ops/insights-planner') {
  const snapshot = buildInsightsPlannerSnapshot();
  return [
    { id: 'insights-planner.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createInsightsPlannerReadinessBoard(snapshot) },
    { id: 'insights-planner.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'insights-planner.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

