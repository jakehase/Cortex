import { buildInsightsCockpitSnapshot, createInsightsCockpitRouteSummary } from '../service-insights-cockpit.mjs';

export function createInsightsCockpitDashboardRoutes(basePath = '/insights-cockpit') {
  const snapshot = buildInsightsCockpitSnapshot();
  return [
    { id: 'insights-cockpit.dashboard.overview', method: 'GET', path: basePath, summary: createInsightsCockpitRouteSummary(snapshot) },
    { id: 'insights-cockpit.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'insights-cockpit.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

