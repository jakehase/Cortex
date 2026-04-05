import { buildBenchmarkNavigatorSnapshot, createBenchmarkNavigatorApiDocument } from '../service-benchmark-navigator.mjs';

export function createBenchmarkNavigatorApiRoutes(basePath = '/api/benchmark-navigator') {
  const snapshot = buildBenchmarkNavigatorSnapshot();
  return [
    { id: 'benchmark-navigator.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'benchmark-navigator.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'benchmark-navigator.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'benchmark-navigator.api.document', method: 'GET', path: basePath + '/document', document: createBenchmarkNavigatorApiDocument(snapshot) }
  ];
}

