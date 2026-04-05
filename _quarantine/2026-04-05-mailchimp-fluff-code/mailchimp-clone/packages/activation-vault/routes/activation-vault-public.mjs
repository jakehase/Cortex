import { buildActivationVaultSnapshot } from '../service-activation-vault.mjs';
import { createActivationVaultFixtures } from '../fixtures-activation-vault.mjs';

export function createActivationVaultPublicRoutes(basePath = '/public/activation-vault') {
  const snapshot = buildActivationVaultSnapshot();
  const fixtures = createActivationVaultFixtures();
  return [
    { id: 'activation-vault.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'activation-vault.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'activation-vault.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

