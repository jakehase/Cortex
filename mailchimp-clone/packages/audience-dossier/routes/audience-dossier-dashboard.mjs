import { buildAudienceDossierSnapshot, createAudienceDossierRouteSummary } from '../service-audience-dossier.mjs';

export function createAudienceDossierDashboardRoutes(basePath = '/audience-dossier') {
  const snapshot = buildAudienceDossierSnapshot();
  return [
    { id: 'audience-dossier.dashboard.overview', method: 'GET', path: basePath, summary: createAudienceDossierRouteSummary(snapshot) },
    { id: 'audience-dossier.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'audience-dossier.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

