import { buildCommerceDossierSnapshot, createCommerceDossierRouteSummary } from '../service-commerce-dossier.mjs';

export function createCommerceDossierDashboardRoutes(basePath = '/commerce-dossier') {
  const snapshot = buildCommerceDossierSnapshot();
  return [
    { id: 'commerce-dossier.dashboard.overview', method: 'GET', path: basePath, summary: createCommerceDossierRouteSummary(snapshot) },
    { id: 'commerce-dossier.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'commerce-dossier.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

