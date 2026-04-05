import { buildAudienceAtlasSnapshot, createAudienceAtlasRouteSummary } from '../service-audience-atlas.mjs';

export function createAudienceAtlasDashboardRoutes(basePath = '/audience-atlas') {
  const snapshot = buildAudienceAtlasSnapshot();
  return [
    { id: 'audience-atlas.dashboard.overview', method: 'GET', path: basePath, summary: createAudienceAtlasRouteSummary(snapshot) },
    { id: 'audience-atlas.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'audience-atlas.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

