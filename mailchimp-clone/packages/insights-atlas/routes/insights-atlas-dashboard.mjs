import { buildInsightsAtlasSnapshot, createInsightsAtlasRouteSummary } from '../service-insights-atlas.mjs';

export function createInsightsAtlasDashboardRoutes(basePath = '/insights-atlas') {
  const snapshot = buildInsightsAtlasSnapshot();
  return [
    { id: 'insights-atlas.dashboard.overview', method: 'GET', path: basePath, summary: createInsightsAtlasRouteSummary(snapshot) },
    { id: 'insights-atlas.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'insights-atlas.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

