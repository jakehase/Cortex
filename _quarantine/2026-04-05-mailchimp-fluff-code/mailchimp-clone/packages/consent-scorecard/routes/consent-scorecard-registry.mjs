import { buildConsentScorecardSnapshot, createConsentScorecardRouteSummary } from '../service-consent-scorecard.mjs';

export function createConsentScorecardRegistryRoutes(basePath = '/registry/consent-scorecard') {
  const snapshot = buildConsentScorecardSnapshot();
  return [
    { id: 'consent-scorecard.registry.summary', method: 'GET', path: basePath, summary: createConsentScorecardRouteSummary(snapshot) },
    { id: 'consent-scorecard.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'consent-scorecard.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

