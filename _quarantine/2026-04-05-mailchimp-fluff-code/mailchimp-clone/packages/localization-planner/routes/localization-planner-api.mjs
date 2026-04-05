import { buildLocalizationPlannerSnapshot, createLocalizationPlannerApiDocument } from '../service-localization-planner.mjs';

export function createLocalizationPlannerApiRoutes(basePath = '/api/localization-planner') {
  const snapshot = buildLocalizationPlannerSnapshot();
  return [
    { id: 'localization-planner.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'localization-planner.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'localization-planner.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'localization-planner.api.document', method: 'GET', path: basePath + '/document', document: createLocalizationPlannerApiDocument(snapshot) }
  ];
}

