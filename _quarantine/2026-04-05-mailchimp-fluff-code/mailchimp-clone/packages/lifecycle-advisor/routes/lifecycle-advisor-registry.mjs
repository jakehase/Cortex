import { buildLifecycleAdvisorSnapshot, createLifecycleAdvisorRouteSummary } from '../service-lifecycle-advisor.mjs';

export function createLifecycleAdvisorRegistryRoutes(basePath = '/registry/lifecycle-advisor') {
  const snapshot = buildLifecycleAdvisorSnapshot();
  return [
    { id: 'lifecycle-advisor.registry.summary', method: 'GET', path: basePath, summary: createLifecycleAdvisorRouteSummary(snapshot) },
    { id: 'lifecycle-advisor.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'lifecycle-advisor.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

