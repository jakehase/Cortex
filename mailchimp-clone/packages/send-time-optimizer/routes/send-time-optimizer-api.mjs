import { buildSendTimeOptimizerSnapshot, createSendTimeOptimizerApiDocument } from '../service-send-time-optimizer.mjs';

export function createSendTimeOptimizerApiRoutes(basePath = '/api/send-time-optimizer') {
  const snapshot = buildSendTimeOptimizerSnapshot();
  return [
    { id: 'send-time-optimizer.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'send-time-optimizer.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'send-time-optimizer.api.document', method: 'GET', path: basePath + '/document', document: createSendTimeOptimizerApiDocument(snapshot) }
  ];
}
