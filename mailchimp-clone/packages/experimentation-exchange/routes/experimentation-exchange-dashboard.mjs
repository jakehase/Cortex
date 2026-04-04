import { buildExperimentationExchangeSnapshot, createExperimentationExchangeRouteSummary } from '../service-experimentation-exchange.mjs';

export function createExperimentationExchangeDashboardRoutes(basePath = '/experimentation-exchange') {
  const snapshot = buildExperimentationExchangeSnapshot();
  return [
    { id: 'experimentation-exchange.dashboard.overview', method: 'GET', path: basePath, summary: createExperimentationExchangeRouteSummary(snapshot) },
    { id: 'experimentation-exchange.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'experimentation-exchange.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

