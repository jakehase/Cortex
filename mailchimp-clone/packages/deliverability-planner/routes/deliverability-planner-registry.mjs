import { buildDeliverabilityPlannerSnapshot, createDeliverabilityPlannerRouteSummary } from '../service-deliverability-planner.mjs';

export function createDeliverabilityPlannerRegistryRoutes(basePath = '/registry/deliverability-planner') {
  const snapshot = buildDeliverabilityPlannerSnapshot();
  return [
    { id: 'deliverability-planner.registry.summary', method: 'GET', path: basePath, summary: createDeliverabilityPlannerRouteSummary(snapshot) },
    { id: 'deliverability-planner.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'deliverability-planner.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

