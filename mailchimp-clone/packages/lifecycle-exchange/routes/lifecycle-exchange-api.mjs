import { buildLifecycleExchangeSnapshot, createLifecycleExchangeApiDocument } from '../service-lifecycle-exchange.mjs';

export function createLifecycleExchangeApiRoutes(basePath = '/api/lifecycle-exchange') {
  const snapshot = buildLifecycleExchangeSnapshot();
  return [
    { id: 'lifecycle-exchange.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'lifecycle-exchange.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'lifecycle-exchange.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'lifecycle-exchange.api.document', method: 'GET', path: basePath + '/document', document: createLifecycleExchangeApiDocument(snapshot) }
  ];
}

