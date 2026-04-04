import { buildChannelLedgerSnapshot } from '../service-channel-ledger.mjs';
import { createChannelLedgerFixtures } from '../fixtures-channel-ledger.mjs';

export function createChannelLedgerPublicRoutes(basePath = '/public/channel-ledger') {
  const snapshot = buildChannelLedgerSnapshot();
  const fixtures = createChannelLedgerFixtures();
  return [
    { id: 'channel-ledger.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'channel-ledger.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'channel-ledger.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

