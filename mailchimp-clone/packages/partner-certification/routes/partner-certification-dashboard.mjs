import { buildPartnerCertificationSnapshot } from '../service-partner-certification.mjs';

export function createPartnerCertificationDashboardRoutes(basePath = '/partner-certification') { const snapshot = buildPartnerCertificationSnapshot(); return [{ id: 'partner-certification.overview', method: 'GET', path: basePath, summary: snapshot.summary }, { id: 'partner-certification.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs }, { id: 'partner-certification.narratives', method: 'GET', path: basePath + '/narratives', narratives: snapshot.narratives }]; }

