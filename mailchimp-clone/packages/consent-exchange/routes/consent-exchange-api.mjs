import { buildConsentExchangeSnapshot, createConsentExchangeApiDocument } from '../service-consent-exchange.mjs';

export function createConsentExchangeApiRoutes(basePath = '/api/consent-exchange') {
  const snapshot = buildConsentExchangeSnapshot();
  return [
    { id: 'consent-exchange.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'consent-exchange.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'consent-exchange.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'consent-exchange.api.document', method: 'GET', path: basePath + '/document', document: createConsentExchangeApiDocument(snapshot) }
  ];
}

