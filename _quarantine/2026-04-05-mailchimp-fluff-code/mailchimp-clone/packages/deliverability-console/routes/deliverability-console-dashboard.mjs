import { buildDeliverabilityConsoleSnapshot, createDeliverabilityConsoleRouteSummary } from '../service-deliverability-console.mjs';

export function createDeliverabilityConsoleDashboardRoutes(basePath = '/deliverability-console') {
  const snapshot = buildDeliverabilityConsoleSnapshot();
  return [
    { id: 'deliverability-console.dashboard.overview', method: 'GET', path: basePath, summary: createDeliverabilityConsoleRouteSummary(snapshot) },
    { id: 'deliverability-console.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'deliverability-console.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

