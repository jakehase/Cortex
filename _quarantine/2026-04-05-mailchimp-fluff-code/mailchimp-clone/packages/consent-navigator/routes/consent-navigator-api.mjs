import { buildConsentNavigatorSnapshot, createConsentNavigatorApiDocument } from '../service-consent-navigator.mjs';

export function createConsentNavigatorApiRoutes(basePath = '/api/consent-navigator') {
  const snapshot = buildConsentNavigatorSnapshot();
  return [
    { id: 'consent-navigator.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'consent-navigator.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'consent-navigator.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'consent-navigator.api.document', method: 'GET', path: basePath + '/document', document: createConsentNavigatorApiDocument(snapshot) }
  ];
}

