import { buildDeliverabilityVaultSnapshot, createDeliverabilityVaultRouteSummary } from '../service-deliverability-vault.mjs';

export function createDeliverabilityVaultRegistryRoutes(basePath = '/registry/deliverability-vault') {
  const snapshot = buildDeliverabilityVaultSnapshot();
  return [
    { id: 'deliverability-vault.registry.summary', method: 'GET', path: basePath, summary: createDeliverabilityVaultRouteSummary(snapshot) },
    { id: 'deliverability-vault.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'deliverability-vault.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

