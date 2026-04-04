import { buildDeliverabilityWarRoomSnapshot, createDeliverabilityWarRoomChecklist } from '../service-deliverability-war-room.mjs';

export function createDeliverabilityWarRoomOpsRoutes(basePath = '/ops/deliverability-war-room') { const snapshot = buildDeliverabilityWarRoomSnapshot(); return [{ id: 'deliverability-war-room.ops.health', method: 'GET', path: basePath + '/health', checklist: createDeliverabilityWarRoomChecklist(snapshot) }, { id: 'deliverability-war-room.ops.policies', method: 'GET', path: basePath + '/policies', policies: snapshot.policies }, { id: 'deliverability-war-room.ops.metrics', method: 'GET', path: basePath + '/metrics', scorecards: snapshot.workspace.scorecards }]; }

