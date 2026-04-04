import { buildComplianceIncidentsSnapshot, createComplianceIncidentsChecklist } from '../service-compliance-incidents.mjs';

export function createComplianceIncidentsOpsRoutes(basePath = '/ops/compliance-incidents') { const snapshot = buildComplianceIncidentsSnapshot(); return [{ id: 'compliance-incidents.ops.health', method: 'GET', path: basePath + '/health', checklist: createComplianceIncidentsChecklist(snapshot) }, { id: 'compliance-incidents.ops.policies', method: 'GET', path: basePath + '/policies', policies: snapshot.policies }, { id: 'compliance-incidents.ops.metrics', method: 'GET', path: basePath + '/metrics', scorecards: snapshot.workspace.scorecards }]; }

