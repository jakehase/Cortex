import { buildContentDossierSnapshot, createContentDossierRouteSummary } from '../service-content-dossier.mjs';

export function createContentDossierDashboardRoutes(basePath = '/content-dossier') {
  const snapshot = buildContentDossierSnapshot();
  return [
    { id: 'content-dossier.dashboard.overview', method: 'GET', path: basePath, summary: createContentDossierRouteSummary(snapshot) },
    { id: 'content-dossier.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'content-dossier.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

