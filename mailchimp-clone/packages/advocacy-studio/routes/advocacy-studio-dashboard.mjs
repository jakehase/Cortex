import { buildAdvocacyStudioSnapshot, createAdvocacyStudioRouteSummary } from '../service-advocacy-studio.mjs';

export function createAdvocacyStudioDashboardRoutes(basePath = '/advocacy-studio') {
  const snapshot = buildAdvocacyStudioSnapshot();
  return [
    { id: 'advocacy-studio.dashboard.overview', method: 'GET', path: basePath, summary: createAdvocacyStudioRouteSummary(snapshot) },
    { id: 'advocacy-studio.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'advocacy-studio.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

