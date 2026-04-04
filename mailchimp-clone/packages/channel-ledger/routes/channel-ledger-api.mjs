import { buildChannelLedgerSnapshot, createChannelLedgerApiDocument } from '../service-channel-ledger.mjs';

export function createChannelLedgerApiRoutes(basePath = '/api/channel-ledger') {
  const snapshot = buildChannelLedgerSnapshot();
  return [
    { id: 'channel-ledger.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'channel-ledger.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'channel-ledger.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'channel-ledger.api.document', method: 'GET', path: basePath + '/document', document: createChannelLedgerApiDocument(snapshot) }
  ];
}

