import { buildContentVaultSnapshot, createContentVaultRouteSummary } from '../service-content-vault.mjs';

export function createContentVaultRegistryRoutes(basePath = '/registry/content-vault') {
  const snapshot = buildContentVaultSnapshot();
  return [
    { id: 'content-vault.registry.summary', method: 'GET', path: basePath, summary: createContentVaultRouteSummary(snapshot) },
    { id: 'content-vault.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'content-vault.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

