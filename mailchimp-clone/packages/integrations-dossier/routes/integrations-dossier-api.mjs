import { buildIntegrationsDossierSnapshot, createIntegrationsDossierApiDocument } from '../service-integrations-dossier.mjs';

export function createIntegrationsDossierApiRoutes(basePath = '/api/integrations-dossier') {
  const snapshot = buildIntegrationsDossierSnapshot();
  return [
    { id: 'integrations-dossier.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'integrations-dossier.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'integrations-dossier.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'integrations-dossier.api.document', method: 'GET', path: basePath + '/document', document: createIntegrationsDossierApiDocument(snapshot) }
  ];
}

