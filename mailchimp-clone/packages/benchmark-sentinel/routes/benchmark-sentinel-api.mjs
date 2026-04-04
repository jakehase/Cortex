import { buildBenchmarkSentinelSnapshot, createBenchmarkSentinelApiDocument } from '../service-benchmark-sentinel.mjs';

export function createBenchmarkSentinelApiRoutes(basePath = '/api/benchmark-sentinel') {
  const snapshot = buildBenchmarkSentinelSnapshot();
  return [
    { id: 'benchmark-sentinel.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'benchmark-sentinel.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'benchmark-sentinel.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'benchmark-sentinel.api.document', method: 'GET', path: basePath + '/document', document: createBenchmarkSentinelApiDocument(snapshot) }
  ];
}

