import { buildLoyaltyVaultSnapshot, createLoyaltyVaultRouteSummary } from '../service-loyalty-vault.mjs';

export function createLoyaltyVaultRegistryRoutes(basePath = '/registry/loyalty-vault') {
  const snapshot = buildLoyaltyVaultSnapshot();
  return [
    { id: 'loyalty-vault.registry.summary', method: 'GET', path: basePath, summary: createLoyaltyVaultRouteSummary(snapshot) },
    { id: 'loyalty-vault.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'loyalty-vault.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

