import { buildEcommerceAdvisorSnapshot } from '../service-ecommerce-advisor.mjs';
import { createEcommerceAdvisorFixtures } from '../fixtures-ecommerce-advisor.mjs';

export function createEcommerceAdvisorPublicRoutes(basePath = '/public/ecommerce-advisor') {
  const snapshot = buildEcommerceAdvisorSnapshot();
  const fixtures = createEcommerceAdvisorFixtures();
  return [
    { id: 'ecommerce-advisor.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'ecommerce-advisor.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'ecommerce-advisor.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

