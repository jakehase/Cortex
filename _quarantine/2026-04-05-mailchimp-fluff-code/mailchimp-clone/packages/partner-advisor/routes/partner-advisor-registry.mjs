import { buildPartnerAdvisorSnapshot, createPartnerAdvisorRouteSummary } from '../service-partner-advisor.mjs';

export function createPartnerAdvisorRegistryRoutes(basePath = '/registry/partner-advisor') {
  const snapshot = buildPartnerAdvisorSnapshot();
  return [
    { id: 'partner-advisor.registry.summary', method: 'GET', path: basePath, summary: createPartnerAdvisorRouteSummary(snapshot) },
    { id: 'partner-advisor.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'partner-advisor.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

