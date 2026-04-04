import { buildEcommerceInsightsSnapshot, createEcommerceInsightsApiDocument } from '../service-ecommerce-insights.mjs';

export function createEcommerceInsightsApiRoutes(basePath = '/api/ecommerce-insights') { const snapshot = buildEcommerceInsightsSnapshot(); return [{ id: 'ecommerce-insights.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary }, { id: 'ecommerce-insights.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation }, { id: 'ecommerce-insights.api.document', method: 'GET', path: basePath + '/document', document: createEcommerceInsightsApiDocument(snapshot) }]; }

