import { buildLocalizationAdvisorSnapshot, createLocalizationAdvisorApiDocument } from '../service-localization-advisor.mjs';

export function createLocalizationAdvisorApiRoutes(basePath = '/api/localization-advisor') {
  const snapshot = buildLocalizationAdvisorSnapshot();
  return [
    { id: 'localization-advisor.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'localization-advisor.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'localization-advisor.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'localization-advisor.api.document', method: 'GET', path: basePath + '/document', document: createLocalizationAdvisorApiDocument(snapshot) }
  ];
}

