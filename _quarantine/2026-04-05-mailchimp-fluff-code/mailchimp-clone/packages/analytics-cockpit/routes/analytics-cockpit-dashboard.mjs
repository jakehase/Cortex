import { buildAnalyticsCockpitSnapshot, createAnalyticsCockpitRouteSummary } from '../service-analytics-cockpit.mjs';

export function createAnalyticsCockpitDashboardRoutes(basePath = '/analytics-cockpit') {
  const snapshot = buildAnalyticsCockpitSnapshot();
  return [
    { id: 'analytics-cockpit.dashboard.overview', method: 'GET', path: basePath, summary: createAnalyticsCockpitRouteSummary(snapshot) },
    { id: 'analytics-cockpit.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'analytics-cockpit.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

