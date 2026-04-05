import { buildCollaborationSentinelSnapshot, createCollaborationSentinelRouteSummary } from '../service-collaboration-sentinel.mjs';

export function createCollaborationSentinelRegistryRoutes(basePath = '/registry/collaboration-sentinel') {
  const snapshot = buildCollaborationSentinelSnapshot();
  return [
    { id: 'collaboration-sentinel.registry.summary', method: 'GET', path: basePath, summary: createCollaborationSentinelRouteSummary(snapshot) },
    { id: 'collaboration-sentinel.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'collaboration-sentinel.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

