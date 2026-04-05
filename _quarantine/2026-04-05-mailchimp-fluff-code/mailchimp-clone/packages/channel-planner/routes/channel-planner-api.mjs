import { buildChannelPlannerSnapshot, createChannelPlannerApiDocument } from '../service-channel-planner.mjs';

export function createChannelPlannerApiRoutes(basePath = '/api/channel-planner') {
  const snapshot = buildChannelPlannerSnapshot();
  return [
    { id: 'channel-planner.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'channel-planner.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'channel-planner.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'channel-planner.api.document', method: 'GET', path: basePath + '/document', document: createChannelPlannerApiDocument(snapshot) }
  ];
}

