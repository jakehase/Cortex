import { buildDeliverabilityStudioSnapshot, createDeliverabilityStudioRouteSummary } from '../service-deliverability-studio.mjs';

export function createDeliverabilityStudioDashboardRoutes(basePath = '/deliverability-studio') {
  const snapshot = buildDeliverabilityStudioSnapshot();
  return [
    { id: 'deliverability-studio.dashboard.overview', method: 'GET', path: basePath, summary: createDeliverabilityStudioRouteSummary(snapshot) },
    { id: 'deliverability-studio.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'deliverability-studio.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

