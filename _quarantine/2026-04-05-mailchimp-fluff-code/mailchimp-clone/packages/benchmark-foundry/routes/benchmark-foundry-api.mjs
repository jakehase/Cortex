import { buildBenchmarkFoundrySnapshot, createBenchmarkFoundryApiDocument } from '../service-benchmark-foundry.mjs';

export function createBenchmarkFoundryApiRoutes(basePath = '/api/benchmark-foundry') {
  const snapshot = buildBenchmarkFoundrySnapshot();
  return [
    { id: 'benchmark-foundry.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'benchmark-foundry.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'benchmark-foundry.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'benchmark-foundry.api.document', method: 'GET', path: basePath + '/document', document: createBenchmarkFoundryApiDocument(snapshot) }
  ];
}

