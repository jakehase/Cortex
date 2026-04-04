import { buildActivationDossierSnapshot, createActivationDossierApiDocument } from '../service-activation-dossier.mjs';

export function createActivationDossierApiRoutes(basePath = '/api/activation-dossier') {
  const snapshot = buildActivationDossierSnapshot();
  return [
    { id: 'activation-dossier.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'activation-dossier.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'activation-dossier.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'activation-dossier.api.document', method: 'GET', path: basePath + '/document', document: createActivationDossierApiDocument(snapshot) }
  ];
}

