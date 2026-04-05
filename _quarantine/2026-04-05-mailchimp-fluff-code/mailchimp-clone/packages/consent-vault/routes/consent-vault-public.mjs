import { buildConsentVaultSnapshot } from '../service-consent-vault.mjs';
import { createConsentVaultFixtures } from '../fixtures-consent-vault.mjs';

export function createConsentVaultPublicRoutes(basePath = '/public/consent-vault') {
  const snapshot = buildConsentVaultSnapshot();
  const fixtures = createConsentVaultFixtures();
  return [
    { id: 'consent-vault.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'consent-vault.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'consent-vault.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

