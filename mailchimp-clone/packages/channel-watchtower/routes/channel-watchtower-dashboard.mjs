import { buildChannelWatchtowerSnapshot, createChannelWatchtowerRouteSummary } from '../service-channel-watchtower.mjs';

export function createChannelWatchtowerDashboardRoutes(basePath = '/channel-watchtower') {
  const snapshot = buildChannelWatchtowerSnapshot();
  return [
    { id: 'channel-watchtower.dashboard.overview', method: 'GET', path: basePath, summary: createChannelWatchtowerRouteSummary(snapshot) },
    { id: 'channel-watchtower.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'channel-watchtower.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

