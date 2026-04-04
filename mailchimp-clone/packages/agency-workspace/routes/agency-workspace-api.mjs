import { buildAgencyWorkspaceSnapshot, createAgencyWorkspaceApiDocument } from '../service-agency-workspace.mjs';

export function createAgencyWorkspaceApiRoutes(basePath = '/api/agency-workspace') {
  const snapshot = buildAgencyWorkspaceSnapshot();
  return [
    { id: 'agency-workspace.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'agency-workspace.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'agency-workspace.api.document', method: 'GET', path: basePath + '/document', document: createAgencyWorkspaceApiDocument(snapshot) }
  ];
}
