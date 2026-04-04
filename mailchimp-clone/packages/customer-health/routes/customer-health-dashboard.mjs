import { buildCustomerHealthSnapshot } from '../service-customer-health.mjs';

export function createCustomerHealthDashboardRoutes(basePath = '/customer-health') { const snapshot = buildCustomerHealthSnapshot(); return [{ id: 'customer-health.overview', method: 'GET', path: basePath, summary: snapshot.summary }, { id: 'customer-health.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs }, { id: 'customer-health.narratives', method: 'GET', path: basePath + '/narratives', narratives: snapshot.narratives }]; }

