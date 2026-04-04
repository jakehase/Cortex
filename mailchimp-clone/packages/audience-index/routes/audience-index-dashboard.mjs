import { buildAudienceIndexSnapshot, createAudienceIndexRouteSummary } from '../service-audience-index.mjs';

export function createAudienceIndexDashboardRoutes(basePath = '/audience-index') {
  const snapshot = buildAudienceIndexSnapshot();
  return [
    { id: 'audience-index.dashboard.overview', method: 'GET', path: basePath, summary: createAudienceIndexRouteSummary(snapshot) },
    { id: 'audience-index.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'audience-index.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

