import { buildDataActivationSnapshot, createDataActivationChecklist } from '../service-data-activation.mjs';

export function createDataActivationOpsRoutes(basePath = '/ops/data-activation') { const snapshot = buildDataActivationSnapshot(); return [{ id: 'data-activation.ops.health', method: 'GET', path: basePath + '/health', checklist: createDataActivationChecklist(snapshot) }, { id: 'data-activation.ops.policies', method: 'GET', path: basePath + '/policies', policies: snapshot.policies }, { id: 'data-activation.ops.metrics', method: 'GET', path: basePath + '/metrics', scorecards: snapshot.workspace.scorecards }]; }

