import { buildDeliverabilityWarRoomSnapshot } from '../service-deliverability-war-room.mjs';
import { createDeliverabilityWarRoomFixtures } from '../fixtures-deliverability-war-room.mjs';

export function createDeliverabilityWarRoomPublicRoutes(basePath = '/public/deliverability-war-room') { const snapshot = buildDeliverabilityWarRoomSnapshot(); const fixtures = createDeliverabilityWarRoomFixtures(); return [{ id: 'deliverability-war-room.public.summary', method: 'GET', path: basePath, focus: snapshot.summary.focus }, { id: 'deliverability-war-room.public.catalog', method: 'GET', path: basePath + '/catalog', contacts: fixtures.contacts }, { id: 'deliverability-war-room.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }]; }

