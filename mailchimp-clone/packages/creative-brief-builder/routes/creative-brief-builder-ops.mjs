import { buildCreativeBriefBuilderSnapshot, createCreativeBriefBuilderChecklist } from '../service-creative-brief-builder.mjs';

export function createCreativeBriefBuilderOpsRoutes(basePath = '/ops/creative-brief-builder') { const snapshot = buildCreativeBriefBuilderSnapshot(); return [{ id: 'creative-brief-builder.ops.health', method: 'GET', path: basePath + '/health', checklist: createCreativeBriefBuilderChecklist(snapshot) }, { id: 'creative-brief-builder.ops.policies', method: 'GET', path: basePath + '/policies', policies: snapshot.policies }, { id: 'creative-brief-builder.ops.metrics', method: 'GET', path: basePath + '/metrics', scorecards: snapshot.workspace.scorecards }]; }

