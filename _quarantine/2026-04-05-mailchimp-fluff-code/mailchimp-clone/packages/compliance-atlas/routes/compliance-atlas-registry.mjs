import { buildComplianceAtlasSnapshot, createComplianceAtlasRouteSummary } from '../service-compliance-atlas.mjs';

export function createComplianceAtlasRegistryRoutes(basePath = '/registry/compliance-atlas') {
  const snapshot = buildComplianceAtlasSnapshot();
  return [
    { id: 'compliance-atlas.registry.summary', method: 'GET', path: basePath, summary: createComplianceAtlasRouteSummary(snapshot) },
    { id: 'compliance-atlas.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'compliance-atlas.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

