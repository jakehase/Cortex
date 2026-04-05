import { buildEcommerceDossierSnapshot, createEcommerceDossierApiDocument } from '../service-ecommerce-dossier.mjs';

export function createEcommerceDossierApiRoutes(basePath = '/api/ecommerce-dossier') {
  const snapshot = buildEcommerceDossierSnapshot();
  return [
    { id: 'ecommerce-dossier.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'ecommerce-dossier.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'ecommerce-dossier.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'ecommerce-dossier.api.document', method: 'GET', path: basePath + '/document', document: createEcommerceDossierApiDocument(snapshot) }
  ];
}

