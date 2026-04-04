import { buildAcquisitionCockpitSnapshot, createAcquisitionCockpitRouteSummary } from '../service-acquisition-cockpit.mjs';

export function createAcquisitionCockpitRegistryRoutes(basePath = '/registry/acquisition-cockpit') {
  const snapshot = buildAcquisitionCockpitSnapshot();
  return [
    { id: 'acquisition-cockpit.registry.summary', method: 'GET', path: basePath, summary: createAcquisitionCockpitRouteSummary(snapshot) },
    { id: 'acquisition-cockpit.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'acquisition-cockpit.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

