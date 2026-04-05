import { buildLocalizationScorecardSnapshot, createLocalizationScorecardRouteSummary } from '../service-localization-scorecard.mjs';

export function createLocalizationScorecardRegistryRoutes(basePath = '/registry/localization-scorecard') {
  const snapshot = buildLocalizationScorecardSnapshot();
  return [
    { id: 'localization-scorecard.registry.summary', method: 'GET', path: basePath, summary: createLocalizationScorecardRouteSummary(snapshot) },
    { id: 'localization-scorecard.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'localization-scorecard.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

