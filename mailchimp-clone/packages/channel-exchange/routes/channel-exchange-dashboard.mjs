import { buildChannelExchangeSnapshot, createChannelExchangeRouteSummary } from '../service-channel-exchange.mjs';

export function createChannelExchangeDashboardRoutes(basePath = '/channel-exchange') {
  const snapshot = buildChannelExchangeSnapshot();
  return [
    { id: 'channel-exchange.dashboard.overview', method: 'GET', path: basePath, summary: createChannelExchangeRouteSummary(snapshot) },
    { id: 'channel-exchange.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'channel-exchange.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

