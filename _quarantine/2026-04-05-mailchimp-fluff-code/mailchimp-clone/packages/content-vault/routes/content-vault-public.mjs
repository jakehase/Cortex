import { buildContentVaultSnapshot } from '../service-content-vault.mjs';
import { createContentVaultFixtures } from '../fixtures-content-vault.mjs';

export function createContentVaultPublicRoutes(basePath = '/public/content-vault') {
  const snapshot = buildContentVaultSnapshot();
  const fixtures = createContentVaultFixtures();
  return [
    { id: 'content-vault.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'content-vault.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'content-vault.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

