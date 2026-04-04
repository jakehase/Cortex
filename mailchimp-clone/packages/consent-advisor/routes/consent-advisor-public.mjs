import { buildConsentAdvisorSnapshot } from '../service-consent-advisor.mjs';
import { createConsentAdvisorFixtures } from '../fixtures-consent-advisor.mjs';

export function createConsentAdvisorPublicRoutes(basePath = '/public/consent-advisor') {
  const snapshot = buildConsentAdvisorSnapshot();
  const fixtures = createConsentAdvisorFixtures();
  return [
    { id: 'consent-advisor.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'consent-advisor.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'consent-advisor.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

