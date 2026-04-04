import { buildBillingRecoverySnapshot } from '../service-billing-recovery.mjs';

export function createBillingRecoveryDashboardRoutes(basePath = '/billing-recovery') { const snapshot = buildBillingRecoverySnapshot(); return [{ id: 'billing-recovery.overview', method: 'GET', path: basePath, summary: snapshot.summary }, { id: 'billing-recovery.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs }, { id: 'billing-recovery.narratives', method: 'GET', path: basePath + '/narratives', narratives: snapshot.narratives }]; }
