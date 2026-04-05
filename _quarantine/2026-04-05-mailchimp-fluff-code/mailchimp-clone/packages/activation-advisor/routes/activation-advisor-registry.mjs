import { buildActivationAdvisorSnapshot, createActivationAdvisorRouteSummary } from '../service-activation-advisor.mjs';

export function createActivationAdvisorRegistryRoutes(basePath = '/registry/activation-advisor') {
  const snapshot = buildActivationAdvisorSnapshot();
  return [
    { id: 'activation-advisor.registry.summary', method: 'GET', path: basePath, summary: createActivationAdvisorRouteSummary(snapshot) },
    { id: 'activation-advisor.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'activation-advisor.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

