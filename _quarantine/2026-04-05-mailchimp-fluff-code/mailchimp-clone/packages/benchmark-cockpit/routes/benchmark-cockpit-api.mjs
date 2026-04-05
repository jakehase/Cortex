import { buildBenchmarkCockpitSnapshot, createBenchmarkCockpitApiDocument } from '../service-benchmark-cockpit.mjs';

export function createBenchmarkCockpitApiRoutes(basePath = '/api/benchmark-cockpit') {
  const snapshot = buildBenchmarkCockpitSnapshot();
  return [
    { id: 'benchmark-cockpit.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'benchmark-cockpit.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'benchmark-cockpit.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'benchmark-cockpit.api.document', method: 'GET', path: basePath + '/document', document: createBenchmarkCockpitApiDocument(snapshot) }
  ];
}

