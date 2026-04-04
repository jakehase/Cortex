import { buildLoyaltyCockpitSnapshot, createLoyaltyCockpitRouteSummary } from '../service-loyalty-cockpit.mjs';

export function createLoyaltyCockpitDashboardRoutes(basePath = '/loyalty-cockpit') {
  const snapshot = buildLoyaltyCockpitSnapshot();
  return [
    { id: 'loyalty-cockpit.dashboard.overview', method: 'GET', path: basePath, summary: createLoyaltyCockpitRouteSummary(snapshot) },
    { id: 'loyalty-cockpit.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'loyalty-cockpit.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

