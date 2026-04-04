import { buildTemplateApprovalsSnapshot } from '../service-template-approvals.mjs';

export function createTemplateApprovalsDashboardRoutes(basePath = '/template-approvals') { const snapshot = buildTemplateApprovalsSnapshot(); return [{ id: 'template-approvals.overview', method: 'GET', path: basePath, summary: snapshot.summary }, { id: 'template-approvals.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs }, { id: 'template-approvals.narratives', method: 'GET', path: basePath + '/narratives', narratives: snapshot.narratives }]; }

