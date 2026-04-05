import { buildCommerceAdvisorSnapshot } from '../service-commerce-advisor.mjs';
import { createCommerceAdvisorFixtures } from '../fixtures-commerce-advisor.mjs';

export function createCommerceAdvisorPublicRoutes(basePath = '/public/commerce-advisor') {
  const snapshot = buildCommerceAdvisorSnapshot();
  const fixtures = createCommerceAdvisorFixtures();
  return [
    { id: 'commerce-advisor.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'commerce-advisor.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'commerce-advisor.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

