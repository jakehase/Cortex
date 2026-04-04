import { buildExperimentationDossierSnapshot, createExperimentationDossierRouteSummary } from '../service-experimentation-dossier.mjs';

export function createExperimentationDossierDashboardRoutes(basePath = '/experimentation-dossier') {
  const snapshot = buildExperimentationDossierSnapshot();
  return [
    { id: 'experimentation-dossier.dashboard.overview', method: 'GET', path: basePath, summary: createExperimentationDossierRouteSummary(snapshot) },
    { id: 'experimentation-dossier.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'experimentation-dossier.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

