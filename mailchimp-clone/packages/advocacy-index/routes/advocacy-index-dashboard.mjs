import { buildAdvocacyIndexSnapshot, createAdvocacyIndexRouteSummary } from '../service-advocacy-index.mjs';

export function createAdvocacyIndexDashboardRoutes(basePath = '/advocacy-index') {
  const snapshot = buildAdvocacyIndexSnapshot();
  return [
    { id: 'advocacy-index.dashboard.overview', method: 'GET', path: basePath, summary: createAdvocacyIndexRouteSummary(snapshot) },
    { id: 'advocacy-index.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'advocacy-index.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

