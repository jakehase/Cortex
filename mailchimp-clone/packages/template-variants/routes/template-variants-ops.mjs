import { buildTemplateVariantsSnapshot, createTemplateVariantsChecklist } from '../service-template-variants.mjs';

export function createTemplateVariantsOpsRoutes(basePath = '/ops/template-variants') { const snapshot = buildTemplateVariantsSnapshot(); return [{ id: 'template-variants.ops.health', method: 'GET', path: basePath + '/health', checklist: createTemplateVariantsChecklist(snapshot) }, { id: 'template-variants.ops.policies', method: 'GET', path: basePath + '/policies', policies: snapshot.policies }, { id: 'template-variants.ops.metrics', method: 'GET', path: basePath + '/metrics', scorecards: snapshot.workspace.scorecards }]; }

