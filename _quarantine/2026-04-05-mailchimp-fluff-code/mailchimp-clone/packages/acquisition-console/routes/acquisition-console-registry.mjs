import { buildAcquisitionConsoleSnapshot, createAcquisitionConsoleRouteSummary } from '../service-acquisition-console.mjs';

export function createAcquisitionConsoleRegistryRoutes(basePath = '/registry/acquisition-console') {
  const snapshot = buildAcquisitionConsoleSnapshot();
  return [
    { id: 'acquisition-console.registry.summary', method: 'GET', path: basePath, summary: createAcquisitionConsoleRouteSummary(snapshot) },
    { id: 'acquisition-console.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'acquisition-console.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

