import { buildCollaborationVaultSnapshot, createCollaborationVaultRouteSummary } from '../service-collaboration-vault.mjs';

export function createCollaborationVaultDashboardRoutes(basePath = '/collaboration-vault') {
  const snapshot = buildCollaborationVaultSnapshot();
  return [
    { id: 'collaboration-vault.dashboard.overview', method: 'GET', path: basePath, summary: createCollaborationVaultRouteSummary(snapshot) },
    { id: 'collaboration-vault.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'collaboration-vault.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

