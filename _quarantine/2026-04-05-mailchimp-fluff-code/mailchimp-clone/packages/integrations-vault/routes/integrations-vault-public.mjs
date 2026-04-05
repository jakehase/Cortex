import { buildIntegrationsVaultSnapshot } from '../service-integrations-vault.mjs';
import { createIntegrationsVaultFixtures } from '../fixtures-integrations-vault.mjs';

export function createIntegrationsVaultPublicRoutes(basePath = '/public/integrations-vault') {
  const snapshot = buildIntegrationsVaultSnapshot();
  const fixtures = createIntegrationsVaultFixtures();
  return [
    { id: 'integrations-vault.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'integrations-vault.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'integrations-vault.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

