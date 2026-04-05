import { buildLocalizationConsoleSnapshot, createLocalizationConsoleRouteSummary } from '../service-localization-console.mjs';

export function createLocalizationConsoleDashboardRoutes(basePath = '/localization-console') {
  const snapshot = buildLocalizationConsoleSnapshot();
  return [
    { id: 'localization-console.dashboard.overview', method: 'GET', path: basePath, summary: createLocalizationConsoleRouteSummary(snapshot) },
    { id: 'localization-console.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'localization-console.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

