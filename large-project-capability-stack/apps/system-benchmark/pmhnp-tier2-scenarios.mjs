export const PMHNP_TIER2_SCENARIOS = Object.freeze([
  {
    id: 'config_runtime_contract',
    label: 'Config runtime contract honors environment wiring',
    allowedFiles: ['src/config.mjs']
  },
  {
    id: 'approval_queue_lifecycle',
    label: 'Approval queue create, approve, reject lifecycle',
    allowedFiles: ['src/domain/approvalQueue.mjs']
  },
  {
    id: 'client_portal_snapshot_aggregation',
    label: 'Client portal snapshot aggregates live onboarding state',
    allowedFiles: ['src/domain/clientPortal.mjs']
  },
  {
    id: 'denial_scoring_feedback_learning',
    label: 'Denial workbench scoring, feedback, and worklist ingestion',
    allowedFiles: ['src/domain/denialWorkbench.mjs']
  },
  {
    id: 'pilot_metrics_rollup',
    label: 'Pilot baseline, events, and report rollup',
    allowedFiles: ['src/domain/pilotMetrics.mjs']
  },
  {
    id: 'public_intake_hybrid',
    label: 'Public intake handles admin-assisted and export-upload flows',
    allowedFiles: ['src/domain/publicIntake.mjs']
  },
  {
    id: 'tebra_onboarding_live_read',
    label: 'Tebra onboarding live-read approval and mapping workflow',
    allowedFiles: ['src/domain/tebraOnboarding.mjs']
  },
  {
    id: 'http_server_auth_guards',
    label: 'HTTP server enforces TLS and auth route behavior',
    allowedFiles: ['src/http/createServer.mjs']
  },
  {
    id: 'audit_log_roundtrip',
    label: 'Audit library appends and lists audit events',
    allowedFiles: ['src/lib/audit.mjs']
  },
  {
    id: 'auth_token_scope_contract',
    label: 'Auth token library issues and verifies scoped tokens',
    allowedFiles: ['src/lib/authTokens.mjs']
  },
  {
    id: 'storage_roundtrip',
    label: 'Storage library JSON and NDJSON roundtrip',
    allowedFiles: ['src/lib/storage.mjs']
  },
  {
    id: 'ops_server_startup_surface',
    label: 'Operational server startup surface serves health and client session',
    allowedFiles: ['src/ops/operationalHttpServerCli.mjs']
  }
]);

export function getTier2Scenario(id) {
  return PMHNP_TIER2_SCENARIOS.find((entry) => entry.id === id) || null;
}
