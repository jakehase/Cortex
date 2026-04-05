import { buildConsentStudioSnapshot } from '../service-consent-studio.mjs';
import { createConsentStudioFixtures } from '../fixtures-consent-studio.mjs';

export function createConsentStudioPublicRoutes(basePath = '/public/consent-studio') {
  const snapshot = buildConsentStudioSnapshot();
  const fixtures = createConsentStudioFixtures();
  return [
    { id: 'consent-studio.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'consent-studio.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'consent-studio.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

