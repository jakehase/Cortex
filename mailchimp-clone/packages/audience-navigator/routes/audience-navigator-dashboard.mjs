import { buildAudienceNavigatorSnapshot, createAudienceNavigatorRouteSummary } from '../service-audience-navigator.mjs';

export function createAudienceNavigatorDashboardRoutes(basePath = '/audience-navigator') {
  const snapshot = buildAudienceNavigatorSnapshot();
  return [
    { id: 'audience-navigator.dashboard.overview', method: 'GET', path: basePath, summary: createAudienceNavigatorRouteSummary(snapshot) },
    { id: 'audience-navigator.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'audience-navigator.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

