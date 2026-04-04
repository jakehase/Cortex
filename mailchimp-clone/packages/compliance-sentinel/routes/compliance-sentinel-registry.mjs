import { buildComplianceSentinelSnapshot, createComplianceSentinelRouteSummary } from '../service-compliance-sentinel.mjs';

export function createComplianceSentinelRegistryRoutes(basePath = '/registry/compliance-sentinel') {
  const snapshot = buildComplianceSentinelSnapshot();
  return [
    { id: 'compliance-sentinel.registry.summary', method: 'GET', path: basePath, summary: createComplianceSentinelRouteSummary(snapshot) },
    { id: 'compliance-sentinel.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'compliance-sentinel.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

