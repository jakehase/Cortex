import { buildBillingGridSnapshot } from '../service-billing-grid.mjs';
import { createBillingGridFixtures } from '../fixtures-billing-grid.mjs';

export function createBillingGridPublicRoutes(basePath = '/public/billing-grid') {
  const snapshot = buildBillingGridSnapshot();
  const fixtures = createBillingGridFixtures();
  return [
    { id: 'billing-grid.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'billing-grid.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'billing-grid.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

