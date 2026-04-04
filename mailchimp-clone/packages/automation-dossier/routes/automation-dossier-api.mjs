import { buildAutomationDossierSnapshot, createAutomationDossierApiDocument } from '../service-automation-dossier.mjs';

export function createAutomationDossierApiRoutes(basePath = '/api/automation-dossier') {
  const snapshot = buildAutomationDossierSnapshot();
  return [
    { id: 'automation-dossier.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'automation-dossier.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'automation-dossier.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'automation-dossier.api.document', method: 'GET', path: basePath + '/document', document: createAutomationDossierApiDocument(snapshot) }
  ];
}

