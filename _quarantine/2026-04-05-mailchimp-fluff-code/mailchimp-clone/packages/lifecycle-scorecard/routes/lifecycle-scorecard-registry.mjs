import { buildLifecycleScorecardSnapshot, createLifecycleScorecardRouteSummary } from '../service-lifecycle-scorecard.mjs';

export function createLifecycleScorecardRegistryRoutes(basePath = '/registry/lifecycle-scorecard') {
  const snapshot = buildLifecycleScorecardSnapshot();
  return [
    { id: 'lifecycle-scorecard.registry.summary', method: 'GET', path: basePath, summary: createLifecycleScorecardRouteSummary(snapshot) },
    { id: 'lifecycle-scorecard.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'lifecycle-scorecard.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

