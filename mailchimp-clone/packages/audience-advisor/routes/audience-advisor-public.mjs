import { buildAudienceAdvisorSnapshot } from '../service-audience-advisor.mjs';
import { createAudienceAdvisorFixtures } from '../fixtures-audience-advisor.mjs';

export function createAudienceAdvisorPublicRoutes(basePath = '/public/audience-advisor') {
  const snapshot = buildAudienceAdvisorSnapshot();
  const fixtures = createAudienceAdvisorFixtures();
  return [
    { id: 'audience-advisor.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'audience-advisor.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'audience-advisor.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

