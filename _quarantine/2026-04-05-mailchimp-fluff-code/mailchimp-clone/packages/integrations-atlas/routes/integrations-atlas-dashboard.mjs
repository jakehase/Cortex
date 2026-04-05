import { buildIntegrationsAtlasSnapshot, createIntegrationsAtlasRouteSummary } from '../service-integrations-atlas.mjs';

export function createIntegrationsAtlasDashboardRoutes(basePath = '/integrations-atlas') {
  const snapshot = buildIntegrationsAtlasSnapshot();
  return [
    { id: 'integrations-atlas.dashboard.overview', method: 'GET', path: basePath, summary: createIntegrationsAtlasRouteSummary(snapshot) },
    { id: 'integrations-atlas.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'integrations-atlas.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

