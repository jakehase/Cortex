import { buildLoyaltyExchangeSnapshot, createLoyaltyExchangeApiDocument } from '../service-loyalty-exchange.mjs';

export function createLoyaltyExchangeApiRoutes(basePath = '/api/loyalty-exchange') {
  const snapshot = buildLoyaltyExchangeSnapshot();
  return [
    { id: 'loyalty-exchange.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'loyalty-exchange.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'loyalty-exchange.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'loyalty-exchange.api.document', method: 'GET', path: basePath + '/document', document: createLoyaltyExchangeApiDocument(snapshot) }
  ];
}

