import { buildCreativeCockpitSnapshot, createCreativeCockpitRouteSummary } from '../service-creative-cockpit.mjs';

export function createCreativeCockpitRegistryRoutes(basePath = '/registry/creative-cockpit') {
  const snapshot = buildCreativeCockpitSnapshot();
  return [
    { id: 'creative-cockpit.registry.summary', method: 'GET', path: basePath, summary: createCreativeCockpitRouteSummary(snapshot) },
    { id: 'creative-cockpit.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'creative-cockpit.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

