import { buildDeliverabilityAdvisorSnapshot, createDeliverabilityAdvisorRouteSummary } from '../service-deliverability-advisor.mjs';

export function createDeliverabilityAdvisorDashboardRoutes(basePath = '/deliverability-advisor') {
  const snapshot = buildDeliverabilityAdvisorSnapshot();
  return [
    { id: 'deliverability-advisor.dashboard.overview', method: 'GET', path: basePath, summary: createDeliverabilityAdvisorRouteSummary(snapshot) },
    { id: 'deliverability-advisor.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'deliverability-advisor.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

