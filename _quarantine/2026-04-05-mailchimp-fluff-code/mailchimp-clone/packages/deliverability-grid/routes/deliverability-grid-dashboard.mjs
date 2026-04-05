import { buildDeliverabilityGridSnapshot, createDeliverabilityGridRouteSummary } from '../service-deliverability-grid.mjs';

export function createDeliverabilityGridDashboardRoutes(basePath = '/deliverability-grid') {
  const snapshot = buildDeliverabilityGridSnapshot();
  return [
    { id: 'deliverability-grid.dashboard.overview', method: 'GET', path: basePath, summary: createDeliverabilityGridRouteSummary(snapshot) },
    { id: 'deliverability-grid.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'deliverability-grid.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

