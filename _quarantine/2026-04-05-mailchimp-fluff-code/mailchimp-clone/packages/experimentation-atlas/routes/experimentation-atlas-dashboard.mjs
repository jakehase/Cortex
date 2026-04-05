import { buildExperimentationAtlasSnapshot, createExperimentationAtlasRouteSummary } from '../service-experimentation-atlas.mjs';

export function createExperimentationAtlasDashboardRoutes(basePath = '/experimentation-atlas') {
  const snapshot = buildExperimentationAtlasSnapshot();
  return [
    { id: 'experimentation-atlas.dashboard.overview', method: 'GET', path: basePath, summary: createExperimentationAtlasRouteSummary(snapshot) },
    { id: 'experimentation-atlas.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'experimentation-atlas.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

