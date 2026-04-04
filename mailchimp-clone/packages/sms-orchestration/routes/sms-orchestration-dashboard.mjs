import { buildSmsOrchestrationSnapshot } from '../service-sms-orchestration.mjs';

export function createSmsOrchestrationDashboardRoutes(basePath = '/sms-orchestration') {
  const snapshot = buildSmsOrchestrationSnapshot();
  return [
    { id: 'sms-orchestration.overview', method: 'GET', path: basePath, summary: snapshot.summary },
    { id: 'sms-orchestration.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'sms-orchestration.narratives', method: 'GET', path: basePath + '/narratives', narratives: snapshot.narratives }
  ];
}
