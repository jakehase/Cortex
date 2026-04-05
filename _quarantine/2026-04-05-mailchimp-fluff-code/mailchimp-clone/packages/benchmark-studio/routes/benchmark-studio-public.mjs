import { buildBenchmarkStudioSnapshot } from '../service-benchmark-studio.mjs';
import { createBenchmarkStudioFixtures } from '../fixtures-benchmark-studio.mjs';

export function createBenchmarkStudioPublicRoutes(basePath = '/public/benchmark-studio') { const snapshot = buildBenchmarkStudioSnapshot(); const fixtures = createBenchmarkStudioFixtures(); return [{ id: 'benchmark-studio.public.summary', method: 'GET', path: basePath, focus: snapshot.summary.focus }, { id: 'benchmark-studio.public.catalog', method: 'GET', path: basePath + '/catalog', contacts: fixtures.contacts }, { id: 'benchmark-studio.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }]; }

