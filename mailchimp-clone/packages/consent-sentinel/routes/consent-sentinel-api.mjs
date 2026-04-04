import { buildConsentSentinelSnapshot, createConsentSentinelApiDocument } from '../service-consent-sentinel.mjs';

export function createConsentSentinelApiRoutes(basePath = '/api/consent-sentinel') {
  const snapshot = buildConsentSentinelSnapshot();
  return [
    { id: 'consent-sentinel.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'consent-sentinel.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'consent-sentinel.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'consent-sentinel.api.document', method: 'GET', path: basePath + '/document', document: createConsentSentinelApiDocument(snapshot) }
  ];
}

