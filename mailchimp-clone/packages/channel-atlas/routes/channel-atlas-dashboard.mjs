import { buildChannelAtlasSnapshot, createChannelAtlasRouteSummary } from '../service-channel-atlas.mjs';

export function createChannelAtlasDashboardRoutes(basePath = '/channel-atlas') {
  const snapshot = buildChannelAtlasSnapshot();
  return [
    { id: 'channel-atlas.dashboard.overview', method: 'GET', path: basePath, summary: createChannelAtlasRouteSummary(snapshot) },
    { id: 'channel-atlas.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'channel-atlas.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

