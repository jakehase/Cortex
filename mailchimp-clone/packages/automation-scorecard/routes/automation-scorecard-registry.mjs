import { buildAutomationScorecardSnapshot, createAutomationScorecardRouteSummary } from '../service-automation-scorecard.mjs';

export function createAutomationScorecardRegistryRoutes(basePath = '/registry/automation-scorecard') {
  const snapshot = buildAutomationScorecardSnapshot();
  return [
    { id: 'automation-scorecard.registry.summary', method: 'GET', path: basePath, summary: createAutomationScorecardRouteSummary(snapshot) },
    { id: 'automation-scorecard.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'automation-scorecard.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

