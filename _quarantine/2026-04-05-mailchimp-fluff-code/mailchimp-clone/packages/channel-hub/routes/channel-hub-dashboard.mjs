import { buildChannelHubSnapshot, createChannelHubRouteSummary } from '../service-channel-hub.mjs';

export function createChannelHubDashboardRoutes(basePath = '/channel-hub') {
  const snapshot = buildChannelHubSnapshot();
  return [
    { id: 'channel-hub.dashboard.overview', method: 'GET', path: basePath, summary: createChannelHubRouteSummary(snapshot) },
    { id: 'channel-hub.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'channel-hub.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

