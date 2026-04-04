import { buildTemplateVariantsSnapshot } from '../service-template-variants.mjs';

export function createTemplateVariantsDashboardRoutes(basePath = '/template-variants') { const snapshot = buildTemplateVariantsSnapshot(); return [{ id: 'template-variants.overview', method: 'GET', path: basePath, summary: snapshot.summary }, { id: 'template-variants.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs }, { id: 'template-variants.narratives', method: 'GET', path: basePath + '/narratives', narratives: snapshot.narratives }]; }

