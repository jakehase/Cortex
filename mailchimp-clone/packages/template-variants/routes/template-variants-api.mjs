import { buildTemplateVariantsSnapshot, createTemplateVariantsApiDocument } from '../service-template-variants.mjs';

export function createTemplateVariantsApiRoutes(basePath = '/api/template-variants') { const snapshot = buildTemplateVariantsSnapshot(); return [{ id: 'template-variants.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary }, { id: 'template-variants.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation }, { id: 'template-variants.api.document', method: 'GET', path: basePath + '/document', document: createTemplateVariantsApiDocument(snapshot) }]; }

