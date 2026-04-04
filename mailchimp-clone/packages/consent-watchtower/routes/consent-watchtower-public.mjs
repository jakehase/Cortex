import { buildConsentWatchtowerSnapshot } from '../service-consent-watchtower.mjs';
import { createConsentWatchtowerFixtures } from '../fixtures-consent-watchtower.mjs';

export function createConsentWatchtowerPublicRoutes(basePath = '/public/consent-watchtower') {
  const snapshot = buildConsentWatchtowerSnapshot();
  const fixtures = createConsentWatchtowerFixtures();
  return [
    { id: 'consent-watchtower.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'consent-watchtower.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'consent-watchtower.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

