import { buildInsightsNavigatorSnapshot, createInsightsNavigatorReadinessBoard } from '../service-insights-navigator.mjs';

export function createInsightsNavigatorOpsRoutes(basePath = '/ops/insights-navigator') {
  const snapshot = buildInsightsNavigatorSnapshot();
  return [
    { id: 'insights-navigator.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createInsightsNavigatorReadinessBoard(snapshot) },
    { id: 'insights-navigator.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'insights-navigator.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

