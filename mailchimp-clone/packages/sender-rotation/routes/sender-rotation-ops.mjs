import { buildSenderRotationSnapshot, createSenderRotationChecklist } from '../service-sender-rotation.mjs';

export function createSenderRotationOpsRoutes(basePath = '/ops/sender-rotation') { const snapshot = buildSenderRotationSnapshot(); return [{ id: 'sender-rotation.ops.health', method: 'GET', path: basePath + '/health', checklist: createSenderRotationChecklist(snapshot) }, { id: 'sender-rotation.ops.policies', method: 'GET', path: basePath + '/policies', policies: snapshot.policies }, { id: 'sender-rotation.ops.metrics', method: 'GET', path: basePath + '/metrics', scorecards: snapshot.workspace.scorecards }]; }

