import { buildConsentPlannerSnapshot, createConsentPlannerApiDocument } from '../service-consent-planner.mjs';

export function createConsentPlannerApiRoutes(basePath = '/api/consent-planner') {
  const snapshot = buildConsentPlannerSnapshot();
  return [
    { id: 'consent-planner.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'consent-planner.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'consent-planner.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'consent-planner.api.document', method: 'GET', path: basePath + '/document', document: createConsentPlannerApiDocument(snapshot) }
  ];
}

