import { buildConsentPlannerSnapshot, createConsentPlannerRouteSummary } from '../service-consent-planner.mjs';

export function createConsentPlannerRegistryRoutes(basePath = '/registry/consent-planner') {
  const snapshot = buildConsentPlannerSnapshot();
  return [
    { id: 'consent-planner.registry.summary', method: 'GET', path: basePath, summary: createConsentPlannerRouteSummary(snapshot) },
    { id: 'consent-planner.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'consent-planner.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

