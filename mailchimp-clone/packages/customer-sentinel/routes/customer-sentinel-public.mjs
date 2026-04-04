import { buildCustomerSentinelSnapshot } from '../service-customer-sentinel.mjs';
import { createCustomerSentinelFixtures } from '../fixtures-customer-sentinel.mjs';

export function createCustomerSentinelPublicRoutes(basePath = '/public/customer-sentinel') {
  const snapshot = buildCustomerSentinelSnapshot();
  const fixtures = createCustomerSentinelFixtures();
  return [
    { id: 'customer-sentinel.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'customer-sentinel.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'customer-sentinel.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

