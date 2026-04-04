import { buildLoyaltyCockpitSnapshot, createLoyaltyCockpitRouteSummary } from '../service-loyalty-cockpit.mjs';

export function createLoyaltyCockpitRegistryRoutes(basePath = '/registry/loyalty-cockpit') {
  const snapshot = buildLoyaltyCockpitSnapshot();
  return [
    { id: 'loyalty-cockpit.registry.summary', method: 'GET', path: basePath, summary: createLoyaltyCockpitRouteSummary(snapshot) },
    { id: 'loyalty-cockpit.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'loyalty-cockpit.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

