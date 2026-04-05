import { buildAttributionVaultSnapshot } from '../service-attribution-vault.mjs';
import { createAttributionVaultFixtures } from '../fixtures-attribution-vault.mjs';

export function createAttributionVaultPublicRoutes(basePath = '/public/attribution-vault') {
  const snapshot = buildAttributionVaultSnapshot();
  const fixtures = createAttributionVaultFixtures();
  return [
    { id: 'attribution-vault.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'attribution-vault.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'attribution-vault.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

