import { buildAutomationAtlasSnapshot, createAutomationAtlasReadinessBoard } from '../service-automation-atlas.mjs';

export function createAutomationAtlasOpsRoutes(basePath = '/ops/automation-atlas') {
  const snapshot = buildAutomationAtlasSnapshot();
  return [
    { id: 'automation-atlas.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAutomationAtlasReadinessBoard(snapshot) },
    { id: 'automation-atlas.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'automation-atlas.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

