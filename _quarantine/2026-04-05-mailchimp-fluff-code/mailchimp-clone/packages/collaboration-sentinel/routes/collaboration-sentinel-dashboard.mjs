import { buildCollaborationSentinelSnapshot, createCollaborationSentinelRouteSummary } from '../service-collaboration-sentinel.mjs';

export function createCollaborationSentinelDashboardRoutes(basePath = '/collaboration-sentinel') {
  const snapshot = buildCollaborationSentinelSnapshot();
  return [
    { id: 'collaboration-sentinel.dashboard.overview', method: 'GET', path: basePath, summary: createCollaborationSentinelRouteSummary(snapshot) },
    { id: 'collaboration-sentinel.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'collaboration-sentinel.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

