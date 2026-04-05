import { buildBillingVaultSnapshot } from '../service-billing-vault.mjs';
import { createBillingVaultFixtures } from '../fixtures-billing-vault.mjs';

export function createBillingVaultPublicRoutes(basePath = '/public/billing-vault') {
  const snapshot = buildBillingVaultSnapshot();
  const fixtures = createBillingVaultFixtures();
  return [
    { id: 'billing-vault.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'billing-vault.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'billing-vault.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

