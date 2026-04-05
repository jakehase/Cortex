import { buildLifecycleFoundrySnapshot, createLifecycleFoundryRouteSummary } from '../service-lifecycle-foundry.mjs';

export function createLifecycleFoundryRegistryRoutes(basePath = '/registry/lifecycle-foundry') {
  const snapshot = buildLifecycleFoundrySnapshot();
  return [
    { id: 'lifecycle-foundry.registry.summary', method: 'GET', path: basePath, summary: createLifecycleFoundryRouteSummary(snapshot) },
    { id: 'lifecycle-foundry.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'lifecycle-foundry.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

