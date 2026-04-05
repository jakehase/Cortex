import { buildComplianceWatchtowerSnapshot, createComplianceWatchtowerRouteSummary } from '../service-compliance-watchtower.mjs';

export function createComplianceWatchtowerRegistryRoutes(basePath = '/registry/compliance-watchtower') {
  const snapshot = buildComplianceWatchtowerSnapshot();
  return [
    { id: 'compliance-watchtower.registry.summary', method: 'GET', path: basePath, summary: createComplianceWatchtowerRouteSummary(snapshot) },
    { id: 'compliance-watchtower.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'compliance-watchtower.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

