import { buildTrustAutomationSnapshot } from '../service-trust-automation.mjs';

export function createTrustAutomationDashboardRoutes(basePath = '/trust-automation') { const snapshot = buildTrustAutomationSnapshot(); return [{ id: 'trust-automation.overview', method: 'GET', path: basePath, summary: snapshot.summary }, { id: 'trust-automation.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs }, { id: 'trust-automation.narratives', method: 'GET', path: basePath + '/narratives', narratives: snapshot.narratives }]; }

