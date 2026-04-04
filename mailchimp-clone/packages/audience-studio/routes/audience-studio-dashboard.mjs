import { buildAudienceStudioSnapshot, createAudienceStudioRouteSummary } from '../service-audience-studio.mjs';

export function createAudienceStudioDashboardRoutes(basePath = '/audience-studio') {
  const snapshot = buildAudienceStudioSnapshot();
  return [
    { id: 'audience-studio.dashboard.overview', method: 'GET', path: basePath, summary: createAudienceStudioRouteSummary(snapshot) },
    { id: 'audience-studio.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'audience-studio.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

