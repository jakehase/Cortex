import { buildBillingWatchtowerSnapshot } from '../service-billing-watchtower.mjs';
import { createBillingWatchtowerFixtures } from '../fixtures-billing-watchtower.mjs';

export function createBillingWatchtowerPublicRoutes(basePath = '/public/billing-watchtower') {
  const snapshot = buildBillingWatchtowerSnapshot();
  const fixtures = createBillingWatchtowerFixtures();
  return [
    { id: 'billing-watchtower.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'billing-watchtower.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'billing-watchtower.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

