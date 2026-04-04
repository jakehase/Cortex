import { buildTemplateApprovalsSnapshot } from '../service-template-approvals.mjs';
import { createTemplateApprovalsFixtures } from '../fixtures-template-approvals.mjs';

export function createTemplateApprovalsPublicRoutes(basePath = '/public/template-approvals') { const snapshot = buildTemplateApprovalsSnapshot(); const fixtures = createTemplateApprovalsFixtures(); return [{ id: 'template-approvals.public.summary', method: 'GET', path: basePath, focus: snapshot.summary.focus }, { id: 'template-approvals.public.catalog', method: 'GET', path: basePath + '/catalog', contacts: fixtures.contacts }, { id: 'template-approvals.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }]; }

