import { buildChannelDossierSnapshot } from '../service-channel-dossier.mjs';
import { createChannelDossierFixtures } from '../fixtures-channel-dossier.mjs';

export function createChannelDossierPublicRoutes(basePath = '/public/channel-dossier') {
  const snapshot = buildChannelDossierSnapshot();
  const fixtures = createChannelDossierFixtures();
  return [
    { id: 'channel-dossier.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'channel-dossier.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'channel-dossier.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

