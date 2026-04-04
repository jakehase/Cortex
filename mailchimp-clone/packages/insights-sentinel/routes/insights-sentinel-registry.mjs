import { buildInsightsSentinelSnapshot, createInsightsSentinelRouteSummary } from '../service-insights-sentinel.mjs';

export function createInsightsSentinelRegistryRoutes(basePath = '/registry/insights-sentinel') {
  const snapshot = buildInsightsSentinelSnapshot();
  return [
    { id: 'insights-sentinel.registry.summary', method: 'GET', path: basePath, summary: createInsightsSentinelRouteSummary(snapshot) },
    { id: 'insights-sentinel.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'insights-sentinel.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

