import { buildLocalizationPlannerSnapshot, createLocalizationPlannerRouteSummary } from '../service-localization-planner.mjs';

export function createLocalizationPlannerDashboardRoutes(basePath = '/localization-planner') {
  const snapshot = buildLocalizationPlannerSnapshot();
  return [
    { id: 'localization-planner.dashboard.overview', method: 'GET', path: basePath, summary: createLocalizationPlannerRouteSummary(snapshot) },
    { id: 'localization-planner.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'localization-planner.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

