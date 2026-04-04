import { buildAudienceCockpitSnapshot, createAudienceCockpitRouteSummary } from '../service-audience-cockpit.mjs';

export function createAudienceCockpitDashboardRoutes(basePath = '/audience-cockpit') {
  const snapshot = buildAudienceCockpitSnapshot();
  return [
    { id: 'audience-cockpit.dashboard.overview', method: 'GET', path: basePath, summary: createAudienceCockpitRouteSummary(snapshot) },
    { id: 'audience-cockpit.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'audience-cockpit.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

