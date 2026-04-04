import { buildCreativeFoundrySnapshot, createCreativeFoundryRouteSummary } from '../service-creative-foundry.mjs';

export function createCreativeFoundryDashboardRoutes(basePath = '/creative-foundry') {
  const snapshot = buildCreativeFoundrySnapshot();
  return [
    { id: 'creative-foundry.dashboard.overview', method: 'GET', path: basePath, summary: createCreativeFoundryRouteSummary(snapshot) },
    { id: 'creative-foundry.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'creative-foundry.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

