import { buildAudienceFoundrySnapshot, createAudienceFoundryRouteSummary } from '../service-audience-foundry.mjs';

export function createAudienceFoundryDashboardRoutes(basePath = '/audience-foundry') {
  const snapshot = buildAudienceFoundrySnapshot();
  return [
    { id: 'audience-foundry.dashboard.overview', method: 'GET', path: basePath, summary: createAudienceFoundryRouteSummary(snapshot) },
    { id: 'audience-foundry.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'audience-foundry.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

