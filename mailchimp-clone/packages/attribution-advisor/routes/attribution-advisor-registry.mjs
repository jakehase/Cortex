import { buildAttributionAdvisorSnapshot, createAttributionAdvisorRouteSummary } from '../service-attribution-advisor.mjs';

export function createAttributionAdvisorRegistryRoutes(basePath = '/registry/attribution-advisor') {
  const snapshot = buildAttributionAdvisorSnapshot();
  return [
    { id: 'attribution-advisor.registry.summary', method: 'GET', path: basePath, summary: createAttributionAdvisorRouteSummary(snapshot) },
    { id: 'attribution-advisor.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'attribution-advisor.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

