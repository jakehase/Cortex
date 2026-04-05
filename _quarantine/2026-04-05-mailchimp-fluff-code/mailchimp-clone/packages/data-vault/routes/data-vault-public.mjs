import { buildDataVaultSnapshot } from '../service-data-vault.mjs';
import { createDataVaultFixtures } from '../fixtures-data-vault.mjs';

export function createDataVaultPublicRoutes(basePath = '/public/data-vault') {
  const snapshot = buildDataVaultSnapshot();
  const fixtures = createDataVaultFixtures();
  return [
    { id: 'data-vault.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'data-vault.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'data-vault.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

