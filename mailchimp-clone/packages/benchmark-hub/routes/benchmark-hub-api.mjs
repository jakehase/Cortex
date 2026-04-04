import { buildBenchmarkHubSnapshot, createBenchmarkHubApiDocument } from '../service-benchmark-hub.mjs';

export function createBenchmarkHubApiRoutes(basePath = '/api/benchmark-hub') {
  const snapshot = buildBenchmarkHubSnapshot();
  return [
    { id: 'benchmark-hub.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'benchmark-hub.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'benchmark-hub.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'benchmark-hub.api.document', method: 'GET', path: basePath + '/document', document: createBenchmarkHubApiDocument(snapshot) }
  ];
}

