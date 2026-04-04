import { buildAutomationStudioSnapshot, createAutomationStudioApiDocument } from '../service-automation-studio.mjs';

export function createAutomationStudioApiRoutes(basePath = '/api/automation-studio') {
  const snapshot = buildAutomationStudioSnapshot();
  return [
    { id: 'automation-studio.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'automation-studio.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'automation-studio.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'automation-studio.api.document', method: 'GET', path: basePath + '/document', document: createAutomationStudioApiDocument(snapshot) }
  ];
}

