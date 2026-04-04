import { buildComplianceDossierSnapshot, createComplianceDossierRouteSummary } from '../service-compliance-dossier.mjs';

export function createComplianceDossierDashboardRoutes(basePath = '/compliance-dossier') {
  const snapshot = buildComplianceDossierSnapshot();
  return [
    { id: 'compliance-dossier.dashboard.overview', method: 'GET', path: basePath, summary: createComplianceDossierRouteSummary(snapshot) },
    { id: 'compliance-dossier.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'compliance-dossier.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

