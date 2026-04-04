import { buildBenchmarkSentinelSnapshot } from '../service-benchmark-sentinel.mjs';
import { createBenchmarkSentinelFixtures } from '../fixtures-benchmark-sentinel.mjs';

export function createBenchmarkSentinelPublicRoutes(basePath = '/public/benchmark-sentinel') {
  const snapshot = buildBenchmarkSentinelSnapshot();
  const fixtures = createBenchmarkSentinelFixtures();
  return [
    { id: 'benchmark-sentinel.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'benchmark-sentinel.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'benchmark-sentinel.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

