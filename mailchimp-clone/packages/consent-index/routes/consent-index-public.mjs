import { buildConsentIndexSnapshot } from '../service-consent-index.mjs';
import { createConsentIndexFixtures } from '../fixtures-consent-index.mjs';

export function createConsentIndexPublicRoutes(basePath = '/public/consent-index') {
  const snapshot = buildConsentIndexSnapshot();
  const fixtures = createConsentIndexFixtures();
  return [
    { id: 'consent-index.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'consent-index.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'consent-index.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

