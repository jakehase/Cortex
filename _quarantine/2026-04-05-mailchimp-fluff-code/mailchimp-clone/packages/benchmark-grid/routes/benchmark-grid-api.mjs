import { buildBenchmarkGridSnapshot, createBenchmarkGridApiDocument } from '../service-benchmark-grid.mjs';

export function createBenchmarkGridApiRoutes(basePath = '/api/benchmark-grid') {
  const snapshot = buildBenchmarkGridSnapshot();
  return [
    { id: 'benchmark-grid.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'benchmark-grid.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'benchmark-grid.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'benchmark-grid.api.document', method: 'GET', path: basePath + '/document', document: createBenchmarkGridApiDocument(snapshot) }
  ];
}

