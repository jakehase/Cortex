import { buildCustomerHealthSnapshot, createCustomerHealthApiDocument } from '../service-customer-health.mjs';

export function createCustomerHealthApiRoutes(basePath = '/api/customer-health') { const snapshot = buildCustomerHealthSnapshot(); return [{ id: 'customer-health.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary }, { id: 'customer-health.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation }, { id: 'customer-health.api.document', method: 'GET', path: basePath + '/document', document: createCustomerHealthApiDocument(snapshot) }]; }

