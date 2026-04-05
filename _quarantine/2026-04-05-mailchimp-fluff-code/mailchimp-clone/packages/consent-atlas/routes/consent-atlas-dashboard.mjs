import { buildConsentAtlasSnapshot, createConsentAtlasRouteSummary } from '../service-consent-atlas.mjs';

export function createConsentAtlasDashboardRoutes(basePath = '/consent-atlas') {
  const snapshot = buildConsentAtlasSnapshot();
  return [
    { id: 'consent-atlas.dashboard.overview', method: 'GET', path: basePath, summary: createConsentAtlasRouteSummary(snapshot) },
    { id: 'consent-atlas.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'consent-atlas.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

