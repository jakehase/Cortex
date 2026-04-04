import { buildDeliverabilityWarRoomSnapshot, createDeliverabilityWarRoomApiDocument } from '../service-deliverability-war-room.mjs';

export function createDeliverabilityWarRoomApiRoutes(basePath = '/api/deliverability-war-room') { const snapshot = buildDeliverabilityWarRoomSnapshot(); return [{ id: 'deliverability-war-room.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary }, { id: 'deliverability-war-room.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation }, { id: 'deliverability-war-room.api.document', method: 'GET', path: basePath + '/document', document: createDeliverabilityWarRoomApiDocument(snapshot) }]; }

