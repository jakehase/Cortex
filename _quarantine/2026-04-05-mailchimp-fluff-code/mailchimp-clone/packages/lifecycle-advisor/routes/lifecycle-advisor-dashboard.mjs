import { buildLifecycleAdvisorSnapshot, createLifecycleAdvisorRouteSummary } from '../service-lifecycle-advisor.mjs';

export function createLifecycleAdvisorDashboardRoutes(basePath = '/lifecycle-advisor') {
  const snapshot = buildLifecycleAdvisorSnapshot();
  return [
    { id: 'lifecycle-advisor.dashboard.overview', method: 'GET', path: basePath, summary: createLifecycleAdvisorRouteSummary(snapshot) },
    { id: 'lifecycle-advisor.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'lifecycle-advisor.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

