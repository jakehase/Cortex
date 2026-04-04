import { buildAnalyticsAtlasSnapshot, createAnalyticsAtlasReadinessBoard } from '../service-analytics-atlas.mjs';

export function createAnalyticsAtlasOpsRoutes(basePath = '/ops/analytics-atlas') {
  const snapshot = buildAnalyticsAtlasSnapshot();
  return [
    { id: 'analytics-atlas.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAnalyticsAtlasReadinessBoard(snapshot) },
    { id: 'analytics-atlas.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'analytics-atlas.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

