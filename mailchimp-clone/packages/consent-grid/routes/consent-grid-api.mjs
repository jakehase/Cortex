import { buildConsentGridSnapshot, createConsentGridApiDocument } from '../service-consent-grid.mjs';

export function createConsentGridApiRoutes(basePath = '/api/consent-grid') {
  const snapshot = buildConsentGridSnapshot();
  return [
    { id: 'consent-grid.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'consent-grid.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'consent-grid.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'consent-grid.api.document', method: 'GET', path: basePath + '/document', document: createConsentGridApiDocument(snapshot) }
  ];
}

