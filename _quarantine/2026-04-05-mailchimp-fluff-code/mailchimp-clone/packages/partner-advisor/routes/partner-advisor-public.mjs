import { buildPartnerAdvisorSnapshot } from '../service-partner-advisor.mjs';
import { createPartnerAdvisorFixtures } from '../fixtures-partner-advisor.mjs';

export function createPartnerAdvisorPublicRoutes(basePath = '/public/partner-advisor') {
  const snapshot = buildPartnerAdvisorSnapshot();
  const fixtures = createPartnerAdvisorFixtures();
  return [
    { id: 'partner-advisor.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'partner-advisor.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'partner-advisor.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

