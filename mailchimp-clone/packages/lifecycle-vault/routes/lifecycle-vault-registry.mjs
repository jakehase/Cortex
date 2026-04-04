import { buildLifecycleVaultSnapshot, createLifecycleVaultRouteSummary } from '../service-lifecycle-vault.mjs';

export function createLifecycleVaultRegistryRoutes(basePath = '/registry/lifecycle-vault') {
  const snapshot = buildLifecycleVaultSnapshot();
  return [
    { id: 'lifecycle-vault.registry.summary', method: 'GET', path: basePath, summary: createLifecycleVaultRouteSummary(snapshot) },
    { id: 'lifecycle-vault.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'lifecycle-vault.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

