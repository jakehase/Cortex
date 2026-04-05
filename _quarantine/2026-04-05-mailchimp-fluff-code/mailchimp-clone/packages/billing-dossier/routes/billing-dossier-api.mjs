import { buildBillingDossierSnapshot, createBillingDossierApiDocument } from '../service-billing-dossier.mjs';

export function createBillingDossierApiRoutes(basePath = '/api/billing-dossier') {
  const snapshot = buildBillingDossierSnapshot();
  return [
    { id: 'billing-dossier.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'billing-dossier.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'billing-dossier.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'billing-dossier.api.document', method: 'GET', path: basePath + '/document', document: createBillingDossierApiDocument(snapshot) }
  ];
}

