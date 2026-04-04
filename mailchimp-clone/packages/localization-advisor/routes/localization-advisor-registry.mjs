import { buildLocalizationAdvisorSnapshot, createLocalizationAdvisorRouteSummary } from '../service-localization-advisor.mjs';

export function createLocalizationAdvisorRegistryRoutes(basePath = '/registry/localization-advisor') {
  const snapshot = buildLocalizationAdvisorSnapshot();
  return [
    { id: 'localization-advisor.registry.summary', method: 'GET', path: basePath, summary: createLocalizationAdvisorRouteSummary(snapshot) },
    { id: 'localization-advisor.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'localization-advisor.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

