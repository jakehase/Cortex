import { buildServiceRecoverySnapshot } from '../service-service-recovery.mjs';

export function createServiceRecoveryDashboardRoutes(basePath = '/service-recovery') { const snapshot = buildServiceRecoverySnapshot(); return [{ id: 'service-recovery.overview', method: 'GET', path: basePath, summary: snapshot.summary }, { id: 'service-recovery.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs }, { id: 'service-recovery.narratives', method: 'GET', path: basePath + '/narratives', narratives: snapshot.narratives }]; }

