import { createDeliverabilityWarRoomWorkspace, summarizeDeliverabilityWarRoom, createDeliverabilityWarRoomNarratives } from './domain-deliverability-war-room.mjs';
import { createDeliverabilityWarRoomPolicies, validateDeliverabilityWarRoomPolicies, policySummaryDeliverabilityWarRoom } from './domain-deliverability-war-room-policies.mjs';

export function buildDeliverabilityWarRoomSnapshot(workspaceName = 'Wave 6 workspace') {
  const workspace = createDeliverabilityWarRoomWorkspace(workspaceName);
  const policies = createDeliverabilityWarRoomPolicies();
  return { workspace, summary: summarizeDeliverabilityWarRoom(workspace), narratives: createDeliverabilityWarRoomNarratives(workspace), policies, policySummary: policySummaryDeliverabilityWarRoom(policies), validation: validateDeliverabilityWarRoomPolicies(policies) };
}

export function createDeliverabilityWarRoomChecklist(snapshot = buildDeliverabilityWarRoomSnapshot()) {
  return [
    { id: "deliverability-war-room-check-1", label: 'Scope visible', ok: snapshot.summary.metricCount >= 3 },
    { id: "deliverability-war-room-check-2", label: 'Policy depth', ok: snapshot.validation.ok },
    { id: "deliverability-war-room-check-3", label: 'Narratives available', ok: snapshot.narratives.length >= 4 }
  ];
}

export function createDeliverabilityWarRoomApiDocument(snapshot = buildDeliverabilityWarRoomSnapshot()) {
  return {
    id: "deliverability-war-room-api",
    headline: snapshot.summary.name + ' API contract',
    endpoints: [
      { method: 'GET', path: '/api/deliverability-war-room/overview' },
      { method: 'POST', path: '/api/deliverability-war-room/validate' },
      { method: 'GET', path: '/api/deliverability-war-room/policies' }
    ],
    checklist: createDeliverabilityWarRoomChecklist(snapshot)
  };
}

