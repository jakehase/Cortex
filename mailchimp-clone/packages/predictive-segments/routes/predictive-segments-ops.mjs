import { buildPredictiveSegmentsSnapshot, createPredictiveSegmentsChecklist } from '../service-predictive-segments.mjs';

export function createPredictiveSegmentsOpsRoutes(basePath = '/ops/predictive-segments') { const snapshot = buildPredictiveSegmentsSnapshot(); return [{ id: 'predictive-segments.ops.health', method: 'GET', path: basePath + '/health', checklist: createPredictiveSegmentsChecklist(snapshot) }, { id: 'predictive-segments.ops.policies', method: 'GET', path: basePath + '/policies', policies: snapshot.policies }, { id: 'predictive-segments.ops.metrics', method: 'GET', path: basePath + '/metrics', scorecards: snapshot.workspace.scorecards }]; }

