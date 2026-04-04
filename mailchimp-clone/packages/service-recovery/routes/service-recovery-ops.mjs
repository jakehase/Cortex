import { buildServiceRecoverySnapshot, createServiceRecoveryChecklist } from '../service-service-recovery.mjs';

export function createServiceRecoveryOpsRoutes(basePath = '/ops/service-recovery') { const snapshot = buildServiceRecoverySnapshot(); return [{ id: 'service-recovery.ops.health', method: 'GET', path: basePath + '/health', checklist: createServiceRecoveryChecklist(snapshot) }, { id: 'service-recovery.ops.policies', method: 'GET', path: basePath + '/policies', policies: snapshot.policies }, { id: 'service-recovery.ops.metrics', method: 'GET', path: basePath + '/metrics', scorecards: snapshot.workspace.scorecards }]; }

