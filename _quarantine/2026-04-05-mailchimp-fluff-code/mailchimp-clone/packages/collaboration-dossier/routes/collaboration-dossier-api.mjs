import { buildCollaborationDossierSnapshot, createCollaborationDossierApiDocument } from '../service-collaboration-dossier.mjs';

export function createCollaborationDossierApiRoutes(basePath = '/api/collaboration-dossier') {
  const snapshot = buildCollaborationDossierSnapshot();
  return [
    { id: 'collaboration-dossier.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'collaboration-dossier.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'collaboration-dossier.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'collaboration-dossier.api.document', method: 'GET', path: basePath + '/document', document: createCollaborationDossierApiDocument(snapshot) }
  ];
}

