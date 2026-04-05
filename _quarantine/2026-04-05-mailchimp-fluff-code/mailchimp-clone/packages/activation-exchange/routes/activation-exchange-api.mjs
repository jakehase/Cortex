import { buildActivationExchangeSnapshot, createActivationExchangeApiDocument } from '../service-activation-exchange.mjs';

export function createActivationExchangeApiRoutes(basePath = '/api/activation-exchange') {
  const snapshot = buildActivationExchangeSnapshot();
  return [
    { id: 'activation-exchange.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'activation-exchange.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'activation-exchange.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'activation-exchange.api.document', method: 'GET', path: basePath + '/document', document: createActivationExchangeApiDocument(snapshot) }
  ];
}

