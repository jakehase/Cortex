import { buildAdvocacyFoundrySnapshot, createAdvocacyFoundryRouteSummary } from '../service-advocacy-foundry.mjs';

export function createAdvocacyFoundryDashboardRoutes(basePath = '/advocacy-foundry') {
  const snapshot = buildAdvocacyFoundrySnapshot();
  return [
    { id: 'advocacy-foundry.dashboard.overview', method: 'GET', path: basePath, summary: createAdvocacyFoundryRouteSummary(snapshot) },
    { id: 'advocacy-foundry.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'advocacy-foundry.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

