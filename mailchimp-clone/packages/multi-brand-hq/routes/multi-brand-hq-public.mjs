import { buildMultiBrandHqSnapshot } from '../service-multi-brand-hq.mjs';
import { createMultiBrandHqFixtures } from '../fixtures-multi-brand-hq.mjs';

export function createMultiBrandHqPublicRoutes(basePath = '/public/multi-brand-hq') {
  const snapshot = buildMultiBrandHqSnapshot();
  const fixtures = createMultiBrandHqFixtures();
  return [
    { id: 'multi-brand-hq.public.summary', method: 'GET', path: basePath, focus: snapshot.summary.focus },
    { id: 'multi-brand-hq.public.catalog', method: 'GET', path: basePath + '/catalog', contacts: fixtures.contacts },
    { id: 'multi-brand-hq.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}
