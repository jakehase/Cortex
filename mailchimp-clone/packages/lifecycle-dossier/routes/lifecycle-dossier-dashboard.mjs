import { buildLifecycleDossierSnapshot, createLifecycleDossierRouteSummary } from '../service-lifecycle-dossier.mjs';

export function createLifecycleDossierDashboardRoutes(basePath = '/lifecycle-dossier') {
  const snapshot = buildLifecycleDossierSnapshot();
  return [
    { id: 'lifecycle-dossier.dashboard.overview', method: 'GET', path: basePath, summary: createLifecycleDossierRouteSummary(snapshot) },
    { id: 'lifecycle-dossier.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'lifecycle-dossier.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

