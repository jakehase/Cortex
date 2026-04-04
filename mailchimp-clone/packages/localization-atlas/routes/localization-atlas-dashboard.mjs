import { buildLocalizationAtlasSnapshot, createLocalizationAtlasRouteSummary } from '../service-localization-atlas.mjs';

export function createLocalizationAtlasDashboardRoutes(basePath = '/localization-atlas') {
  const snapshot = buildLocalizationAtlasSnapshot();
  return [
    { id: 'localization-atlas.dashboard.overview', method: 'GET', path: basePath, summary: createLocalizationAtlasRouteSummary(snapshot) },
    { id: 'localization-atlas.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'localization-atlas.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

