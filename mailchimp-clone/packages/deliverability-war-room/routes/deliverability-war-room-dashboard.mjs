import { buildDeliverabilityWarRoomSnapshot } from '../service-deliverability-war-room.mjs';

export function createDeliverabilityWarRoomDashboardRoutes(basePath = '/deliverability-war-room') { const snapshot = buildDeliverabilityWarRoomSnapshot(); return [{ id: 'deliverability-war-room.overview', method: 'GET', path: basePath, summary: snapshot.summary }, { id: 'deliverability-war-room.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs }, { id: 'deliverability-war-room.narratives', method: 'GET', path: basePath + '/narratives', narratives: snapshot.narratives }]; }

