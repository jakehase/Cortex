import { buildContentFoundrySnapshot, createContentFoundryRouteSummary } from '../service-content-foundry.mjs';

export function createContentFoundryDashboardRoutes(basePath = '/content-foundry') {
  const snapshot = buildContentFoundrySnapshot();
  return [
    { id: 'content-foundry.dashboard.overview', method: 'GET', path: basePath, summary: createContentFoundryRouteSummary(snapshot) },
    { id: 'content-foundry.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'content-foundry.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

