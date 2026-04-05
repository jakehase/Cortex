import { buildDeliverabilityNavigatorSnapshot, createDeliverabilityNavigatorRouteSummary } from '../service-deliverability-navigator.mjs';

export function createDeliverabilityNavigatorDashboardRoutes(basePath = '/deliverability-navigator') {
  const snapshot = buildDeliverabilityNavigatorSnapshot();
  return [
    { id: 'deliverability-navigator.dashboard.overview', method: 'GET', path: basePath, summary: createDeliverabilityNavigatorRouteSummary(snapshot) },
    { id: 'deliverability-navigator.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'deliverability-navigator.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

