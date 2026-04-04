import { buildBenchmarkScorecardSnapshot } from '../service-benchmark-scorecard.mjs';
import { createBenchmarkScorecardFixtures } from '../fixtures-benchmark-scorecard.mjs';

export function createBenchmarkScorecardPublicRoutes(basePath = '/public/benchmark-scorecard') {
  const snapshot = buildBenchmarkScorecardSnapshot();
  const fixtures = createBenchmarkScorecardFixtures();
  return [
    { id: 'benchmark-scorecard.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'benchmark-scorecard.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'benchmark-scorecard.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

