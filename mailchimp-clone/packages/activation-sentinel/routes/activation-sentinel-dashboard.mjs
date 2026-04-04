import { buildActivationSentinelSnapshot, createActivationSentinelRouteSummary } from '../service-activation-sentinel.mjs';

export function createActivationSentinelDashboardRoutes(basePath = '/activation-sentinel') {
  const snapshot = buildActivationSentinelSnapshot();
  return [
    { id: 'activation-sentinel.dashboard.overview', method: 'GET', path: basePath, summary: createActivationSentinelRouteSummary(snapshot) },
    { id: 'activation-sentinel.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'activation-sentinel.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

