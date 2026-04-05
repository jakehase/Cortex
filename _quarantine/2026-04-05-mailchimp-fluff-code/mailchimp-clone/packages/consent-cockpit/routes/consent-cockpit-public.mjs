import { buildConsentCockpitSnapshot } from '../service-consent-cockpit.mjs';
import { createConsentCockpitFixtures } from '../fixtures-consent-cockpit.mjs';

export function createConsentCockpitPublicRoutes(basePath = '/public/consent-cockpit') {
  const snapshot = buildConsentCockpitSnapshot();
  const fixtures = createConsentCockpitFixtures();
  return [
    { id: 'consent-cockpit.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'consent-cockpit.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'consent-cockpit.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

