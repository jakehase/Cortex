import { buildChannelPlaybooksSnapshot } from '../service-channel-playbooks.mjs';
import { createChannelPlaybooksFixtures } from '../fixtures-channel-playbooks.mjs';

export function createChannelPlaybooksPublicRoutes(basePath = '/public/channel-playbooks') { const snapshot = buildChannelPlaybooksSnapshot(); const fixtures = createChannelPlaybooksFixtures(); return [{ id: 'channel-playbooks.public.summary', method: 'GET', path: basePath, focus: snapshot.summary.focus }, { id: 'channel-playbooks.public.catalog', method: 'GET', path: basePath + '/catalog', contacts: fixtures.contacts }, { id: 'channel-playbooks.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }]; }

