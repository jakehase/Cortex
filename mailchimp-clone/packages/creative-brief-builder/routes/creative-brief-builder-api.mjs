import { buildCreativeBriefBuilderSnapshot, createCreativeBriefBuilderApiDocument } from '../service-creative-brief-builder.mjs';

export function createCreativeBriefBuilderApiRoutes(basePath = '/api/creative-brief-builder') { const snapshot = buildCreativeBriefBuilderSnapshot(); return [{ id: 'creative-brief-builder.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary }, { id: 'creative-brief-builder.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation }, { id: 'creative-brief-builder.api.document', method: 'GET', path: basePath + '/document', document: createCreativeBriefBuilderApiDocument(snapshot) }]; }

