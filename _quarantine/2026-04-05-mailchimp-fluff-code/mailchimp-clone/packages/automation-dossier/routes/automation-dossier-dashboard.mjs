import { buildAutomationDossierSnapshot, createAutomationDossierRouteSummary } from '../service-automation-dossier.mjs';

export function createAutomationDossierDashboardRoutes(basePath = '/automation-dossier') {
  const snapshot = buildAutomationDossierSnapshot();
  return [
    { id: 'automation-dossier.dashboard.overview', method: 'GET', path: basePath, summary: createAutomationDossierRouteSummary(snapshot) },
    { id: 'automation-dossier.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'automation-dossier.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

