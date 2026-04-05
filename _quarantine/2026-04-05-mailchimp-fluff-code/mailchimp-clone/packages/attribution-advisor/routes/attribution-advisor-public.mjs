import { buildAttributionAdvisorSnapshot } from '../service-attribution-advisor.mjs';
import { createAttributionAdvisorFixtures } from '../fixtures-attribution-advisor.mjs';

export function createAttributionAdvisorPublicRoutes(basePath = '/public/attribution-advisor') {
  const snapshot = buildAttributionAdvisorSnapshot();
  const fixtures = createAttributionAdvisorFixtures();
  return [
    { id: 'attribution-advisor.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'attribution-advisor.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'attribution-advisor.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

