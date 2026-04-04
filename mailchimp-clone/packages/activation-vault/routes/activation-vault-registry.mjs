import { buildActivationVaultSnapshot, createActivationVaultRouteSummary } from '../service-activation-vault.mjs';

export function createActivationVaultRegistryRoutes(basePath = '/registry/activation-vault') {
  const snapshot = buildActivationVaultSnapshot();
  return [
    { id: 'activation-vault.registry.summary', method: 'GET', path: basePath, summary: createActivationVaultRouteSummary(snapshot) },
    { id: 'activation-vault.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'activation-vault.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

