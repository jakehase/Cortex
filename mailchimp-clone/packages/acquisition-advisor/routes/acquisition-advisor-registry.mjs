import { buildAcquisitionAdvisorSnapshot, createAcquisitionAdvisorRouteSummary } from '../service-acquisition-advisor.mjs';

export function createAcquisitionAdvisorRegistryRoutes(basePath = '/registry/acquisition-advisor') {
  const snapshot = buildAcquisitionAdvisorSnapshot();
  return [
    { id: 'acquisition-advisor.registry.summary', method: 'GET', path: basePath, summary: createAcquisitionAdvisorRouteSummary(snapshot) },
    { id: 'acquisition-advisor.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'acquisition-advisor.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

