import { buildAcquisitionDossierSnapshot, createAcquisitionDossierRouteSummary } from '../service-acquisition-dossier.mjs';

export function createAcquisitionDossierDashboardRoutes(basePath = '/acquisition-dossier') {
  const snapshot = buildAcquisitionDossierSnapshot();
  return [
    { id: 'acquisition-dossier.dashboard.overview', method: 'GET', path: basePath, summary: createAcquisitionDossierRouteSummary(snapshot) },
    { id: 'acquisition-dossier.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'acquisition-dossier.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

