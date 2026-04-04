import { buildSegmentationQualitySnapshot, createSegmentationQualityApiDocument } from '../service-segmentation-quality.mjs';

export function createSegmentationQualityApiRoutes(basePath = '/api/segmentation-quality') { const snapshot = buildSegmentationQualitySnapshot(); return [{ id: 'segmentation-quality.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary }, { id: 'segmentation-quality.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation }, { id: 'segmentation-quality.api.document', method: 'GET', path: basePath + '/document', document: createSegmentationQualityApiDocument(snapshot) }]; }

