import { buildDataResidencySnapshot } from '../service-data-residency.mjs';
import { createDataResidencyFixtures } from '../fixtures-data-residency.mjs';

export function createDataResidencyPublicRoutes(basePath = '/public/data-residency') {
  const snapshot = buildDataResidencySnapshot();
  const fixtures = createDataResidencyFixtures();
  return [
    { id: 'data-residency.public.summary', method: 'GET', path: basePath, focus: snapshot.summary.focus },
    { id: 'data-residency.public.catalog', method: 'GET', path: basePath + '/catalog', contacts: fixtures.contacts },
    { id: 'data-residency.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}
