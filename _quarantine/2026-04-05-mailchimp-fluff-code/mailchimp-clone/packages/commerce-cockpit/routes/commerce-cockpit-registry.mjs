import { buildCommerceCockpitSnapshot, createCommerceCockpitRouteSummary } from '../service-commerce-cockpit.mjs';

export function createCommerceCockpitRegistryRoutes(basePath = '/registry/commerce-cockpit') {
  const snapshot = buildCommerceCockpitSnapshot();
  return [
    { id: 'commerce-cockpit.registry.summary', method: 'GET', path: basePath, summary: createCommerceCockpitRouteSummary(snapshot) },
    { id: 'commerce-cockpit.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'commerce-cockpit.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

