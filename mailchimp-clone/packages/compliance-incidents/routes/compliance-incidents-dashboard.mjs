import { buildComplianceIncidentsSnapshot } from '../service-compliance-incidents.mjs';

export function createComplianceIncidentsDashboardRoutes(basePath = '/compliance-incidents') { const snapshot = buildComplianceIncidentsSnapshot(); return [{ id: 'compliance-incidents.overview', method: 'GET', path: basePath, summary: snapshot.summary }, { id: 'compliance-incidents.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs }, { id: 'compliance-incidents.narratives', method: 'GET', path: basePath + '/narratives', narratives: snapshot.narratives }]; }

