import { buildChannelGridSnapshot, createChannelGridRouteSummary } from '../service-channel-grid.mjs';

export function createChannelGridDashboardRoutes(basePath = '/channel-grid') {
  const snapshot = buildChannelGridSnapshot();
  return [
    { id: 'channel-grid.dashboard.overview', method: 'GET', path: basePath, summary: createChannelGridRouteSummary(snapshot) },
    { id: 'channel-grid.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'channel-grid.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

