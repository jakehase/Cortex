import { buildExperimentationScorecardSnapshot, createExperimentationScorecardRouteSummary } from '../service-experimentation-scorecard.mjs';

export function createExperimentationScorecardRegistryRoutes(basePath = '/registry/experimentation-scorecard') {
  const snapshot = buildExperimentationScorecardSnapshot();
  return [
    { id: 'experimentation-scorecard.registry.summary', method: 'GET', path: basePath, summary: createExperimentationScorecardRouteSummary(snapshot) },
    { id: 'experimentation-scorecard.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'experimentation-scorecard.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

