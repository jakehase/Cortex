import { buildBillingAdvisorSnapshot } from '../service-billing-advisor.mjs';
import { createBillingAdvisorFixtures } from '../fixtures-billing-advisor.mjs';

export function createBillingAdvisorPublicRoutes(basePath = '/public/billing-advisor') {
  const snapshot = buildBillingAdvisorSnapshot();
  const fixtures = createBillingAdvisorFixtures();
  return [
    { id: 'billing-advisor.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'billing-advisor.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'billing-advisor.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

