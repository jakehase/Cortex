import { buildBillingFoundrySnapshot } from '../service-billing-foundry.mjs';
import { createBillingFoundryFixtures } from '../fixtures-billing-foundry.mjs';

export function createBillingFoundryPublicRoutes(basePath = '/public/billing-foundry') {
  const snapshot = buildBillingFoundrySnapshot();
  const fixtures = createBillingFoundryFixtures();
  return [
    { id: 'billing-foundry.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'billing-foundry.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'billing-foundry.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

