import { buildDeliverabilityScorecardSnapshot, createDeliverabilityScorecardRouteSummary } from '../service-deliverability-scorecard.mjs';

export function createDeliverabilityScorecardRegistryRoutes(basePath = '/registry/deliverability-scorecard') {
  const snapshot = buildDeliverabilityScorecardSnapshot();
  return [
    { id: 'deliverability-scorecard.registry.summary', method: 'GET', path: basePath, summary: createDeliverabilityScorecardRouteSummary(snapshot) },
    { id: 'deliverability-scorecard.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'deliverability-scorecard.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

