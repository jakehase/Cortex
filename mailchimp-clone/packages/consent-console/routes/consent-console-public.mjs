import { buildConsentConsoleSnapshot } from '../service-consent-console.mjs';
import { createConsentConsoleFixtures } from '../fixtures-consent-console.mjs';

export function createConsentConsolePublicRoutes(basePath = '/public/consent-console') {
  const snapshot = buildConsentConsoleSnapshot();
  const fixtures = createConsentConsoleFixtures();
  return [
    { id: 'consent-console.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'consent-console.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'consent-console.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

