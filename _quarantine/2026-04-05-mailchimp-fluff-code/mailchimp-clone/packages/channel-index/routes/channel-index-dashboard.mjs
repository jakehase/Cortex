import { buildChannelIndexSnapshot, createChannelIndexRouteSummary } from '../service-channel-index.mjs';

export function createChannelIndexDashboardRoutes(basePath = '/channel-index') {
  const snapshot = buildChannelIndexSnapshot();
  return [
    { id: 'channel-index.dashboard.overview', method: 'GET', path: basePath, summary: createChannelIndexRouteSummary(snapshot) },
    { id: 'channel-index.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'channel-index.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

