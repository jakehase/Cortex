import { buildAudienceExchangeSnapshot, createAudienceExchangeApiDocument } from '../service-audience-exchange.mjs';

export function createAudienceExchangeApiRoutes(basePath = '/api/audience-exchange') {
  const snapshot = buildAudienceExchangeSnapshot();
  return [
    { id: 'audience-exchange.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'audience-exchange.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'audience-exchange.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'audience-exchange.api.document', method: 'GET', path: basePath + '/document', document: createAudienceExchangeApiDocument(snapshot) }
  ];
}

