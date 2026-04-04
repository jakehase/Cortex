import { buildLocalizationQaSnapshot, createLocalizationQaChecklist } from '../service-localization-qa.mjs';

export function createLocalizationQaOpsRoutes(basePath = '/ops/localization-qa') { const snapshot = buildLocalizationQaSnapshot(); return [{ id: 'localization-qa.ops.health', method: 'GET', path: basePath + '/health', checklist: createLocalizationQaChecklist(snapshot) }, { id: 'localization-qa.ops.policies', method: 'GET', path: basePath + '/policies', policies: snapshot.policies }, { id: 'localization-qa.ops.metrics', method: 'GET', path: basePath + '/metrics', scorecards: snapshot.workspace.scorecards }]; }

