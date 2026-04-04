import { buildPartnerCertificationSnapshot, createPartnerCertificationChecklist } from '../service-partner-certification.mjs';

export function createPartnerCertificationOpsRoutes(basePath = '/ops/partner-certification') { const snapshot = buildPartnerCertificationSnapshot(); return [{ id: 'partner-certification.ops.health', method: 'GET', path: basePath + '/health', checklist: createPartnerCertificationChecklist(snapshot) }, { id: 'partner-certification.ops.policies', method: 'GET', path: basePath + '/policies', policies: snapshot.policies }, { id: 'partner-certification.ops.metrics', method: 'GET', path: basePath + '/metrics', scorecards: snapshot.workspace.scorecards }]; }

