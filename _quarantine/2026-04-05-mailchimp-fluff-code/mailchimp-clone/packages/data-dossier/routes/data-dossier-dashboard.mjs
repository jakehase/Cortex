import { buildDataDossierSnapshot, createDataDossierRouteSummary } from '../service-data-dossier.mjs';

export function createDataDossierDashboardRoutes(basePath = '/data-dossier') {
  const snapshot = buildDataDossierSnapshot();
  return [
    { id: 'data-dossier.dashboard.overview', method: 'GET', path: basePath, summary: createDataDossierRouteSummary(snapshot) },
    { id: 'data-dossier.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'data-dossier.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

