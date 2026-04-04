import { buildSendTimeOptimizerSnapshot, createSendTimeOptimizerChecklist } from '../service-send-time-optimizer.mjs';

export function createSendTimeOptimizerOpsRoutes(basePath = '/ops/send-time-optimizer') {
  const snapshot = buildSendTimeOptimizerSnapshot();
  return [
    { id: 'send-time-optimizer.ops.health', method: 'GET', path: basePath + '/health', checklist: createSendTimeOptimizerChecklist(snapshot) },
    { id: 'send-time-optimizer.ops.policies', method: 'GET', path: basePath + '/policies', policies: snapshot.policies },
    { id: 'send-time-optimizer.ops.metrics', method: 'GET', path: basePath + '/metrics', scorecards: snapshot.workspace.scorecards }
  ];
}
