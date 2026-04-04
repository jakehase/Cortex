import { buildAttributionModelingSnapshot, createAttributionModelingChecklist } from '../service-attribution-modeling.mjs';

export function createAttributionModelingOpsRoutes(basePath = '/ops/attribution-modeling') { const snapshot = buildAttributionModelingSnapshot(); return [{ id: 'attribution-modeling.ops.health', method: 'GET', path: basePath + '/health', checklist: createAttributionModelingChecklist(snapshot) }, { id: 'attribution-modeling.ops.policies', method: 'GET', path: basePath + '/policies', policies: snapshot.policies }, { id: 'attribution-modeling.ops.metrics', method: 'GET', path: basePath + '/metrics', scorecards: snapshot.workspace.scorecards }]; }

