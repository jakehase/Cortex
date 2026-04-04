import { buildChannelWorkbenchSnapshot, createChannelWorkbenchRouteSummary } from '../service-channel-workbench.mjs';

export function createChannelWorkbenchDashboardRoutes(basePath = '/channel-workbench') {
  const snapshot = buildChannelWorkbenchSnapshot();
  return [
    { id: 'channel-workbench.dashboard.overview', method: 'GET', path: basePath, summary: createChannelWorkbenchRouteSummary(snapshot) },
    { id: 'channel-workbench.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'channel-workbench.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

