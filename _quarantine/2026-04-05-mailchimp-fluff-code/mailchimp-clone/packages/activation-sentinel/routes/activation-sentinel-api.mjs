import { buildActivationSentinelSnapshot, createActivationSentinelApiDocument } from '../service-activation-sentinel.mjs';

export function createActivationSentinelApiRoutes(basePath = '/api/activation-sentinel') {
  const snapshot = buildActivationSentinelSnapshot();
  return [
    { id: 'activation-sentinel.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'activation-sentinel.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'activation-sentinel.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'activation-sentinel.api.document', method: 'GET', path: basePath + '/document', document: createActivationSentinelApiDocument(snapshot) }
  ];
}

