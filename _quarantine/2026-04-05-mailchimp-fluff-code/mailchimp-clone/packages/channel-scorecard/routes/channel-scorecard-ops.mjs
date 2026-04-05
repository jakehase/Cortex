import { buildChannelScorecardSnapshot, createChannelScorecardReadinessBoard } from '../service-channel-scorecard.mjs';

export function createChannelScorecardOpsRoutes(basePath = '/ops/channel-scorecard') {
  const snapshot = buildChannelScorecardSnapshot();
  return [
    { id: 'channel-scorecard.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createChannelScorecardReadinessBoard(snapshot) },
    { id: 'channel-scorecard.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'channel-scorecard.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

