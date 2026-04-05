import { buildDataCockpitSnapshot, createDataCockpitRouteSummary } from '../service-data-cockpit.mjs';

export function createDataCockpitRegistryRoutes(basePath = '/registry/data-cockpit') {
  const snapshot = buildDataCockpitSnapshot();
  return [
    { id: 'data-cockpit.registry.summary', method: 'GET', path: basePath, summary: createDataCockpitRouteSummary(snapshot) },
    { id: 'data-cockpit.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'data-cockpit.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

