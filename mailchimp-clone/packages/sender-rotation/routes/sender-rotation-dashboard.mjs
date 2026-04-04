import { buildSenderRotationSnapshot } from '../service-sender-rotation.mjs';

export function createSenderRotationDashboardRoutes(basePath = '/sender-rotation') { const snapshot = buildSenderRotationSnapshot(); return [{ id: 'sender-rotation.overview', method: 'GET', path: basePath, summary: snapshot.summary }, { id: 'sender-rotation.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs }, { id: 'sender-rotation.narratives', method: 'GET', path: basePath + '/narratives', narratives: snapshot.narratives }]; }

