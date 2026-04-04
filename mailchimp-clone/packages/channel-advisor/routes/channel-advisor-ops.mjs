import { buildChannelAdvisorSnapshot, createChannelAdvisorReadinessBoard } from '../service-channel-advisor.mjs';

export function createChannelAdvisorOpsRoutes(basePath = '/ops/channel-advisor') {
  const snapshot = buildChannelAdvisorSnapshot();
  return [
    { id: 'channel-advisor.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createChannelAdvisorReadinessBoard(snapshot) },
    { id: 'channel-advisor.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'channel-advisor.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

