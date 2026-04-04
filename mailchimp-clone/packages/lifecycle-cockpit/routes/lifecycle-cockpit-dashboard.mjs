import { buildLifecycleCockpitSnapshot, createLifecycleCockpitRouteSummary } from '../service-lifecycle-cockpit.mjs';

export function createLifecycleCockpitDashboardRoutes(basePath = '/lifecycle-cockpit') {
  const snapshot = buildLifecycleCockpitSnapshot();
  return [
    { id: 'lifecycle-cockpit.dashboard.overview', method: 'GET', path: basePath, summary: createLifecycleCockpitRouteSummary(snapshot) },
    { id: 'lifecycle-cockpit.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'lifecycle-cockpit.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

