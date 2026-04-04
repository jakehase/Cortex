import { buildSenderRotationSnapshot } from '../service-sender-rotation.mjs';
import { createSenderRotationFixtures } from '../fixtures-sender-rotation.mjs';

export function createSenderRotationPublicRoutes(basePath = '/public/sender-rotation') { const snapshot = buildSenderRotationSnapshot(); const fixtures = createSenderRotationFixtures(); return [{ id: 'sender-rotation.public.summary', method: 'GET', path: basePath, focus: snapshot.summary.focus }, { id: 'sender-rotation.public.catalog', method: 'GET', path: basePath + '/catalog', contacts: fixtures.contacts }, { id: 'sender-rotation.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }]; }

