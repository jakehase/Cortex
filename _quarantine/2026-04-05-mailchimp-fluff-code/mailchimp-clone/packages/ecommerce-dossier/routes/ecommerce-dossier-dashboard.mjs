import { buildEcommerceDossierSnapshot, createEcommerceDossierRouteSummary } from '../service-ecommerce-dossier.mjs';

export function createEcommerceDossierDashboardRoutes(basePath = '/ecommerce-dossier') {
  const snapshot = buildEcommerceDossierSnapshot();
  return [
    { id: 'ecommerce-dossier.dashboard.overview', method: 'GET', path: basePath, summary: createEcommerceDossierRouteSummary(snapshot) },
    { id: 'ecommerce-dossier.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'ecommerce-dossier.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

