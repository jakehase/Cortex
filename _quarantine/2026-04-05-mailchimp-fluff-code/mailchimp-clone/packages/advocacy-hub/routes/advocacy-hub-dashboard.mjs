import { buildAdvocacyHubSnapshot, createAdvocacyHubRouteSummary } from '../service-advocacy-hub.mjs';

export function createAdvocacyHubDashboardRoutes(basePath = '/advocacy-hub') {
  const snapshot = buildAdvocacyHubSnapshot();
  return [
    { id: 'advocacy-hub.dashboard.overview', method: 'GET', path: basePath, summary: createAdvocacyHubRouteSummary(snapshot) },
    { id: 'advocacy-hub.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'advocacy-hub.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

