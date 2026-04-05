import { buildBenchmarkAdvisorSnapshot } from '../service-benchmark-advisor.mjs';
import { createBenchmarkAdvisorFixtures } from '../fixtures-benchmark-advisor.mjs';

export function createBenchmarkAdvisorPublicRoutes(basePath = '/public/benchmark-advisor') {
  const snapshot = buildBenchmarkAdvisorSnapshot();
  const fixtures = createBenchmarkAdvisorFixtures();
  return [
    { id: 'benchmark-advisor.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'benchmark-advisor.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'benchmark-advisor.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

