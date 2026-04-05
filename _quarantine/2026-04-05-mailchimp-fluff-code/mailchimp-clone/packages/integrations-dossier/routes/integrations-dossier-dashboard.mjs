import { buildIntegrationsDossierSnapshot, createIntegrationsDossierRouteSummary } from '../service-integrations-dossier.mjs';

export function createIntegrationsDossierDashboardRoutes(basePath = '/integrations-dossier') {
  const snapshot = buildIntegrationsDossierSnapshot();
  return [
    { id: 'integrations-dossier.dashboard.overview', method: 'GET', path: basePath, summary: createIntegrationsDossierRouteSummary(snapshot) },
    { id: 'integrations-dossier.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'integrations-dossier.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

