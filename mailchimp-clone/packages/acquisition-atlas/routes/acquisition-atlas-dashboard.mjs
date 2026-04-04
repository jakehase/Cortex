import { buildAcquisitionAtlasSnapshot, createAcquisitionAtlasRouteSummary } from '../service-acquisition-atlas.mjs';

export function createAcquisitionAtlasDashboardRoutes(basePath = '/acquisition-atlas') {
  const snapshot = buildAcquisitionAtlasSnapshot();
  return [
    { id: 'acquisition-atlas.dashboard.overview', method: 'GET', path: basePath, summary: createAcquisitionAtlasRouteSummary(snapshot) },
    { id: 'acquisition-atlas.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'acquisition-atlas.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

