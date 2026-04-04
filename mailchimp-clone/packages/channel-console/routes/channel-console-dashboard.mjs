import { buildChannelConsoleSnapshot, createChannelConsoleRouteSummary } from '../service-channel-console.mjs';

export function createChannelConsoleDashboardRoutes(basePath = '/channel-console') {
  const snapshot = buildChannelConsoleSnapshot();
  return [
    { id: 'channel-console.dashboard.overview', method: 'GET', path: basePath, summary: createChannelConsoleRouteSummary(snapshot) },
    { id: 'channel-console.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'channel-console.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

