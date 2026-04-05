import { buildAcquisitionVaultSnapshot } from '../service-acquisition-vault.mjs';
import { createAcquisitionVaultFixtures } from '../fixtures-acquisition-vault.mjs';

export function createAcquisitionVaultPublicRoutes(basePath = '/public/acquisition-vault') {
  const snapshot = buildAcquisitionVaultSnapshot();
  const fixtures = createAcquisitionVaultFixtures();
  return [
    { id: 'acquisition-vault.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'acquisition-vault.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'acquisition-vault.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

