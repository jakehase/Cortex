import { buildLocalizationAdvisorSnapshot, createLocalizationAdvisorRouteSummary } from '../service-localization-advisor.mjs';

export function createLocalizationAdvisorDashboardRoutes(basePath = '/localization-advisor') {
  const snapshot = buildLocalizationAdvisorSnapshot();
  return [
    { id: 'localization-advisor.dashboard.overview', method: 'GET', path: basePath, summary: createLocalizationAdvisorRouteSummary(snapshot) },
    { id: 'localization-advisor.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'localization-advisor.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

