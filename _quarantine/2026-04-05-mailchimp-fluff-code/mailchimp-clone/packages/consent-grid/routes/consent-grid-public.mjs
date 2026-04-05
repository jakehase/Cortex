import { buildConsentGridSnapshot } from '../service-consent-grid.mjs';
import { createConsentGridFixtures } from '../fixtures-consent-grid.mjs';

export function createConsentGridPublicRoutes(basePath = '/public/consent-grid') {
  const snapshot = buildConsentGridSnapshot();
  const fixtures = createConsentGridFixtures();
  return [
    { id: 'consent-grid.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'consent-grid.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'consent-grid.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

