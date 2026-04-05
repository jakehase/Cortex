import { buildAttributionCockpitSnapshot, createAttributionCockpitRouteSummary } from '../service-attribution-cockpit.mjs';

export function createAttributionCockpitRegistryRoutes(basePath = '/registry/attribution-cockpit') {
  const snapshot = buildAttributionCockpitSnapshot();
  return [
    { id: 'attribution-cockpit.registry.summary', method: 'GET', path: basePath, summary: createAttributionCockpitRouteSummary(snapshot) },
    { id: 'attribution-cockpit.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'attribution-cockpit.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

