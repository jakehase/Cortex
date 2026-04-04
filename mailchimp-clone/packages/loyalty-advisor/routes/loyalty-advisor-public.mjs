import { buildLoyaltyAdvisorSnapshot } from '../service-loyalty-advisor.mjs';
import { createLoyaltyAdvisorFixtures } from '../fixtures-loyalty-advisor.mjs';

export function createLoyaltyAdvisorPublicRoutes(basePath = '/public/loyalty-advisor') {
  const snapshot = buildLoyaltyAdvisorSnapshot();
  const fixtures = createLoyaltyAdvisorFixtures();
  return [
    { id: 'loyalty-advisor.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'loyalty-advisor.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'loyalty-advisor.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

