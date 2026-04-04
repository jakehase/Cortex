import { buildEcommerceVaultSnapshot } from '../service-ecommerce-vault.mjs';
import { createEcommerceVaultFixtures } from '../fixtures-ecommerce-vault.mjs';

export function createEcommerceVaultPublicRoutes(basePath = '/public/ecommerce-vault') {
  const snapshot = buildEcommerceVaultSnapshot();
  const fixtures = createEcommerceVaultFixtures();
  return [
    { id: 'ecommerce-vault.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'ecommerce-vault.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'ecommerce-vault.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

