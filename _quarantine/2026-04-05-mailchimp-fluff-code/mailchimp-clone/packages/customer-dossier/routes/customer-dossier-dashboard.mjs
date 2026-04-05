import { buildCustomerDossierSnapshot, createCustomerDossierRouteSummary } from '../service-customer-dossier.mjs';

export function createCustomerDossierDashboardRoutes(basePath = '/customer-dossier') {
  const snapshot = buildCustomerDossierSnapshot();
  return [
    { id: 'customer-dossier.dashboard.overview', method: 'GET', path: basePath, summary: createCustomerDossierRouteSummary(snapshot) },
    { id: 'customer-dossier.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'customer-dossier.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

