import { buildComplianceWatchtowerSnapshot, createComplianceWatchtowerRouteSummary } from '../service-compliance-watchtower.mjs';

export function createComplianceWatchtowerDashboardRoutes(basePath = '/compliance-watchtower') {
  const snapshot = buildComplianceWatchtowerSnapshot();
  return [
    { id: 'compliance-watchtower.dashboard.overview', method: 'GET', path: basePath, summary: createComplianceWatchtowerRouteSummary(snapshot) },
    { id: 'compliance-watchtower.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'compliance-watchtower.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

