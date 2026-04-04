import { buildSmsOrchestrationSnapshot, createSmsOrchestrationChecklist } from '../service-sms-orchestration.mjs';

export function createSmsOrchestrationOpsRoutes(basePath = '/ops/sms-orchestration') {
  const snapshot = buildSmsOrchestrationSnapshot();
  return [
    { id: 'sms-orchestration.ops.health', method: 'GET', path: basePath + '/health', checklist: createSmsOrchestrationChecklist(snapshot) },
    { id: 'sms-orchestration.ops.policies', method: 'GET', path: basePath + '/policies', policies: snapshot.policies },
    { id: 'sms-orchestration.ops.metrics', method: 'GET', path: basePath + '/metrics', scorecards: snapshot.workspace.scorecards }
  ];
}
