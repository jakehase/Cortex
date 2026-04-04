import { buildDataAdvisorSnapshot } from '../service-data-advisor.mjs';
import { createDataAdvisorFixtures } from '../fixtures-data-advisor.mjs';

export function createDataAdvisorPublicRoutes(basePath = '/public/data-advisor') {
  const snapshot = buildDataAdvisorSnapshot();
  const fixtures = createDataAdvisorFixtures();
  return [
    { id: 'data-advisor.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'data-advisor.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'data-advisor.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

