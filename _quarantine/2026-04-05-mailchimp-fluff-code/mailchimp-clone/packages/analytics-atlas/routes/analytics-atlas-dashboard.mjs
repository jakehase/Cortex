import { buildAnalyticsAtlasSnapshot, createAnalyticsAtlasRouteSummary } from '../service-analytics-atlas.mjs';

export function createAnalyticsAtlasDashboardRoutes(basePath = '/analytics-atlas') {
  const snapshot = buildAnalyticsAtlasSnapshot();
  return [
    { id: 'analytics-atlas.dashboard.overview', method: 'GET', path: basePath, summary: createAnalyticsAtlasRouteSummary(snapshot) },
    { id: 'analytics-atlas.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'analytics-atlas.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

