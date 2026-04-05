import { buildBillingHubSnapshot } from '../service-billing-hub.mjs';
import { createBillingHubFixtures } from '../fixtures-billing-hub.mjs';

export function createBillingHubPublicRoutes(basePath = '/public/billing-hub') {
  const snapshot = buildBillingHubSnapshot();
  const fixtures = createBillingHubFixtures();
  return [
    { id: 'billing-hub.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'billing-hub.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'billing-hub.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

