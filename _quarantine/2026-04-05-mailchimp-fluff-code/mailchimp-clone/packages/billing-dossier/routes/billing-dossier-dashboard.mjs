import { buildBillingDossierSnapshot, createBillingDossierRouteSummary } from '../service-billing-dossier.mjs';

export function createBillingDossierDashboardRoutes(basePath = '/billing-dossier') {
  const snapshot = buildBillingDossierSnapshot();
  return [
    { id: 'billing-dossier.dashboard.overview', method: 'GET', path: basePath, summary: createBillingDossierRouteSummary(snapshot) },
    { id: 'billing-dossier.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'billing-dossier.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

