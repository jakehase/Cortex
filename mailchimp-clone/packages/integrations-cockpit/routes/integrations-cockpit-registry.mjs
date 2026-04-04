import { buildIntegrationsCockpitSnapshot, createIntegrationsCockpitRouteSummary } from '../service-integrations-cockpit.mjs';

export function createIntegrationsCockpitRegistryRoutes(basePath = '/registry/integrations-cockpit') {
  const snapshot = buildIntegrationsCockpitSnapshot();
  return [
    { id: 'integrations-cockpit.registry.summary', method: 'GET', path: basePath, summary: createIntegrationsCockpitRouteSummary(snapshot) },
    { id: 'integrations-cockpit.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'integrations-cockpit.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

