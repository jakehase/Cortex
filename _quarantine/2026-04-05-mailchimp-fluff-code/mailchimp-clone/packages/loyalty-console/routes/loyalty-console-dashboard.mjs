import { buildLoyaltyConsoleSnapshot, createLoyaltyConsoleRouteSummary } from '../service-loyalty-console.mjs';

export function createLoyaltyConsoleDashboardRoutes(basePath = '/loyalty-console') {
  const snapshot = buildLoyaltyConsoleSnapshot();
  return [
    { id: 'loyalty-console.dashboard.overview', method: 'GET', path: basePath, summary: createLoyaltyConsoleRouteSummary(snapshot) },
    { id: 'loyalty-console.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'loyalty-console.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

