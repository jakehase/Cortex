import { buildCommerceCockpitSnapshot, createCommerceCockpitRouteSummary } from '../service-commerce-cockpit.mjs';

export function createCommerceCockpitDashboardRoutes(basePath = '/commerce-cockpit') {
  const snapshot = buildCommerceCockpitSnapshot();
  return [
    { id: 'commerce-cockpit.dashboard.overview', method: 'GET', path: basePath, summary: createCommerceCockpitRouteSummary(snapshot) },
    { id: 'commerce-cockpit.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'commerce-cockpit.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

