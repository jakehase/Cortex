import { buildLoyaltyDossierSnapshot, createLoyaltyDossierRouteSummary } from '../service-loyalty-dossier.mjs';

export function createLoyaltyDossierDashboardRoutes(basePath = '/loyalty-dossier') {
  const snapshot = buildLoyaltyDossierSnapshot();
  return [
    { id: 'loyalty-dossier.dashboard.overview', method: 'GET', path: basePath, summary: createLoyaltyDossierRouteSummary(snapshot) },
    { id: 'loyalty-dossier.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'loyalty-dossier.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

