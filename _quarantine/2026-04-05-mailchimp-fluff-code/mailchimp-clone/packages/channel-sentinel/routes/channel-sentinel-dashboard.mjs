import { buildChannelSentinelSnapshot, createChannelSentinelRouteSummary } from '../service-channel-sentinel.mjs';

export function createChannelSentinelDashboardRoutes(basePath = '/channel-sentinel') {
  const snapshot = buildChannelSentinelSnapshot();
  return [
    { id: 'channel-sentinel.dashboard.overview', method: 'GET', path: basePath, summary: createChannelSentinelRouteSummary(snapshot) },
    { id: 'channel-sentinel.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'channel-sentinel.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

