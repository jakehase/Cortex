import { buildAgencyWorkspaceSnapshot, createAgencyWorkspaceChecklist } from '../service-agency-workspace.mjs';

export function createAgencyWorkspaceOpsRoutes(basePath = '/ops/agency-workspace') {
  const snapshot = buildAgencyWorkspaceSnapshot();
  return [
    { id: 'agency-workspace.ops.health', method: 'GET', path: basePath + '/health', checklist: createAgencyWorkspaceChecklist(snapshot) },
    { id: 'agency-workspace.ops.policies', method: 'GET', path: basePath + '/policies', policies: snapshot.policies },
    { id: 'agency-workspace.ops.metrics', method: 'GET', path: basePath + '/metrics', scorecards: snapshot.workspace.scorecards }
  ];
}
