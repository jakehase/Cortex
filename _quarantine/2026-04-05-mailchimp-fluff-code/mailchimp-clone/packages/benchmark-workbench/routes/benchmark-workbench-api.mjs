import { buildBenchmarkWorkbenchSnapshot, createBenchmarkWorkbenchApiDocument } from '../service-benchmark-workbench.mjs';

export function createBenchmarkWorkbenchApiRoutes(basePath = '/api/benchmark-workbench') {
  const snapshot = buildBenchmarkWorkbenchSnapshot();
  return [
    { id: 'benchmark-workbench.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'benchmark-workbench.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'benchmark-workbench.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'benchmark-workbench.api.document', method: 'GET', path: basePath + '/document', document: createBenchmarkWorkbenchApiDocument(snapshot) }
  ];
}

