import { buildSmsOrchestrationSnapshot, createSmsOrchestrationApiDocument } from '../service-sms-orchestration.mjs';

export function createSmsOrchestrationApiRoutes(basePath = '/api/sms-orchestration') {
  const snapshot = buildSmsOrchestrationSnapshot();
  return [
    { id: 'sms-orchestration.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'sms-orchestration.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'sms-orchestration.api.document', method: 'GET', path: basePath + '/document', document: createSmsOrchestrationApiDocument(snapshot) }
  ];
}
