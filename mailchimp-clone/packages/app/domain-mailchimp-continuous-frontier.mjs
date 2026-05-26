import { persistState } from './storage.mjs';
import { createId, nowIso } from './utils.mjs';
import { recordAudit } from './domain-core.mjs';

export const MAILCHIMP_CONTINUOUS_FRONTIER_RUNTIME_CONTRACT = Object.freeze({
  surfaceId: 'mailchimp_continuous_frontier_runtime_layer',
  label: 'Mailchimp continuous frontier runtime for official-surface subtranche workstreams',
  controls: [
    'frontier_surface_run_ledger',
    'frontier_evidence_event_ledger',
    'frontier_dimension_workflow_state',
    'frontier_runtime_snapshots',
    'frontier_runtime_api_evidence'
  ],
  evidenceContract: [
    'frontier_runs_bind_to_official_mailchimp_surface_labels',
    'frontier_runs_track_strict_gap_and_dimension',
    'frontier_evidence_events_capture_workflow_state',
    'frontier_snapshots_are_durable',
    'normal_ops_route_adoption'
  ]
});

function ensureFrontierState(state) {
  state.db.mailchimpFrontierSurfaceRuns ||= [];
  state.db.mailchimpFrontierEvidenceEvents ||= [];
  state.db.mailchimpFrontierRuntimeSnapshots ||= [];
  return state;
}

function normalizeList(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  const raw = String(value || '').trim();
  if (!raw) return [];
  if (raw.startsWith('[')) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter(Boolean).map(String);
    } catch {
      // Fall back to legacy comma-delimited form input below.
    }
  }
  return raw.split(',').map((entry) => entry.trim()).filter(Boolean);
}

export function recordMailchimpFrontierRuntimeSlice(state, actor, body = {}) {
  ensureFrontierState(state);
  const officialLabels = normalizeList(body.officialLabels || body.sourceLabels || body.officialSurface || 'Mailchimp official surface');
  const run = {
    id: createId('mfront'),
    workspaceId: actor.workspace.id,
    surfaceId: body.surfaceId || body.parentSurfaceId || 'mailchimp_frontier_surface',
    strictGap: body.strictGap || '',
    officialSurface: body.officialSurface || officialLabels[0] || 'Mailchimp surface',
    officialLabels,
    proofDimension: body.proofDimension || body.dimension || 'runtime_depth',
    workflowState: body.workflowState || 'queued_for_product_proof',
    priority: body.priority || 'medium',
    notes: body.notes || '',
    createdBy: actor.user.id,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    evidenceEventIds: []
  };
  state.db.mailchimpFrontierSurfaceRuns.unshift(run);
  state.db.mailchimpFrontierSurfaceRuns = state.db.mailchimpFrontierSurfaceRuns.slice(0, 1000);
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'mailchimp-frontier-runtime-slice', detail: `${run.surfaceId} ${run.proofDimension}` });
  return run;
}

export function recordMailchimpFrontierEvidenceEvent(state, actor, body = {}) {
  ensureFrontierState(state);
  const run = state.db.mailchimpFrontierSurfaceRuns.find((entry) => entry.id === body.runId && entry.workspaceId === actor.workspace.id) || null;
  const event = {
    id: createId('mfrontev'),
    workspaceId: actor.workspace.id,
    runId: run?.id || body.runId || '',
    surfaceId: run?.surfaceId || body.surfaceId || '',
    eventType: body.eventType || 'workflow_evidence_recorded',
    evidenceLabel: body.evidenceLabel || 'frontier workflow evidence',
    evidenceStatus: body.evidenceStatus || 'observed',
    detail: body.detail || '',
    recordedBy: actor.user.id,
    recordedAt: nowIso()
  };
  state.db.mailchimpFrontierEvidenceEvents.unshift(event);
  state.db.mailchimpFrontierEvidenceEvents = state.db.mailchimpFrontierEvidenceEvents.slice(0, 2000);
  if (run) {
    run.workflowState = body.workflowState || run.workflowState || 'evidence_recorded';
    run.evidenceEventIds ||= [];
    run.evidenceEventIds.unshift(event.id);
    run.evidenceEventIds = run.evidenceEventIds.slice(0, 25);
    run.updatedAt = event.recordedAt;
  }
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'mailchimp-frontier-evidence-event', detail: `${event.surfaceId} ${event.eventType}` });
  return event;
}

export function buildMailchimpContinuousFrontierRuntimeSnapshot(state, workspaceId) {
  ensureFrontierState(state);
  const runs = state.db.mailchimpFrontierSurfaceRuns.filter((entry) => entry.workspaceId === workspaceId);
  const events = state.db.mailchimpFrontierEvidenceEvents.filter((entry) => entry.workspaceId === workspaceId);
  const snapshots = state.db.mailchimpFrontierRuntimeSnapshots.filter((entry) => entry.workspaceId === workspaceId);
  const dimensionCounts = runs.reduce((acc, run) => {
    acc[run.proofDimension] = (acc[run.proofDimension] || 0) + 1;
    return acc;
  }, {});
  const officialSurfaceCounts = runs.reduce((acc, run) => {
    acc[run.officialSurface] = (acc[run.officialSurface] || 0) + 1;
    return acc;
  }, {});
  return {
    ...MAILCHIMP_CONTINUOUS_FRONTIER_RUNTIME_CONTRACT,
    generatedAt: nowIso(),
    workspaceId,
    runCount: runs.length,
    evidenceEventCount: events.length,
    snapshotCount: snapshots.length,
    distinctSurfaceCount: new Set(runs.map((entry) => entry.surfaceId)).size,
    dimensionCounts,
    officialSurfaceCounts,
    recentRuns: runs.slice(0, 25),
    recentEvidenceEvents: events.slice(0, 25),
    runtimeHealth: {
      runLedgerReady: runs.length > 0,
      evidenceLedgerReady: events.length > 0,
      officialSurfaceAnchorReady: runs.some((entry) => entry.officialLabels?.length),
      snapshotReady: snapshots.length > 0,
      apiReady: true
    }
  };
}

export function persistMailchimpContinuousFrontierRuntimeSnapshot(state, actor, reason = 'manual_mailchimp_frontier_runtime_snapshot') {
  ensureFrontierState(state);
  const snapshot = buildMailchimpContinuousFrontierRuntimeSnapshot(state, actor.workspace.id);
  const entry = { id: createId('mfrontsnap'), reason, recordedAt: nowIso(), userId: actor.user.id, ...snapshot };
  state.db.mailchimpFrontierRuntimeSnapshots.unshift(entry);
  state.db.mailchimpFrontierRuntimeSnapshots = state.db.mailchimpFrontierRuntimeSnapshots.slice(0, 200);
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'mailchimp-frontier-runtime-snapshot', detail: 'Captured Mailchimp frontier runtime snapshot' });
  return entry;
}
