import { buildCreativeQaSnapshot, createCreativeQaChecklist } from '../service-creative-qa.mjs';

export function createCreativeQaOpsRoutes(basePath = '/ops/creative-qa') { const snapshot = buildCreativeQaSnapshot(); return [{ id: 'creative-qa.ops.health', method: 'GET', path: basePath + '/health', checklist: createCreativeQaChecklist(snapshot) }, { id: 'creative-qa.ops.policies', method: 'GET', path: basePath + '/policies', policies: snapshot.policies }, { id: 'creative-qa.ops.metrics', method: 'GET', path: basePath + '/metrics', scorecards: snapshot.workspace.scorecards }]; }

