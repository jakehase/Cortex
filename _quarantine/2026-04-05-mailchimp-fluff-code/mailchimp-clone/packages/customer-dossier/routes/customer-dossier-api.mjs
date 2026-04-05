import { buildCustomerDossierSnapshot, createCustomerDossierApiDocument } from '../service-customer-dossier.mjs';

export function createCustomerDossierApiRoutes(basePath = '/api/customer-dossier') {
  const snapshot = buildCustomerDossierSnapshot();
  return [
    { id: 'customer-dossier.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'customer-dossier.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'customer-dossier.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'customer-dossier.api.document', method: 'GET', path: basePath + '/document', document: createCustomerDossierApiDocument(snapshot) }
  ];
}

