import { buildAcquisitionExchangeSnapshot, createAcquisitionExchangeApiDocument } from '../service-acquisition-exchange.mjs';

export function createAcquisitionExchangeApiRoutes(basePath = '/api/acquisition-exchange') {
  const snapshot = buildAcquisitionExchangeSnapshot();
  return [
    { id: 'acquisition-exchange.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'acquisition-exchange.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'acquisition-exchange.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'acquisition-exchange.api.document', method: 'GET', path: basePath + '/document', document: createAcquisitionExchangeApiDocument(snapshot) }
  ];
}

