import { buildConsentHubSnapshot } from '../service-consent-hub.mjs';
import { createConsentHubFixtures } from '../fixtures-consent-hub.mjs';

export function createConsentHubPublicRoutes(basePath = '/public/consent-hub') {
  const snapshot = buildConsentHubSnapshot();
  const fixtures = createConsentHubFixtures();
  return [
    { id: 'consent-hub.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'consent-hub.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'consent-hub.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

