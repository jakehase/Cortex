import { buildInsightsDossierSnapshot, createInsightsDossierRouteSummary } from '../service-insights-dossier.mjs';

export function createInsightsDossierDashboardRoutes(basePath = '/insights-dossier') {
  const snapshot = buildInsightsDossierSnapshot();
  return [
    { id: 'insights-dossier.dashboard.overview', method: 'GET', path: basePath, summary: createInsightsDossierRouteSummary(snapshot) },
    { id: 'insights-dossier.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'insights-dossier.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

