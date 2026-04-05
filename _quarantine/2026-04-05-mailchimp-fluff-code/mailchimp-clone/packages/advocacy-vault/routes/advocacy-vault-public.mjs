import { buildAdvocacyVaultSnapshot } from '../service-advocacy-vault.mjs';
import { createAdvocacyVaultFixtures } from '../fixtures-advocacy-vault.mjs';

export function createAdvocacyVaultPublicRoutes(basePath = '/public/advocacy-vault') {
  const snapshot = buildAdvocacyVaultSnapshot();
  const fixtures = createAdvocacyVaultFixtures();
  return [
    { id: 'advocacy-vault.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'advocacy-vault.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'advocacy-vault.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

