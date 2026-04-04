import { buildAdvocacyCockpitSnapshot, createAdvocacyCockpitRouteSummary } from '../service-advocacy-cockpit.mjs';

export function createAdvocacyCockpitRegistryRoutes(basePath = '/registry/advocacy-cockpit') {
  const snapshot = buildAdvocacyCockpitSnapshot();
  return [
    { id: 'advocacy-cockpit.registry.summary', method: 'GET', path: basePath, summary: createAdvocacyCockpitRouteSummary(snapshot) },
    { id: 'advocacy-cockpit.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'advocacy-cockpit.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

