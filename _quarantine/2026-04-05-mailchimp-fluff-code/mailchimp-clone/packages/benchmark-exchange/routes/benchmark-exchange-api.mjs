import { buildBenchmarkExchangeSnapshot, createBenchmarkExchangeApiDocument } from '../service-benchmark-exchange.mjs';

export function createBenchmarkExchangeApiRoutes(basePath = '/api/benchmark-exchange') {
  const snapshot = buildBenchmarkExchangeSnapshot();
  return [
    { id: 'benchmark-exchange.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'benchmark-exchange.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'benchmark-exchange.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'benchmark-exchange.api.document', method: 'GET', path: basePath + '/document', document: createBenchmarkExchangeApiDocument(snapshot) }
  ];
}

