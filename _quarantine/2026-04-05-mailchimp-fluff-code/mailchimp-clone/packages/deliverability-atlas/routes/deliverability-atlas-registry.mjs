import { buildDeliverabilityAtlasSnapshot, createDeliverabilityAtlasRouteSummary } from '../service-deliverability-atlas.mjs';

export function createDeliverabilityAtlasRegistryRoutes(basePath = '/registry/deliverability-atlas') {
  const snapshot = buildDeliverabilityAtlasSnapshot();
  return [
    { id: 'deliverability-atlas.registry.summary', method: 'GET', path: basePath, summary: createDeliverabilityAtlasRouteSummary(snapshot) },
    { id: 'deliverability-atlas.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'deliverability-atlas.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

