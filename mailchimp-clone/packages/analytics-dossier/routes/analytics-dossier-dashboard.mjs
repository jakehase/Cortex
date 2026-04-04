import { buildAnalyticsDossierSnapshot, createAnalyticsDossierRouteSummary } from '../service-analytics-dossier.mjs';

export function createAnalyticsDossierDashboardRoutes(basePath = '/analytics-dossier') {
  const snapshot = buildAnalyticsDossierSnapshot();
  return [
    { id: 'analytics-dossier.dashboard.overview', method: 'GET', path: basePath, summary: createAnalyticsDossierRouteSummary(snapshot) },
    { id: 'analytics-dossier.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'analytics-dossier.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

