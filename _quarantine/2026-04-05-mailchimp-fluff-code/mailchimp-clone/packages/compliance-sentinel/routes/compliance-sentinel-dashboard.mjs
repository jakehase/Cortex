import { buildComplianceSentinelSnapshot, createComplianceSentinelRouteSummary } from '../service-compliance-sentinel.mjs';

export function createComplianceSentinelDashboardRoutes(basePath = '/compliance-sentinel') {
  const snapshot = buildComplianceSentinelSnapshot();
  return [
    { id: 'compliance-sentinel.dashboard.overview', method: 'GET', path: basePath, summary: createComplianceSentinelRouteSummary(snapshot) },
    { id: 'compliance-sentinel.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'compliance-sentinel.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

