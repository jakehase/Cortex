import { buildConsentFoundrySnapshot } from '../service-consent-foundry.mjs';
import { createConsentFoundryFixtures } from '../fixtures-consent-foundry.mjs';

export function createConsentFoundryPublicRoutes(basePath = '/public/consent-foundry') {
  const snapshot = buildConsentFoundrySnapshot();
  const fixtures = createConsentFoundryFixtures();
  return [
    { id: 'consent-foundry.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'consent-foundry.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'consent-foundry.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

