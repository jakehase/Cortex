import { buildRetentionLabSnapshot } from '../service-retention-lab.mjs';
import { createRetentionLabFixtures } from '../fixtures-retention-lab.mjs';

export function createRetentionLabPublicRoutes(basePath = '/public/retention-lab') {
  const snapshot = buildRetentionLabSnapshot();
  const fixtures = createRetentionLabFixtures();
  return [
    { id: 'retention-lab.public.summary', method: 'GET', path: basePath, focus: snapshot.summary.focus },
    { id: 'retention-lab.public.catalog', method: 'GET', path: basePath + '/catalog', contacts: fixtures.contacts },
    { id: 'retention-lab.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}
