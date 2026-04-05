import { buildCustomerCockpitSnapshot } from '../service-customer-cockpit.mjs';
import { createCustomerCockpitFixtures } from '../fixtures-customer-cockpit.mjs';

export function createCustomerCockpitPublicRoutes(basePath = '/public/customer-cockpit') {
  const snapshot = buildCustomerCockpitSnapshot();
  const fixtures = createCustomerCockpitFixtures();
  return [
    { id: 'customer-cockpit.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'customer-cockpit.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'customer-cockpit.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

