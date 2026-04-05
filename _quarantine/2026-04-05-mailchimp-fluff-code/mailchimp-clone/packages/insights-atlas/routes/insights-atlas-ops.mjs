import { buildInsightsAtlasSnapshot, createInsightsAtlasReadinessBoard } from '../service-insights-atlas.mjs';

export function createInsightsAtlasOpsRoutes(basePath = '/ops/insights-atlas') {
  const snapshot = buildInsightsAtlasSnapshot();
  return [
    { id: 'insights-atlas.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createInsightsAtlasReadinessBoard(snapshot) },
    { id: 'insights-atlas.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'insights-atlas.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

