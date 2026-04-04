import { buildCustomerLifecycleSnapshot } from '../service-customer-lifecycle.mjs';
import { createCustomerLifecycleFixtures } from '../fixtures-customer-lifecycle.mjs';

export function createCustomerLifecyclePublicRoutes(basePath = '/public/customer-lifecycle') {
  const snapshot = buildCustomerLifecycleSnapshot();
  const fixtures = createCustomerLifecycleFixtures();
  return [
    { id: 'customer-lifecycle.public.summary', method: 'GET', path: basePath, focus: snapshot.summary.focus },
    { id: 'customer-lifecycle.public.catalog', method: 'GET', path: basePath + '/catalog', contacts: fixtures.contacts },
    { id: 'customer-lifecycle.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}
