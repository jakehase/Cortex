import { buildInsightsWatchtowerSnapshot, createInsightsWatchtowerReadinessBoard } from '../service-insights-watchtower.mjs';

export function createInsightsWatchtowerOpsRoutes(basePath = '/ops/insights-watchtower') {
  const snapshot = buildInsightsWatchtowerSnapshot();
  return [
    { id: 'insights-watchtower.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createInsightsWatchtowerReadinessBoard(snapshot) },
    { id: 'insights-watchtower.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'insights-watchtower.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

