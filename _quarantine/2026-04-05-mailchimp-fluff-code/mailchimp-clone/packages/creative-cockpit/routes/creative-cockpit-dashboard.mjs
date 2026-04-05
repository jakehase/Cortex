import { buildCreativeCockpitSnapshot, createCreativeCockpitRouteSummary } from '../service-creative-cockpit.mjs';

export function createCreativeCockpitDashboardRoutes(basePath = '/creative-cockpit') {
  const snapshot = buildCreativeCockpitSnapshot();
  return [
    { id: 'creative-cockpit.dashboard.overview', method: 'GET', path: basePath, summary: createCreativeCockpitRouteSummary(snapshot) },
    { id: 'creative-cockpit.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'creative-cockpit.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

