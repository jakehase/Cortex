import { buildComplianceVaultSnapshot } from '../service-compliance-vault.mjs';
import { createComplianceVaultFixtures } from '../fixtures-compliance-vault.mjs';

export function createComplianceVaultPublicRoutes(basePath = '/public/compliance-vault') {
  const snapshot = buildComplianceVaultSnapshot();
  const fixtures = createComplianceVaultFixtures();
  return [
    { id: 'compliance-vault.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'compliance-vault.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'compliance-vault.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

