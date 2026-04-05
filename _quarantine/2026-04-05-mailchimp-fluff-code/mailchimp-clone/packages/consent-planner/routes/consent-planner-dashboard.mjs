import { buildConsentPlannerSnapshot, createConsentPlannerRouteSummary } from '../service-consent-planner.mjs';

export function createConsentPlannerDashboardRoutes(basePath = '/consent-planner') {
  const snapshot = buildConsentPlannerSnapshot();
  return [
    { id: 'consent-planner.dashboard.overview', method: 'GET', path: basePath, summary: createConsentPlannerRouteSummary(snapshot) },
    { id: 'consent-planner.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'consent-planner.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

