import { buildCustomerScorecardSnapshot } from '../service-customer-scorecard.mjs';
import { createCustomerScorecardFixtures } from '../fixtures-customer-scorecard.mjs';

export function createCustomerScorecardPublicRoutes(basePath = '/public/customer-scorecard') {
  const snapshot = buildCustomerScorecardSnapshot();
  const fixtures = createCustomerScorecardFixtures();
  return [
    { id: 'customer-scorecard.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'customer-scorecard.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'customer-scorecard.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

