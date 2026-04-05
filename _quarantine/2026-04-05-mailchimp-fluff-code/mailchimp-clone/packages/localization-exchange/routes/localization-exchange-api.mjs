import { buildLocalizationExchangeSnapshot, createLocalizationExchangeApiDocument } from '../service-localization-exchange.mjs';

export function createLocalizationExchangeApiRoutes(basePath = '/api/localization-exchange') {
  const snapshot = buildLocalizationExchangeSnapshot();
  return [
    { id: 'localization-exchange.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'localization-exchange.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'localization-exchange.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'localization-exchange.api.document', method: 'GET', path: basePath + '/document', document: createLocalizationExchangeApiDocument(snapshot) }
  ];
}

