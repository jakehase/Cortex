import { buildChannelNavigatorSnapshot, createChannelNavigatorRouteSummary } from '../service-channel-navigator.mjs';

export function createChannelNavigatorDashboardRoutes(basePath = '/channel-navigator') {
  const snapshot = buildChannelNavigatorSnapshot();
  return [
    { id: 'channel-navigator.dashboard.overview', method: 'GET', path: basePath, summary: createChannelNavigatorRouteSummary(snapshot) },
    { id: 'channel-navigator.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'channel-navigator.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

