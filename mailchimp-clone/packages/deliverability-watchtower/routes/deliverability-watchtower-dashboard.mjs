import { buildDeliverabilityWatchtowerSnapshot, createDeliverabilityWatchtowerRouteSummary } from '../service-deliverability-watchtower.mjs';

export function createDeliverabilityWatchtowerDashboardRoutes(basePath = '/deliverability-watchtower') {
  const snapshot = buildDeliverabilityWatchtowerSnapshot();
  return [
    { id: 'deliverability-watchtower.dashboard.overview', method: 'GET', path: basePath, summary: createDeliverabilityWatchtowerRouteSummary(snapshot) },
    { id: 'deliverability-watchtower.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'deliverability-watchtower.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

