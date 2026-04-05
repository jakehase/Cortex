import { buildCollaborationCockpitSnapshot, createCollaborationCockpitRouteSummary } from '../service-collaboration-cockpit.mjs';

export function createCollaborationCockpitDashboardRoutes(basePath = '/collaboration-cockpit') {
  const snapshot = buildCollaborationCockpitSnapshot();
  return [
    { id: 'collaboration-cockpit.dashboard.overview', method: 'GET', path: basePath, summary: createCollaborationCockpitRouteSummary(snapshot) },
    { id: 'collaboration-cockpit.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'collaboration-cockpit.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

