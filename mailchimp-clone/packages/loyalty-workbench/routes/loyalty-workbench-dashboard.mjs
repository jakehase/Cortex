import { buildLoyaltyWorkbenchSnapshot, createLoyaltyWorkbenchRouteSummary } from '../service-loyalty-workbench.mjs';

export function createLoyaltyWorkbenchDashboardRoutes(basePath = '/loyalty-workbench') {
  const snapshot = buildLoyaltyWorkbenchSnapshot();
  return [
    { id: 'loyalty-workbench.dashboard.overview', method: 'GET', path: basePath, summary: createLoyaltyWorkbenchRouteSummary(snapshot) },
    { id: 'loyalty-workbench.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'loyalty-workbench.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

