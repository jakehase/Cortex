import { buildTemplateApprovalsSnapshot, createTemplateApprovalsChecklist } from '../service-template-approvals.mjs';

export function createTemplateApprovalsOpsRoutes(basePath = '/ops/template-approvals') { const snapshot = buildTemplateApprovalsSnapshot(); return [{ id: 'template-approvals.ops.health', method: 'GET', path: basePath + '/health', checklist: createTemplateApprovalsChecklist(snapshot) }, { id: 'template-approvals.ops.policies', method: 'GET', path: basePath + '/policies', policies: snapshot.policies }, { id: 'template-approvals.ops.metrics', method: 'GET', path: basePath + '/metrics', scorecards: snapshot.workspace.scorecards }]; }

