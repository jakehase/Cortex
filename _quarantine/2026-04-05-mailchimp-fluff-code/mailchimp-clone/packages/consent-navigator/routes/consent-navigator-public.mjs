import { buildConsentNavigatorSnapshot } from '../service-consent-navigator.mjs';
import { createConsentNavigatorFixtures } from '../fixtures-consent-navigator.mjs';

export function createConsentNavigatorPublicRoutes(basePath = '/public/consent-navigator') {
  const snapshot = buildConsentNavigatorSnapshot();
  const fixtures = createConsentNavigatorFixtures();
  return [
    { id: 'consent-navigator.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'consent-navigator.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'consent-navigator.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

