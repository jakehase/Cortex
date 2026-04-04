import { buildComplianceScorecardSnapshot, createComplianceScorecardRouteSummary } from '../service-compliance-scorecard.mjs';

export function createComplianceScorecardRegistryRoutes(basePath = '/registry/compliance-scorecard') {
  const snapshot = buildComplianceScorecardSnapshot();
  return [
    { id: 'compliance-scorecard.registry.summary', method: 'GET', path: basePath, summary: createComplianceScorecardRouteSummary(snapshot) },
    { id: 'compliance-scorecard.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'compliance-scorecard.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

