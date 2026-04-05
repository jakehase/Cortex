import { buildChannelStudioSnapshot, createChannelStudioRouteSummary } from '../service-channel-studio.mjs';

export function createChannelStudioDashboardRoutes(basePath = '/channel-studio') {
  const snapshot = buildChannelStudioSnapshot();
  return [
    { id: 'channel-studio.dashboard.overview', method: 'GET', path: basePath, summary: createChannelStudioRouteSummary(snapshot) },
    { id: 'channel-studio.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'channel-studio.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

