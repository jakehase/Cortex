import { buildAdvocacyAtlasSnapshot, createAdvocacyAtlasRouteSummary } from '../service-advocacy-atlas.mjs';

export function createAdvocacyAtlasDashboardRoutes(basePath = '/advocacy-atlas') {
  const snapshot = buildAdvocacyAtlasSnapshot();
  return [
    { id: 'advocacy-atlas.dashboard.overview', method: 'GET', path: basePath, summary: createAdvocacyAtlasRouteSummary(snapshot) },
    { id: 'advocacy-atlas.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'advocacy-atlas.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

