import { buildChannelScorecardSnapshot, createChannelScorecardApiDocument } from '../service-channel-scorecard.mjs';

export function createChannelScorecardApiRoutes(basePath = '/api/channel-scorecard') {
  const snapshot = buildChannelScorecardSnapshot();
  return [
    { id: 'channel-scorecard.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'channel-scorecard.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'channel-scorecard.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'channel-scorecard.api.document', method: 'GET', path: basePath + '/document', document: createChannelScorecardApiDocument(snapshot) }
  ];
}

