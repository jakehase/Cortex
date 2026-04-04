import { buildLocalizationQaSnapshot, createLocalizationQaApiDocument } from '../service-localization-qa.mjs';

export function createLocalizationQaApiRoutes(basePath = '/api/localization-qa') { const snapshot = buildLocalizationQaSnapshot(); return [{ id: 'localization-qa.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary }, { id: 'localization-qa.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation }, { id: 'localization-qa.api.document', method: 'GET', path: basePath + '/document', document: createLocalizationQaApiDocument(snapshot) }]; }

