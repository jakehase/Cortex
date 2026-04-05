import { buildDeliverabilityPlannerSnapshot, createDeliverabilityPlannerRouteSummary } from '../service-deliverability-planner.mjs';

export function createDeliverabilityPlannerDashboardRoutes(basePath = '/deliverability-planner') {
  const snapshot = buildDeliverabilityPlannerSnapshot();
  return [
    { id: 'deliverability-planner.dashboard.overview', method: 'GET', path: basePath, summary: createDeliverabilityPlannerRouteSummary(snapshot) },
    { id: 'deliverability-planner.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'deliverability-planner.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

