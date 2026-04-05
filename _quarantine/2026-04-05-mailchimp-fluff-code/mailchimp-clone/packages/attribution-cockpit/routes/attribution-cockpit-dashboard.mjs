import { buildAttributionCockpitSnapshot, createAttributionCockpitRouteSummary } from '../service-attribution-cockpit.mjs';

export function createAttributionCockpitDashboardRoutes(basePath = '/attribution-cockpit') {
  const snapshot = buildAttributionCockpitSnapshot();
  return [
    { id: 'attribution-cockpit.dashboard.overview', method: 'GET', path: basePath, summary: createAttributionCockpitRouteSummary(snapshot) },
    { id: 'attribution-cockpit.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'attribution-cockpit.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

