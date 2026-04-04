import { buildCustomerAdvisorSnapshot } from '../service-customer-advisor.mjs';
import { createCustomerAdvisorFixtures } from '../fixtures-customer-advisor.mjs';

export function createCustomerAdvisorPublicRoutes(basePath = '/public/customer-advisor') {
  const snapshot = buildCustomerAdvisorSnapshot();
  const fixtures = createCustomerAdvisorFixtures();
  return [
    { id: 'customer-advisor.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'customer-advisor.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'customer-advisor.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

