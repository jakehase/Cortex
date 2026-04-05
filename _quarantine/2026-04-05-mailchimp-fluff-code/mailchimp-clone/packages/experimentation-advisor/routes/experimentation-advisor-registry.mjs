import { buildExperimentationAdvisorSnapshot, createExperimentationAdvisorRouteSummary } from '../service-experimentation-advisor.mjs';

export function createExperimentationAdvisorRegistryRoutes(basePath = '/registry/experimentation-advisor') {
  const snapshot = buildExperimentationAdvisorSnapshot();
  return [
    { id: 'experimentation-advisor.registry.summary', method: 'GET', path: basePath, summary: createExperimentationAdvisorRouteSummary(snapshot) },
    { id: 'experimentation-advisor.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'experimentation-advisor.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

