import { buildBenchmarkWatchtowerSnapshot, createBenchmarkWatchtowerApiDocument } from '../service-benchmark-watchtower.mjs';

export function createBenchmarkWatchtowerApiRoutes(basePath = '/api/benchmark-watchtower') {
  const snapshot = buildBenchmarkWatchtowerSnapshot();
  return [
    { id: 'benchmark-watchtower.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'benchmark-watchtower.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'benchmark-watchtower.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'benchmark-watchtower.api.document', method: 'GET', path: basePath + '/document', document: createBenchmarkWatchtowerApiDocument(snapshot) }
  ];
}

