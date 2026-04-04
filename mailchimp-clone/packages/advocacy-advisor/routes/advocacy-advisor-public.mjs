import { buildAdvocacyAdvisorSnapshot } from '../service-advocacy-advisor.mjs';
import { createAdvocacyAdvisorFixtures } from '../fixtures-advocacy-advisor.mjs';

export function createAdvocacyAdvisorPublicRoutes(basePath = '/public/advocacy-advisor') {
  const snapshot = buildAdvocacyAdvisorSnapshot();
  const fixtures = createAdvocacyAdvisorFixtures();
  return [
    { id: 'advocacy-advisor.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'advocacy-advisor.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'advocacy-advisor.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

