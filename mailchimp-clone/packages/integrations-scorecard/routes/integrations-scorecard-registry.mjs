import { buildIntegrationsScorecardSnapshot, createIntegrationsScorecardRouteSummary } from '../service-integrations-scorecard.mjs';

export function createIntegrationsScorecardRegistryRoutes(basePath = '/registry/integrations-scorecard') {
  const snapshot = buildIntegrationsScorecardSnapshot();
  return [
    { id: 'integrations-scorecard.registry.summary', method: 'GET', path: basePath, summary: createIntegrationsScorecardRouteSummary(snapshot) },
    { id: 'integrations-scorecard.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'integrations-scorecard.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

