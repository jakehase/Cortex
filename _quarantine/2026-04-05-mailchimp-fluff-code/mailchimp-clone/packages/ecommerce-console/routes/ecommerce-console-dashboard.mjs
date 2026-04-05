import { buildEcommerceConsoleSnapshot, createEcommerceConsoleRouteSummary } from '../service-ecommerce-console.mjs';

export function createEcommerceConsoleDashboardRoutes(basePath = '/ecommerce-console') {
  const snapshot = buildEcommerceConsoleSnapshot();
  return [
    { id: 'ecommerce-console.dashboard.overview', method: 'GET', path: basePath, summary: createEcommerceConsoleRouteSummary(snapshot) },
    { id: 'ecommerce-console.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'ecommerce-console.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

