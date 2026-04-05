import { buildAudienceCockpitSnapshot, createAudienceCockpitRouteSummary } from '../service-audience-cockpit.mjs';

export function createAudienceCockpitRegistryRoutes(basePath = '/registry/audience-cockpit') {
  const snapshot = buildAudienceCockpitSnapshot();
  return [
    { id: 'audience-cockpit.registry.summary', method: 'GET', path: basePath, summary: createAudienceCockpitRouteSummary(snapshot) },
    { id: 'audience-cockpit.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'audience-cockpit.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

