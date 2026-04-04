import { buildAdvocacyDossierSnapshot, createAdvocacyDossierRouteSummary } from '../service-advocacy-dossier.mjs';

export function createAdvocacyDossierDashboardRoutes(basePath = '/advocacy-dossier') {
  const snapshot = buildAdvocacyDossierSnapshot();
  return [
    { id: 'advocacy-dossier.dashboard.overview', method: 'GET', path: basePath, summary: createAdvocacyDossierRouteSummary(snapshot) },
    { id: 'advocacy-dossier.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'advocacy-dossier.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

