import { buildTrustAutomationSnapshot, createTrustAutomationApiDocument } from '../service-trust-automation.mjs';

export function createTrustAutomationApiRoutes(basePath = '/api/trust-automation') { const snapshot = buildTrustAutomationSnapshot(); return [{ id: 'trust-automation.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary }, { id: 'trust-automation.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation }, { id: 'trust-automation.api.document', method: 'GET', path: basePath + '/document', document: createTrustAutomationApiDocument(snapshot) }]; }

