import { buildChannelVaultSnapshot } from '../service-channel-vault.mjs';
import { createChannelVaultFixtures } from '../fixtures-channel-vault.mjs';

export function createChannelVaultPublicRoutes(basePath = '/public/channel-vault') {
  const snapshot = buildChannelVaultSnapshot();
  const fixtures = createChannelVaultFixtures();
  return [
    { id: 'channel-vault.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'channel-vault.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'channel-vault.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

