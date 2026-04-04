import { buildAcquisitionDossierSnapshot, createAcquisitionDossierApiDocument } from '../service-acquisition-dossier.mjs';

export function createAcquisitionDossierApiRoutes(basePath = '/api/acquisition-dossier') {
  const snapshot = buildAcquisitionDossierSnapshot();
  return [
    { id: 'acquisition-dossier.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'acquisition-dossier.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'acquisition-dossier.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'acquisition-dossier.api.document', method: 'GET', path: basePath + '/document', document: createAcquisitionDossierApiDocument(snapshot) }
  ];
}

