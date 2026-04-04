import { buildAdvocacyCockpitSnapshot, createAdvocacyCockpitRouteSummary } from '../service-advocacy-cockpit.mjs';

export function createAdvocacyCockpitDashboardRoutes(basePath = '/advocacy-cockpit') {
  const snapshot = buildAdvocacyCockpitSnapshot();
  return [
    { id: 'advocacy-cockpit.dashboard.overview', method: 'GET', path: basePath, summary: createAdvocacyCockpitRouteSummary(snapshot) },
    { id: 'advocacy-cockpit.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'advocacy-cockpit.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

