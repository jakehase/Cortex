import { buildIntegrationsSentinelSnapshot, createIntegrationsSentinelRouteSummary } from '../service-integrations-sentinel.mjs';

export function createIntegrationsSentinelDashboardRoutes(basePath = '/integrations-sentinel') {
  const snapshot = buildIntegrationsSentinelSnapshot();
  return [
    { id: 'integrations-sentinel.dashboard.overview', method: 'GET', path: basePath, summary: createIntegrationsSentinelRouteSummary(snapshot) },
    { id: 'integrations-sentinel.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'integrations-sentinel.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

