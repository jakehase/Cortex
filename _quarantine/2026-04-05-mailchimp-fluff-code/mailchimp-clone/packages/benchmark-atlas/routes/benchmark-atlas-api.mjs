import { buildBenchmarkAtlasSnapshot, createBenchmarkAtlasApiDocument } from '../service-benchmark-atlas.mjs';

export function createBenchmarkAtlasApiRoutes(basePath = '/api/benchmark-atlas') {
  const snapshot = buildBenchmarkAtlasSnapshot();
  return [
    { id: 'benchmark-atlas.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'benchmark-atlas.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'benchmark-atlas.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'benchmark-atlas.api.document', method: 'GET', path: basePath + '/document', document: createBenchmarkAtlasApiDocument(snapshot) }
  ];
}

