import { buildDeliverabilityIndexSnapshot, createDeliverabilityIndexRouteSummary } from '../service-deliverability-index.mjs';

export function createDeliverabilityIndexDashboardRoutes(basePath = '/deliverability-index') {
  const snapshot = buildDeliverabilityIndexSnapshot();
  return [
    { id: 'deliverability-index.dashboard.overview', method: 'GET', path: basePath, summary: createDeliverabilityIndexRouteSummary(snapshot) },
    { id: 'deliverability-index.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'deliverability-index.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

