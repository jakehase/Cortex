import { buildAcquisitionAdvisorSnapshot, createAcquisitionAdvisorRouteSummary } from '../service-acquisition-advisor.mjs';

export function createAcquisitionAdvisorDashboardRoutes(basePath = '/acquisition-advisor') {
  const snapshot = buildAcquisitionAdvisorSnapshot();
  return [
    { id: 'acquisition-advisor.dashboard.overview', method: 'GET', path: basePath, summary: createAcquisitionAdvisorRouteSummary(snapshot) },
    { id: 'acquisition-advisor.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'acquisition-advisor.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

