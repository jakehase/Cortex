import { buildLifecycleExchangeSnapshot, createLifecycleExchangeRouteSummary } from '../service-lifecycle-exchange.mjs';

export function createLifecycleExchangeDashboardRoutes(basePath = '/lifecycle-exchange') {
  const snapshot = buildLifecycleExchangeSnapshot();
  return [
    { id: 'lifecycle-exchange.dashboard.overview', method: 'GET', path: basePath, summary: createLifecycleExchangeRouteSummary(snapshot) },
    { id: 'lifecycle-exchange.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'lifecycle-exchange.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

