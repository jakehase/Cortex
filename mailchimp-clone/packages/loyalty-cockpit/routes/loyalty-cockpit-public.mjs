import { buildLoyaltyCockpitSnapshot } from '../service-loyalty-cockpit.mjs';
import { createLoyaltyCockpitFixtures } from '../fixtures-loyalty-cockpit.mjs';

export function createLoyaltyCockpitPublicRoutes(basePath = '/public/loyalty-cockpit') {
  const snapshot = buildLoyaltyCockpitSnapshot();
  const fixtures = createLoyaltyCockpitFixtures();
  return [
    { id: 'loyalty-cockpit.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'loyalty-cockpit.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'loyalty-cockpit.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

