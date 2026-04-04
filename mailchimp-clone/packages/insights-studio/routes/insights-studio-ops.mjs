import { buildInsightsStudioSnapshot, createInsightsStudioReadinessBoard } from '../service-insights-studio.mjs';

export function createInsightsStudioOpsRoutes(basePath = '/ops/insights-studio') {
  const snapshot = buildInsightsStudioSnapshot();
  return [
    { id: 'insights-studio.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createInsightsStudioReadinessBoard(snapshot) },
    { id: 'insights-studio.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'insights-studio.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

