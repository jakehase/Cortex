import { buildLocalizationSentinelSnapshot, createLocalizationSentinelApiDocument } from '../service-localization-sentinel.mjs';

export function createLocalizationSentinelApiRoutes(basePath = '/api/localization-sentinel') {
  const snapshot = buildLocalizationSentinelSnapshot();
  return [
    { id: 'localization-sentinel.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'localization-sentinel.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'localization-sentinel.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'localization-sentinel.api.document', method: 'GET', path: basePath + '/document', document: createLocalizationSentinelApiDocument(snapshot) }
  ];
}

