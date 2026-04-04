import { buildPredictiveSegmentsSnapshot, createPredictiveSegmentsApiDocument } from '../service-predictive-segments.mjs';

export function createPredictiveSegmentsApiRoutes(basePath = '/api/predictive-segments') { const snapshot = buildPredictiveSegmentsSnapshot(); return [{ id: 'predictive-segments.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary }, { id: 'predictive-segments.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation }, { id: 'predictive-segments.api.document', method: 'GET', path: basePath + '/document', document: createPredictiveSegmentsApiDocument(snapshot) }]; }

