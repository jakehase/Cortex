import { buildChannelFoundrySnapshot, createChannelFoundryRouteSummary } from '../service-channel-foundry.mjs';

export function createChannelFoundryDashboardRoutes(basePath = '/channel-foundry') {
  const snapshot = buildChannelFoundrySnapshot();
  return [
    { id: 'channel-foundry.dashboard.overview', method: 'GET', path: basePath, summary: createChannelFoundryRouteSummary(snapshot) },
    { id: 'channel-foundry.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'channel-foundry.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

