import { buildCustomerVaultSnapshot } from '../service-customer-vault.mjs';
import { createCustomerVaultFixtures } from '../fixtures-customer-vault.mjs';

export function createCustomerVaultPublicRoutes(basePath = '/public/customer-vault') {
  const snapshot = buildCustomerVaultSnapshot();
  const fixtures = createCustomerVaultFixtures();
  return [
    { id: 'customer-vault.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'customer-vault.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'customer-vault.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

