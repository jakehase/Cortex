import { buildCreativeAdvisorSnapshot } from '../service-creative-advisor.mjs';
import { createCreativeAdvisorFixtures } from '../fixtures-creative-advisor.mjs';

export function createCreativeAdvisorPublicRoutes(basePath = '/public/creative-advisor') {
  const snapshot = buildCreativeAdvisorSnapshot();
  const fixtures = createCreativeAdvisorFixtures();
  return [
    { id: 'creative-advisor.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'creative-advisor.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'creative-advisor.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

