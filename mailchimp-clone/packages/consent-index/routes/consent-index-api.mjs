import { buildConsentIndexSnapshot, createConsentIndexApiDocument } from '../service-consent-index.mjs';

export function createConsentIndexApiRoutes(basePath = '/api/consent-index') {
  const snapshot = buildConsentIndexSnapshot();
  return [
    { id: 'consent-index.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'consent-index.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'consent-index.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'consent-index.api.document', method: 'GET', path: basePath + '/document', document: createConsentIndexApiDocument(snapshot) }
  ];
}

