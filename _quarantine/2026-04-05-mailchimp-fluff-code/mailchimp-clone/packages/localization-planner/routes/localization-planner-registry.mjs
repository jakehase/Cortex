import { buildLocalizationPlannerSnapshot, createLocalizationPlannerRouteSummary } from '../service-localization-planner.mjs';

export function createLocalizationPlannerRegistryRoutes(basePath = '/registry/localization-planner') {
  const snapshot = buildLocalizationPlannerSnapshot();
  return [
    { id: 'localization-planner.registry.summary', method: 'GET', path: basePath, summary: createLocalizationPlannerRouteSummary(snapshot) },
    { id: 'localization-planner.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'localization-planner.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

