import { buildDeliverabilityHubSnapshot, createDeliverabilityHubRouteSummary } from '../service-deliverability-hub.mjs';

export function createDeliverabilityHubDashboardRoutes(basePath = '/deliverability-hub') {
  const snapshot = buildDeliverabilityHubSnapshot();
  return [
    { id: 'deliverability-hub.dashboard.overview', method: 'GET', path: basePath, summary: createDeliverabilityHubRouteSummary(snapshot) },
    { id: 'deliverability-hub.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'deliverability-hub.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

