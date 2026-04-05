import { buildExperimentationSentinelSnapshot, createExperimentationSentinelApiDocument } from '../service-experimentation-sentinel.mjs';

export function createExperimentationSentinelApiRoutes(basePath = '/api/experimentation-sentinel') {
  const snapshot = buildExperimentationSentinelSnapshot();
  return [
    { id: 'experimentation-sentinel.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'experimentation-sentinel.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'experimentation-sentinel.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'experimentation-sentinel.api.document', method: 'GET', path: basePath + '/document', document: createExperimentationSentinelApiDocument(snapshot) }
  ];
}

