import { buildLoyaltyAdvisorSnapshot, createLoyaltyAdvisorRouteSummary } from '../service-loyalty-advisor.mjs';

export function createLoyaltyAdvisorRegistryRoutes(basePath = '/registry/loyalty-advisor') {
  const snapshot = buildLoyaltyAdvisorSnapshot();
  return [
    { id: 'loyalty-advisor.registry.summary', method: 'GET', path: basePath, summary: createLoyaltyAdvisorRouteSummary(snapshot) },
    { id: 'loyalty-advisor.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'loyalty-advisor.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

