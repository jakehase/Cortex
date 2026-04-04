import { buildChannelPlannerSnapshot, createChannelPlannerRouteSummary } from '../service-channel-planner.mjs';

export function createChannelPlannerDashboardRoutes(basePath = '/channel-planner') {
  const snapshot = buildChannelPlannerSnapshot();
  return [
    { id: 'channel-planner.dashboard.overview', method: 'GET', path: basePath, summary: createChannelPlannerRouteSummary(snapshot) },
    { id: 'channel-planner.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'channel-planner.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

