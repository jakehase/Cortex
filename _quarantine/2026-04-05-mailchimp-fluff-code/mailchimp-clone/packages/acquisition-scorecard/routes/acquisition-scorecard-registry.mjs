import { buildAcquisitionScorecardSnapshot, createAcquisitionScorecardRouteSummary } from '../service-acquisition-scorecard.mjs';

export function createAcquisitionScorecardRegistryRoutes(basePath = '/registry/acquisition-scorecard') {
  const snapshot = buildAcquisitionScorecardSnapshot();
  return [
    { id: 'acquisition-scorecard.registry.summary', method: 'GET', path: basePath, summary: createAcquisitionScorecardRouteSummary(snapshot) },
    { id: 'acquisition-scorecard.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'acquisition-scorecard.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

