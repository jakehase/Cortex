import { buildCollaborationScorecardSnapshot, createCollaborationScorecardRouteSummary } from '../service-collaboration-scorecard.mjs';

export function createCollaborationScorecardRegistryRoutes(basePath = '/registry/collaboration-scorecard') {
  const snapshot = buildCollaborationScorecardSnapshot();
  return [
    { id: 'collaboration-scorecard.registry.summary', method: 'GET', path: basePath, summary: createCollaborationScorecardRouteSummary(snapshot) },
    { id: 'collaboration-scorecard.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'collaboration-scorecard.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

