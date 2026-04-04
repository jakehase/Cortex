import { buildPartnerCockpitSnapshot, createPartnerCockpitRouteSummary } from '../service-partner-cockpit.mjs';

export function createPartnerCockpitRegistryRoutes(basePath = '/registry/partner-cockpit') {
  const snapshot = buildPartnerCockpitSnapshot();
  return [
    { id: 'partner-cockpit.registry.summary', method: 'GET', path: basePath, summary: createPartnerCockpitRouteSummary(snapshot) },
    { id: 'partner-cockpit.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'partner-cockpit.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

