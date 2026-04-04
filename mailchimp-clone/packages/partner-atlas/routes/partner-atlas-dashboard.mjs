import { buildPartnerAtlasSnapshot, createPartnerAtlasRouteSummary } from '../service-partner-atlas.mjs';

export function createPartnerAtlasDashboardRoutes(basePath = '/partner-atlas') {
  const snapshot = buildPartnerAtlasSnapshot();
  return [
    { id: 'partner-atlas.dashboard.overview', method: 'GET', path: basePath, summary: createPartnerAtlasRouteSummary(snapshot) },
    { id: 'partner-atlas.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'partner-atlas.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

