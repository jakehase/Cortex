import { buildLocalizationExchangeSnapshot, createLocalizationExchangeRouteSummary } from '../service-localization-exchange.mjs';

export function createLocalizationExchangeDashboardRoutes(basePath = '/localization-exchange') {
  const snapshot = buildLocalizationExchangeSnapshot();
  return [
    { id: 'localization-exchange.dashboard.overview', method: 'GET', path: basePath, summary: createLocalizationExchangeRouteSummary(snapshot) },
    { id: 'localization-exchange.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'localization-exchange.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

