import { buildChannelScorecardSnapshot, createChannelScorecardRouteSummary } from '../service-channel-scorecard.mjs';

export function createChannelScorecardDashboardRoutes(basePath = '/channel-scorecard') {
  const snapshot = buildChannelScorecardSnapshot();
  return [
    { id: 'channel-scorecard.dashboard.overview', method: 'GET', path: basePath, summary: createChannelScorecardRouteSummary(snapshot) },
    { id: 'channel-scorecard.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'channel-scorecard.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

