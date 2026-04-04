import { buildLoyaltyFoundrySnapshot, createLoyaltyFoundryRouteSummary } from '../service-loyalty-foundry.mjs';

export function createLoyaltyFoundryRegistryRoutes(basePath = '/registry/loyalty-foundry') {
  const snapshot = buildLoyaltyFoundrySnapshot();
  return [
    { id: 'loyalty-foundry.registry.summary', method: 'GET', path: basePath, summary: createLoyaltyFoundryRouteSummary(snapshot) },
    { id: 'loyalty-foundry.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'loyalty-foundry.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

