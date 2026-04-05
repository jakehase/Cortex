import { buildLifecycleCockpitSnapshot, createLifecycleCockpitRouteSummary } from '../service-lifecycle-cockpit.mjs';

export function createLifecycleCockpitRegistryRoutes(basePath = '/registry/lifecycle-cockpit') {
  const snapshot = buildLifecycleCockpitSnapshot();
  return [
    { id: 'lifecycle-cockpit.registry.summary', method: 'GET', path: basePath, summary: createLifecycleCockpitRouteSummary(snapshot) },
    { id: 'lifecycle-cockpit.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'lifecycle-cockpit.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

