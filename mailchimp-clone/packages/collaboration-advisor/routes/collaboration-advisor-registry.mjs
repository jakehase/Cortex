import { buildCollaborationAdvisorSnapshot, createCollaborationAdvisorRouteSummary } from '../service-collaboration-advisor.mjs';

export function createCollaborationAdvisorRegistryRoutes(basePath = '/registry/collaboration-advisor') {
  const snapshot = buildCollaborationAdvisorSnapshot();
  return [
    { id: 'collaboration-advisor.registry.summary', method: 'GET', path: basePath, summary: createCollaborationAdvisorRouteSummary(snapshot) },
    { id: 'collaboration-advisor.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'collaboration-advisor.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

