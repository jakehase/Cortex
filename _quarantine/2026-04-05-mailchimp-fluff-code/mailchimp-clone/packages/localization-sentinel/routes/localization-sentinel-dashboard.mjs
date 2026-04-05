import { buildLocalizationSentinelSnapshot, createLocalizationSentinelRouteSummary } from '../service-localization-sentinel.mjs';

export function createLocalizationSentinelDashboardRoutes(basePath = '/localization-sentinel') {
  const snapshot = buildLocalizationSentinelSnapshot();
  return [
    { id: 'localization-sentinel.dashboard.overview', method: 'GET', path: basePath, summary: createLocalizationSentinelRouteSummary(snapshot) },
    { id: 'localization-sentinel.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'localization-sentinel.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

