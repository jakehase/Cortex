import { buildContentCockpitSnapshot, createContentCockpitRouteSummary } from '../service-content-cockpit.mjs';

export function createContentCockpitRegistryRoutes(basePath = '/registry/content-cockpit') {
  const snapshot = buildContentCockpitSnapshot();
  return [
    { id: 'content-cockpit.registry.summary', method: 'GET', path: basePath, summary: createContentCockpitRouteSummary(snapshot) },
    { id: 'content-cockpit.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'content-cockpit.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

