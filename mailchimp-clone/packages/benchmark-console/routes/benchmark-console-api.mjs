import { buildBenchmarkConsoleSnapshot, createBenchmarkConsoleApiDocument } from '../service-benchmark-console.mjs';

export function createBenchmarkConsoleApiRoutes(basePath = '/api/benchmark-console') {
  const snapshot = buildBenchmarkConsoleSnapshot();
  return [
    { id: 'benchmark-console.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'benchmark-console.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'benchmark-console.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'benchmark-console.api.document', method: 'GET', path: basePath + '/document', document: createBenchmarkConsoleApiDocument(snapshot) }
  ];
}

