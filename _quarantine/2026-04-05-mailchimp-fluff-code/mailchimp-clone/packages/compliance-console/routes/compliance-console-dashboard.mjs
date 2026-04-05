import { buildComplianceConsoleSnapshot, createComplianceConsoleRouteSummary } from '../service-compliance-console.mjs';

export function createComplianceConsoleDashboardRoutes(basePath = '/compliance-console') {
  const snapshot = buildComplianceConsoleSnapshot();
  return [
    { id: 'compliance-console.dashboard.overview', method: 'GET', path: basePath, summary: createComplianceConsoleRouteSummary(snapshot) },
    { id: 'compliance-console.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'compliance-console.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

