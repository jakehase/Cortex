import { buildOpsObservabilitySnapshot } from '../service-ops-observability.mjs';
import { createOpsObservabilityFixtures } from '../fixtures-ops-observability.mjs';

export function createOpsObservabilityPublicRoutes(basePath = '/public/ops-observability') {
  const snapshot = buildOpsObservabilitySnapshot();
  const fixtures = createOpsObservabilityFixtures();
  return [
    { id: 'ops-observability.public.summary', method: 'GET', path: basePath, focus: snapshot.summary.focus },
    { id: 'ops-observability.public.catalog', method: 'GET', path: basePath + '/catalog', contacts: fixtures.contacts },
    { id: 'ops-observability.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}
