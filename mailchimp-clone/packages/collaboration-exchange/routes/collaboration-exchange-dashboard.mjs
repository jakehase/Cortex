import { buildCollaborationExchangeSnapshot, createCollaborationExchangeRouteSummary } from '../service-collaboration-exchange.mjs';

export function createCollaborationExchangeDashboardRoutes(basePath = '/collaboration-exchange') {
  const snapshot = buildCollaborationExchangeSnapshot();
  return [
    { id: 'collaboration-exchange.dashboard.overview', method: 'GET', path: basePath, summary: createCollaborationExchangeRouteSummary(snapshot) },
    { id: 'collaboration-exchange.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'collaboration-exchange.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

