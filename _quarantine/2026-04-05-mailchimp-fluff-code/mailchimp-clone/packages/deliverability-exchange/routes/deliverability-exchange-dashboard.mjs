import { buildDeliverabilityExchangeSnapshot, createDeliverabilityExchangeRouteSummary } from '../service-deliverability-exchange.mjs';

export function createDeliverabilityExchangeDashboardRoutes(basePath = '/deliverability-exchange') {
  const snapshot = buildDeliverabilityExchangeSnapshot();
  return [
    { id: 'deliverability-exchange.dashboard.overview', method: 'GET', path: basePath, summary: createDeliverabilityExchangeRouteSummary(snapshot) },
    { id: 'deliverability-exchange.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'deliverability-exchange.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

