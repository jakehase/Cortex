import { buildExperimentationSentinelSnapshot, createExperimentationSentinelRouteSummary } from '../service-experimentation-sentinel.mjs';

export function createExperimentationSentinelDashboardRoutes(basePath = '/experimentation-sentinel') {
  const snapshot = buildExperimentationSentinelSnapshot();
  return [
    { id: 'experimentation-sentinel.dashboard.overview', method: 'GET', path: basePath, summary: createExperimentationSentinelRouteSummary(snapshot) },
    { id: 'experimentation-sentinel.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'experimentation-sentinel.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

