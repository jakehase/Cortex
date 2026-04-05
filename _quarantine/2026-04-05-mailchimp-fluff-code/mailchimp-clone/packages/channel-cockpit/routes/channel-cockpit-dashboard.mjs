import { buildChannelCockpitSnapshot, createChannelCockpitRouteSummary } from '../service-channel-cockpit.mjs';

export function createChannelCockpitDashboardRoutes(basePath = '/channel-cockpit') {
  const snapshot = buildChannelCockpitSnapshot();
  return [
    { id: 'channel-cockpit.dashboard.overview', method: 'GET', path: basePath, summary: createChannelCockpitRouteSummary(snapshot) },
    { id: 'channel-cockpit.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'channel-cockpit.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

