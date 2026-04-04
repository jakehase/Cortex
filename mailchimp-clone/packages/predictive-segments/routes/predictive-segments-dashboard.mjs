import { buildPredictiveSegmentsSnapshot } from '../service-predictive-segments.mjs';

export function createPredictiveSegmentsDashboardRoutes(basePath = '/predictive-segments') { const snapshot = buildPredictiveSegmentsSnapshot(); return [{ id: 'predictive-segments.overview', method: 'GET', path: basePath, summary: snapshot.summary }, { id: 'predictive-segments.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs }, { id: 'predictive-segments.narratives', method: 'GET', path: basePath + '/narratives', narratives: snapshot.narratives }]; }

