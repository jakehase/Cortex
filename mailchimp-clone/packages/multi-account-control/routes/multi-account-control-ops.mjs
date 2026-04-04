import { buildMultiAccountControlSnapshot, createMultiAccountControlChecklist } from '../service-multi-account-control.mjs';

export function createMultiAccountControlOpsRoutes(basePath = '/ops/multi-account-control') { const snapshot = buildMultiAccountControlSnapshot(); return [{ id: 'multi-account-control.ops.health', method: 'GET', path: basePath + '/health', checklist: createMultiAccountControlChecklist(snapshot) }, { id: 'multi-account-control.ops.policies', method: 'GET', path: basePath + '/policies', policies: snapshot.policies }, { id: 'multi-account-control.ops.metrics', method: 'GET', path: basePath + '/metrics', scorecards: snapshot.workspace.scorecards }]; }

