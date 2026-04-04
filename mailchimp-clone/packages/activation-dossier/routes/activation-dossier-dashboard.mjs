import { buildActivationDossierSnapshot, createActivationDossierRouteSummary } from '../service-activation-dossier.mjs';

export function createActivationDossierDashboardRoutes(basePath = '/activation-dossier') {
  const snapshot = buildActivationDossierSnapshot();
  return [
    { id: 'activation-dossier.dashboard.overview', method: 'GET', path: basePath, summary: createActivationDossierRouteSummary(snapshot) },
    { id: 'activation-dossier.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'activation-dossier.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

