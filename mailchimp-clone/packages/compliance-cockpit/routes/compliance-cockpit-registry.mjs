import { buildComplianceCockpitSnapshot, createComplianceCockpitRouteSummary } from '../service-compliance-cockpit.mjs';

export function createComplianceCockpitRegistryRoutes(basePath = '/registry/compliance-cockpit') {
  const snapshot = buildComplianceCockpitSnapshot();
  return [
    { id: 'compliance-cockpit.registry.summary', method: 'GET', path: basePath, summary: createComplianceCockpitRouteSummary(snapshot) },
    { id: 'compliance-cockpit.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'compliance-cockpit.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

