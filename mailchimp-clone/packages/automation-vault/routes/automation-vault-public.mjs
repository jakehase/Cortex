import { buildAutomationVaultSnapshot } from '../service-automation-vault.mjs';
import { createAutomationVaultFixtures } from '../fixtures-automation-vault.mjs';

export function createAutomationVaultPublicRoutes(basePath = '/public/automation-vault') {
  const snapshot = buildAutomationVaultSnapshot();
  const fixtures = createAutomationVaultFixtures();
  return [
    { id: 'automation-vault.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'automation-vault.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'automation-vault.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

