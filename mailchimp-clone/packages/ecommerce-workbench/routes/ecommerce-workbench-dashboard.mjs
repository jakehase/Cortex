import { buildEcommerceWorkbenchSnapshot, createEcommerceWorkbenchRouteSummary } from '../service-ecommerce-workbench.mjs';

export function createEcommerceWorkbenchDashboardRoutes(basePath = '/ecommerce-workbench') {
  const snapshot = buildEcommerceWorkbenchSnapshot();
  return [
    { id: 'ecommerce-workbench.dashboard.overview', method: 'GET', path: basePath, summary: createEcommerceWorkbenchRouteSummary(snapshot) },
    { id: 'ecommerce-workbench.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'ecommerce-workbench.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

