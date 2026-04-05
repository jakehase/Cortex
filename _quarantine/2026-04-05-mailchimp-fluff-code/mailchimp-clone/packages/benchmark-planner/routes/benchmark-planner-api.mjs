import { buildBenchmarkPlannerSnapshot, createBenchmarkPlannerApiDocument } from '../service-benchmark-planner.mjs';

export function createBenchmarkPlannerApiRoutes(basePath = '/api/benchmark-planner') {
  const snapshot = buildBenchmarkPlannerSnapshot();
  return [
    { id: 'benchmark-planner.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'benchmark-planner.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'benchmark-planner.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'benchmark-planner.api.document', method: 'GET', path: basePath + '/document', document: createBenchmarkPlannerApiDocument(snapshot) }
  ];
}

