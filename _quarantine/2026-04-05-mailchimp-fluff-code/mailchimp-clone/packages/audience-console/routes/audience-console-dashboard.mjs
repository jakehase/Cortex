import { buildAudienceConsoleSnapshot, createAudienceConsoleRouteSummary } from '../service-audience-console.mjs';

export function createAudienceConsoleDashboardRoutes(basePath = '/audience-console') {
  const snapshot = buildAudienceConsoleSnapshot();
  return [
    { id: 'audience-console.dashboard.overview', method: 'GET', path: basePath, summary: createAudienceConsoleRouteSummary(snapshot) },
    { id: 'audience-console.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'audience-console.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

