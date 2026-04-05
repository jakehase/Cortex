import { buildAttributionDossierSnapshot, createAttributionDossierRouteSummary } from '../service-attribution-dossier.mjs';

export function createAttributionDossierDashboardRoutes(basePath = '/attribution-dossier') {
  const snapshot = buildAttributionDossierSnapshot();
  return [
    { id: 'attribution-dossier.dashboard.overview', method: 'GET', path: basePath, summary: createAttributionDossierRouteSummary(snapshot) },
    { id: 'attribution-dossier.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'attribution-dossier.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

