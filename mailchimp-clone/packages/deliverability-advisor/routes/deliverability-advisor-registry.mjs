import { buildDeliverabilityAdvisorSnapshot, createDeliverabilityAdvisorRouteSummary } from '../service-deliverability-advisor.mjs';

export function createDeliverabilityAdvisorRegistryRoutes(basePath = '/registry/deliverability-advisor') {
  const snapshot = buildDeliverabilityAdvisorSnapshot();
  return [
    { id: 'deliverability-advisor.registry.summary', method: 'GET', path: basePath, summary: createDeliverabilityAdvisorRouteSummary(snapshot) },
    { id: 'deliverability-advisor.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'deliverability-advisor.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

