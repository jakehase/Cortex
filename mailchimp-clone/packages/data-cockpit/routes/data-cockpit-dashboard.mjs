import { buildDataCockpitSnapshot, createDataCockpitRouteSummary } from '../service-data-cockpit.mjs';

export function createDataCockpitDashboardRoutes(basePath = '/data-cockpit') {
  const snapshot = buildDataCockpitSnapshot();
  return [
    { id: 'data-cockpit.dashboard.overview', method: 'GET', path: basePath, summary: createDataCockpitRouteSummary(snapshot) },
    { id: 'data-cockpit.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'data-cockpit.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

