import { buildComplianceWorkbenchSnapshot, createComplianceWorkbenchRouteSummary } from '../service-compliance-workbench.mjs';

export function createComplianceWorkbenchDashboardRoutes(basePath = '/compliance-workbench') {
  const snapshot = buildComplianceWorkbenchSnapshot();
  return [
    { id: 'compliance-workbench.dashboard.overview', method: 'GET', path: basePath, summary: createComplianceWorkbenchRouteSummary(snapshot) },
    { id: 'compliance-workbench.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'compliance-workbench.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

