import { buildAutomationSentinelSnapshot, createAutomationSentinelRouteSummary } from '../service-automation-sentinel.mjs';

export function createAutomationSentinelRegistryRoutes(basePath = '/registry/automation-sentinel') {
  const snapshot = buildAutomationSentinelSnapshot();
  return [
    { id: 'automation-sentinel.registry.summary', method: 'GET', path: basePath, summary: createAutomationSentinelRouteSummary(snapshot) },
    { id: 'automation-sentinel.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'automation-sentinel.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

