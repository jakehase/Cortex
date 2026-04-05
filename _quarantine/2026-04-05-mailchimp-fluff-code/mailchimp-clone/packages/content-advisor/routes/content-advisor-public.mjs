import { buildContentAdvisorSnapshot } from '../service-content-advisor.mjs';
import { createContentAdvisorFixtures } from '../fixtures-content-advisor.mjs';

export function createContentAdvisorPublicRoutes(basePath = '/public/content-advisor') {
  const snapshot = buildContentAdvisorSnapshot();
  const fixtures = createContentAdvisorFixtures();
  return [
    { id: 'content-advisor.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'content-advisor.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'content-advisor.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

