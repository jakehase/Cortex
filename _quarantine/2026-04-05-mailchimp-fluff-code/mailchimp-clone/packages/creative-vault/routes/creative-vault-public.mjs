import { buildCreativeVaultSnapshot } from '../service-creative-vault.mjs';
import { createCreativeVaultFixtures } from '../fixtures-creative-vault.mjs';

export function createCreativeVaultPublicRoutes(basePath = '/public/creative-vault') {
  const snapshot = buildCreativeVaultSnapshot();
  const fixtures = createCreativeVaultFixtures();
  return [
    { id: 'creative-vault.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'creative-vault.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'creative-vault.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

