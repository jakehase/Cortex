import { buildActivationAtlasSnapshot, createActivationAtlasRouteSummary } from '../service-activation-atlas.mjs';

export function createActivationAtlasDashboardRoutes(basePath = '/activation-atlas') {
  const snapshot = buildActivationAtlasSnapshot();
  return [
    { id: 'activation-atlas.dashboard.overview', method: 'GET', path: basePath, summary: createActivationAtlasRouteSummary(snapshot) },
    { id: 'activation-atlas.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'activation-atlas.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

