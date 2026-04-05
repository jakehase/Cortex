import { buildChannelLedgerSnapshot, createChannelLedgerRouteSummary } from '../service-channel-ledger.mjs';

export function createChannelLedgerDashboardRoutes(basePath = '/channel-ledger') {
  const snapshot = buildChannelLedgerSnapshot();
  return [
    { id: 'channel-ledger.dashboard.overview', method: 'GET', path: basePath, summary: createChannelLedgerRouteSummary(snapshot) },
    { id: 'channel-ledger.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'channel-ledger.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

