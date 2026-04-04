import { buildBillingIndexSnapshot } from '../service-billing-index.mjs';
import { createBillingIndexFixtures } from '../fixtures-billing-index.mjs';

export function createBillingIndexPublicRoutes(basePath = '/public/billing-index') {
  const snapshot = buildBillingIndexSnapshot();
  const fixtures = createBillingIndexFixtures();
  return [
    { id: 'billing-index.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'billing-index.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'billing-index.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

