import { buildRetentionOffersSnapshot, createRetentionOffersChecklist } from '../service-retention-offers.mjs';

export function createRetentionOffersOpsRoutes(basePath = '/ops/retention-offers') { const snapshot = buildRetentionOffersSnapshot(); return [{ id: 'retention-offers.ops.health', method: 'GET', path: basePath + '/health', checklist: createRetentionOffersChecklist(snapshot) }, { id: 'retention-offers.ops.policies', method: 'GET', path: basePath + '/policies', policies: snapshot.policies }, { id: 'retention-offers.ops.metrics', method: 'GET', path: basePath + '/metrics', scorecards: snapshot.workspace.scorecards }]; }

