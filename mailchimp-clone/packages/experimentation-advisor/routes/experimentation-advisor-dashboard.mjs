import { buildExperimentationAdvisorSnapshot, createExperimentationAdvisorRouteSummary } from '../service-experimentation-advisor.mjs';

export function createExperimentationAdvisorDashboardRoutes(basePath = '/experimentation-advisor') {
  const snapshot = buildExperimentationAdvisorSnapshot();
  return [
    { id: 'experimentation-advisor.dashboard.overview', method: 'GET', path: basePath, summary: createExperimentationAdvisorRouteSummary(snapshot) },
    { id: 'experimentation-advisor.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'experimentation-advisor.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

