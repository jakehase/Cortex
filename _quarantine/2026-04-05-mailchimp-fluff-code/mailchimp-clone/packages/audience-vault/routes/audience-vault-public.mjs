import { buildAudienceVaultSnapshot } from '../service-audience-vault.mjs';
import { createAudienceVaultFixtures } from '../fixtures-audience-vault.mjs';

export function createAudienceVaultPublicRoutes(basePath = '/public/audience-vault') {
  const snapshot = buildAudienceVaultSnapshot();
  const fixtures = createAudienceVaultFixtures();
  return [
    { id: 'audience-vault.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'audience-vault.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'audience-vault.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

