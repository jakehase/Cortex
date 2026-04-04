import { buildCollaborationDossierSnapshot, createCollaborationDossierRouteSummary } from '../service-collaboration-dossier.mjs';

export function createCollaborationDossierDashboardRoutes(basePath = '/collaboration-dossier') {
  const snapshot = buildCollaborationDossierSnapshot();
  return [
    { id: 'collaboration-dossier.dashboard.overview', method: 'GET', path: basePath, summary: createCollaborationDossierRouteSummary(snapshot) },
    { id: 'collaboration-dossier.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'collaboration-dossier.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

