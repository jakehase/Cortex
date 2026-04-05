import { buildCreativeDossierSnapshot, createCreativeDossierRouteSummary } from '../service-creative-dossier.mjs';

export function createCreativeDossierDashboardRoutes(basePath = '/creative-dossier') {
  const snapshot = buildCreativeDossierSnapshot();
  return [
    { id: 'creative-dossier.dashboard.overview', method: 'GET', path: basePath, summary: createCreativeDossierRouteSummary(snapshot) },
    { id: 'creative-dossier.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'creative-dossier.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

