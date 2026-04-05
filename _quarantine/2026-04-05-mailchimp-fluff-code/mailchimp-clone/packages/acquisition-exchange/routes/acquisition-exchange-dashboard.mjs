import { buildAcquisitionExchangeSnapshot, createAcquisitionExchangeRouteSummary } from '../service-acquisition-exchange.mjs';

export function createAcquisitionExchangeDashboardRoutes(basePath = '/acquisition-exchange') {
  const snapshot = buildAcquisitionExchangeSnapshot();
  return [
    { id: 'acquisition-exchange.dashboard.overview', method: 'GET', path: basePath, summary: createAcquisitionExchangeRouteSummary(snapshot) },
    { id: 'acquisition-exchange.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'acquisition-exchange.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

