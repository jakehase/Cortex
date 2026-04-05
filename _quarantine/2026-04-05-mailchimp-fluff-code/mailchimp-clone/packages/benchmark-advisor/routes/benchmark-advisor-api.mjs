import { buildBenchmarkAdvisorSnapshot, createBenchmarkAdvisorApiDocument } from '../service-benchmark-advisor.mjs';

export function createBenchmarkAdvisorApiRoutes(basePath = '/api/benchmark-advisor') {
  const snapshot = buildBenchmarkAdvisorSnapshot();
  return [
    { id: 'benchmark-advisor.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'benchmark-advisor.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'benchmark-advisor.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'benchmark-advisor.api.document', method: 'GET', path: basePath + '/document', document: createBenchmarkAdvisorApiDocument(snapshot) }
  ];
}

