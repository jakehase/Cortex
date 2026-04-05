import { buildChannelAdvisorSnapshot, createChannelAdvisorRouteSummary } from '../service-channel-advisor.mjs';

export function createChannelAdvisorDashboardRoutes(basePath = '/channel-advisor') {
  const snapshot = buildChannelAdvisorSnapshot();
  return [
    { id: 'channel-advisor.dashboard.overview', method: 'GET', path: basePath, summary: createChannelAdvisorRouteSummary(snapshot) },
    { id: 'channel-advisor.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'channel-advisor.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

