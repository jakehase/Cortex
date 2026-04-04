import { buildRetentionOffersSnapshot, createRetentionOffersApiDocument } from '../service-retention-offers.mjs';

export function createRetentionOffersApiRoutes(basePath = '/api/retention-offers') { const snapshot = buildRetentionOffersSnapshot(); return [{ id: 'retention-offers.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary }, { id: 'retention-offers.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation }, { id: 'retention-offers.api.document', method: 'GET', path: basePath + '/document', document: createRetentionOffersApiDocument(snapshot) }]; }

