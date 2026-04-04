import { buildAttributionCockpitSnapshot } from '../service-attribution-cockpit.mjs';
import { createAttributionCockpitFixtures } from '../fixtures-attribution-cockpit.mjs';

export function createAttributionCockpitPublicRoutes(basePath = '/public/attribution-cockpit') {
  const snapshot = buildAttributionCockpitSnapshot();
  const fixtures = createAttributionCockpitFixtures();
  return [
    { id: 'attribution-cockpit.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'attribution-cockpit.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'attribution-cockpit.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

