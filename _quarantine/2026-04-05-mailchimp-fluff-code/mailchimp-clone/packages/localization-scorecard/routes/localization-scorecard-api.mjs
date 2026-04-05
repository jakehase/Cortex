import { buildLocalizationScorecardSnapshot, createLocalizationScorecardApiDocument } from '../service-localization-scorecard.mjs';

export function createLocalizationScorecardApiRoutes(basePath = '/api/localization-scorecard') {
  const snapshot = buildLocalizationScorecardSnapshot();
  return [
    { id: 'localization-scorecard.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'localization-scorecard.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'localization-scorecard.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'localization-scorecard.api.document', method: 'GET', path: basePath + '/document', document: createLocalizationScorecardApiDocument(snapshot) }
  ];
}

