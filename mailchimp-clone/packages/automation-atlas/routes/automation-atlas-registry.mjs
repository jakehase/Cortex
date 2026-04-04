import { buildAutomationAtlasSnapshot, createAutomationAtlasRouteSummary } from '../service-automation-atlas.mjs';

export function createAutomationAtlasRegistryRoutes(basePath = '/registry/automation-atlas') {
  const snapshot = buildAutomationAtlasSnapshot();
  return [
    { id: 'automation-atlas.registry.summary', method: 'GET', path: basePath, summary: createAutomationAtlasRouteSummary(snapshot) },
    { id: 'automation-atlas.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'automation-atlas.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

