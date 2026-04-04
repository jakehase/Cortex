import { buildExperimentationExchangeSnapshot, createExperimentationExchangeApiDocument } from '../service-experimentation-exchange.mjs';

export function createExperimentationExchangeApiRoutes(basePath = '/api/experimentation-exchange') {
  const snapshot = buildExperimentationExchangeSnapshot();
  return [
    { id: 'experimentation-exchange.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'experimentation-exchange.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'experimentation-exchange.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'experimentation-exchange.api.document', method: 'GET', path: basePath + '/document', document: createExperimentationExchangeApiDocument(snapshot) }
  ];
}

