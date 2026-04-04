import { buildBillingStudioSnapshot } from '../service-billing-studio.mjs';
import { createBillingStudioFixtures } from '../fixtures-billing-studio.mjs';

export function createBillingStudioPublicRoutes(basePath = '/public/billing-studio') {
  const snapshot = buildBillingStudioSnapshot();
  const fixtures = createBillingStudioFixtures();
  return [
    { id: 'billing-studio.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'billing-studio.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'billing-studio.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

