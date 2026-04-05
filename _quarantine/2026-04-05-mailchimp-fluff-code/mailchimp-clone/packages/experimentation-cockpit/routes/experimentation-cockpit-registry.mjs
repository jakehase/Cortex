import { buildExperimentationCockpitSnapshot, createExperimentationCockpitRouteSummary } from '../service-experimentation-cockpit.mjs';

export function createExperimentationCockpitRegistryRoutes(basePath = '/registry/experimentation-cockpit') {
  const snapshot = buildExperimentationCockpitSnapshot();
  return [
    { id: 'experimentation-cockpit.registry.summary', method: 'GET', path: basePath, summary: createExperimentationCockpitRouteSummary(snapshot) },
    { id: 'experimentation-cockpit.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'experimentation-cockpit.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

