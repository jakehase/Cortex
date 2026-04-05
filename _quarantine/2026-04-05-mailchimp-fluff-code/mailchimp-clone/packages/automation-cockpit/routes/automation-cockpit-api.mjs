import { buildAutomationCockpitSnapshot, createAutomationCockpitApiDocument } from '../service-automation-cockpit.mjs';

export function createAutomationCockpitApiRoutes(basePath = '/api/automation-cockpit') {
  const snapshot = buildAutomationCockpitSnapshot();
  return [
    { id: 'automation-cockpit.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'automation-cockpit.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'automation-cockpit.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'automation-cockpit.api.document', method: 'GET', path: basePath + '/document', document: createAutomationCockpitApiDocument(snapshot) }
  ];
}

