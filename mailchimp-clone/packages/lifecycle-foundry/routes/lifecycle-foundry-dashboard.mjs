import { buildLifecycleFoundrySnapshot, createLifecycleFoundryRouteSummary } from '../service-lifecycle-foundry.mjs';

export function createLifecycleFoundryDashboardRoutes(basePath = '/lifecycle-foundry') {
  const snapshot = buildLifecycleFoundrySnapshot();
  return [
    { id: 'lifecycle-foundry.dashboard.overview', method: 'GET', path: basePath, summary: createLifecycleFoundryRouteSummary(snapshot) },
    { id: 'lifecycle-foundry.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'lifecycle-foundry.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

