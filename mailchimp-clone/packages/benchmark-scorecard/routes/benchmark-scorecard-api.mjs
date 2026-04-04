import { buildBenchmarkScorecardSnapshot, createBenchmarkScorecardApiDocument } from '../service-benchmark-scorecard.mjs';

export function createBenchmarkScorecardApiRoutes(basePath = '/api/benchmark-scorecard') {
  const snapshot = buildBenchmarkScorecardSnapshot();
  return [
    { id: 'benchmark-scorecard.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'benchmark-scorecard.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'benchmark-scorecard.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'benchmark-scorecard.api.document', method: 'GET', path: basePath + '/document', document: createBenchmarkScorecardApiDocument(snapshot) }
  ];
}

