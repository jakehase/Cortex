import { buildCommerceVaultSnapshot } from '../service-commerce-vault.mjs';
import { createCommerceVaultFixtures } from '../fixtures-commerce-vault.mjs';

export function createCommerceVaultPublicRoutes(basePath = '/public/commerce-vault') {
  const snapshot = buildCommerceVaultSnapshot();
  const fixtures = createCommerceVaultFixtures();
  return [
    { id: 'commerce-vault.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'commerce-vault.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'commerce-vault.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

