import { buildAutomationSentinelSnapshot, createAutomationSentinelApiDocument } from '../service-automation-sentinel.mjs';

export function createAutomationSentinelApiRoutes(basePath = '/api/automation-sentinel') {
  const snapshot = buildAutomationSentinelSnapshot();
  return [
    { id: 'automation-sentinel.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'automation-sentinel.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'automation-sentinel.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'automation-sentinel.api.document', method: 'GET', path: basePath + '/document', document: createAutomationSentinelApiDocument(snapshot) }
  ];
}

