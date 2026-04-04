import { buildTemplateApprovalsSnapshot, createTemplateApprovalsApiDocument } from '../service-template-approvals.mjs';

export function createTemplateApprovalsApiRoutes(basePath = '/api/template-approvals') { const snapshot = buildTemplateApprovalsSnapshot(); return [{ id: 'template-approvals.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary }, { id: 'template-approvals.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation }, { id: 'template-approvals.api.document', method: 'GET', path: basePath + '/document', document: createTemplateApprovalsApiDocument(snapshot) }]; }

