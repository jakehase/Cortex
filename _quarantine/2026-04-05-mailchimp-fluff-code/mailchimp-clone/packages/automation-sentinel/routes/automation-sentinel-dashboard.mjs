import { buildAutomationSentinelSnapshot, createAutomationSentinelRouteSummary } from '../service-automation-sentinel.mjs';

export function createAutomationSentinelDashboardRoutes(basePath = '/automation-sentinel') {
  const snapshot = buildAutomationSentinelSnapshot();
  return [
    { id: 'automation-sentinel.dashboard.overview', method: 'GET', path: basePath, summary: createAutomationSentinelRouteSummary(snapshot) },
    { id: 'automation-sentinel.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'automation-sentinel.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

