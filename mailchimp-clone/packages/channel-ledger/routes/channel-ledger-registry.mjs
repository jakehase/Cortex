import { buildChannelLedgerSnapshot, createChannelLedgerRouteSummary } from '../service-channel-ledger.mjs';

export function createChannelLedgerRegistryRoutes(basePath = '/registry/channel-ledger') {
  const snapshot = buildChannelLedgerSnapshot();
  return [
    { id: 'channel-ledger.registry.summary', method: 'GET', path: basePath, summary: createChannelLedgerRouteSummary(snapshot) },
    { id: 'channel-ledger.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'channel-ledger.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

