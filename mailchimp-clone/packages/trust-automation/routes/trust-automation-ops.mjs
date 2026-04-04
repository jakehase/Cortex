import { buildTrustAutomationSnapshot, createTrustAutomationChecklist } from '../service-trust-automation.mjs';

export function createTrustAutomationOpsRoutes(basePath = '/ops/trust-automation') { const snapshot = buildTrustAutomationSnapshot(); return [{ id: 'trust-automation.ops.health', method: 'GET', path: basePath + '/health', checklist: createTrustAutomationChecklist(snapshot) }, { id: 'trust-automation.ops.policies', method: 'GET', path: basePath + '/policies', policies: snapshot.policies }, { id: 'trust-automation.ops.metrics', method: 'GET', path: basePath + '/metrics', scorecards: snapshot.workspace.scorecards }]; }

