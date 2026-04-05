import { buildCollaborationVaultSnapshot, createCollaborationVaultRouteSummary } from '../service-collaboration-vault.mjs';

export function createCollaborationVaultRegistryRoutes(basePath = '/registry/collaboration-vault') {
  const snapshot = buildCollaborationVaultSnapshot();
  return [
    { id: 'collaboration-vault.registry.summary', method: 'GET', path: basePath, summary: createCollaborationVaultRouteSummary(snapshot) },
    { id: 'collaboration-vault.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'collaboration-vault.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

