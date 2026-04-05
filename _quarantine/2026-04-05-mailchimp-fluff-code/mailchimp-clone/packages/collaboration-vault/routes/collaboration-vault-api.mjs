import { buildCollaborationVaultSnapshot, createCollaborationVaultApiDocument } from '../service-collaboration-vault.mjs';

export function createCollaborationVaultApiRoutes(basePath = '/api/collaboration-vault') {
  const snapshot = buildCollaborationVaultSnapshot();
  return [
    { id: 'collaboration-vault.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'collaboration-vault.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'collaboration-vault.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'collaboration-vault.api.document', method: 'GET', path: basePath + '/document', document: createCollaborationVaultApiDocument(snapshot) }
  ];
}

