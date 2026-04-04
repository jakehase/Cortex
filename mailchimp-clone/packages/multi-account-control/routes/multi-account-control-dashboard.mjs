import { buildMultiAccountControlSnapshot } from '../service-multi-account-control.mjs';

export function createMultiAccountControlDashboardRoutes(basePath = '/multi-account-control') { const snapshot = buildMultiAccountControlSnapshot(); return [{ id: 'multi-account-control.overview', method: 'GET', path: basePath, summary: snapshot.summary }, { id: 'multi-account-control.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs }, { id: 'multi-account-control.narratives', method: 'GET', path: basePath + '/narratives', narratives: snapshot.narratives }]; }

