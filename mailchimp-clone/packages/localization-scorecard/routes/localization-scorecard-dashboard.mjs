import { buildLocalizationScorecardSnapshot, createLocalizationScorecardRouteSummary } from '../service-localization-scorecard.mjs';

export function createLocalizationScorecardDashboardRoutes(basePath = '/localization-scorecard') {
  const snapshot = buildLocalizationScorecardSnapshot();
  return [
    { id: 'localization-scorecard.dashboard.overview', method: 'GET', path: basePath, summary: createLocalizationScorecardRouteSummary(snapshot) },
    { id: 'localization-scorecard.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'localization-scorecard.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

