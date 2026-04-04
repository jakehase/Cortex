import { buildConsentDossierSnapshot, createConsentDossierApiDocument } from '../service-consent-dossier.mjs';

export function createConsentDossierApiRoutes(basePath = '/api/consent-dossier') {
  const snapshot = buildConsentDossierSnapshot();
  return [
    { id: 'consent-dossier.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'consent-dossier.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'consent-dossier.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'consent-dossier.api.document', method: 'GET', path: basePath + '/document', document: createConsentDossierApiDocument(snapshot) }
  ];
}

