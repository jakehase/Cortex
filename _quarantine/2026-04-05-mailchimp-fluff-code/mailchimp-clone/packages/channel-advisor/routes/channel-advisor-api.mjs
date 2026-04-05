import { buildChannelAdvisorSnapshot, createChannelAdvisorApiDocument } from '../service-channel-advisor.mjs';

export function createChannelAdvisorApiRoutes(basePath = '/api/channel-advisor') {
  const snapshot = buildChannelAdvisorSnapshot();
  return [
    { id: 'channel-advisor.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'channel-advisor.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'channel-advisor.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'channel-advisor.api.document', method: 'GET', path: basePath + '/document', document: createChannelAdvisorApiDocument(snapshot) }
  ];
}

