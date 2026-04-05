import { buildLifecycleVaultSnapshot } from '../service-lifecycle-vault.mjs';
import { createLifecycleVaultFixtures } from '../fixtures-lifecycle-vault.mjs';

export function createLifecycleVaultPublicRoutes(basePath = '/public/lifecycle-vault') {
  const snapshot = buildLifecycleVaultSnapshot();
  const fixtures = createLifecycleVaultFixtures();
  return [
    { id: 'lifecycle-vault.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'lifecycle-vault.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'lifecycle-vault.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

