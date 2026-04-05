import { buildBillingNavigatorSnapshot } from '../service-billing-navigator.mjs';
import { createBillingNavigatorFixtures } from '../fixtures-billing-navigator.mjs';

export function createBillingNavigatorPublicRoutes(basePath = '/public/billing-navigator') {
  const snapshot = buildBillingNavigatorSnapshot();
  const fixtures = createBillingNavigatorFixtures();
  return [
    { id: 'billing-navigator.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'billing-navigator.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'billing-navigator.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

