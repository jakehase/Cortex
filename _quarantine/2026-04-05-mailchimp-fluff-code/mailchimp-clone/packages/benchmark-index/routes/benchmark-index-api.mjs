import { buildBenchmarkIndexSnapshot, createBenchmarkIndexApiDocument } from '../service-benchmark-index.mjs';

export function createBenchmarkIndexApiRoutes(basePath = '/api/benchmark-index') {
  const snapshot = buildBenchmarkIndexSnapshot();
  return [
    { id: 'benchmark-index.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'benchmark-index.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'benchmark-index.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'benchmark-index.api.document', method: 'GET', path: basePath + '/document', document: createBenchmarkIndexApiDocument(snapshot) }
  ];
}

