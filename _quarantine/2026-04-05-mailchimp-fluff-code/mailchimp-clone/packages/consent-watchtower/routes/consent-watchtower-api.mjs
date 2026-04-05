import { buildConsentWatchtowerSnapshot, createConsentWatchtowerApiDocument } from '../service-consent-watchtower.mjs';

export function createConsentWatchtowerApiRoutes(basePath = '/api/consent-watchtower') {
  const snapshot = buildConsentWatchtowerSnapshot();
  return [
    { id: 'consent-watchtower.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'consent-watchtower.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'consent-watchtower.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'consent-watchtower.api.document', method: 'GET', path: basePath + '/document', document: createConsentWatchtowerApiDocument(snapshot) }
  ];
}

