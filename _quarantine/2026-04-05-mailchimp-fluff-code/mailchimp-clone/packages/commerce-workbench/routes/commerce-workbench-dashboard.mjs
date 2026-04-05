import { buildCommerceWorkbenchSnapshot, createCommerceWorkbenchRouteSummary } from '../service-commerce-workbench.mjs';

export function createCommerceWorkbenchDashboardRoutes(basePath = '/commerce-workbench') {
  const snapshot = buildCommerceWorkbenchSnapshot();
  return [
    { id: 'commerce-workbench.dashboard.overview', method: 'GET', path: basePath, summary: createCommerceWorkbenchRouteSummary(snapshot) },
    { id: 'commerce-workbench.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'commerce-workbench.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

