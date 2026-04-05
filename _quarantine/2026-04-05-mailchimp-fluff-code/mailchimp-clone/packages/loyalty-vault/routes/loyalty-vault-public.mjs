import { buildLoyaltyVaultSnapshot } from '../service-loyalty-vault.mjs';
import { createLoyaltyVaultFixtures } from '../fixtures-loyalty-vault.mjs';

export function createLoyaltyVaultPublicRoutes(basePath = '/public/loyalty-vault') {
  const snapshot = buildLoyaltyVaultSnapshot();
  const fixtures = createLoyaltyVaultFixtures();
  return [
    { id: 'loyalty-vault.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'loyalty-vault.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'loyalty-vault.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

