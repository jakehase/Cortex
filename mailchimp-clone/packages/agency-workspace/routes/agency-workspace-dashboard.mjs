import { buildAgencyWorkspaceSnapshot } from '../service-agency-workspace.mjs';

export function createAgencyWorkspaceDashboardRoutes(basePath = '/agency-workspace') {
  const snapshot = buildAgencyWorkspaceSnapshot();
  return [
    { id: 'agency-workspace.overview', method: 'GET', path: basePath, summary: snapshot.summary },
    { id: 'agency-workspace.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'agency-workspace.narratives', method: 'GET', path: basePath + '/narratives', narratives: snapshot.narratives }
  ];
}
