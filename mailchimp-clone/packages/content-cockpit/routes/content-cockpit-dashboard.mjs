import { buildContentCockpitSnapshot, createContentCockpitRouteSummary } from '../service-content-cockpit.mjs';

export function createContentCockpitDashboardRoutes(basePath = '/content-cockpit') {
  const snapshot = buildContentCockpitSnapshot();
  return [
    { id: 'content-cockpit.dashboard.overview', method: 'GET', path: basePath, summary: createContentCockpitRouteSummary(snapshot) },
    { id: 'content-cockpit.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'content-cockpit.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

