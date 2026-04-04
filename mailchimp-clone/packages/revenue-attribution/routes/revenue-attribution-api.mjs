import { buildRevenueAttributionSnapshot, createRevenueAttributionApiDocument } from '../service-revenue-attribution.mjs';

export function createRevenueAttributionApiRoutes(basePath = '/api/revenue-attribution') { const snapshot = buildRevenueAttributionSnapshot(); return [{ id: 'revenue-attribution.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary }, { id: 'revenue-attribution.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation }, { id: 'revenue-attribution.api.document', method: 'GET', path: basePath + '/document', document: createRevenueAttributionApiDocument(snapshot) }]; }

