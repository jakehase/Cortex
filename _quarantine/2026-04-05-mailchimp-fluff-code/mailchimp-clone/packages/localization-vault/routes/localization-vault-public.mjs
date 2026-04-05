import { buildLocalizationVaultSnapshot } from '../service-localization-vault.mjs';
import { createLocalizationVaultFixtures } from '../fixtures-localization-vault.mjs';

export function createLocalizationVaultPublicRoutes(basePath = '/public/localization-vault') {
  const snapshot = buildLocalizationVaultSnapshot();
  const fixtures = createLocalizationVaultFixtures();
  return [
    { id: 'localization-vault.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'localization-vault.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'localization-vault.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

