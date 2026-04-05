import { buildCompliancePlannerSnapshot, createCompliancePlannerRouteSummary } from '../service-compliance-planner.mjs';

export function createCompliancePlannerRegistryRoutes(basePath = '/registry/compliance-planner') {
  const snapshot = buildCompliancePlannerSnapshot();
  return [
    { id: 'compliance-planner.registry.summary', method: 'GET', path: basePath, summary: createCompliancePlannerRouteSummary(snapshot) },
    { id: 'compliance-planner.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'compliance-planner.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

