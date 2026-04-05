import { buildBillingCockpitSnapshot } from '../service-billing-cockpit.mjs';
import { createBillingCockpitFixtures } from '../fixtures-billing-cockpit.mjs';

export function createBillingCockpitPublicRoutes(basePath = '/public/billing-cockpit') {
  const snapshot = buildBillingCockpitSnapshot();
  const fixtures = createBillingCockpitFixtures();
  return [
    { id: 'billing-cockpit.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'billing-cockpit.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'billing-cockpit.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

