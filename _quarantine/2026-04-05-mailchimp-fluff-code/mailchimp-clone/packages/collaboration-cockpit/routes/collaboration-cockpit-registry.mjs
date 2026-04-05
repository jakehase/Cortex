import { buildCollaborationCockpitSnapshot, createCollaborationCockpitRouteSummary } from '../service-collaboration-cockpit.mjs';

export function createCollaborationCockpitRegistryRoutes(basePath = '/registry/collaboration-cockpit') {
  const snapshot = buildCollaborationCockpitSnapshot();
  return [
    { id: 'collaboration-cockpit.registry.summary', method: 'GET', path: basePath, summary: createCollaborationCockpitRouteSummary(snapshot) },
    { id: 'collaboration-cockpit.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'collaboration-cockpit.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

