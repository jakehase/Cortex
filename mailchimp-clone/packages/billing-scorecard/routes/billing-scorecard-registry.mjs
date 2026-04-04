import { buildBillingScorecardSnapshot, createBillingScorecardRouteSummary } from '../service-billing-scorecard.mjs';

export function createBillingScorecardRegistryRoutes(basePath = '/registry/billing-scorecard') {
  const snapshot = buildBillingScorecardSnapshot();
  return [
    { id: 'billing-scorecard.registry.summary', method: 'GET', path: basePath, summary: createBillingScorecardRouteSummary(snapshot) },
    { id: 'billing-scorecard.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'billing-scorecard.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

