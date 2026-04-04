import { buildDataAdvisorSnapshot, createDataAdvisorRouteSummary } from '../service-data-advisor.mjs';

export function createDataAdvisorRegistryRoutes(basePath = '/registry/data-advisor') {
  const snapshot = buildDataAdvisorSnapshot();
  return [
    { id: 'data-advisor.registry.summary', method: 'GET', path: basePath, summary: createDataAdvisorRouteSummary(snapshot) },
    { id: 'data-advisor.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'data-advisor.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

