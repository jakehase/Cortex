export const surfaceId = "aios_verifier-claim-gate_evidence-replay_068";
export const surfaceGroup = "verifier-claim-gate";
export const surfaceName = "evidence-replay";

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_BACKOFF_MS = 250;
const DEFAULT_MAX_BACKOFF_MS = 5_000;
const HISTORY_SNAPSHOT_LIMIT = 8;
const EXPORT_HISTORY_LIMIT = 10;
const COMMAND_LEDGER_LIMIT = 24;
const COMMAND_LEDGER_STATES = new Set(['applied', 'completed', 'rejected', 'duplicate', 'abandoned']);
const REPORTING_TIMELINE_LIMIT = 50;
const REPORTING_BUCKETS = new Set(['status', 'source', 'sourceType', 'severity']);
const EXPORT_FORMATS = new Set(['json', 'ndjson', 'csv']);
const EXPORT_HISTORY_STATES = new Set(['prepared', 'published', 'acked', 'failed', 'skipped', 'blocked', 'duplicate']);
const INTEGRATION_PROVIDER_PROTOCOLS = new Set(['hosted-kernel', 'webhook', 'queue']);
const INTEGRATION_PROVIDER_CAPABILITIES = new Set([
  'evidence.replay',
  'receipt.verify',
  'claimGate.handoff',
  'audit.export',
  'sync.cursor'
]);
const INTEGRATION_PROVIDER_ACK_MODES = new Set(['none', 'cursor', 'receipt']);
const INTEGRATION_PROVIDER_ACK_FIELDS = new Set([
  'providerId',
  'serviceId',
  'operationId',
  'idempotencyKey',
  'syncDigest',
  'cursor',
  'acceptedAt'
]);
const INTEGRATION_PROVIDER_OPERATIONS = {
  'receipt.verify': 'receipt.verify',
  'evidence.replay': 'evidence.replay',
  'audit.export': 'audit.export',
  'claimGate.handoff': 'claimGate.handoff',
  'sync.cursor': 'sync.cursor'
};
const DEFAULT_PROVIDER_ACK_TIMEOUT_MS = 30_000;
const MAX_PROVIDER_ACK_TIMEOUT_MS = 10 * 60 * 1000;
const STALE_PERSISTED_STATE_MS = 15 * 60 * 1000;
const MIN_SCHEDULE_INTERVAL_MS = 60_000;
const RECOVERY_JOURNAL_LIMIT = 12;
const RECOVERY_RUN_STATES = new Set(['pending', 'running', 'completed', 'failed', 'abandoned']);
const CLIENT_REPLAY_MODES = new Set(['inspect', 'run', 'handoff']);
const CLIENT_WORKFLOW_STEPS = new Set([
  'collect-evidence',
  'replay-evidence',
  'review-proof',
  'open-claim-gate'
]);
const WORKSPACE_SCOPE_MODES = new Set(['strict', 'advisory']);
const BOUNDARY_ROLES = new Set(['viewer', 'verifier', 'operator', 'auditor', 'admin']);
const BOUNDARY_PERMISSIONS = new Set([
  'evidence:read',
  'evidence:replay',
  'claim-gate:handoff',
  'claim-gate:open',
  'lifecycle:write',
  'audit:export'
]);
const ROLE_PERMISSIONS = {
  viewer: ['evidence:read'],
  auditor: ['evidence:read', 'audit:export'],
  verifier: ['evidence:read', 'evidence:replay', 'audit:export'],
  operator: ['evidence:read', 'evidence:replay', 'claim-gate:handoff', 'audit:export'],
  admin: ['evidence:read', 'evidence:replay', 'claim-gate:handoff', 'claim-gate:open', 'lifecycle:write', 'audit:export']
};
const LIFECYCLE_COMMANDS = new Set([
  'status',
  'enable',
  'disable',
  'pause',
  'resume',
  'run-now',
  'schedule'
]);
const LIFECYCLE_SCHEDULE_MODES = new Set(['manual', 'interval', 'at']);
const LIFECYCLE_DISABLE_POLICIES = new Set(['preserve-schedule', 'clear-schedule']);
const LIFECYCLE_PAUSE_POLICIES = new Set(['keep-schedule', 'hold-schedule']);
const LIFECYCLE_MISSED_RUN_POLICIES = new Set(['skip', 'run-once', 'catch-up']);
const LIFECYCLE_WINDOW_FIELDS = new Set(['disabledUntil', 'pausedUntil']);
const DEFAULT_SCHEDULE_MISSED_RUN_POLICY = 'run-once';
const DEFAULT_SCHEDULE_MAX_CATCH_UP_RUNS = 1;
const MAX_SCHEDULE_CATCH_UP_RUNS = 10;
const RECOVERABLE_FAILURES = new Set([
  'timeout',
  'transient_unavailable',
  'rate_limited',
  'dependency_unhealthy'
]);
const OPERATIONAL_HEALTH_COMPONENTS = new Set([
  'receipt-verifier',
  'replay-worker',
  'audit-export',
  'provider-sync',
  'claim-gate'
]);
const OPERATIONAL_HEALTH_STATES = new Set(['healthy', 'degraded', 'unhealthy', 'unknown']);
const OPERATIONAL_CIRCUIT_STATES = new Set(['closed', 'half-open', 'open']);
const DEFAULT_OPERATIONAL_HEARTBEAT_MAX_AGE_MS = 2 * 60 * 1000;
const OPERATIONAL_COMPONENT_REQUIREMENTS = {
  'receipt-verifier': 'receipt verification is required for every hosted-kernel evidence replay evaluation',
  'replay-worker': 'replay execution is required for run-now and due scheduled replay requests',
  'audit-export': 'audit export is required before replay results leave the tenant boundary',
  'provider-sync': 'provider sync is required for cursor-backed external handoff idempotency',
  'claim-gate': 'claim-gate health is required before acceptance handoff can open the gate'
};
const EVIDENCE_SOURCE_TYPES = new Set([
  'verifier-observation',
  'kernel-receipt',
  'claim-gate-proof',
  'audit-log'
]);

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function proofDigest(value) {
  const source = stableStringify(value);
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function normalizeEvidenceSourceReceipt(entry, index, boundary, claimId, proof) {
  const raw = entry.sourceReceipt && typeof entry.sourceReceipt === 'object' && !Array.isArray(entry.sourceReceipt)
    ? entry.sourceReceipt
    : entry.receipt && typeof entry.receipt === 'object' && !Array.isArray(entry.receipt)
      ? entry.receipt
      : null;

  if (!raw) {
    return {
      ok: false,
      error: {
        code: 'EVIDENCE_SOURCE_RECEIPT_REQUIRED',
        path: `evidence[${index}].sourceReceipt`,
        claimId,
        message: 'Replay evidence requires a source receipt that binds the claim proof to a hosted-kernel verifier source.',
        action: 'Attach sourceReceipt with sourceType, sourceId, issuedAt, signer, and digest before replaying the claim.'
      }
    };
  }

  const sourceType = typeof raw.sourceType === 'string' && raw.sourceType.trim() ? raw.sourceType.trim() : null;
  const sourceId = typeof raw.sourceId === 'string' && raw.sourceId.trim() ? raw.sourceId.trim() : null;
  const signer = typeof raw.signer === 'string' && raw.signer.trim() ? raw.signer.trim() : null;
  const issuedAt = typeof raw.issuedAt === 'string' && raw.issuedAt.trim() ? raw.issuedAt.trim() : null;
  const tenantId = typeof raw.tenantId === 'string' && raw.tenantId.trim() ? raw.tenantId.trim() : boundary.tenantId;
  const workspaceId = typeof raw.workspaceId === 'string' && raw.workspaceId.trim() ? raw.workspaceId.trim() : boundary.workspaceId;
  const expectedDigest = proofDigest({ tenantId, workspaceId, claimId, proof });
  const receiptDigest = typeof raw.digest === 'string' && raw.digest.trim() ? raw.digest.trim() : expectedDigest;
  const errors = [];

  if (!sourceType || !EVIDENCE_SOURCE_TYPES.has(sourceType)) {
    errors.push({
      code: 'EVIDENCE_SOURCE_TYPE_INVALID',
      path: `evidence[${index}].sourceReceipt.sourceType`,
      claimId,
      message: `Unsupported evidence source receipt type: ${sourceType || 'missing'}.`,
      action: 'Use verifier-observation, kernel-receipt, claim-gate-proof, or audit-log source receipts.'
    });
  }
  if (!sourceId) {
    errors.push({
      code: 'EVIDENCE_SOURCE_ID_REQUIRED',
      path: `evidence[${index}].sourceReceipt.sourceId`,
      claimId,
      message: 'Evidence source receipt is missing sourceId.',
      action: 'Bind the proof to the verifier, kernel receipt, claim-gate proof, or audit log source id.'
    });
  }
  if (!signer) {
    errors.push({
      code: 'EVIDENCE_SOURCE_SIGNER_REQUIRED',
      path: `evidence[${index}].sourceReceipt.signer`,
      claimId,
      message: 'Evidence source receipt is missing signer.',
      action: 'Attach the hosted-kernel principal that signed or emitted the evidence source receipt.'
    });
  }
  if (!issuedAt || Number.isNaN(Date.parse(issuedAt))) {
    errors.push({
      code: 'EVIDENCE_SOURCE_ISSUED_AT_INVALID',
      path: `evidence[${index}].sourceReceipt.issuedAt`,
      claimId,
      message: 'Evidence source receipt issuedAt must be a parseable ISO timestamp.',
      action: 'Attach the source receipt issue time so replay ordering can be audited.'
    });
  }
  if (boundary.tenantId && tenantId !== boundary.tenantId) {
    errors.push({
      code: 'EVIDENCE_SOURCE_TENANT_BOUNDARY_MISMATCH',
      path: `evidence[${index}].sourceReceipt.tenantId`,
      claimId,
      message: 'Evidence source receipt tenantId does not match the active tenant boundary.',
      action: 'Replay only receipts issued for the active boundary.tenantId.'
    });
  }
  if (boundary.workspaceId && workspaceId !== boundary.workspaceId) {
    errors.push({
      code: 'EVIDENCE_SOURCE_WORKSPACE_BOUNDARY_MISMATCH',
      path: `evidence[${index}].sourceReceipt.workspaceId`,
      claimId,
      message: 'Evidence source receipt workspaceId does not match the active workspace boundary.',
      action: 'Replay only receipts issued for the active boundary.workspaceId.'
    });
  }
  if (raw.digest !== undefined && receiptDigest !== expectedDigest) {
    errors.push({
      code: 'EVIDENCE_SOURCE_DIGEST_MISMATCH',
      path: `evidence[${index}].sourceReceipt.digest`,
      claimId,
      message: 'Evidence source receipt digest does not match the submitted proof payload.',
      action: 'Recompute the receipt digest from tenantId, workspaceId, claimId, and proof before replay.'
    });
  }

  if (errors.length > 0) {
    return { ok: false, error: errors[0] };
  }

  return {
    ok: true,
    value: {
      contract: 'hosted-kernel evidence source receipt/v1',
      sourceType,
      sourceId,
      signer,
      issuedAt,
      tenantId,
      workspaceId,
      digest: receiptDigest,
      verified: true
    }
  };
}

function normalizeBoundaryContext(input, clientState) {
  const raw = input.boundary && typeof input.boundary === 'object' && !Array.isArray(input.boundary)
    ? input.boundary
    : input.workspace && typeof input.workspace === 'object' && !Array.isArray(input.workspace)
      ? input.workspace
      : {};
  const tenantId = typeof raw.tenantId === 'string' && raw.tenantId.trim()
    ? raw.tenantId.trim()
    : typeof input.tenantId === 'string' && input.tenantId.trim()
      ? input.tenantId.trim()
      : null;
  const workspaceId = typeof raw.workspaceId === 'string' && raw.workspaceId.trim()
    ? raw.workspaceId.trim()
    : typeof input.workspaceId === 'string' && input.workspaceId.trim()
      ? input.workspaceId.trim()
      : null;
  const actorId = typeof raw.actorId === 'string' && raw.actorId.trim()
    ? raw.actorId.trim()
    : clientState.requestedBy;
  const roles = Array.isArray(raw.roles)
    ? [...new Set(raw.roles.filter((role) => typeof role === 'string' && role.trim()).map((role) => role.trim()))]
    : [];
  const explicitPermissions = Array.isArray(raw.permissions)
    ? raw.permissions.filter((permission) => typeof permission === 'string' && permission.trim()).map((permission) => permission.trim())
    : [];
  const rolePermissions = roles.flatMap((role) => ROLE_PERMISSIONS[role] || []);
  const permissions = [...new Set(rolePermissions.concat(explicitPermissions))].sort();
  const errors = [];

  if (!tenantId) {
    errors.push({
      code: 'TENANT_ID_REQUIRED',
      path: 'boundary.tenantId',
      message: 'Evidence replay requires an explicit tenantId boundary.',
      action: 'Pass boundary.tenantId so replay evidence cannot cross tenant isolation boundaries.'
    });
  }
  if (!workspaceId) {
    errors.push({
      code: 'WORKSPACE_ID_REQUIRED',
      path: 'boundary.workspaceId',
      message: 'Evidence replay requires an explicit workspaceId boundary.',
      action: 'Pass boundary.workspaceId for the workspace that owns the claim-gate evidence.'
    });
  }
  for (const role of roles) {
    if (!BOUNDARY_ROLES.has(role)) {
      errors.push({
        code: 'BOUNDARY_ROLE_INVALID',
        path: 'boundary.roles',
        message: `Unsupported evidence replay boundary role: ${role}.`,
        action: 'Use viewer, verifier, operator, auditor, or admin roles for hosted-kernel evidence replay.'
      });
    }
  }
  for (const permission of explicitPermissions) {
    if (!BOUNDARY_PERMISSIONS.has(permission)) {
      errors.push({
        code: 'BOUNDARY_PERMISSION_INVALID',
        path: 'boundary.permissions',
        message: `Unsupported evidence replay boundary permission: ${permission}.`,
        action: 'Use hosted-kernel evidence replay permissions from the boundary contract.'
      });
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    contract: 'hosted-kernel evidence replay tenant boundary/v1',
    tenantId,
    workspaceId,
    actorId,
    roles,
    permissions,
    canReplay: permissions.includes('evidence:replay'),
    canHandoff: permissions.includes('claim-gate:handoff') || permissions.includes('claim-gate:open'),
    canOpenClaimGate: permissions.includes('claim-gate:open'),
    canWriteLifecycle: permissions.includes('lifecycle:write'),
    canExportAudit: permissions.includes('audit:export')
  };
}

function boundaryPermissionErrors(boundary, clientState, lifecycle) {
  const errors = [];
  if ((clientState.replayMode === 'run' || lifecycle.runRequested || lifecycle.schedule.due) && !boundary.canReplay) {
    errors.push({
      code: 'EVIDENCE_REPLAY_PERMISSION_DENIED',
      path: 'boundary.permissions',
      message: 'The current actor cannot run hosted-kernel evidence replay.',
      action: 'Grant evidence:replay through a verifier, operator, or admin boundary role before replaying evidence.'
    });
  }
  if (clientState.replayMode === 'handoff' && !boundary.canHandoff) {
    errors.push({
      code: 'CLAIM_GATE_HANDOFF_PERMISSION_DENIED',
      path: 'boundary.permissions',
      message: 'The current actor cannot hand off replay results to the claim gate.',
      action: 'Grant claim-gate:handoff or claim-gate:open before requesting handoff mode.'
    });
  }
  if (clientState.workflowStep === 'open-claim-gate' && !boundary.canOpenClaimGate) {
    errors.push({
      code: 'CLAIM_GATE_OPEN_PERMISSION_DENIED',
      path: 'boundary.permissions',
      message: 'The current actor cannot open the hosted-kernel claim gate.',
      action: 'Grant claim-gate:open to an admin boundary role before opening the claim gate.'
    });
  }
  if (lifecycle.command !== 'status' && !boundary.canWriteLifecycle) {
    errors.push({
      code: 'LIFECYCLE_WRITE_PERMISSION_DENIED',
      path: 'boundary.permissions',
      message: 'The current actor cannot mutate evidence replay lifecycle controls.',
      action: 'Grant lifecycle:write before issuing enable, disable, pause, resume, run-now, or schedule commands.'
    });
  }
  return errors;
}

function normalizeWorkspaceScopePolicy(input, boundary) {
  const raw = input.workspaceScope && typeof input.workspaceScope === 'object' && !Array.isArray(input.workspaceScope)
    ? input.workspaceScope
    : input.claimScope && typeof input.claimScope === 'object' && !Array.isArray(input.claimScope)
      ? input.claimScope
      : input.boundary?.workspaceScope && typeof input.boundary.workspaceScope === 'object' && !Array.isArray(input.boundary.workspaceScope)
        ? input.boundary.workspaceScope
        : {};
  const mode = typeof raw.mode === 'string' && raw.mode.trim() ? raw.mode.trim() : 'strict';
  const tenantId = typeof raw.tenantId === 'string' && raw.tenantId.trim() ? raw.tenantId.trim() : boundary.tenantId;
  const workspaceId = typeof raw.workspaceId === 'string' && raw.workspaceId.trim() ? raw.workspaceId.trim() : boundary.workspaceId;
  const allowedClaimPrefixes = Array.isArray(raw.allowedClaimPrefixes)
    ? [...new Set(raw.allowedClaimPrefixes.filter((prefix) => typeof prefix === 'string' && prefix.trim()).map((prefix) => prefix.trim()))]
    : [];
  const allowedSourceTypes = Array.isArray(raw.allowedSourceTypes)
    ? [...new Set(raw.allowedSourceTypes.filter((sourceType) => typeof sourceType === 'string' && sourceType.trim()).map((sourceType) => sourceType.trim()))]
    : [];
  const requiredSourceIds = Array.isArray(raw.requiredSourceIds)
    ? [...new Set(raw.requiredSourceIds.filter((sourceId) => typeof sourceId === 'string' && sourceId.trim()).map((sourceId) => sourceId.trim()))]
    : [];
  const maxReplayClaims = Number.isInteger(raw.maxReplayClaims) && raw.maxReplayClaims >= 0 ? raw.maxReplayClaims : null;
  const errors = [];

  if (!WORKSPACE_SCOPE_MODES.has(mode)) {
    errors.push({
      code: 'WORKSPACE_SCOPE_MODE_INVALID',
      path: 'workspaceScope.mode',
      message: `Unsupported workspace scope mode: ${mode}.`,
      action: 'Use strict to block out-of-scope evidence or advisory to emit scoped audit evidence without blocking replay.'
    });
  }
  if (raw.allowedClaimPrefixes !== undefined && !Array.isArray(raw.allowedClaimPrefixes)) {
    errors.push({
      code: 'WORKSPACE_SCOPE_CLAIM_PREFIXES_INVALID',
      path: 'workspaceScope.allowedClaimPrefixes',
      message: 'Workspace scope allowedClaimPrefixes must be an array of non-empty strings.',
      action: 'Send the claim id prefixes owned by this workspace as workspaceScope.allowedClaimPrefixes.'
    });
  }
  if (raw.allowedSourceTypes !== undefined && !Array.isArray(raw.allowedSourceTypes)) {
    errors.push({
      code: 'WORKSPACE_SCOPE_SOURCE_TYPES_INVALID',
      path: 'workspaceScope.allowedSourceTypes',
      message: 'Workspace scope allowedSourceTypes must be an array of evidence source type strings.',
      action: 'Send allowedSourceTypes as verifier-observation, kernel-receipt, claim-gate-proof, and/or audit-log.'
    });
  }
  if (raw.requiredSourceIds !== undefined && !Array.isArray(raw.requiredSourceIds)) {
    errors.push({
      code: 'WORKSPACE_SCOPE_SOURCE_IDS_INVALID',
      path: 'workspaceScope.requiredSourceIds',
      message: 'Workspace scope requiredSourceIds must be an array of hosted-kernel source ids.',
      action: 'Send requiredSourceIds as the verifier or audit source ids trusted for this workspace.'
    });
  }
  for (const sourceType of allowedSourceTypes) {
    if (!EVIDENCE_SOURCE_TYPES.has(sourceType)) {
      errors.push({
        code: 'WORKSPACE_SCOPE_SOURCE_TYPE_UNSUPPORTED',
        path: 'workspaceScope.allowedSourceTypes',
        message: `Workspace scope references unsupported source type: ${sourceType}.`,
        action: 'Use verifier-observation, kernel-receipt, claim-gate-proof, or audit-log source types.'
      });
    }
  }
  if (raw.maxReplayClaims !== undefined && (!Number.isInteger(raw.maxReplayClaims) || raw.maxReplayClaims < 0)) {
    errors.push({
      code: 'WORKSPACE_SCOPE_MAX_CLAIMS_INVALID',
      path: 'workspaceScope.maxReplayClaims',
      message: 'Workspace scope maxReplayClaims must be a non-negative integer.',
      action: 'Use maxReplayClaims to bound replay fanout inside a workspace, or omit it.'
    });
  }
  if (boundary.tenantId && tenantId !== boundary.tenantId) {
    errors.push({
      code: 'WORKSPACE_SCOPE_TENANT_BOUNDARY_MISMATCH',
      path: 'workspaceScope.tenantId',
      message: 'Workspace scope tenantId does not match the active replay boundary.',
      action: 'Attach only workspace scope policies issued for the active boundary.tenantId.'
    });
  }
  if (boundary.workspaceId && workspaceId !== boundary.workspaceId) {
    errors.push({
      code: 'WORKSPACE_SCOPE_WORKSPACE_BOUNDARY_MISMATCH',
      path: 'workspaceScope.workspaceId',
      message: 'Workspace scope workspaceId does not match the active replay boundary.',
      action: 'Attach only workspace scope policies issued for the active boundary.workspaceId.'
    });
  }

  return {
    contract: 'hosted-kernel evidence replay workspace scope/v1',
    ok: errors.length === 0,
    errors,
    mode: WORKSPACE_SCOPE_MODES.has(mode) ? mode : 'strict',
    enforced: mode !== 'advisory',
    tenantId,
    workspaceId,
    allowedClaimPrefixes,
    allowedSourceTypes: allowedSourceTypes.filter((sourceType) => EVIDENCE_SOURCE_TYPES.has(sourceType)),
    requiredSourceIds,
    maxReplayClaims,
    policyDigest: proofDigest({
      tenantId,
      workspaceId,
      mode,
      allowedClaimPrefixes,
      allowedSourceTypes,
      requiredSourceIds,
      maxReplayClaims
    })
  };
}

function workspaceScopeRecordErrors(records, workspaceScope) {
  const violations = [];
  if (workspaceScope.maxReplayClaims !== null && records.length > workspaceScope.maxReplayClaims) {
    violations.push({
      code: 'WORKSPACE_SCOPE_REPLAY_CLAIM_LIMIT_EXCEEDED',
      path: 'workspaceScope.maxReplayClaims',
      message: 'Replay evidence exceeds the workspace claim replay limit.',
      action: 'Reduce evidence to the workspace-scoped claim set or raise workspaceScope.maxReplayClaims through policy.'
    });
  }

  for (const record of records) {
    if (workspaceScope.allowedClaimPrefixes.length > 0
      && !workspaceScope.allowedClaimPrefixes.some((prefix) => record.claimId.startsWith(prefix))) {
      violations.push({
        code: 'WORKSPACE_SCOPE_CLAIM_OUT_OF_SCOPE',
        path: 'evidence[].claimId',
        claimId: record.claimId,
        message: 'Claim id is outside the workspace allowed claim prefix policy.',
        action: 'Replay only claims whose ids are owned by workspaceScope.allowedClaimPrefixes.'
      });
    }
    if (workspaceScope.allowedSourceTypes.length > 0
      && !workspaceScope.allowedSourceTypes.includes(record.sourceReceipt.sourceType)) {
      violations.push({
        code: 'WORKSPACE_SCOPE_SOURCE_TYPE_OUT_OF_SCOPE',
        path: 'evidence[].sourceReceipt.sourceType',
        claimId: record.claimId,
        message: 'Evidence source type is outside the workspace source type policy.',
        action: 'Replay only evidence source types allowed by workspaceScope.allowedSourceTypes.'
      });
    }
    if (workspaceScope.requiredSourceIds.length > 0
      && !workspaceScope.requiredSourceIds.includes(record.sourceReceipt.sourceId)) {
      violations.push({
        code: 'WORKSPACE_SCOPE_SOURCE_ID_OUT_OF_SCOPE',
        path: 'evidence[].sourceReceipt.sourceId',
        claimId: record.claimId,
        message: 'Evidence source id is not trusted by the active workspace scope policy.',
        action: 'Use a sourceReceipt.sourceId listed in workspaceScope.requiredSourceIds for this workspace.'
      });
    }
  }

  return violations.map((violation) => ({
    ...violation,
    severity: workspaceScope.enforced ? 'error' : 'warning',
    blocking: workspaceScope.enforced
  }));
}

function normalizeEvidenceEntry(entry, index, boundary) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return {
      ok: false,
      error: {
        code: 'EVIDENCE_ENTRY_INVALID',
        path: `evidence[${index}]`,
        message: 'Evidence entry must be an object with a claimId and proof payload.',
        action: 'Provide replay evidence as structured records instead of primitive values.'
      }
    };
  }

  const claimId = typeof entry.claimId === 'string' && entry.claimId.trim()
    ? entry.claimId.trim()
    : null;
  const proof = entry.proof ?? entry.evidence ?? entry.payload;
  const status = typeof entry.status === 'string' ? entry.status : 'observed';
  const failureType = typeof entry.failureType === 'string' ? entry.failureType : null;
  const tenantId = typeof entry.tenantId === 'string' && entry.tenantId.trim() ? entry.tenantId.trim() : boundary.tenantId;
  const workspaceId = typeof entry.workspaceId === 'string' && entry.workspaceId.trim() ? entry.workspaceId.trim() : boundary.workspaceId;
  const source = typeof entry.source === 'string' && entry.source.trim() ? entry.source.trim() : 'unknown';

  if (!claimId) {
    return {
      ok: false,
      error: {
        code: 'CLAIM_ID_REQUIRED',
        path: `evidence[${index}].claimId`,
        message: 'Replay evidence is missing a non-empty claimId.',
        action: 'Attach the verifier claim id before submitting replay evidence.'
      }
    };
  }
  if (boundary.tenantId && tenantId !== boundary.tenantId) {
    return {
      ok: false,
      error: {
        code: 'EVIDENCE_TENANT_BOUNDARY_MISMATCH',
        path: `evidence[${index}].tenantId`,
        claimId,
        message: 'Replay evidence tenantId does not match the active tenant boundary.',
        action: 'Submit only evidence owned by the active boundary.tenantId.'
      }
    };
  }
  if (boundary.workspaceId && workspaceId !== boundary.workspaceId) {
    return {
      ok: false,
      error: {
        code: 'EVIDENCE_WORKSPACE_BOUNDARY_MISMATCH',
        path: `evidence[${index}].workspaceId`,
        claimId,
        message: 'Replay evidence workspaceId does not match the active workspace boundary.',
        action: 'Submit only evidence owned by the active boundary.workspaceId.'
      }
    };
  }

  if (proof === undefined || proof === null) {
    return {
      ok: false,
      error: {
        code: 'PROOF_PAYLOAD_REQUIRED',
        path: `evidence[${index}].proof`,
        claimId,
        message: 'Replay evidence is missing a proof payload.',
        action: 'Attach the source-backed proof payload, receipt, or observation used by the verifier.'
      }
    };
  }

  const sourceReceipt = normalizeEvidenceSourceReceipt(entry, index, boundary, claimId, proof);
  if (!sourceReceipt.ok) {
    return sourceReceipt;
  }

  const attempts = Number.isInteger(entry.attempts) && entry.attempts > 0 ? entry.attempts : 1;
  return {
    ok: true,
    value: {
      claimId,
      tenantId,
      workspaceId,
      sequence: Number.isFinite(entry.sequence) ? Number(entry.sequence) : index,
      status,
      failureType,
      attempts,
      source,
      observedAt: typeof entry.observedAt === 'string' ? entry.observedAt : null,
      proof,
      proofDigest: proofDigest({ tenantId, workspaceId, claimId, proof }),
      sourceReceipt: sourceReceipt.value
    }
  };
}

function retryPlanFor(entry, options) {
  const maxAttempts = Number.isInteger(options.maxAttempts) && options.maxAttempts > 0
    ? options.maxAttempts
    : DEFAULT_MAX_ATTEMPTS;
  const baseBackoffMs = Number.isFinite(options.baseBackoffMs) && options.baseBackoffMs > 0
    ? options.baseBackoffMs
    : DEFAULT_BASE_BACKOFF_MS;
  const maxBackoffMs = Number.isFinite(options.maxBackoffMs) && options.maxBackoffMs > 0
    ? options.maxBackoffMs
    : DEFAULT_MAX_BACKOFF_MS;
  const recoverable = entry.status === 'failed' && RECOVERABLE_FAILURES.has(entry.failureType);
  const attemptsRemaining = Math.max(0, maxAttempts - entry.attempts);

  if (!recoverable || attemptsRemaining === 0) {
    return {
      retryable: false,
      attemptsRemaining,
      nextBackoffMs: 0,
      reason: recoverable ? 'attempt_budget_exhausted' : 'not_recoverable'
    };
  }

  return {
    retryable: true,
    attemptsRemaining,
    nextBackoffMs: Math.min(maxBackoffMs, baseBackoffMs * (2 ** Math.max(0, entry.attempts - 1))),
    reason: 'recoverable_failure'
  };
}

function buildReplayRecord(entry, options) {
  const retry = retryPlanFor(entry, options);
  const failed = entry.status === 'failed';
  const degraded = failed && retry.retryable;
  const blocked = failed && !retry.retryable;

  return {
    claimId: entry.claimId,
    tenantId: entry.tenantId,
    workspaceId: entry.workspaceId,
    sequence: entry.sequence,
    source: entry.source,
    observedAt: entry.observedAt,
    status: blocked ? 'blocked' : degraded ? 'degraded' : 'accepted',
    proofDigest: entry.proofDigest,
    sourceReceipt: {
      contract: entry.sourceReceipt.contract,
      sourceType: entry.sourceReceipt.sourceType,
      sourceId: entry.sourceReceipt.sourceId,
      signer: entry.sourceReceipt.signer,
      issuedAt: entry.sourceReceipt.issuedAt,
      digest: entry.sourceReceipt.digest,
      verified: entry.sourceReceipt.verified
    },
    audit: {
      replayed: !blocked,
      attempts: entry.attempts,
      failureType: entry.failureType,
      retry,
      sourceReceiptDigest: entry.sourceReceipt.digest
    },
    action: blocked
      ? 'Inspect the failing claim proof and resubmit corrected evidence before opening the claim gate.'
      : degraded
        ? `Retry replay after ${retry.nextBackoffMs}ms while keeping the claim gate in degraded mode.`
      : 'Evidence is replayable and can participate in claim-gate proof evaluation.'
  };
}

function replayAnalytics(records, validationErrors) {
  const byStatus = { accepted: 0, degraded: 0, blocked: 0 };
  const bySource = {};
  const bySourceType = {};
  const sourceSigners = {};
  const retry = {
    retryable: 0,
    exhausted: 0,
    maxNextBackoffMs: 0,
    totalAttemptsRemaining: 0
  };
  const blockedClaimIds = [];
  const degradedClaimIds = [];
  let totalAttempts = 0;

  for (const record of records) {
    byStatus[record.status] = (byStatus[record.status] || 0) + 1;
    bySource[record.source] = (bySource[record.source] || 0) + 1;
    bySourceType[record.sourceReceipt.sourceType] = (bySourceType[record.sourceReceipt.sourceType] || 0) + 1;
    sourceSigners[record.sourceReceipt.signer] = (sourceSigners[record.sourceReceipt.signer] || 0) + 1;
    totalAttempts += record.audit.attempts;

    if (record.status === 'blocked') {
      blockedClaimIds.push(record.claimId);
    }
    if (record.status === 'degraded') {
      degradedClaimIds.push(record.claimId);
    }
    if (record.audit.retry.retryable) {
      retry.retryable += 1;
      retry.maxNextBackoffMs = Math.max(retry.maxNextBackoffMs, record.audit.retry.nextBackoffMs);
      retry.totalAttemptsRemaining += record.audit.retry.attemptsRemaining;
    }
    if (record.audit.retry.reason === 'attempt_budget_exhausted') {
      retry.exhausted += 1;
    }
  }

  return {
    counters: {
      evidenceTotal: records.length,
      validationErrorTotal: validationErrors.length,
      acceptedTotal: byStatus.accepted,
      degradedTotal: byStatus.degraded,
      blockedTotal: byStatus.blocked,
      replayedTotal: records.filter((record) => record.audit.replayed).length,
      retryableTotal: retry.retryable,
      exhaustedRetryBudgetTotal: retry.exhausted,
      verifiedSourceReceiptTotal: records.filter((record) => record.sourceReceipt.verified).length,
      uniqueSourceSignerTotal: Object.keys(sourceSigners).length,
      averageAttempts: records.length > 0 ? Number((totalAttempts / records.length).toFixed(2)) : 0
    },
    byStatus,
    bySource,
    bySourceType,
    sourceSigners,
    retry,
    claimSets: {
      blocked: blockedClaimIds.sort(),
      degraded: degradedClaimIds.sort()
    }
  };
}

function normalizeHistorySnapshot(snapshot, index) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return null;
  }
  const generatedAt = typeof snapshot.generatedAt === 'string'
    ? snapshot.generatedAt
    : typeof snapshot.capturedAt === 'string'
      ? snapshot.capturedAt
      : `snapshot-${index}`;
  const healthState = typeof snapshot.health?.state === 'string'
    ? snapshot.health.state
    : typeof snapshot.state === 'string'
      ? snapshot.state
      : 'unknown';
  const counters = snapshot.analytics?.counters || snapshot.counters || {};

  return {
    generatedAt,
    healthState,
    proofDigest: typeof snapshot.audit?.proofDigest === 'string'
      ? snapshot.audit.proofDigest
      : typeof snapshot.proofDigest === 'string'
        ? snapshot.proofDigest
        : null,
    counters: {
      evidenceTotal: Number.isFinite(counters.evidenceTotal) ? counters.evidenceTotal : 0,
      acceptedTotal: Number.isFinite(counters.acceptedTotal) ? counters.acceptedTotal : 0,
      degradedTotal: Number.isFinite(counters.degradedTotal) ? counters.degradedTotal : 0,
      blockedTotal: Number.isFinite(counters.blockedTotal) ? counters.blockedTotal : 0,
      validationErrorTotal: Number.isFinite(counters.validationErrorTotal) ? counters.validationErrorTotal : 0
    }
  };
}

function buildHistorySnapshots(history, currentSnapshot) {
  const previous = Array.isArray(history)
    ? history.map(normalizeHistorySnapshot).filter(Boolean).slice(-HISTORY_SNAPSHOT_LIMIT)
    : [];
  const latest = previous[previous.length - 1] || null;
  const delta = latest
    ? {
        evidenceTotal: currentSnapshot.counters.evidenceTotal - latest.counters.evidenceTotal,
        acceptedTotal: currentSnapshot.counters.acceptedTotal - latest.counters.acceptedTotal,
        degradedTotal: currentSnapshot.counters.degradedTotal - latest.counters.degradedTotal,
        blockedTotal: currentSnapshot.counters.blockedTotal - latest.counters.blockedTotal,
        validationErrorTotal: currentSnapshot.counters.validationErrorTotal - latest.counters.validationErrorTotal,
        healthChanged: latest.healthState !== currentSnapshot.healthState,
        proofChanged: Boolean(latest.proofDigest && latest.proofDigest !== currentSnapshot.proofDigest)
      }
    : null;

  return {
    retained: previous.length,
    latest,
    current: currentSnapshot,
    deltaFromLatest: delta,
    snapshots: previous.concat(currentSnapshot).slice(-HISTORY_SNAPSHOT_LIMIT)
  };
}

function buildReplayTimeline(records, validationErrors, generatedAt) {
  const validationEvents = validationErrors.map((error, index) => ({
    order: index,
    at: generatedAt,
    type: 'validation_error',
    severity: 'error',
    claimId: error.claimId || null,
    summary: error.code,
    detail: error.message
  }));
  const replayEvents = records.map((record, index) => ({
    order: validationEvents.length + index,
    at: record.observedAt || generatedAt,
    type: 'evidence_replay',
    severity: record.status === 'blocked' ? 'error' : record.status === 'degraded' ? 'warning' : 'info',
    claimId: record.claimId,
    summary: record.status,
    detail: record.action,
    proofDigest: record.proofDigest,
    sourceReceiptDigest: record.sourceReceipt.digest
  }));

  return validationEvents.concat(replayEvents)
    .sort((left, right) => String(left.at).localeCompare(String(right.at)) || left.order - right.order);
}

function buildExportSummary(records, health, analytics, generatedAt) {
  return {
    format: 'hosted-kernel evidence replay export/v1',
    generatedAt,
    healthState: health.state,
    canOpenClaimGate: health.canOpenClaimGate,
    nextAction: health.nextAction,
    counters: analytics.counters,
    rows: records.map((record) => ({
      claimId: record.claimId,
      tenantId: record.tenantId,
      workspaceId: record.workspaceId,
      status: record.status,
      source: record.source,
      sourceType: record.sourceReceipt.sourceType,
      sourceId: record.sourceReceipt.sourceId,
      sourceSigner: record.sourceReceipt.signer,
      sourceReceiptDigest: record.sourceReceipt.digest,
      observedAt: record.observedAt,
      proofDigest: record.proofDigest,
      attempts: record.audit.attempts,
      retryable: record.audit.retry.retryable,
      attemptsRemaining: record.audit.retry.attemptsRemaining,
      nextBackoffMs: record.audit.retry.nextBackoffMs,
      action: record.action
    }))
  };
}

function normalizeExportHistoryEntry(entry, index) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return {
      ok: false,
      error: {
        code: 'EXPORT_HISTORY_ENTRY_INVALID',
        path: `exportHistory[${index}]`,
        message: 'Evidence replay export history entries must be objects.',
        action: 'Persist export history entries with generatedAt, state, format, rowCount, and manifestDigest.'
      }
    };
  }

  const manifest = entry.exportManifest && typeof entry.exportManifest === 'object' && !Array.isArray(entry.exportManifest)
    ? entry.exportManifest
    : {};
  const generatedAt = typeof entry.generatedAt === 'string' && entry.generatedAt.trim()
    ? entry.generatedAt.trim()
    : typeof entry.exportedAt === 'string' && entry.exportedAt.trim()
      ? entry.exportedAt.trim()
      : null;
  const format = typeof entry.format === 'string' && entry.format.trim()
    ? entry.format.trim()
    : typeof manifest.format === 'string' && manifest.format.trim()
      ? manifest.format.trim()
      : 'json';
  const state = typeof entry.state === 'string' && entry.state.trim()
    ? entry.state.trim()
    : entry.deliveredAt
      ? 'published'
      : 'prepared';
  const manifestDigest = typeof entry.manifestDigest === 'string' && entry.manifestDigest.trim()
    ? entry.manifestDigest.trim()
    : typeof manifest.manifestDigest === 'string' && manifest.manifestDigest.trim()
      ? manifest.manifestDigest.trim()
      : typeof entry.proofDigest === 'string' && entry.proofDigest.trim()
        ? entry.proofDigest.trim()
        : null;
  const rowCount = Number.isInteger(entry.rowCount) && entry.rowCount >= 0
    ? entry.rowCount
    : Number.isInteger(manifest.rowCount) && manifest.rowCount >= 0
      ? manifest.rowCount
      : 0;
  const counters = entry.counters && typeof entry.counters === 'object' && !Array.isArray(entry.counters)
    ? entry.counters
    : {};
  const errors = [];

  if (!generatedAt || Number.isNaN(Date.parse(generatedAt))) {
    errors.push({
      code: 'EXPORT_HISTORY_GENERATED_AT_INVALID',
      path: `exportHistory[${index}].generatedAt`,
      message: 'Evidence replay export history generatedAt must be a parseable ISO timestamp.',
      action: 'Persist the generatedAt value returned with each evidence replay export manifest.'
    });
  }
  if (!EXPORT_FORMATS.has(format)) {
    errors.push({
      code: 'EXPORT_HISTORY_FORMAT_INVALID',
      path: `exportHistory[${index}].format`,
      message: `Unsupported persisted evidence replay export format: ${format}.`,
      action: 'Persist export history format as json, ndjson, or csv.'
    });
  }
  if (!EXPORT_HISTORY_STATES.has(state)) {
    errors.push({
      code: 'EXPORT_HISTORY_STATE_INVALID',
      path: `exportHistory[${index}].state`,
      message: `Unsupported evidence replay export history state: ${state}.`,
      action: 'Use prepared, published, acked, failed, skipped, blocked, or duplicate for export history state.'
    });
  }
  if (!manifestDigest) {
    errors.push({
      code: 'EXPORT_HISTORY_MANIFEST_DIGEST_REQUIRED',
      path: `exportHistory[${index}].manifestDigest`,
      message: 'Evidence replay export history entry is missing manifestDigest.',
      action: 'Persist reporting.exportManifest.manifestDigest with every export history entry.'
    });
  }

  return {
    ok: errors.length === 0,
    errors,
    value: {
      generatedAt,
      state: EXPORT_HISTORY_STATES.has(state) ? state : 'failed',
      format: EXPORT_FORMATS.has(format) ? format : 'json',
      rowCount,
      manifestDigest,
      healthState: typeof entry.healthState === 'string' && entry.healthState.trim() ? entry.healthState.trim() : null,
      deliveredAt: typeof entry.deliveredAt === 'string' && entry.deliveredAt.trim() ? entry.deliveredAt.trim() : null,
      ackedAt: typeof entry.ackedAt === 'string' && entry.ackedAt.trim() ? entry.ackedAt.trim() : null,
      counters: {
        evidenceTotal: Number.isFinite(counters.evidenceTotal) ? counters.evidenceTotal : rowCount,
        acceptedTotal: Number.isFinite(counters.acceptedTotal) ? counters.acceptedTotal : 0,
        degradedTotal: Number.isFinite(counters.degradedTotal) ? counters.degradedTotal : 0,
        blockedTotal: Number.isFinite(counters.blockedTotal) ? counters.blockedTotal : 0,
        validationErrorTotal: Number.isFinite(counters.validationErrorTotal) ? counters.validationErrorTotal : 0
      }
    }
  };
}

function buildExportHistoryState(input, reporting, exportSummary, auditHandoff, providerSync, generatedAt) {
  const reportingInput = input.reporting && typeof input.reporting === 'object' && !Array.isArray(input.reporting)
    ? input.reporting
    : {};
  const analyticsExportInput = input.analyticsExport && typeof input.analyticsExport === 'object' && !Array.isArray(input.analyticsExport)
    ? input.analyticsExport
    : {};
  const rawHistory = Array.isArray(input.exportHistory)
    ? input.exportHistory
    : Array.isArray(reportingInput.exportHistory)
      ? reportingInput.exportHistory
      : Array.isArray(analyticsExportInput.history)
        ? analyticsExportInput.history
        : [];
  const normalized = rawHistory.map(normalizeExportHistoryEntry);
  const errors = normalized.flatMap((entry) => entry.ok ? [] : entry.errors);
  const entries = normalized
    .filter((entry) => entry.ok)
    .map((entry) => entry.value)
    .sort((left, right) => String(left.generatedAt).localeCompare(String(right.generatedAt)))
    .slice(-EXPORT_HISTORY_LIMIT);
  const latest = entries[entries.length - 1] || null;
  const currentManifest = reporting.exportManifest;
  const duplicateOfLatest = Boolean(latest && latest.manifestDigest === currentManifest.manifestDigest);
  const currentState = !reporting.exportReady
    ? 'blocked'
    : duplicateOfLatest
      ? 'duplicate'
      : auditHandoff.exportAllowed
        ? 'prepared'
        : 'skipped';
  const current = {
    generatedAt,
    state: currentState,
    format: currentManifest.format,
    rowCount: currentManifest.rowCount,
    manifestDigest: currentManifest.manifestDigest,
    healthState: exportSummary.healthState,
    deliveredAt: null,
    ackedAt: null,
    counters: exportSummary.counters,
    providerCursor: providerSync.cursor.next,
    idempotencyKey: proofDigest({
      manifestDigest: currentManifest.manifestDigest,
      providerSyncDigest: providerSync.syncDigest,
      auditReceiptDigest: auditHandoff.receiptDigest
    })
  };
  const deltaFromLatest = latest
    ? {
        rowCount: current.rowCount - latest.rowCount,
        evidenceTotal: current.counters.evidenceTotal - latest.counters.evidenceTotal,
        acceptedTotal: current.counters.acceptedTotal - latest.counters.acceptedTotal,
        degradedTotal: current.counters.degradedTotal - latest.counters.degradedTotal,
        blockedTotal: current.counters.blockedTotal - latest.counters.blockedTotal,
        validationErrorTotal: current.counters.validationErrorTotal - latest.counters.validationErrorTotal,
        manifestChanged: latest.manifestDigest !== current.manifestDigest,
        healthChanged: latest.healthState !== current.healthState
      }
    : null;
  const timelineEvents = entries.concat(current).map((entry, index) => ({
    order: index,
    at: entry.generatedAt,
    type: 'analytics_export',
    severity: entry.state === 'failed' || entry.state === 'blocked' ? 'error' : entry.state === 'duplicate' ? 'warning' : 'info',
    summary: entry.state,
    manifestDigest: entry.manifestDigest,
    rowCount: entry.rowCount,
    format: entry.format
  }));

  return {
    contract: 'hosted-kernel evidence replay export history/v1',
    generatedAt,
    ok: errors.length === 0,
    errors,
    retained: entries.length,
    invalidEntryTotal: errors.length,
    duplicateOfLatest,
    latest,
    current,
    deltaFromLatest,
    entries: entries.concat(current).slice(-EXPORT_HISTORY_LIMIT),
    timelineEvents,
    counters: {
      exportHistoryEntryTotal: entries.length,
      exportHistoryInvalidEntryTotal: errors.length,
      exportPreparedTotal: entries.filter((entry) => entry.state === 'prepared').length + (current.state === 'prepared' ? 1 : 0),
      exportPublishedTotal: entries.filter((entry) => entry.state === 'published' || entry.state === 'acked').length,
      exportFailedTotal: entries.filter((entry) => entry.state === 'failed' || entry.state === 'blocked').length + (current.state === 'blocked' ? 1 : 0),
      exportDuplicateTotal: entries.filter((entry) => entry.state === 'duplicate').length + (current.state === 'duplicate' ? 1 : 0)
    },
    action: current.state === 'prepared'
      ? 'Persist exportHistory.current after the analytics export is published and advance providerSync.cursor.next on acknowledgement.'
      : current.state === 'duplicate'
        ? 'Skip publishing because the current analytics manifest matches the latest retained export history entry.'
        : 'Keep the analytics export inside the hosted-kernel boundary until reporting and audit export blockers are resolved.'
  };
}

function normalizeReportingOptions(input) {
  const raw = input.reporting && typeof input.reporting === 'object' && !Array.isArray(input.reporting)
    ? input.reporting
    : input.analyticsExport && typeof input.analyticsExport === 'object' && !Array.isArray(input.analyticsExport)
      ? input.analyticsExport
      : {};
  const errors = [];
  const exportFormat = typeof raw.exportFormat === 'string' && raw.exportFormat.trim()
    ? raw.exportFormat.trim()
    : 'json';
  const timelineLimit = Number.isInteger(raw.timelineLimit) && raw.timelineLimit > 0
    ? Math.min(raw.timelineLimit, REPORTING_TIMELINE_LIMIT)
    : REPORTING_TIMELINE_LIMIT;
  const bucketBy = Array.isArray(raw.bucketBy)
    ? raw.bucketBy.filter((bucket) => typeof bucket === 'string' && bucket.trim()).map((bucket) => bucket.trim())
    : ['status', 'source', 'sourceType', 'severity'];
  const includeProofDigests = typeof raw.includeProofDigests === 'boolean'
    ? raw.includeProofDigests
    : true;

  if (!EXPORT_FORMATS.has(exportFormat)) {
    errors.push({
      code: 'REPORTING_EXPORT_FORMAT_INVALID',
      path: 'reporting.exportFormat',
      message: `Unsupported evidence replay reporting export format: ${exportFormat}.`,
      action: 'Use json, ndjson, or csv for hosted-kernel evidence replay analytics exports.'
    });
  }
  if (raw.timelineLimit !== undefined && (!Number.isInteger(raw.timelineLimit) || raw.timelineLimit <= 0)) {
    errors.push({
      code: 'REPORTING_TIMELINE_LIMIT_INVALID',
      path: 'reporting.timelineLimit',
      message: 'Evidence replay reporting timelineLimit must be a positive integer.',
      action: 'Provide a positive integer timelineLimit so dashboard exports are bounded.'
    });
  }
  for (const bucket of bucketBy) {
    if (!REPORTING_BUCKETS.has(bucket)) {
      errors.push({
      code: 'REPORTING_BUCKET_INVALID',
      path: 'reporting.bucketBy',
      message: `Unsupported evidence replay reporting bucket: ${bucket}.`,
      action: 'Bucket evidence replay analytics by status, source, sourceType, and/or severity.'
      });
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    contract: 'hosted-kernel evidence replay reporting options/v1',
    exportFormat,
    timelineLimit,
    bucketBy: [...new Set(bucketBy)].filter((bucket) => REPORTING_BUCKETS.has(bucket)),
    includeProofDigests
  };
}

function normalizeIntegrationProviderContract(input, boundary, clientState, lifecycle, reporting) {
  const raw = input.providerContract && typeof input.providerContract === 'object' && !Array.isArray(input.providerContract)
    ? input.providerContract
    : input.integrationProvider && typeof input.integrationProvider === 'object' && !Array.isArray(input.integrationProvider)
      ? input.integrationProvider
      : input.serviceProvider && typeof input.serviceProvider === 'object' && !Array.isArray(input.serviceProvider)
        ? input.serviceProvider
        : {};
  const providerId = typeof raw.providerId === 'string' && raw.providerId.trim()
    ? raw.providerId.trim()
    : 'hosted-kernel-verifier';
  const serviceId = typeof raw.serviceId === 'string' && raw.serviceId.trim()
    ? raw.serviceId.trim()
    : 'claim-gate/evidence-replay';
  const protocol = typeof raw.protocol === 'string' && raw.protocol.trim()
    ? raw.protocol.trim()
    : 'hosted-kernel';
  const endpoint = typeof raw.endpoint === 'string' && raw.endpoint.trim()
    ? raw.endpoint.trim()
    : null;
  const requestedCapabilities = Array.isArray(raw.capabilities)
    ? raw.capabilities.filter((capability) => typeof capability === 'string' && capability.trim()).map((capability) => capability.trim())
    : ['evidence.replay', 'receipt.verify', 'claimGate.handoff', 'audit.export', 'sync.cursor'];
  const scope = raw.scope && typeof raw.scope === 'object' && !Array.isArray(raw.scope)
    ? raw.scope
    : {};
  const sync = raw.sync && typeof raw.sync === 'object' && !Array.isArray(raw.sync)
    ? raw.sync
    : {};
  const acknowledgement = raw.acknowledgement && typeof raw.acknowledgement === 'object' && !Array.isArray(raw.acknowledgement)
    ? raw.acknowledgement
    : raw.ackPolicy && typeof raw.ackPolicy === 'object' && !Array.isArray(raw.ackPolicy)
      ? raw.ackPolicy
      : {};
  const requiredCapabilities = ['receipt.verify'];
  const errors = [];

  if (clientState.replayMode === 'run' || lifecycle.runRequested || lifecycle.schedule.due) {
    requiredCapabilities.push('evidence.replay');
  }
  if (clientState.replayMode === 'handoff' || clientState.workflowStep === 'open-claim-gate') {
    requiredCapabilities.push('claimGate.handoff');
  }
  if (reporting.exportFormat && boundary.canExportAudit) {
    requiredCapabilities.push('audit.export');
  }

  if (!INTEGRATION_PROVIDER_PROTOCOLS.has(protocol)) {
    errors.push({
      code: 'INTEGRATION_PROVIDER_PROTOCOL_INVALID',
      path: 'providerContract.protocol',
      message: `Unsupported evidence replay provider protocol: ${protocol}.`,
      action: 'Use hosted-kernel, webhook, or queue for evidence replay provider contracts.'
    });
  }
  if ((protocol === 'webhook' || protocol === 'queue') && !endpoint) {
    errors.push({
      code: 'INTEGRATION_PROVIDER_ENDPOINT_REQUIRED',
      path: 'providerContract.endpoint',
      message: 'External evidence replay providers require an endpoint.',
      action: 'Set providerContract.endpoint to the webhook URL or queue address used for claim-gate handoff.'
    });
  }
  for (const capability of requestedCapabilities) {
    if (!INTEGRATION_PROVIDER_CAPABILITIES.has(capability)) {
      errors.push({
        code: 'INTEGRATION_PROVIDER_CAPABILITY_INVALID',
        path: 'providerContract.capabilities',
        message: `Unsupported evidence replay provider capability: ${capability}.`,
        action: 'Advertise only evidence.replay, receipt.verify, claimGate.handoff, audit.export, or sync.cursor.'
      });
    }
  }
  if (raw.capabilities !== undefined && !Array.isArray(raw.capabilities)) {
    errors.push({
      code: 'INTEGRATION_PROVIDER_CAPABILITIES_INVALID',
      path: 'providerContract.capabilities',
      message: 'Evidence replay provider capabilities must be an array of strings.',
      action: 'Send providerContract.capabilities as the provider capability list negotiated at connect time.'
    });
  }
  if (raw.acknowledgement !== undefined && (!raw.acknowledgement || typeof raw.acknowledgement !== 'object' || Array.isArray(raw.acknowledgement))) {
    errors.push({
      code: 'INTEGRATION_PROVIDER_ACK_POLICY_INVALID',
      path: 'providerContract.acknowledgement',
      message: 'Provider acknowledgement policy must be an object when provided.',
      action: 'Send acknowledgement.mode, acknowledgement.timeoutMs, and acknowledgement.requiredReceiptFields for external handoff providers.'
    });
  }
  if (raw.ackPolicy !== undefined && (!raw.ackPolicy || typeof raw.ackPolicy !== 'object' || Array.isArray(raw.ackPolicy))) {
    errors.push({
      code: 'INTEGRATION_PROVIDER_ACK_POLICY_INVALID',
      path: 'providerContract.ackPolicy',
      message: 'Provider ackPolicy must be an object when provided.',
      action: 'Use providerContract.acknowledgement as the canonical acknowledgement policy object.'
    });
  }
  if (scope.tenantId && scope.tenantId !== boundary.tenantId) {
    errors.push({
      code: 'INTEGRATION_PROVIDER_TENANT_BOUNDARY_MISMATCH',
      path: 'providerContract.scope.tenantId',
      message: 'Provider contract tenant scope does not match the active replay boundary.',
      action: 'Negotiate provider contracts inside the same tenantId as the replay request.'
    });
  }
  if (scope.workspaceId && scope.workspaceId !== boundary.workspaceId) {
    errors.push({
      code: 'INTEGRATION_PROVIDER_WORKSPACE_BOUNDARY_MISMATCH',
      path: 'providerContract.scope.workspaceId',
      message: 'Provider contract workspace scope does not match the active replay boundary.',
      action: 'Negotiate provider contracts inside the same workspaceId as the replay request.'
    });
  }

  const capabilities = [...new Set(requestedCapabilities)].filter((capability) => INTEGRATION_PROVIDER_CAPABILITIES.has(capability)).sort();
  const missingCapabilities = [...new Set(requiredCapabilities)]
    .filter((capability) => !capabilities.includes(capability));
  const ackMode = typeof acknowledgement.mode === 'string' && acknowledgement.mode.trim()
    ? acknowledgement.mode.trim()
    : protocol === 'hosted-kernel'
      ? 'cursor'
      : 'receipt';
  const ackTimeoutMs = Number.isInteger(acknowledgement.timeoutMs) && acknowledgement.timeoutMs > 0
    ? Math.min(acknowledgement.timeoutMs, MAX_PROVIDER_ACK_TIMEOUT_MS)
    : DEFAULT_PROVIDER_ACK_TIMEOUT_MS;
  const requiredReceiptFields = Array.isArray(acknowledgement.requiredReceiptFields)
    ? [...new Set(acknowledgement.requiredReceiptFields
      .filter((field) => typeof field === 'string' && field.trim())
      .map((field) => field.trim()))]
    : ackMode === 'receipt'
      ? ['providerId', 'serviceId', 'operationId', 'idempotencyKey', 'syncDigest', 'acceptedAt']
      : ackMode === 'cursor'
        ? ['providerId', 'serviceId', 'cursor', 'acceptedAt']
        : [];
  const operations = capabilities
    .filter((capability) => requiredCapabilities.includes(capability) || capability === 'sync.cursor')
    .map((capability) => ({
      capability,
      operation: INTEGRATION_PROVIDER_OPERATIONS[capability],
      required: requiredCapabilities.includes(capability)
    }))
    .filter((operation) => operation.operation);

  if (!INTEGRATION_PROVIDER_ACK_MODES.has(ackMode)) {
    errors.push({
      code: 'INTEGRATION_PROVIDER_ACK_MODE_INVALID',
      path: 'providerContract.acknowledgement.mode',
      message: `Unsupported provider acknowledgement mode: ${ackMode}.`,
      action: 'Use none, cursor, or receipt for hosted-kernel evidence replay provider acknowledgements.'
    });
  }
  if (protocol !== 'hosted-kernel' && ackMode === 'none') {
    errors.push({
      code: 'INTEGRATION_PROVIDER_EXTERNAL_ACK_REQUIRED',
      path: 'providerContract.acknowledgement.mode',
      message: 'External evidence replay providers must acknowledge handoff acceptance.',
      action: 'Use cursor or receipt acknowledgement mode for webhook and queue providers.'
    });
  }
  if (acknowledgement.timeoutMs !== undefined
    && (!Number.isInteger(acknowledgement.timeoutMs) || acknowledgement.timeoutMs <= 0 || acknowledgement.timeoutMs > MAX_PROVIDER_ACK_TIMEOUT_MS)) {
    errors.push({
      code: 'INTEGRATION_PROVIDER_ACK_TIMEOUT_INVALID',
      path: 'providerContract.acknowledgement.timeoutMs',
      message: `Provider acknowledgement timeoutMs must be an integer from 1 to ${MAX_PROVIDER_ACK_TIMEOUT_MS}.`,
      action: 'Choose a bounded acknowledgement timeout so external claim-gate handoff can be retried deterministically.'
    });
  }
  if (acknowledgement.requiredReceiptFields !== undefined && !Array.isArray(acknowledgement.requiredReceiptFields)) {
    errors.push({
      code: 'INTEGRATION_PROVIDER_ACK_FIELDS_INVALID',
      path: 'providerContract.acknowledgement.requiredReceiptFields',
      message: 'Provider acknowledgement requiredReceiptFields must be an array of field names.',
      action: 'List the receipt fields the provider must echo before cursor advancement is persisted.'
    });
  }
  for (const field of requiredReceiptFields) {
    if (!INTEGRATION_PROVIDER_ACK_FIELDS.has(field)) {
      errors.push({
        code: 'INTEGRATION_PROVIDER_ACK_FIELD_UNSUPPORTED',
        path: 'providerContract.acknowledgement.requiredReceiptFields',
        field,
        message: `Unsupported provider acknowledgement receipt field: ${field}.`,
        action: 'Use providerId, serviceId, operationId, idempotencyKey, syncDigest, cursor, or acceptedAt.'
      });
    }
  }
  for (const capability of missingCapabilities) {
    errors.push({
      code: 'INTEGRATION_PROVIDER_CAPABILITY_MISSING',
      path: 'providerContract.capabilities',
      capability,
      message: `Evidence replay provider is missing required capability: ${capability}.`,
      action: 'Renegotiate provider capabilities before running replay, exporting audit data, or handing off to the claim gate.'
    });
  }

  return {
    ok: errors.length === 0,
    errors,
    contract: 'hosted-kernel evidence replay provider contract/v1',
    providerId,
    serviceId,
    protocol,
    endpoint,
    scope: {
      tenantId: scope.tenantId || boundary.tenantId,
      workspaceId: scope.workspaceId || boundary.workspaceId
    },
    capabilities,
    requiredCapabilities: [...new Set(requiredCapabilities)].sort(),
    missingCapabilities,
    negotiated: missingCapabilities.length === 0 && errors.length === 0,
    serviceContract: {
      contract: 'hosted-kernel evidence replay provider service contract/v1',
      operations,
      operationDigest: proofDigest({
        providerId,
        serviceId,
        protocol,
        scope: {
          tenantId: scope.tenantId || boundary.tenantId,
          workspaceId: scope.workspaceId || boundary.workspaceId
        },
        operations
      }),
      handoffRequiresEndpoint: protocol === 'webhook' || protocol === 'queue',
      external: protocol !== 'hosted-kernel'
    },
    acknowledgement: {
      contract: 'hosted-kernel evidence replay provider acknowledgement/v1',
      mode: INTEGRATION_PROVIDER_ACK_MODES.has(ackMode) ? ackMode : 'receipt',
      required: ackMode !== 'none',
      timeoutMs: ackTimeoutMs,
      requiredReceiptFields: requiredReceiptFields.filter((field) => INTEGRATION_PROVIDER_ACK_FIELDS.has(field)),
      correlationId: typeof acknowledgement.correlationId === 'string' && acknowledgement.correlationId.trim()
        ? acknowledgement.correlationId.trim()
        : proofDigest({ providerId, serviceId, protocol, requestId: clientState.requestId }).replace('fnv1a32:', 'ack-')
    },
    sync: {
      cursor: typeof sync.cursor === 'string' && sync.cursor.trim() ? sync.cursor.trim() : null,
      generation: Number.isInteger(sync.generation) && sync.generation >= 0 ? sync.generation : 0,
      lastSyncedAt: typeof sync.lastSyncedAt === 'string' && sync.lastSyncedAt.trim() ? sync.lastSyncedAt.trim() : null,
      externalVersion: typeof sync.externalVersion === 'string' && sync.externalVersion.trim() ? sync.externalVersion.trim() : null
    }
  };
}

function countTimelineBy(timeline, key) {
  return timeline.reduce((counts, event) => {
    const value = event[key] || 'unknown';
    counts[value] = (counts[value] || 0) + 1;
    return counts;
  }, {});
}

function buildReportingState(records, validationErrors, analytics, history, timeline, health, boundary, lifecycle, reporting, generatedAt) {
  const delta = history.deltaFromLatest || {};
  const blockedDelta = Number.isFinite(delta.blockedTotal) ? delta.blockedTotal : 0;
  const validationDelta = Number.isFinite(delta.validationErrorTotal) ? delta.validationErrorTotal : 0;
  const severity = health.state === 'unhealthy' || blockedDelta > 0 || validationDelta > 0
    ? 'critical'
    : health.state === 'degraded' || analytics.counters.retryableTotal > 0
      ? 'warning'
      : 'normal';
  const timelineTail = timeline.slice(-reporting.timelineLimit);
  const bucketCounts = {};

  if (reporting.bucketBy.includes('status')) {
    bucketCounts.status = { ...analytics.byStatus };
  }
  if (reporting.bucketBy.includes('source')) {
    bucketCounts.source = { ...analytics.bySource };
  }
  if (reporting.bucketBy.includes('sourceType')) {
    bucketCounts.sourceType = { ...analytics.bySourceType };
  }
  if (reporting.bucketBy.includes('severity')) {
    bucketCounts.severity = countTimelineBy(timelineTail, 'severity');
  }

  const rowDigests = records.map((record) => ({
    claimId: record.claimId,
    rowDigest: proofDigest({
      claimId: record.claimId,
      status: record.status,
      source: record.source,
      sourceType: record.sourceReceipt.sourceType,
      sourceReceiptDigest: record.sourceReceipt.digest,
      proofDigest: reporting.includeProofDigests ? record.proofDigest : null,
      retry: record.audit.retry
    })
  }));

  return {
    contract: 'hosted-kernel evidence replay analytics reporting/v1',
    generatedAt,
    exportFormat: reporting.exportFormat,
    exportReady: reporting.ok && boundary.canExportAudit && validationErrors.length === 0,
    severity,
    scope: {
      tenantId: boundary.tenantId,
      workspaceId: boundary.workspaceId,
      actorId: boundary.actorId
    },
    counters: {
      ...analytics.counters,
      timelineEventTotal: timeline.length,
      reportingValidationErrorTotal: reporting.errors.length,
      historySnapshotTotal: history.snapshots.length,
      blockedDelta,
      validationErrorDelta: validationDelta
    },
    bucketCounts,
    timelineReport: {
      retained: timelineTail.length,
      omitted: Math.max(0, timeline.length - timelineTail.length),
      firstEventAt: timelineTail[0]?.at || null,
      lastEventAt: timelineTail[timelineTail.length - 1]?.at || null,
      criticalEvents: timelineTail
        .filter((event) => event.severity === 'error')
        .map((event) => ({
          at: event.at,
          type: event.type,
          claimId: event.claimId,
          summary: event.summary
        }))
    },
    historyReport: {
      latestHealthState: history.latest?.healthState || null,
      currentHealthState: history.current.healthState,
      healthChanged: Boolean(history.deltaFromLatest?.healthChanged),
      proofChanged: Boolean(history.deltaFromLatest?.proofChanged),
      deltaFromLatest: history.deltaFromLatest
    },
    exportManifest: {
      dataset: 'evidence_replay_claim_rows',
      format: reporting.exportFormat,
      rowCount: records.length,
      columns: [
        'claimId',
        'tenantId',
        'workspaceId',
        'status',
        'source',
        'sourceType',
        'sourceId',
        'sourceSigner',
        'sourceReceiptDigest',
        'observedAt',
        ...(reporting.includeProofDigests ? ['proofDigest'] : []),
        'attempts',
        'retryable',
        'attemptsRemaining',
        'nextBackoffMs',
        'action'
      ],
      rowDigests,
      manifestDigest: proofDigest({
        surfaceId,
        generatedAt,
        exportFormat: reporting.exportFormat,
        scope: boundary.tenantId && boundary.workspaceId ? `${boundary.tenantId}/${boundary.workspaceId}` : null,
        counters: analytics.counters,
        rowDigests,
        lifecycleCommand: lifecycle.command
      })
    },
    action: boundary.canExportAudit
      ? 'Publish reporting.exportManifest with exports.summary for tenant-scoped analytics ingestion.'
      : 'Grant audit:export before publishing evidence replay analytics outside the hosted-kernel boundary.'
  };
}

function buildAuditHandoff(boundary, workspaceScope, health, lifecycle, analytics, records, validationErrors, generatedAt) {
  const boundaryViolations = validationErrors
    .filter((error) => typeof error.code === 'string' && (
      error.code.includes('BOUNDARY')
      || error.code.includes('TENANT')
      || error.code.includes('WORKSPACE')
      || error.code.includes('PERMISSION')
    ));
  const scope = {
    tenantId: boundary.tenantId,
    workspaceId: boundary.workspaceId,
    actorId: boundary.actorId
  };
  const evidenceDigests = records.map((record) => ({
    claimId: record.claimId,
    proofDigest: record.proofDigest,
    sourceReceiptDigest: record.sourceReceipt.digest,
    sourceType: record.sourceReceipt.sourceType,
    sourceSigner: record.sourceReceipt.signer,
    status: record.status
  }));
  const exportAllowed = boundary.canExportAudit && boundaryViolations.length === 0;

  return {
    contract: 'hosted-kernel evidence replay audit handoff/v1',
    generatedAt,
    scope,
    actor: {
      id: boundary.actorId,
      roles: boundary.roles,
      permissions: boundary.permissions
    },
    exportAllowed,
    isolation: {
      enforced: boundary.ok,
      violationTotal: boundaryViolations.length,
      violations: boundaryViolations.map((error) => ({
        code: error.code,
        path: error.path,
        claimId: error.claimId || null
      }))
    },
    workspaceScope: {
      contract: workspaceScope.contract,
      mode: workspaceScope.mode,
      enforced: workspaceScope.enforced,
      policyDigest: workspaceScope.policyDigest,
      violationTotal: workspaceScope.violationTotal,
      blockingViolationTotal: workspaceScope.blockingViolationTotal,
      violations: workspaceScope.findings.map((finding) => ({
        code: finding.code,
        claimId: finding.claimId || null,
        blocking: finding.blocking
      }))
    },
    replaySummary: {
      healthState: health.state,
      lifecycleCommand: lifecycle.command,
      counters: analytics.counters,
      evidenceDigests
    },
    receiptDigest: proofDigest({
      surfaceId,
      generatedAt,
      scope,
      actorId: boundary.actorId,
      permissions: boundary.permissions,
      healthState: health.state,
      lifecycleCommand: lifecycle.command,
      counters: analytics.counters,
      evidenceDigests,
      workspaceScopeDigest: workspaceScope.policyDigest,
      workspaceScopeFindings: workspaceScope.findings,
      boundaryViolations
    }),
    action: exportAllowed
      ? 'Forward this receipt with the replay summary to audit storage for the active tenant/workspace boundary.'
      : 'Do not export audit evidence until boundary, permission, and tenant/workspace validation errors are repaired.'
  };
}

function buildProviderSyncState(provider, boundary, health, records, validationErrors, generatedAt) {
  const replayableDigests = records
    .filter((record) => record.status !== 'blocked')
    .map((record) => ({
      claimId: record.claimId,
      status: record.status,
      proofDigest: record.proofDigest,
      sourceReceiptDigest: record.sourceReceipt.digest
    }));
  const syncDigest = proofDigest({
    surfaceId,
    providerId: provider.providerId,
    serviceId: provider.serviceId,
    tenantId: boundary.tenantId,
    workspaceId: boundary.workspaceId,
    healthState: health.state,
    replayableDigests,
    validationErrorCodes: validationErrors.map((error) => error.code)
  });
  const nextCursor = provider.capabilities.includes('sync.cursor')
    ? proofDigest({ previous: provider.sync.cursor, generatedAt, syncDigest }).replace('fnv1a32:', 'cursor-')
    : null;
  const operationId = proofDigest({
    providerId: provider.providerId,
    serviceId: provider.serviceId,
    operationDigest: provider.serviceContract.operationDigest,
    syncDigest,
    generation: provider.sync.generation + (nextCursor ? 1 : 0)
  }).replace('fnv1a32:', 'op-');
  const parsedGeneratedAt = Date.parse(generatedAt);
  const ackDeadlineAt = provider.acknowledgement.required && !Number.isNaN(parsedGeneratedAt)
    ? new Date(parsedGeneratedAt + provider.acknowledgement.timeoutMs).toISOString()
    : null;
  const requiredAckReceipt = provider.acknowledgement.required
    ? provider.acknowledgement.requiredReceiptFields.reduce((receipt, field) => {
        if (field === 'providerId') {
          receipt.providerId = provider.providerId;
        } else if (field === 'serviceId') {
          receipt.serviceId = provider.serviceId;
        } else if (field === 'operationId') {
          receipt.operationId = operationId;
        } else if (field === 'idempotencyKey') {
          receipt.idempotencyKey = proofDigest({ operationId, syncDigest, cursor: nextCursor });
        } else if (field === 'syncDigest') {
          receipt.syncDigest = syncDigest;
        } else if (field === 'cursor') {
          receipt.cursor = nextCursor;
        } else if (field === 'acceptedAt') {
          receipt.acceptedAt = '<provider-accepted-at>';
        }
        return receipt;
      }, {})
    : null;

  return {
    contract: 'hosted-kernel evidence replay provider sync/v1',
    providerId: provider.providerId,
    serviceId: provider.serviceId,
    generatedAt,
    ready: provider.negotiated && validationErrors.length === 0,
    cursor: {
      previous: provider.sync.cursor,
      next: nextCursor,
      generation: provider.sync.generation + (nextCursor ? 1 : 0),
      lastSyncedAt: provider.sync.lastSyncedAt,
      externalVersion: provider.sync.externalVersion
    },
    operation: {
      contract: 'hosted-kernel evidence replay provider sync operation/v1',
      operationId,
      operationDigest: provider.serviceContract.operationDigest,
      protocol: provider.protocol,
      endpoint: provider.endpoint,
      correlationId: provider.acknowledgement.correlationId,
      idempotencyKey: proofDigest({ operationId, syncDigest, previousCursor: provider.sync.cursor, nextCursor }),
      operations: provider.serviceContract.operations,
      external: provider.serviceContract.external
    },
    acknowledgement: {
      required: provider.acknowledgement.required,
      mode: provider.acknowledgement.mode,
      timeoutMs: provider.acknowledgement.timeoutMs,
      deadlineAt: ackDeadlineAt,
      requiredReceiptFields: provider.acknowledgement.requiredReceiptFields,
      expectedReceipt: requiredAckReceipt
    },
    replayableDigestTotal: replayableDigests.length,
    syncDigest,
    action: nextCursor
      ? 'Persist providerSync.cursor.next after the provider accepts this evidence replay handoff.'
      : 'Provider did not negotiate sync.cursor; use syncDigest as the idempotency key for external handoff.'
  };
}

function normalizeProviderAcknowledgementReceipt(input, provider, providerSync, generatedAt) {
  const raw = input.providerAcknowledgement && typeof input.providerAcknowledgement === 'object' && !Array.isArray(input.providerAcknowledgement)
    ? input.providerAcknowledgement
    : input.handoffReceipt && typeof input.handoffReceipt === 'object' && !Array.isArray(input.handoffReceipt)
      ? input.handoffReceipt
      : input.providerReceipt && typeof input.providerReceipt === 'object' && !Array.isArray(input.providerReceipt)
        ? input.providerReceipt
        : null;
  const expected = providerSync.acknowledgement.expectedReceipt || {};
  const requiredFields = providerSync.acknowledgement.requiredReceiptFields || [];
  const errors = [];

  if (!providerSync.acknowledgement.required) {
    return {
      contract: 'hosted-kernel evidence replay provider acknowledgement receipt/v1',
      received: Boolean(raw),
      ok: true,
      errors,
      state: raw ? 'ignored-not-required' : 'not-required',
      receipt: raw ? { acceptedAt: typeof raw.acceptedAt === 'string' ? raw.acceptedAt : null } : null,
      receiptDigest: raw ? proofDigest(raw) : null,
      commit: {
        cursorAdvanceAllowed: true,
        committedCursor: providerSync.cursor.next,
        committedAt: generatedAt,
        reason: 'provider_acknowledgement_not_required'
      }
    };
  }

  if (!raw) {
    return {
      contract: 'hosted-kernel evidence replay provider acknowledgement receipt/v1',
      received: false,
      ok: true,
      errors,
      state: 'awaiting-receipt',
      receipt: null,
      receiptDigest: null,
      commit: {
        cursorAdvanceAllowed: false,
        committedCursor: null,
        committedAt: null,
        reason: 'provider_acknowledgement_missing'
      }
    };
  }

  const receipt = {};
  for (const field of INTEGRATION_PROVIDER_ACK_FIELDS) {
    if (typeof raw[field] === 'string' && raw[field].trim()) {
      receipt[field] = raw[field].trim();
    }
  }

  for (const field of requiredFields) {
    if (!receipt[field]) {
      errors.push({
        code: 'PROVIDER_ACK_RECEIPT_FIELD_REQUIRED',
        path: `providerAcknowledgement.${field}`,
        field,
        message: `Provider acknowledgement receipt is missing required field: ${field}.`,
        action: 'Echo every required acknowledgement field from providerSync.acknowledgement.expectedReceipt.'
      });
    }
  }
  for (const field of ['providerId', 'serviceId', 'operationId', 'idempotencyKey', 'syncDigest', 'cursor']) {
    if (expected[field] && receipt[field] && receipt[field] !== expected[field]) {
      errors.push({
        code: 'PROVIDER_ACK_RECEIPT_FIELD_MISMATCH',
        path: `providerAcknowledgement.${field}`,
        field,
        message: `Provider acknowledgement ${field} does not match the expected handoff receipt.`,
        action: 'Reject the acknowledgement and retry with the expected providerSync acknowledgement receipt values.'
      });
    }
  }
  if (receipt.acceptedAt && Number.isNaN(Date.parse(receipt.acceptedAt))) {
    errors.push({
      code: 'PROVIDER_ACK_ACCEPTED_AT_INVALID',
      path: 'providerAcknowledgement.acceptedAt',
      message: 'Provider acknowledgement acceptedAt must be a parseable ISO timestamp.',
      action: 'Return acceptedAt as the provider acceptance timestamp so cursor commits remain auditable.'
    });
  }

  const ok = errors.length === 0;
  return {
    contract: 'hosted-kernel evidence replay provider acknowledgement receipt/v1',
    received: true,
    ok,
    errors,
    state: ok ? 'accepted' : 'rejected',
    receipt,
    receiptDigest: proofDigest({
      providerId: provider.providerId,
      serviceId: provider.serviceId,
      operationId: providerSync.operation.operationId,
      syncDigest: providerSync.syncDigest,
      receipt
    }),
    commit: {
      cursorAdvanceAllowed: ok,
      committedCursor: ok ? providerSync.cursor.next : null,
      committedAt: ok ? receipt.acceptedAt || generatedAt : null,
      reason: ok ? 'provider_acknowledgement_validated' : 'provider_acknowledgement_invalid'
    }
  };
}

function buildExternalHandoffState(provider, providerSync, providerAcknowledgement, boundary, health, workflowHandoff, auditHandoff, records, validationErrors, generatedAt) {
  const handoffRecords = records
    .filter((record) => record.status === 'accepted')
    .map((record) => ({
      claimId: record.claimId,
      proofDigest: record.proofDigest,
      sourceReceiptDigest: record.sourceReceipt.digest,
      sourceType: record.sourceReceipt.sourceType
    }));
  const blockedBy = [];

  if (!provider.negotiated) {
    blockedBy.push('provider_capability_negotiation_failed');
  }
  if (!workflowHandoff.canHandoffToClaimGate) {
    blockedBy.push(workflowHandoff.reason);
  }
  if (!auditHandoff.exportAllowed) {
    blockedBy.push('audit_export_not_allowed');
  }
  if (validationErrors.length > 0) {
    blockedBy.push('validation_errors_present');
  }
  if (provider.acknowledgement.required && providerSync.acknowledgement.expectedReceipt === null) {
    blockedBy.push('provider_acknowledgement_contract_unavailable');
  }
  if (provider.acknowledgement.required && providerAcknowledgement.received && !providerAcknowledgement.ok) {
    blockedBy.push('provider_acknowledgement_invalid');
  }

  const handoffState = blockedBy.length === 0
    ? provider.acknowledgement.required
      ? providerAcknowledgement.ok && providerAcknowledgement.received
        ? 'acked'
        : 'awaiting-ack'
      : 'ready'
    : 'blocked';
  const operationEnvelope = {
    contract: 'hosted-kernel evidence replay provider handoff operation/v1',
    operationId: providerSync.operation.operationId,
    operation: 'claimGate.handoff',
    providerId: provider.providerId,
    serviceId: provider.serviceId,
    protocol: provider.protocol,
    endpoint: provider.endpoint,
    correlationId: provider.acknowledgement.correlationId,
    tenantId: boundary.tenantId,
    workspaceId: boundary.workspaceId,
    requestId: workflowHandoff.requestId,
    claimGateReady: health.canOpenClaimGate,
    auditReceiptDigest: auditHandoff.receiptDigest,
    syncDigest: providerSync.syncDigest,
    cursor: providerSync.cursor.next,
    records: handoffRecords,
    envelopeDigest: proofDigest({
      providerId: provider.providerId,
      serviceId: provider.serviceId,
      requestId: workflowHandoff.requestId,
      syncDigest: providerSync.syncDigest,
      cursor: providerSync.cursor.next,
      auditReceiptDigest: auditHandoff.receiptDigest,
      handoffRecords
    })
  };

  return {
    contract: 'hosted-kernel evidence replay external handoff/v1',
    generatedAt,
    provider: {
      providerId: provider.providerId,
      serviceId: provider.serviceId,
      protocol: provider.protocol,
      endpoint: provider.endpoint,
      capabilities: provider.capabilities
    },
    scope: {
      tenantId: boundary.tenantId,
      workspaceId: boundary.workspaceId,
      actorId: boundary.actorId
    },
    state: handoffState,
    blockedBy: [...new Set(blockedBy)],
    claimGateReady: health.canOpenClaimGate,
    handoffRecordTotal: handoffRecords.length,
    handoffRecords,
    operationEnvelope,
    acknowledgement: {
      required: provider.acknowledgement.required,
      mode: provider.acknowledgement.mode,
      deadlineAt: providerSync.acknowledgement.deadlineAt,
      requiredReceiptFields: provider.acknowledgement.requiredReceiptFields,
      expectedReceipt: providerSync.acknowledgement.expectedReceipt,
      receivedReceipt: providerAcknowledgement.receipt,
      receiptDigest: providerAcknowledgement.receiptDigest,
      receiptState: providerAcknowledgement.state,
      commit: providerAcknowledgement.commit,
      commitState: handoffState === 'acked'
        ? 'provider-ack-validated'
        : handoffState === 'awaiting-ack'
        ? 'pending-provider-ack'
        : handoffState === 'ready'
          ? 'provider-ack-not-required'
          : 'blocked-before-provider-send'
    },
    idempotencyKey: proofDigest({
      providerId: provider.providerId,
      serviceId: provider.serviceId,
      requestId: workflowHandoff.requestId,
      auditReceiptDigest: auditHandoff.receiptDigest,
      syncDigest: providerSync.syncDigest,
      operationEnvelopeDigest: operationEnvelope.envelopeDigest,
      acknowledgementReceiptDigest: providerAcknowledgement.receiptDigest,
      handoffRecords
    }),
    action: handoffState === 'acked'
      ? 'Persist providerSync.cursor.next and the validated acknowledgement receipt as the external handoff commit record.'
      : handoffState === 'awaiting-ack'
      ? 'Send operationEnvelope to the negotiated provider and persist providerSync.cursor.next only after the expected acknowledgement receipt is returned.'
      : handoffState === 'ready'
        ? 'Provider acknowledgement is not required; persist providerSync.cursor.next with the handoff operation digest.'
      : 'Keep replay results inside the hosted-kernel boundary until provider negotiation, audit export, and claim-gate handoff blockers are cleared.'
  };
}

function normalizePersistedCommandLedgerEntry(entry, index, errors) {
  if (typeof entry === 'string') {
    const id = entry.trim();
    if (!id) {
      errors.push({
        code: 'PERSISTED_COMMAND_LEDGER_ENTRY_INVALID',
        path: `persistedState.commandLedger[${index}]`,
        message: 'Persisted command ledger string entries must be non-empty command ids.',
        action: 'Store command ledger entries as command ids or hosted-kernel command result objects.'
      });
      return null;
    }
    return {
      id,
      command: null,
      state: 'completed',
      appliedAt: null,
      requestId: null,
      receiptDigest: null,
      proofDigest: null,
      providerCursor: null,
      recoveryState: null,
      replayAllowed: null
    };
  }

  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    errors.push({
      code: 'PERSISTED_COMMAND_LEDGER_ENTRY_INVALID',
      path: `persistedState.commandLedger[${index}]`,
      message: 'Persisted command ledger entries must be objects or command id strings.',
      action: 'Persist commandLedger entries with id, command, state, appliedAt, receiptDigest, and proofDigest.'
    });
    return null;
  }

  const id = typeof entry.id === 'string' && entry.id.trim()
    ? entry.id.trim()
    : typeof entry.commandId === 'string' && entry.commandId.trim()
      ? entry.commandId.trim()
      : null;
  const command = typeof entry.command === 'string' && entry.command.trim() ? entry.command.trim() : null;
  const state = typeof entry.state === 'string' && entry.state.trim() ? entry.state.trim() : 'completed';
  const appliedAt = typeof entry.appliedAt === 'string' && entry.appliedAt.trim()
    ? entry.appliedAt.trim()
    : typeof entry.generatedAt === 'string' && entry.generatedAt.trim()
      ? entry.generatedAt.trim()
      : null;
  const receiptDigest = typeof entry.receiptDigest === 'string' && entry.receiptDigest.trim()
    ? entry.receiptDigest.trim()
    : typeof entry.commandReceipt === 'string' && entry.commandReceipt.trim()
      ? entry.commandReceipt.trim()
      : null;
  const proof = typeof entry.proofDigest === 'string' && entry.proofDigest.trim()
    ? entry.proofDigest.trim()
    : typeof entry.lastProofDigest === 'string' && entry.lastProofDigest.trim()
      ? entry.lastProofDigest.trim()
      : null;

  if (!id) {
    errors.push({
      code: 'PERSISTED_COMMAND_LEDGER_ID_REQUIRED',
      path: `persistedState.commandLedger[${index}].id`,
      message: 'Persisted command ledger entry is missing id.',
      action: 'Persist the lifecycle commandId as commandLedger[].id so replay commands remain idempotent after restart.'
    });
  }
  if (!COMMAND_LEDGER_STATES.has(state)) {
    errors.push({
      code: 'PERSISTED_COMMAND_LEDGER_STATE_INVALID',
      path: `persistedState.commandLedger[${index}].state`,
      message: `Unsupported persisted command ledger state: ${state}.`,
      action: 'Use applied, completed, rejected, duplicate, or abandoned for command ledger result state.'
    });
  }
  if (appliedAt && Number.isNaN(Date.parse(appliedAt))) {
    errors.push({
      code: 'PERSISTED_COMMAND_LEDGER_APPLIED_AT_INVALID',
      path: `persistedState.commandLedger[${index}].appliedAt`,
      message: 'Persisted command ledger appliedAt must be a parseable ISO timestamp.',
      action: 'Persist command ledger timestamps as ISO strings so duplicate command replay is deterministic.'
    });
  }

  return {
    id,
    command,
    state: COMMAND_LEDGER_STATES.has(state) ? state : 'rejected',
    appliedAt,
    requestId: typeof entry.requestId === 'string' && entry.requestId.trim() ? entry.requestId.trim() : null,
    receiptDigest,
    proofDigest: proof,
    providerCursor: typeof entry.providerCursor === 'string' && entry.providerCursor.trim() ? entry.providerCursor.trim() : null,
    recoveryState: typeof entry.recoveryState === 'string' && entry.recoveryState.trim() ? entry.recoveryState.trim() : null,
    replayAllowed: typeof entry.replayAllowed === 'boolean' ? entry.replayAllowed : null
  };
}

function normalizePersistedReplayState(input, generatedAt) {
  const raw = input.persistedState && typeof input.persistedState === 'object' && !Array.isArray(input.persistedState)
    ? input.persistedState
    : input.recoveredState && typeof input.recoveredState === 'object' && !Array.isArray(input.recoveredState)
      ? input.recoveredState
      : {};
  const errors = [];
  const parsedNow = Date.parse(generatedAt);
  const lastGeneratedAt = typeof raw.lastGeneratedAt === 'string' && raw.lastGeneratedAt.trim()
    ? raw.lastGeneratedAt.trim()
    : typeof raw.generatedAt === 'string' && raw.generatedAt.trim()
      ? raw.generatedAt.trim()
      : null;
  const parsedLastGeneratedAt = lastGeneratedAt ? Date.parse(lastGeneratedAt) : NaN;
  const legacyAppliedCommandIds = Array.isArray(raw.appliedCommandIds)
    ? raw.appliedCommandIds.filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim())
    : [];
  const rawCommandLedger = Array.isArray(raw.commandLedger)
    ? raw.commandLedger
    : [];
  const commandLedger = rawCommandLedger
    .map((entry, index) => normalizePersistedCommandLedgerEntry(entry, index, errors))
    .filter(Boolean)
    .filter((entry) => entry.id)
    .slice(-COMMAND_LEDGER_LIMIT);
  const commandLedgerIds = commandLedger.map((entry) => entry.id);
  const appliedCommandIds = legacyAppliedCommandIds.length > 0
    ? legacyAppliedCommandIds
    : Array.isArray(raw.commandLedger)
      ? commandLedgerIds
      : [];

  if (raw.lastGeneratedAt !== undefined && (typeof raw.lastGeneratedAt !== 'string' || !raw.lastGeneratedAt.trim())) {
    errors.push({
      code: 'PERSISTED_STATE_TIMESTAMP_INVALID',
      path: 'persistedState.lastGeneratedAt',
      message: 'Persisted evidence replay state lastGeneratedAt must be an ISO timestamp string.',
      action: 'Persist the generatedAt value returned by the previous hosted-kernel evidence replay status.'
    });
  }
  if (lastGeneratedAt && Number.isNaN(parsedLastGeneratedAt)) {
    errors.push({
      code: 'PERSISTED_STATE_TIMESTAMP_UNPARSEABLE',
      path: 'persistedState.lastGeneratedAt',
      message: 'Persisted evidence replay state lastGeneratedAt could not be parsed.',
      action: 'Discard the stale state or replace it with a valid ISO-8601 timestamp.'
    });
  }
  if (raw.appliedCommandIds !== undefined && !Array.isArray(raw.appliedCommandIds)) {
    errors.push({
      code: 'PERSISTED_COMMAND_LEDGER_INVALID',
      path: 'persistedState.appliedCommandIds',
      message: 'Persisted evidence replay command ledger must be an array.',
      action: 'Persist appliedCommandIds as an ordered array of idempotency keys.'
    });
  }
  if (raw.commandLedger !== undefined && !Array.isArray(raw.commandLedger)) {
    errors.push({
      code: 'PERSISTED_COMMAND_RESULT_LEDGER_INVALID',
      path: 'persistedState.commandLedger',
      message: 'Persisted evidence replay commandLedger must be an array.',
      action: 'Persist commandLedger as ordered hosted-kernel command result entries.'
    });
  }

  const ageMs = lastGeneratedAt && !Number.isNaN(parsedNow) && !Number.isNaN(parsedLastGeneratedAt)
    ? Math.max(0, parsedNow - parsedLastGeneratedAt)
    : null;
  const recoveredLifecycle = raw.lifecycle && typeof raw.lifecycle === 'object' && !Array.isArray(raw.lifecycle)
    ? {
        enabled: typeof raw.lifecycle.enabled === 'boolean' ? raw.lifecycle.enabled : null,
        paused: typeof raw.lifecycle.paused === 'boolean' ? raw.lifecycle.paused : null,
        disabledUntil: typeof raw.lifecycle.disabledUntil === 'string' && raw.lifecycle.disabledUntil.trim()
          ? raw.lifecycle.disabledUntil.trim()
          : raw.lifecycle.windows && typeof raw.lifecycle.windows.disabledUntil === 'string' && raw.lifecycle.windows.disabledUntil.trim()
            ? raw.lifecycle.windows.disabledUntil.trim()
            : null,
        pausedUntil: typeof raw.lifecycle.pausedUntil === 'string' && raw.lifecycle.pausedUntil.trim()
          ? raw.lifecycle.pausedUntil.trim()
          : raw.lifecycle.windows && typeof raw.lifecycle.windows.pausedUntil === 'string' && raw.lifecycle.windows.pausedUntil.trim()
            ? raw.lifecycle.windows.pausedUntil.trim()
            : null,
        schedule: raw.lifecycle.schedule && typeof raw.lifecycle.schedule === 'object' && !Array.isArray(raw.lifecycle.schedule)
          ? raw.lifecycle.schedule
          : null
      }
    : { enabled: null, paused: null, disabledUntil: null, pausedUntil: null, schedule: null };
  const rawRecoveryJournal = raw.recoveryJournal && typeof raw.recoveryJournal === 'object' && !Array.isArray(raw.recoveryJournal)
    ? raw.recoveryJournal
    : raw.replayJournal && typeof raw.replayJournal === 'object' && !Array.isArray(raw.replayJournal)
      ? raw.replayJournal
      : {};
  const rawRuns = Array.isArray(rawRecoveryJournal.runs)
    ? rawRecoveryJournal.runs
    : raw.inflightReplay && typeof raw.inflightReplay === 'object' && !Array.isArray(raw.inflightReplay)
      ? [raw.inflightReplay]
      : [];
  const recoveryRuns = rawRuns
    .map((run, index) => {
      if (!run || typeof run !== 'object' || Array.isArray(run)) {
        errors.push({
          code: 'PERSISTED_RECOVERY_RUN_INVALID',
          path: `persistedState.recoveryJournal.runs[${index}]`,
          message: 'Persisted evidence replay recovery runs must be objects.',
          action: 'Persist each replay recovery journal run with commandId, requestId, state, and proofDigest.'
        });
        return null;
      }
      const state = typeof run.state === 'string' && run.state.trim() ? run.state.trim() : 'pending';
      const commandId = typeof run.commandId === 'string' && run.commandId.trim() ? run.commandId.trim() : null;
      const requestId = typeof run.requestId === 'string' && run.requestId.trim() ? run.requestId.trim() : null;
      const startedAt = typeof run.startedAt === 'string' && run.startedAt.trim() ? run.startedAt.trim() : null;
      const updatedAt = typeof run.updatedAt === 'string' && run.updatedAt.trim() ? run.updatedAt.trim() : startedAt;
      const runProofDigest = typeof run.proofDigest === 'string' && run.proofDigest.trim() ? run.proofDigest.trim() : null;

      if (!RECOVERY_RUN_STATES.has(state)) {
        errors.push({
          code: 'PERSISTED_RECOVERY_RUN_STATE_INVALID',
          path: `persistedState.recoveryJournal.runs[${index}].state`,
          message: `Unsupported persisted recovery run state: ${state}.`,
          action: 'Use pending, running, completed, failed, or abandoned for recovery journal run state.'
        });
      }
      if (!commandId) {
        errors.push({
          code: 'PERSISTED_RECOVERY_RUN_COMMAND_ID_REQUIRED',
          path: `persistedState.recoveryJournal.runs[${index}].commandId`,
          message: 'Persisted recovery run is missing commandId.',
          action: 'Persist the lifecycle commandId that created each replay recovery journal run.'
        });
      }
      if (startedAt && Number.isNaN(Date.parse(startedAt))) {
        errors.push({
          code: 'PERSISTED_RECOVERY_RUN_STARTED_AT_INVALID',
          path: `persistedState.recoveryJournal.runs[${index}].startedAt`,
          message: 'Persisted recovery run startedAt must be a parseable ISO timestamp.',
          action: 'Store recovery run timestamps as ISO strings so restart ordering is deterministic.'
        });
      }

      return {
        commandId,
        requestId,
        state: RECOVERY_RUN_STATES.has(state) ? state : 'failed',
        startedAt,
        updatedAt,
        proofDigest: runProofDigest,
        providerCursor: typeof run.providerCursor === 'string' && run.providerCursor.trim() ? run.providerCursor.trim() : null,
        replayableDigestTotal: Number.isInteger(run.replayableDigestTotal) && run.replayableDigestTotal >= 0
          ? run.replayableDigestTotal
          : 0
      };
    })
    .filter(Boolean)
    .slice(-RECOVERY_JOURNAL_LIMIT);
  const rawClientRuntime = raw.clientRuntime && typeof raw.clientRuntime === 'object' && !Array.isArray(raw.clientRuntime)
    ? raw.clientRuntime
    : raw.clientState && typeof raw.clientState === 'object' && !Array.isArray(raw.clientState)
      ? raw.clientState
      : {};
  const clientRuntimeUpdatedAt = typeof rawClientRuntime.updatedAt === 'string' && rawClientRuntime.updatedAt.trim()
    ? rawClientRuntime.updatedAt.trim()
    : typeof rawClientRuntime.generatedAt === 'string' && rawClientRuntime.generatedAt.trim()
      ? rawClientRuntime.generatedAt.trim()
      : null;

  if (clientRuntimeUpdatedAt && Number.isNaN(Date.parse(clientRuntimeUpdatedAt))) {
    errors.push({
      code: 'PERSISTED_CLIENT_RUNTIME_UPDATED_AT_INVALID',
      path: 'persistedState.clientRuntime.updatedAt',
      message: 'Persisted client runtime updatedAt must be a parseable ISO timestamp.',
      action: 'Persist clientRuntime.updatedAt from clientRuntimeAdoption.persistencePatch.updatedAt.'
    });
  }

  return {
    ok: errors.length === 0,
    errors,
    contract: 'hosted-kernel evidence replay persisted state/v1',
    found: Object.keys(raw).length > 0,
    lastGeneratedAt,
    ageMs,
    stale: typeof ageMs === 'number' ? ageMs > STALE_PERSISTED_STATE_MS : false,
    lastProofDigest: typeof raw.lastProofDigest === 'string' && raw.lastProofDigest.trim()
      ? raw.lastProofDigest.trim()
      : typeof raw.proofDigest === 'string' && raw.proofDigest.trim()
        ? raw.proofDigest.trim()
        : null,
    appliedCommandIds: [...new Set(appliedCommandIds.concat(commandLedgerIds))].slice(-COMMAND_LEDGER_LIMIT),
    commandLedger: commandLedger.length > 0
      ? commandLedger
      : [...new Set(appliedCommandIds)].slice(-COMMAND_LEDGER_LIMIT).map((id) => ({
          id,
          command: null,
          state: 'completed',
          appliedAt: null,
          requestId: null,
          receiptDigest: null,
          proofDigest: null,
          providerCursor: null,
          recoveryState: null,
          replayAllowed: null
        })),
    recoveredLifecycle,
    recoveryJournal: {
      contract: 'hosted-kernel evidence replay recovery journal/v1',
      found: recoveryRuns.length > 0,
      runs: recoveryRuns,
      activeRuns: recoveryRuns.filter((run) => run.state === 'pending' || run.state === 'running'),
      lastCompleted: [...recoveryRuns].reverse().find((run) => run.state === 'completed') || null
    },
    clientRuntime: {
      contract: 'hosted-kernel evidence replay persisted client runtime/v1',
      found: Object.keys(rawClientRuntime).length > 0,
      requestId: typeof rawClientRuntime.requestId === 'string' && rawClientRuntime.requestId.trim()
        ? rawClientRuntime.requestId.trim()
        : null,
      routeState: typeof rawClientRuntime.routeState === 'string' && rawClientRuntime.routeState.trim()
        ? rawClientRuntime.routeState.trim()
        : null,
      routeTarget: typeof rawClientRuntime.routeTarget === 'string' && rawClientRuntime.routeTarget.trim()
        ? rawClientRuntime.routeTarget.trim()
        : null,
      workflowStep: typeof rawClientRuntime.workflowStep === 'string' && rawClientRuntime.workflowStep.trim()
        ? rawClientRuntime.workflowStep.trim()
        : null,
      nextWorkflowStep: typeof rawClientRuntime.nextWorkflowStep === 'string' && rawClientRuntime.nextWorkflowStep.trim()
        ? rawClientRuntime.nextWorkflowStep.trim()
        : null,
      handoffToken: typeof rawClientRuntime.handoffToken === 'string' && rawClientRuntime.handoffToken.trim()
        ? rawClientRuntime.handoffToken.trim()
        : null,
      submitDisabledReason: typeof rawClientRuntime.submitDisabledReason === 'string' && rawClientRuntime.submitDisabledReason.trim()
        ? rawClientRuntime.submitDisabledReason.trim()
        : null,
      updatedAt: clientRuntimeUpdatedAt
    }
  };
}

function normalizeClientRuntimeState(input, generatedAt) {
  const raw = input.clientState && typeof input.clientState === 'object' && !Array.isArray(input.clientState)
    ? input.clientState
    : input.request && typeof input.request === 'object' && !Array.isArray(input.request)
      ? input.request
      : {};
  const errors = [];
  const replayMode = typeof raw.replayMode === 'string' && raw.replayMode.trim()
    ? raw.replayMode.trim()
    : 'inspect';
  const workflowStep = typeof raw.workflowStep === 'string' && raw.workflowStep.trim()
    ? raw.workflowStep.trim()
    : 'collect-evidence';
  const requestedBy = typeof raw.requestedBy === 'string' && raw.requestedBy.trim()
    ? raw.requestedBy.trim()
    : 'hosted-kernel-client';
  const requestId = typeof raw.requestId === 'string' && raw.requestId.trim()
    ? raw.requestId.trim()
    : proofDigest({ surfaceId, generatedAt, requestedBy }).replace('fnv1a32:', 'replay-');
  const selectedClaimIds = Array.isArray(raw.selectedClaimIds)
    ? raw.selectedClaimIds
      .filter((claimId) => typeof claimId === 'string' && claimId.trim())
      .map((claimId) => claimId.trim())
    : [];
  const acknowledgedProofDigests = Array.isArray(raw.acknowledgedProofDigests)
    ? raw.acknowledgedProofDigests
      .filter((digest) => typeof digest === 'string' && digest.trim())
      .map((digest) => digest.trim())
    : [];

  if (!CLIENT_REPLAY_MODES.has(replayMode)) {
    errors.push({
      code: 'CLIENT_REPLAY_MODE_INVALID',
      path: 'clientState.replayMode',
      message: `Unsupported evidence replay client mode: ${replayMode}.`,
      action: 'Use inspect, run, or handoff when requesting hosted-kernel evidence replay.'
    });
  }
  if (!CLIENT_WORKFLOW_STEPS.has(workflowStep)) {
    errors.push({
      code: 'CLIENT_WORKFLOW_STEP_INVALID',
      path: 'clientState.workflowStep',
      message: `Unsupported evidence replay workflow step: ${workflowStep}.`,
      action: 'Use collect-evidence, replay-evidence, review-proof, or open-claim-gate.'
    });
  }
  if (raw.selectedClaimIds !== undefined && !Array.isArray(raw.selectedClaimIds)) {
    errors.push({
      code: 'CLIENT_SELECTED_CLAIMS_INVALID',
      path: 'clientState.selectedClaimIds',
      message: 'Selected claim ids must be provided as an array of strings.',
      action: 'Send clientState.selectedClaimIds as the claim ids currently selected in the replay UI.'
    });
  }
  if (raw.acknowledgedProofDigests !== undefined && !Array.isArray(raw.acknowledgedProofDigests)) {
    errors.push({
      code: 'CLIENT_ACKNOWLEDGED_PROOFS_INVALID',
      path: 'clientState.acknowledgedProofDigests',
      message: 'Acknowledged proof digests must be provided as an array of strings.',
      action: 'Send clientState.acknowledgedProofDigests as proof digests the operator has reviewed.'
    });
  }

  return {
    ok: errors.length === 0,
    errors,
    contract: 'hosted-kernel evidence replay client state/v1',
    requestId,
    requestedBy,
    replayMode,
    workflowStep,
    selectedClaimIds: [...new Set(selectedClaimIds)],
    acknowledgedProofDigests: [...new Set(acknowledgedProofDigests)]
  };
}

function normalizeLifecycleSettings(input, generatedAt, requestId, persistedState) {
  const raw = input.lifecycle && typeof input.lifecycle === 'object' && !Array.isArray(input.lifecycle)
    ? input.lifecycle
    : input.settings && typeof input.settings === 'object' && !Array.isArray(input.settings)
      ? input.settings
      : {};
  const errors = [];
  const command = typeof raw.command === 'string' && raw.command.trim()
    ? raw.command.trim()
    : 'status';
  const enabledInput = raw.enabled;
  const pausedInput = raw.paused;
  const recoveredLifecycle = persistedState?.recoveredLifecycle || {};
  const recoveredDisabledUntil = typeof recoveredLifecycle.disabledUntil === 'string' && recoveredLifecycle.disabledUntil.trim()
    ? recoveredLifecycle.disabledUntil.trim()
    : null;
  const recoveredPausedUntil = typeof recoveredLifecycle.pausedUntil === 'string' && recoveredLifecycle.pausedUntil.trim()
    ? recoveredLifecycle.pausedUntil.trim()
    : null;
  let enabled = typeof enabledInput === 'boolean'
    ? enabledInput
    : typeof recoveredLifecycle.enabled === 'boolean'
      ? recoveredLifecycle.enabled
      : true;
  let paused = typeof pausedInput === 'boolean'
    ? pausedInput
    : typeof recoveredLifecycle.paused === 'boolean'
      ? recoveredLifecycle.paused
      : false;
  const commandId = typeof raw.commandId === 'string' && raw.commandId.trim()
    ? raw.commandId.trim()
    : proofDigest({
        surfaceId,
        requestId,
        command,
        enabledInput,
        pausedInput,
        disabledUntil: raw.disabledUntil || raw.disableUntil || null,
        pausedUntil: raw.pausedUntil || raw.resumeAt || null,
        schedule: raw.schedule || null
      })
      .replace('fnv1a32:', 'cmd-');
  const duplicateCommand = command !== 'status'
    && Array.isArray(persistedState?.appliedCommandIds)
    && persistedState.appliedCommandIds.includes(commandId);

  if (!LIFECYCLE_COMMANDS.has(command)) {
    errors.push({
      code: 'LIFECYCLE_COMMAND_INVALID',
      path: 'lifecycle.command',
      message: `Unsupported evidence replay lifecycle command: ${command}.`,
      action: 'Use status, enable, disable, pause, resume, run-now, or schedule.'
    });
  }
  if (enabledInput !== undefined && typeof enabledInput !== 'boolean') {
    errors.push({
      code: 'LIFECYCLE_ENABLED_INVALID',
      path: 'lifecycle.enabled',
      message: 'Evidence replay enabled control must be a boolean.',
      action: 'Set lifecycle.enabled to true or false before issuing replay controls.'
    });
  }
  if (pausedInput !== undefined && typeof pausedInput !== 'boolean') {
    errors.push({
      code: 'LIFECYCLE_PAUSED_INVALID',
      path: 'lifecycle.paused',
      message: 'Evidence replay paused control must be a boolean.',
      action: 'Set lifecycle.paused to true or false before issuing replay controls.'
    });
  }

  if (raw.commandId !== undefined && (typeof raw.commandId !== 'string' || !raw.commandId.trim())) {
    errors.push({
      code: 'LIFECYCLE_COMMAND_ID_INVALID',
      path: 'lifecycle.commandId',
      message: 'Evidence replay lifecycle commandId must be a non-empty string.',
      action: 'Use a stable commandId so hosted-kernel replay commands are idempotent across restarts.'
    });
  }
  if (raw.disabledUntil !== undefined && (typeof raw.disabledUntil !== 'string' || !raw.disabledUntil.trim())) {
    errors.push({
      code: 'LIFECYCLE_DISABLED_UNTIL_INVALID',
      path: 'lifecycle.disabledUntil',
      message: 'Evidence replay disabledUntil must be a non-empty ISO timestamp string.',
      action: 'Use lifecycle.disabledUntil to bound a temporary disable window, or omit it for an indefinite disable.'
    });
  }
  if (raw.disableUntil !== undefined && (typeof raw.disableUntil !== 'string' || !raw.disableUntil.trim())) {
    errors.push({
      code: 'LIFECYCLE_DISABLE_UNTIL_INVALID',
      path: 'lifecycle.disableUntil',
      message: 'Evidence replay disableUntil must be a non-empty ISO timestamp string.',
      action: 'Use lifecycle.disabledUntil as the canonical temporary disable timestamp.'
    });
  }
  if (raw.pausedUntil !== undefined && (typeof raw.pausedUntil !== 'string' || !raw.pausedUntil.trim())) {
    errors.push({
      code: 'LIFECYCLE_PAUSED_UNTIL_INVALID',
      path: 'lifecycle.pausedUntil',
      message: 'Evidence replay pausedUntil must be a non-empty ISO timestamp string.',
      action: 'Use lifecycle.pausedUntil to bound a temporary pause window, or omit it for an indefinite pause.'
    });
  }
  if (raw.resumeAt !== undefined && (typeof raw.resumeAt !== 'string' || !raw.resumeAt.trim())) {
    errors.push({
      code: 'LIFECYCLE_RESUME_AT_INVALID',
      path: 'lifecycle.resumeAt',
      message: 'Evidence replay resumeAt must be a non-empty ISO timestamp string.',
      action: 'Use lifecycle.pausedUntil as the canonical temporary pause timestamp.'
    });
  }
  if (raw.reason !== undefined && (typeof raw.reason !== 'string' || !raw.reason.trim())) {
    errors.push({
      code: 'LIFECYCLE_REASON_INVALID',
      path: 'lifecycle.reason',
      message: 'Evidence replay lifecycle reason must be a non-empty string when provided.',
      action: 'Attach a concise operator reason for lifecycle changes so audit output explains the control-plane decision.'
    });
  }

  if (!duplicateCommand && (command === 'enable' || command === 'resume')) {
    enabled = true;
  }
  if (!duplicateCommand && command === 'disable') {
    enabled = false;
  }
  if (!duplicateCommand && command === 'pause') {
    paused = true;
  }
  if (!duplicateCommand && command === 'resume') {
    paused = false;
  }

  const rawSchedule = raw.schedule && typeof raw.schedule === 'object' && !Array.isArray(raw.schedule)
    ? raw.schedule
    : recoveredLifecycle.schedule && typeof recoveredLifecycle.schedule === 'object'
      ? recoveredLifecycle.schedule
      : {};
  const disablePolicy = typeof raw.disablePolicy === 'string' && raw.disablePolicy.trim()
    ? raw.disablePolicy.trim()
    : 'preserve-schedule';
  const pausePolicy = typeof raw.pausePolicy === 'string' && raw.pausePolicy.trim()
    ? raw.pausePolicy.trim()
    : 'keep-schedule';
  const disabledUntil = typeof raw.disabledUntil === 'string' && raw.disabledUntil.trim()
    ? raw.disabledUntil.trim()
    : typeof raw.disableUntil === 'string' && raw.disableUntil.trim()
      ? raw.disableUntil.trim()
      : command === 'disable'
        ? null
        : recoveredDisabledUntil;
  const pausedUntil = typeof raw.pausedUntil === 'string' && raw.pausedUntil.trim()
    ? raw.pausedUntil.trim()
    : typeof raw.resumeAt === 'string' && raw.resumeAt.trim()
      ? raw.resumeAt.trim()
      : command === 'pause'
        ? null
        : recoveredPausedUntil;
  const controlReason = typeof raw.reason === 'string' && raw.reason.trim()
    ? raw.reason.trim()
    : typeof raw.controlReason === 'string' && raw.controlReason.trim()
      ? raw.controlReason.trim()
      : null;
  const scheduleMode = typeof rawSchedule.mode === 'string' && rawSchedule.mode.trim()
    ? rawSchedule.mode.trim()
    : rawSchedule.nextRunAt
      ? 'at'
      : rawSchedule.intervalMs !== undefined
        ? 'interval'
        : 'manual';
  const scheduleEnabled = typeof rawSchedule.enabled === 'boolean'
    ? rawSchedule.enabled
    : command === 'schedule';
  const intervalMs = Number.isFinite(rawSchedule.intervalMs)
    ? Number(rawSchedule.intervalMs)
    : null;
  const nextRunAt = typeof rawSchedule.nextRunAt === 'string' && rawSchedule.nextRunAt.trim()
    ? rawSchedule.nextRunAt.trim()
    : null;
  const missedRunPolicy = typeof rawSchedule.missedRunPolicy === 'string' && rawSchedule.missedRunPolicy.trim()
    ? rawSchedule.missedRunPolicy.trim()
    : DEFAULT_SCHEDULE_MISSED_RUN_POLICY;
  const maxCatchUpRuns = Number.isInteger(rawSchedule.maxCatchUpRuns) && rawSchedule.maxCatchUpRuns >= 0
    ? Math.min(rawSchedule.maxCatchUpRuns, MAX_SCHEDULE_CATCH_UP_RUNS)
    : DEFAULT_SCHEDULE_MAX_CATCH_UP_RUNS;
  const parsedNow = Date.parse(generatedAt);
  const parsedNextRunAt = nextRunAt ? Date.parse(nextRunAt) : NaN;
  const parsedDisabledUntil = disabledUntil ? Date.parse(disabledUntil) : NaN;
  const parsedPausedUntil = pausedUntil ? Date.parse(pausedUntil) : NaN;

  if (!LIFECYCLE_DISABLE_POLICIES.has(disablePolicy)) {
    errors.push({
      code: 'LIFECYCLE_DISABLE_POLICY_INVALID',
      path: 'lifecycle.disablePolicy',
      message: `Unsupported evidence replay disable policy: ${disablePolicy}.`,
      action: 'Use preserve-schedule or clear-schedule when disabling hosted-kernel evidence replay.'
    });
  }
  if (!LIFECYCLE_PAUSE_POLICIES.has(pausePolicy)) {
    errors.push({
      code: 'LIFECYCLE_PAUSE_POLICY_INVALID',
      path: 'lifecycle.pausePolicy',
      message: `Unsupported evidence replay pause policy: ${pausePolicy}.`,
      action: 'Use keep-schedule or hold-schedule when pausing hosted-kernel evidence replay.'
    });
  }
  if (!LIFECYCLE_SCHEDULE_MODES.has(scheduleMode)) {
    errors.push({
      code: 'REPLAY_SCHEDULE_MODE_INVALID',
      path: 'lifecycle.schedule.mode',
      message: `Unsupported evidence replay schedule mode: ${scheduleMode}.`,
      action: 'Use manual, interval, or at for hosted-kernel evidence replay scheduling.'
    });
  }
  if (raw.schedule !== undefined && (!raw.schedule || typeof raw.schedule !== 'object' || Array.isArray(raw.schedule))) {
    errors.push({
      code: 'REPLAY_SCHEDULE_INVALID',
      path: 'lifecycle.schedule',
      message: 'Evidence replay schedule settings must be an object.',
      action: 'Send lifecycle.schedule as an object containing enabled, mode, intervalMs, or nextRunAt.'
    });
  }
  if (scheduleEnabled && intervalMs !== null && intervalMs < MIN_SCHEDULE_INTERVAL_MS) {
    errors.push({
      code: 'REPLAY_SCHEDULE_INTERVAL_TOO_SHORT',
      path: 'lifecycle.schedule.intervalMs',
      message: 'Evidence replay schedule interval must be at least 60000ms.',
      action: 'Use a schedule interval of one minute or longer to avoid hosted-kernel replay churn.'
    });
  }
  if (scheduleEnabled && nextRunAt && Number.isNaN(parsedNextRunAt)) {
    errors.push({
      code: 'REPLAY_SCHEDULE_NEXT_RUN_INVALID',
      path: 'lifecycle.schedule.nextRunAt',
      message: 'Evidence replay schedule nextRunAt must be an ISO timestamp.',
      action: 'Provide lifecycle.schedule.nextRunAt as an ISO-8601 timestamp.'
    });
  }
  if (scheduleEnabled && scheduleMode === 'interval' && intervalMs === null) {
    errors.push({
      code: 'REPLAY_SCHEDULE_INTERVAL_REQUIRED',
      path: 'lifecycle.schedule.intervalMs',
      message: 'Interval schedule mode requires intervalMs.',
      action: 'Set lifecycle.schedule.intervalMs to at least 60000ms when schedule.mode is interval.'
    });
  }
  if (scheduleEnabled && scheduleMode === 'at' && !nextRunAt) {
    errors.push({
      code: 'REPLAY_SCHEDULE_NEXT_RUN_REQUIRED',
      path: 'lifecycle.schedule.nextRunAt',
      message: 'At schedule mode requires nextRunAt.',
      action: 'Set lifecycle.schedule.nextRunAt to the ISO timestamp for the next evidence replay run.'
    });
  }
  if (!LIFECYCLE_MISSED_RUN_POLICIES.has(missedRunPolicy)) {
    errors.push({
      code: 'REPLAY_SCHEDULE_MISSED_RUN_POLICY_INVALID',
      path: 'lifecycle.schedule.missedRunPolicy',
      message: `Unsupported evidence replay missed run policy: ${missedRunPolicy}.`,
      action: 'Use skip, run-once, or catch-up to define how overdue scheduled replay should advance.'
    });
  }
  if (rawSchedule.maxCatchUpRuns !== undefined
    && (!Number.isInteger(rawSchedule.maxCatchUpRuns) || rawSchedule.maxCatchUpRuns < 0 || rawSchedule.maxCatchUpRuns > MAX_SCHEDULE_CATCH_UP_RUNS)) {
    errors.push({
      code: 'REPLAY_SCHEDULE_MAX_CATCH_UP_RUNS_INVALID',
      path: 'lifecycle.schedule.maxCatchUpRuns',
      message: `Evidence replay schedule maxCatchUpRuns must be an integer from 0 to ${MAX_SCHEDULE_CATCH_UP_RUNS}.`,
      action: 'Bound catch-up replay work so a stale scheduler cannot flood the hosted-kernel replay worker.'
    });
  }
  if (scheduleEnabled && scheduleMode === 'interval' && missedRunPolicy === 'catch-up' && maxCatchUpRuns < 1) {
    errors.push({
      code: 'REPLAY_SCHEDULE_CATCH_UP_REQUIRES_RUN_BUDGET',
      path: 'lifecycle.schedule.maxCatchUpRuns',
      message: 'Catch-up missed run policy requires maxCatchUpRuns to be at least 1.',
      action: 'Use maxCatchUpRuns from 1 to 10, or switch missedRunPolicy to skip or run-once.'
    });
  }
  if (scheduleEnabled && scheduleMode !== 'interval' && rawSchedule.missedRunPolicy !== undefined) {
    errors.push({
      code: 'REPLAY_SCHEDULE_MISSED_RUN_POLICY_UNSUPPORTED',
      path: 'lifecycle.schedule.missedRunPolicy',
      message: 'Missed run policy only applies to interval schedules.',
      action: 'Remove missedRunPolicy for manual or one-shot at schedules.'
    });
  }
  if (scheduleEnabled && scheduleMode !== 'interval' && rawSchedule.maxCatchUpRuns !== undefined) {
    errors.push({
      code: 'REPLAY_SCHEDULE_MAX_CATCH_UP_RUNS_UNSUPPORTED',
      path: 'lifecycle.schedule.maxCatchUpRuns',
      message: 'maxCatchUpRuns only applies to interval schedules.',
      action: 'Remove maxCatchUpRuns for manual or one-shot at schedules.'
    });
  }
  if (scheduleEnabled && scheduleMode === 'manual' && (nextRunAt || intervalMs !== null)) {
    errors.push({
      code: 'REPLAY_SCHEDULE_MANUAL_FIELDS_INVALID',
      path: 'lifecycle.schedule',
      message: 'Manual schedule mode cannot carry intervalMs or nextRunAt.',
      action: 'Use interval or at schedule mode when replay should be dispatched by the scheduler.'
    });
  }
  if (disabledUntil && Number.isNaN(parsedDisabledUntil)) {
    errors.push({
      code: 'LIFECYCLE_DISABLED_UNTIL_UNPARSEABLE',
      path: 'lifecycle.disabledUntil',
      message: 'Evidence replay disabledUntil must be a parseable ISO timestamp.',
      action: 'Provide a valid ISO-8601 timestamp or omit disabledUntil for an indefinite disable.'
    });
  }
  if (pausedUntil && Number.isNaN(parsedPausedUntil)) {
    errors.push({
      code: 'LIFECYCLE_PAUSED_UNTIL_UNPARSEABLE',
      path: 'lifecycle.pausedUntil',
      message: 'Evidence replay pausedUntil must be a parseable ISO timestamp.',
      action: 'Provide a valid ISO-8601 timestamp or omit pausedUntil for an indefinite pause.'
    });
  }
  if (command === 'disable' && disabledUntil && !Number.isNaN(parsedNow) && !Number.isNaN(parsedDisabledUntil) && parsedDisabledUntil <= parsedNow) {
    errors.push({
      code: 'LIFECYCLE_DISABLED_UNTIL_NOT_FUTURE',
      path: 'lifecycle.disabledUntil',
      message: 'Evidence replay disabledUntil must be in the future when issuing disable.',
      action: 'Use enable for an already elapsed disable window, or choose a future disabledUntil timestamp.'
    });
  }
  if (command === 'pause' && pausedUntil && !Number.isNaN(parsedNow) && !Number.isNaN(parsedPausedUntil) && parsedPausedUntil <= parsedNow) {
    errors.push({
      code: 'LIFECYCLE_PAUSED_UNTIL_NOT_FUTURE',
      path: 'lifecycle.pausedUntil',
      message: 'Evidence replay pausedUntil must be in the future when issuing pause.',
      action: 'Use resume for an already elapsed pause window, or choose a future pausedUntil timestamp.'
    });
  }

  const scheduleCleared = !duplicateCommand && command === 'disable' && disablePolicy === 'clear-schedule';
  const scheduleHeld = !duplicateCommand && command === 'pause' && pausePolicy === 'hold-schedule';
  const disableWindowActive = Boolean(disabledUntil && !Number.isNaN(parsedNow) && !Number.isNaN(parsedDisabledUntil) && parsedDisabledUntil > parsedNow);
  const pauseWindowActive = Boolean(pausedUntil && !Number.isNaN(parsedNow) && !Number.isNaN(parsedPausedUntil) && parsedPausedUntil > parsedNow);
  const disableWindowExpired = Boolean(disabledUntil && !Number.isNaN(parsedNow) && !Number.isNaN(parsedDisabledUntil) && parsedDisabledUntil <= parsedNow);
  const pauseWindowExpired = Boolean(pausedUntil && !Number.isNaN(parsedNow) && !Number.isNaN(parsedPausedUntil) && parsedPausedUntil <= parsedNow);

  if (!duplicateCommand && command === 'enable') {
    enabled = true;
  } else if (disableWindowActive) {
    enabled = false;
  } else if (disableWindowExpired && typeof enabledInput !== 'boolean') {
    enabled = true;
  }
  if (!duplicateCommand && command === 'resume') {
    paused = false;
  } else if (pauseWindowActive) {
    paused = true;
  } else if (pauseWindowExpired && typeof pausedInput !== 'boolean') {
    paused = false;
  }

  const effectiveScheduleEnabled = scheduleCleared ? false : scheduleEnabled;
  const effectiveNextRunAt = scheduleCleared ? null : nextRunAt;
  const scheduleDue = effectiveScheduleEnabled
    && enabled
    && !paused
    && !scheduleHeld
    && effectiveNextRunAt
    && !Number.isNaN(parsedNow)
    && !Number.isNaN(parsedNextRunAt)
    ? parsedNextRunAt <= parsedNow
    : false;
  const missedIntervalRuns = scheduleDue && scheduleMode === 'interval' && intervalMs
    ? Math.max(1, Math.floor((parsedNow - parsedNextRunAt) / intervalMs) + 1)
    : scheduleDue
      ? 1
      : 0;
  const dueRunCount = scheduleDue
    ? scheduleMode === 'interval' && missedRunPolicy === 'catch-up'
      ? Math.min(missedIntervalRuns, maxCatchUpRuns)
      : 1
    : 0;
  const nextRunAfterDispatch = scheduleDue && scheduleMode === 'interval' && intervalMs
    ? new Date(
        parsedNextRunAt + (missedRunPolicy === 'catch-up' && missedIntervalRuns > dueRunCount
          ? Math.max(1, dueRunCount) * intervalMs
          : Math.max(1, missedIntervalRuns) * intervalMs)
      ).toISOString()
    : scheduleDue && scheduleMode === 'at'
      ? null
      : effectiveNextRunAt;
  const catchUpRemaining = scheduleDue && scheduleMode === 'interval' && missedRunPolicy === 'catch-up'
    ? Math.max(0, missedIntervalRuns - dueRunCount)
    : 0;
  const rescheduleRequired = scheduleDue && (scheduleMode === 'at' || nextRunAfterDispatch !== effectiveNextRunAt);

  return {
    ok: errors.length === 0,
    errors,
    contract: 'hosted-kernel evidence replay lifecycle controls/v1',
    command,
    commandId,
    duplicateCommand,
    disablePolicy,
    pausePolicy,
    controlReason,
    enabled,
    paused,
    windows: {
      disabledUntil: disableWindowExpired || command === 'enable' ? null : disabledUntil,
      pausedUntil: pauseWindowExpired || command === 'resume' ? null : pausedUntil,
      disabledActive: disableWindowActive,
      pausedActive: pauseWindowActive,
      expired: [
        ...(disableWindowExpired ? ['disabledUntil'] : []),
        ...(pauseWindowExpired ? ['pausedUntil'] : [])
      ].filter((field) => LIFECYCLE_WINDOW_FIELDS.has(field))
    },
    runRequested: command === 'run-now' && !duplicateCommand,
    scheduleCleared,
    scheduleHeld,
    schedule: {
      mode: scheduleMode,
      enabled: effectiveScheduleEnabled,
      intervalMs,
      nextRunAt: effectiveNextRunAt,
      due: scheduleDue,
      missedRunPolicy,
      maxCatchUpRuns,
      missedRunCount: missedIntervalRuns,
      dueRunCount,
      catchUpRemaining,
      nextRunAfterDispatch,
      rescheduleRequired
    }
  };
}

function buildLifecycleControlState(lifecycle, persistedState, generatedAt) {
  const previous = persistedState?.recoveredLifecycle || {};
  const previousSchedule = previous.schedule && typeof previous.schedule === 'object'
    ? previous.schedule
    : {};
  const commandApplied = lifecycle.command !== 'status' && !lifecycle.duplicateCommand && lifecycle.ok;
  const commandRejected = lifecycle.command !== 'status' && !lifecycle.duplicateCommand && !lifecycle.ok;
  const schedulerBlockedBy = [];
  const commandBlockedBy = lifecycle.errors.map((error) => ({
    code: error.code,
    path: error.path,
    action: error.action
  }));

  if (!lifecycle.enabled) {
    schedulerBlockedBy.push('disabled');
  }
  if (lifecycle.paused) {
    schedulerBlockedBy.push('paused');
  }
  if (lifecycle.windows.disabledActive) {
    schedulerBlockedBy.push('disabled_until_window');
  }
  if (lifecycle.windows.pausedActive) {
    schedulerBlockedBy.push('paused_until_window');
  }
  if (lifecycle.scheduleHeld) {
    schedulerBlockedBy.push('pause_policy_hold_schedule');
  }
  if (!lifecycle.schedule.enabled) {
    schedulerBlockedBy.push('schedule_disabled');
  }

  const sideEffects = [];
  if (commandApplied && lifecycle.command === 'enable') {
    sideEffects.push('enabled_replay');
  }
  if (commandApplied && lifecycle.command === 'disable') {
    sideEffects.push(lifecycle.scheduleCleared ? 'disabled_replay_and_cleared_schedule' : 'disabled_replay');
    if (lifecycle.windows.disabledUntil) {
      sideEffects.push('armed_temporary_disable_window');
    }
  }
  if (commandApplied && lifecycle.command === 'pause') {
    sideEffects.push(lifecycle.scheduleHeld ? 'paused_replay_and_held_scheduler' : 'paused_replay');
    if (lifecycle.windows.pausedUntil) {
      sideEffects.push('armed_temporary_pause_window');
    }
  }
  if (commandApplied && lifecycle.command === 'resume') {
    sideEffects.push('resumed_replay');
  }
  if (commandApplied && lifecycle.command === 'run-now') {
    sideEffects.push('requested_immediate_replay');
  }
  if (commandApplied && lifecycle.command === 'schedule') {
    sideEffects.push('updated_replay_schedule');
  }

  const settingsPatch = {
    enabled: lifecycle.enabled,
    paused: lifecycle.paused,
    disabledUntil: lifecycle.windows.disabledUntil,
    pausedUntil: lifecycle.windows.pausedUntil,
    windows: lifecycle.windows,
    schedule: {
      enabled: lifecycle.schedule.rescheduleRequired && lifecycle.schedule.mode === 'at'
        ? false
        : lifecycle.schedule.enabled,
      mode: lifecycle.schedule.rescheduleRequired && lifecycle.schedule.mode === 'at'
        ? 'manual'
        : lifecycle.schedule.mode,
      intervalMs: lifecycle.schedule.mode === 'interval' ? lifecycle.schedule.intervalMs : null,
      nextRunAt: lifecycle.schedule.rescheduleRequired
        ? lifecycle.schedule.nextRunAfterDispatch
        : lifecycle.schedule.nextRunAt,
      missedRunPolicy: lifecycle.schedule.missedRunPolicy,
      maxCatchUpRuns: lifecycle.schedule.maxCatchUpRuns
    }
  };
  const schedulerIntent = lifecycle.schedule.due
    ? lifecycle.schedule.catchUpRemaining > 0
      ? 'dispatch-and-continue-catch-up'
      : lifecycle.schedule.rescheduleRequired
        ? 'dispatch-and-advance-schedule'
        : 'dispatch-due-run'
    : lifecycle.runRequested
      ? 'dispatch-manual-run'
      : lifecycle.schedule.enabled
        ? 'wait-for-next-run'
        : 'standby';
  const nextLifecycleCommand = commandRejected
    ? 'status'
    : lifecycle.duplicateCommand
      ? 'status'
      : !lifecycle.enabled
        ? 'enable'
        : lifecycle.paused || lifecycle.scheduleHeld
          ? 'resume'
          : lifecycle.schedule.due && lifecycle.schedule.catchUpRemaining > 0
            ? 'run-now'
            : lifecycle.schedule.rescheduleRequired
              ? 'schedule'
              : lifecycle.schedule.enabled
                ? 'status'
                : 'schedule';
  const commandState = lifecycle.command === 'status'
    ? 'read-only'
    : lifecycle.duplicateCommand
      ? 'duplicate'
      : commandRejected
        ? 'rejected'
        : commandApplied
          ? 'applied'
          : 'no-op';
  const commandResult = {
    contract: 'hosted-kernel evidence replay lifecycle command result/v1',
    commandId: lifecycle.commandId,
    command: lifecycle.command,
    state: commandState,
    applied: commandApplied,
    rejected: commandRejected,
    duplicate: lifecycle.duplicateCommand,
    generatedAt,
    reason: lifecycle.controlReason,
    blockedBy: commandBlockedBy,
    sideEffects,
    persistRequired: commandApplied || lifecycle.schedule.rescheduleRequired,
    persistPatch: commandApplied || lifecycle.schedule.rescheduleRequired ? settingsPatch : null,
    schedulerIntent,
    schedulerDispatch: {
      requested: lifecycle.runRequested || lifecycle.schedule.due,
      manual: lifecycle.runRequested,
      scheduled: lifecycle.schedule.due,
      dueRunCount: lifecycle.schedule.dueRunCount,
      rescheduleRequired: lifecycle.schedule.rescheduleRequired,
      nextRunAfterDispatch: lifecycle.schedule.nextRunAfterDispatch
    },
    nextLifecycleCommand,
    resultDigest: proofDigest({
      commandId: lifecycle.commandId,
      command: lifecycle.command,
      commandState,
      blockedBy: commandBlockedBy,
      settingsPatch,
      schedulerIntent,
      sideEffects
    }),
    action: commandRejected
      ? 'Reject this lifecycle command and return blockedBy to the operator before mutating persisted lifecycle state.'
      : lifecycle.duplicateCommand
        ? 'Return the persisted command result and do not dispatch duplicate lifecycle side effects.'
        : commandApplied
          ? 'Persist commandResult.persistPatch and append commandResult to the command ledger before dispatching side effects.'
          : 'Return lifecycle status without mutating persisted lifecycle state.'
  };

  return {
    contract: 'hosted-kernel evidence replay lifecycle control-plane/v1',
    generatedAt,
    commandApplied,
    commandId: lifecycle.commandId,
    idempotency: lifecycle.duplicateCommand ? 'duplicate_ignored' : commandApplied ? 'applied' : commandRejected ? 'rejected' : 'read_only',
    stateBefore: {
      enabled: typeof previous.enabled === 'boolean' ? previous.enabled : null,
      paused: typeof previous.paused === 'boolean' ? previous.paused : null,
      windows: {
        disabledUntil: typeof previous.disabledUntil === 'string' ? previous.disabledUntil : null,
        pausedUntil: typeof previous.pausedUntil === 'string' ? previous.pausedUntil : null
      },
      schedule: {
        enabled: typeof previousSchedule.enabled === 'boolean' ? previousSchedule.enabled : null,
        mode: typeof previousSchedule.mode === 'string' ? previousSchedule.mode : null,
        intervalMs: Number.isFinite(previousSchedule.intervalMs) ? previousSchedule.intervalMs : null,
        nextRunAt: typeof previousSchedule.nextRunAt === 'string' ? previousSchedule.nextRunAt : null
      }
    },
    stateAfter: {
      enabled: lifecycle.enabled,
      paused: lifecycle.paused,
      windows: lifecycle.windows,
      schedule: lifecycle.schedule
    },
    settingsPatch,
    scheduler: {
      due: lifecycle.schedule.due,
      blocked: schedulerBlockedBy.length > 0,
      blockedBy: schedulerBlockedBy,
      intent: schedulerIntent,
      missedRunPolicy: lifecycle.schedule.missedRunPolicy,
      dueRunCount: lifecycle.schedule.dueRunCount,
      catchUpRemaining: lifecycle.schedule.catchUpRemaining,
      nextRunAfterDispatch: lifecycle.schedule.nextRunAfterDispatch,
      rescheduleRequired: lifecycle.schedule.rescheduleRequired,
      leaseKey: lifecycle.schedule.enabled
        ? proofDigest({ surfaceId, commandId: lifecycle.commandId, nextRunAt: lifecycle.schedule.nextRunAt, intervalMs: lifecycle.schedule.intervalMs })
        : null
    },
    schedulerCommit: {
      required: lifecycle.schedule.rescheduleRequired,
      schedulePatch: lifecycle.schedule.rescheduleRequired
        ? {
            enabled: lifecycle.schedule.mode === 'at' ? false : lifecycle.schedule.enabled,
            mode: lifecycle.schedule.mode === 'at' ? 'manual' : lifecycle.schedule.mode,
            intervalMs: lifecycle.schedule.mode === 'interval' ? lifecycle.schedule.intervalMs : null,
            nextRunAt: lifecycle.schedule.nextRunAfterDispatch,
            missedRunPolicy: lifecycle.schedule.missedRunPolicy,
            maxCatchUpRuns: lifecycle.schedule.maxCatchUpRuns
          }
        : null,
      action: lifecycle.schedule.rescheduleRequired
        ? 'Persist schedulerCommit.schedulePatch with persistedState.lifecycle.schedule after dispatching the due replay run.'
        : 'No scheduler advancement is required for this lifecycle evaluation.'
    },
    sideEffects,
    commandResult,
    settingsDigest: proofDigest({
      enabled: lifecycle.enabled,
      paused: lifecycle.paused,
      disablePolicy: lifecycle.disablePolicy,
      pausePolicy: lifecycle.pausePolicy,
      controlReason: lifecycle.controlReason,
      windows: lifecycle.windows,
      schedule: lifecycle.schedule
    }),
    commandReceipt: proofDigest({
      commandId: lifecycle.commandId,
      command: lifecycle.command,
      controlReason: lifecycle.controlReason,
      windows: lifecycle.windows,
      schedule: lifecycle.schedule,
      commandResultDigest: commandResult.resultDigest
    })
  };
}

function buildNextAction(healthState, records, validationErrors, lifecycle, operationalHealth = null) {
  if (validationErrors.length > 0) {
    return {
      type: 'repair-settings-or-evidence',
      command: 'status',
      reason: validationErrors[0].code,
      claimId: validationErrors[0].claimId || null
    };
  }
  if (!lifecycle.enabled) {
    if (lifecycle.windows.disabledActive) {
      return {
        type: 'wait-for-enable-window',
        command: 'status',
        reason: 'temporary_disable_window_active',
        claimId: null,
        at: lifecycle.windows.disabledUntil
      };
    }
    return {
      type: 'enable-replay',
      command: 'enable',
      reason: 'lifecycle_disabled',
      claimId: null
    };
  }
  if (lifecycle.scheduleHeld) {
    return {
      type: 'resume-scheduler',
      command: 'resume',
      reason: 'schedule_held_by_pause_policy',
      claimId: null,
      at: lifecycle.schedule.nextRunAt
    };
  }
  if (lifecycle.paused) {
    if (lifecycle.windows.pausedActive) {
      return {
        type: 'wait-for-resume-window',
        command: 'status',
        reason: 'temporary_pause_window_active',
        claimId: null,
        at: lifecycle.windows.pausedUntil
      };
    }
    return {
      type: 'resume-replay',
      command: 'resume',
      reason: 'lifecycle_paused',
      claimId: null
    };
  }
  if (operationalHealth?.state === 'degraded') {
    return {
      type: 'retry-after-operational-recovery',
      command: 'run-now',
      reason: operationalHealth.retryAdvice.reason,
      claimId: null,
      afterMs: operationalHealth.retryAdvice.afterMs,
      components: operationalHealth.degradedBy
    };
  }

  const blocked = records.find((record) => record.status === 'blocked');
  if (blocked) {
    return {
      type: 'repair-blocked-claim',
      command: 'status',
      reason: blocked.audit.retry.reason,
      claimId: blocked.claimId
    };
  }

  const degraded = records.find((record) => record.status === 'degraded');
  if (degraded) {
    return {
      type: 'retry-replay',
      command: 'run-now',
      reason: degraded.audit.retry.reason,
      claimId: degraded.claimId,
      afterMs: degraded.audit.retry.nextBackoffMs
    };
  }

  if (lifecycle.runRequested || lifecycle.schedule.due) {
    if (lifecycle.schedule.due && lifecycle.schedule.rescheduleRequired) {
      return {
        type: lifecycle.schedule.catchUpRemaining > 0 ? 'continue-catch-up-replay' : 'commit-schedule-advance',
        command: lifecycle.schedule.catchUpRemaining > 0 ? 'run-now' : 'schedule',
        reason: lifecycle.schedule.catchUpRemaining > 0 ? 'scheduled_replay_catch_up_remaining' : 'scheduled_replay_completed',
        claimId: null,
        dueRunCount: lifecycle.schedule.dueRunCount,
        catchUpRemaining: lifecycle.schedule.catchUpRemaining,
        at: lifecycle.schedule.nextRunAfterDispatch
      };
    }
    return {
      type: 'open-claim-gate',
      command: 'status',
      reason: lifecycle.runRequested ? 'manual_replay_completed' : 'scheduled_replay_due',
      claimId: null
    };
  }

  if (lifecycle.schedule.enabled && lifecycle.schedule.nextRunAt) {
    return {
      type: 'wait-for-schedule',
      command: 'schedule',
      reason: 'next_replay_scheduled',
      claimId: null,
      at: lifecycle.schedule.nextRunAt
    };
  }

  return {
    type: healthState === 'healthy' ? 'open-claim-gate' : 'collect-evidence',
    command: 'status',
    reason: healthState === 'healthy' ? 'all_evidence_replayable' : 'no_evidence_submitted',
    claimId: null
  };
}

function operationalRequiredComponents(provider, boundary, clientState, lifecycle, reporting) {
  const required = new Set(['receipt-verifier']);
  if (clientState.replayMode === 'run' || lifecycle.runRequested || lifecycle.schedule.due) {
    required.add('replay-worker');
  }
  if (boundary.canExportAudit && reporting.exportFormat) {
    required.add('audit-export');
  }
  if (provider.capabilities.includes('sync.cursor') || provider.protocol !== 'hosted-kernel') {
    required.add('provider-sync');
  }
  if (clientState.replayMode === 'handoff' || clientState.workflowStep === 'open-claim-gate') {
    required.add('claim-gate');
  }
  return [...required].filter((component) => OPERATIONAL_HEALTH_COMPONENTS.has(component)).sort();
}

function normalizeOperationalHealth(input, generatedAt, provider, boundary, clientState, lifecycle, reporting) {
  const raw = input.operationalHealth && typeof input.operationalHealth === 'object' && !Array.isArray(input.operationalHealth)
    ? input.operationalHealth
    : input.healthProbes && typeof input.healthProbes === 'object' && !Array.isArray(input.healthProbes)
      ? input.healthProbes
      : {};
  const rawDependencies = Array.isArray(raw.dependencies)
    ? raw.dependencies
    : Array.isArray(raw.components)
      ? raw.components
      : [];
  const maxHeartbeatAgeMs = Number.isFinite(raw.maxHeartbeatAgeMs) && raw.maxHeartbeatAgeMs > 0
    ? Number(raw.maxHeartbeatAgeMs)
    : DEFAULT_OPERATIONAL_HEARTBEAT_MAX_AGE_MS;
  const parsedNow = Date.parse(generatedAt);
  const errors = [];
  const requiredComponents = operationalRequiredComponents(provider, boundary, clientState, lifecycle, reporting);
  const dependencies = rawDependencies.map((dependency, index) => {
    if (!dependency || typeof dependency !== 'object' || Array.isArray(dependency)) {
      errors.push({
        code: 'OPERATIONAL_HEALTH_DEPENDENCY_INVALID',
        path: `operationalHealth.dependencies[${index}]`,
        message: 'Operational health dependencies must be objects.',
        action: 'Report each hosted-kernel dependency with component, state, lastOkAt, circuitState, and optional lastError.'
      });
      return null;
    }

    const component = typeof dependency.component === 'string' && dependency.component.trim()
      ? dependency.component.trim()
      : typeof dependency.name === 'string' && dependency.name.trim()
        ? dependency.name.trim()
        : null;
    const state = typeof dependency.state === 'string' && dependency.state.trim()
      ? dependency.state.trim()
      : 'unknown';
    const lastOkAt = typeof dependency.lastOkAt === 'string' && dependency.lastOkAt.trim()
      ? dependency.lastOkAt.trim()
      : typeof dependency.lastHeartbeatAt === 'string' && dependency.lastHeartbeatAt.trim()
        ? dependency.lastHeartbeatAt.trim()
        : null;
    const parsedLastOkAt = lastOkAt ? Date.parse(lastOkAt) : NaN;
    const ageMs = lastOkAt && !Number.isNaN(parsedNow) && !Number.isNaN(parsedLastOkAt)
      ? Math.max(0, parsedNow - parsedLastOkAt)
      : null;
    const stale = typeof ageMs === 'number' ? ageMs > maxHeartbeatAgeMs : false;
    const circuitState = typeof dependency.circuitState === 'string' && dependency.circuitState.trim()
      ? dependency.circuitState.trim()
      : dependency.circuit && typeof dependency.circuit === 'object' && typeof dependency.circuit.state === 'string'
        ? dependency.circuit.state.trim()
        : 'closed';
    const consecutiveFailures = Number.isInteger(dependency.consecutiveFailures) && dependency.consecutiveFailures >= 0
      ? dependency.consecutiveFailures
      : 0;
    const lastError = dependency.lastError && typeof dependency.lastError === 'object' && !Array.isArray(dependency.lastError)
      ? {
          code: typeof dependency.lastError.code === 'string' && dependency.lastError.code.trim()
            ? dependency.lastError.code.trim()
            : 'OPERATIONAL_DEPENDENCY_ERROR',
          message: typeof dependency.lastError.message === 'string' && dependency.lastError.message.trim()
            ? dependency.lastError.message.trim()
            : 'Hosted-kernel dependency reported an operational error.',
          action: typeof dependency.lastError.action === 'string' && dependency.lastError.action.trim()
            ? dependency.lastError.action.trim()
            : 'Inspect the dependency health probe and retry evidence replay after it recovers.'
        }
      : null;

    if (!component || !OPERATIONAL_HEALTH_COMPONENTS.has(component)) {
      errors.push({
        code: 'OPERATIONAL_HEALTH_COMPONENT_INVALID',
        path: `operationalHealth.dependencies[${index}].component`,
        message: `Unsupported evidence replay operational component: ${component || 'missing'}.`,
        action: 'Use receipt-verifier, replay-worker, audit-export, provider-sync, or claim-gate.'
      });
    }
    if (!OPERATIONAL_HEALTH_STATES.has(state)) {
      errors.push({
        code: 'OPERATIONAL_HEALTH_STATE_INVALID',
        path: `operationalHealth.dependencies[${index}].state`,
        message: `Unsupported evidence replay operational health state: ${state}.`,
        action: 'Report dependency health as healthy, degraded, unhealthy, or unknown.'
      });
    }
    if (lastOkAt && Number.isNaN(parsedLastOkAt)) {
      errors.push({
        code: 'OPERATIONAL_HEALTH_LAST_OK_AT_INVALID',
        path: `operationalHealth.dependencies[${index}].lastOkAt`,
        message: 'Operational dependency lastOkAt must be a parseable ISO timestamp.',
        action: 'Send lastOkAt as an ISO-8601 timestamp so stale hosted-kernel dependencies can be quarantined.'
      });
    }
    if (!OPERATIONAL_CIRCUIT_STATES.has(circuitState)) {
      errors.push({
        code: 'OPERATIONAL_HEALTH_CIRCUIT_STATE_INVALID',
        path: `operationalHealth.dependencies[${index}].circuitState`,
        message: `Unsupported evidence replay circuit state: ${circuitState}.`,
        action: 'Use closed, half-open, or open for dependency circuit state.'
      });
    }

    const blocking = state === 'unhealthy' || stale || circuitState === 'open';
    const degraded = !blocking && (state === 'degraded' || state === 'unknown' || circuitState === 'half-open' || consecutiveFailures > 0);
    return {
      component,
      state: OPERATIONAL_HEALTH_STATES.has(state) ? state : 'unknown',
      lastOkAt,
      ageMs,
      stale,
      circuitState: OPERATIONAL_CIRCUIT_STATES.has(circuitState) ? circuitState : 'open',
      consecutiveFailures,
      blocking,
      degraded,
      lastError,
      action: blocking
        ? 'Keep claim-gate handoff closed until this hosted-kernel dependency reports healthy and its circuit is closed.'
        : degraded
          ? 'Keep replay in degraded mode and retry with backoff while monitoring this dependency.'
          : 'Dependency is available for hosted-kernel evidence replay.'
    };
  }).filter(Boolean);
  const reportedComponents = new Set(dependencies.map((dependency) => dependency.component).filter(Boolean));
  const missingRequired = requiredComponents
    .filter((component) => !reportedComponents.has(component))
    .map((component) => ({
      code: rawDependencies.length === 0
        ? 'OPERATIONAL_HEALTH_REQUIRED_COMPONENT_UNREPORTED'
        : 'OPERATIONAL_HEALTH_REQUIRED_COMPONENT_MISSING',
      path: 'operationalHealth.dependencies',
      component,
      severity: rawDependencies.length === 0 ? 'warning' : 'error',
      blocking: rawDependencies.length > 0,
      message: rawDependencies.length === 0
        ? `Hosted-kernel dependency ${component} has no health probe in this replay request.`
        : `Hosted-kernel dependency ${component} is required but was not reported by operational health.`,
      action: `Report ${component} health with state, lastOkAt, circuitState, and lastError when ${OPERATIONAL_COMPONENT_REQUIREMENTS[component]}.`
    }));
  const blockingDependencies = dependencies.filter((dependency) => dependency.blocking);
  const degradedDependencies = dependencies.filter((dependency) => dependency.degraded);
  const blockingErrors = blockingDependencies.map((dependency) => ({
    code: dependency.stale ? 'OPERATIONAL_HEALTH_HEARTBEAT_STALE' : 'OPERATIONAL_HEALTH_DEPENDENCY_BLOCKING',
    path: 'operationalHealth.dependencies',
    component: dependency.component,
    message: dependency.lastError?.message || `Hosted-kernel dependency ${dependency.component} is blocking evidence replay.`,
    action: dependency.lastError?.action || dependency.action
  })).concat(missingRequired.filter((finding) => finding.blocking));
  const degradedFindings = missingRequired.filter((finding) => !finding.blocking)
    .concat(degradedDependencies.map((dependency) => ({
      code: 'OPERATIONAL_HEALTH_DEPENDENCY_DEGRADED',
      path: 'operationalHealth.dependencies',
      component: dependency.component,
      severity: 'warning',
      blocking: false,
      message: dependency.lastError?.message || `Hosted-kernel dependency ${dependency.component} is degraded for evidence replay.`,
      action: dependency.lastError?.action || dependency.action
    })));
  const state = blockingDependencies.length > 0 || errors.length > 0 || missingRequired.some((finding) => finding.blocking)
    ? 'unhealthy'
    : degradedDependencies.length > 0 || missingRequired.length > 0
      ? 'degraded'
      : 'healthy';
  const maxFailureCount = dependencies.reduce((max, dependency) => Math.max(max, dependency.consecutiveFailures), 0);
  const backoffExponent = Math.min(5, Math.max(degradedFindings.length, maxFailureCount));
  const retryAfterMs = degradedFindings.length > 0
    ? Math.min(DEFAULT_MAX_BACKOFF_MS, DEFAULT_BASE_BACKOFF_MS * (2 ** backoffExponent))
    : 0;
  const healthProof = proofDigest({
    generatedAt,
    requiredComponents,
    state,
    maxHeartbeatAgeMs,
    blocking: blockingErrors.map((error) => ({ code: error.code, component: error.component })),
    degraded: degradedFindings.map((finding) => ({ code: finding.code, component: finding.component })),
    dependencies: dependencies.map((dependency) => ({
      component: dependency.component,
      state: dependency.state,
      lastOkAt: dependency.lastOkAt,
      stale: dependency.stale,
      circuitState: dependency.circuitState,
      consecutiveFailures: dependency.consecutiveFailures,
      lastErrorCode: dependency.lastError?.code || null
    }))
  });

  return {
    contract: 'hosted-kernel evidence replay operational health/v1',
    ok: errors.length === 0 && blockingErrors.length === 0,
    configured: rawDependencies.length > 0,
    state,
    maxHeartbeatAgeMs,
    requiredComponents,
    errors,
    blockingErrors,
    degradedFindings,
    dependencies,
    blockedBy: blockingDependencies.map((dependency) => dependency.component).sort(),
    degradedBy: [...new Set(degradedDependencies.map((dependency) => dependency.component).concat(
      missingRequired.filter((finding) => !finding.blocking).map((finding) => finding.component)
    ))].sort(),
    retryAdvice: degradedFindings.length > 0
      ? {
          retryable: true,
          afterMs: retryAfterMs,
          reason: missingRequired.length > 0 ? 'operational_health_probe_missing' : 'operational_dependency_degraded'
        }
      : {
          retryable: false,
          afterMs: 0,
          reason: blockingDependencies.length > 0 ? 'operational_dependency_blocking' : 'operational_dependencies_healthy'
        },
    proof: {
      digest: healthProof,
      componentsVerified: dependencies
        .filter((dependency) => requiredComponents.includes(dependency.component) && !dependency.blocking && !dependency.degraded)
        .map((dependency) => dependency.component)
        .sort(),
      missingRequiredComponents: missingRequired.map((finding) => finding.component).sort(),
      actionableFindings: blockingErrors.concat(degradedFindings)
    }
  };
}

function summarizeHealth(records, validationErrors, lifecycle, operationalHealth) {
  if (!lifecycle.enabled) {
    return {
      state: 'disabled',
      canOpenClaimGate: false,
      reason: 'lifecycle_disabled',
      nextAction: buildNextAction('disabled', records, validationErrors, lifecycle, operationalHealth)
    };
  }
  if (lifecycle.paused) {
    return {
      state: 'paused',
      canOpenClaimGate: false,
      reason: 'lifecycle_paused',
      nextAction: buildNextAction('paused', records, validationErrors, lifecycle, operationalHealth)
    };
  }

  const blocked = records.filter((record) => record.status === 'blocked');
  const degraded = records.filter((record) => record.status === 'degraded');
  let state = 'healthy';
  let reason = records.length > 0 ? 'all_evidence_replayable' : 'no_evidence_submitted';
  let canOpenClaimGate = records.length > 0;

  if (validationErrors.length > 0 || blocked.length > 0) {
    state = 'unhealthy';
    canOpenClaimGate = false;
    reason = validationErrors.length > 0 ? 'validation_failed' : 'blocked_replay_failure';
  } else if (degraded.length > 0) {
    state = 'degraded';
    canOpenClaimGate = false;
    reason = 'recoverable_replay_failure';
  } else if (operationalHealth?.state === 'degraded') {
    state = 'degraded';
    canOpenClaimGate = false;
    reason = 'operational_dependency_degraded';
  }

  return {
    state,
    canOpenClaimGate,
    reason,
    nextAction: buildNextAction(state, records, validationErrors, lifecycle, operationalHealth)
  };
}

function buildWorkflowHandoff(clientState, boundary, health, lifecycle, records, validationErrors, timeline, generatedAt) {
  const selected = clientState.selectedClaimIds.length > 0
    ? records.filter((record) => clientState.selectedClaimIds.includes(record.claimId))
    : records;
  const visibleRecords = selected.length > 0 || clientState.selectedClaimIds.length === 0
    ? selected
    : records.filter((record) => record.status !== 'accepted');
  const missingSelectedClaimIds = clientState.selectedClaimIds
    .filter((claimId) => !records.some((record) => record.claimId === claimId))
    .sort();
  const unacknowledged = visibleRecords
    .filter((record) => !clientState.acknowledgedProofDigests.includes(record.proofDigest));
  const firstBlockingRecord = visibleRecords.find((record) => record.status === 'blocked') || null;
  const firstRetryableRecord = visibleRecords.find((record) => record.status === 'degraded') || null;
  const primaryRecord = firstBlockingRecord || firstRetryableRecord || unacknowledged[0] || visibleRecords[0] || null;
  const queue = visibleRecords.map((record) => ({
    claimId: record.claimId,
    status: record.status,
    proofDigest: record.proofDigest,
    sourceReceiptDigest: record.sourceReceipt.digest,
    sourceType: record.sourceReceipt.sourceType,
    sourceVerified: record.sourceReceipt.verified,
    selected: clientState.selectedClaimIds.includes(record.claimId),
    acknowledged: clientState.acknowledgedProofDigests.includes(record.proofDigest),
    nextCommand: record.status === 'degraded' ? 'run-now' : 'status',
    action: record.action
  }));
  const blockedByClientAck = health.canOpenClaimGate && unacknowledged.length > 0 && clientState.replayMode === 'handoff';
  const blockedByBoundary = clientState.replayMode === 'handoff' && !boundary.canHandoff;
  const handoffStep = validationErrors.length > 0 || missingSelectedClaimIds.length > 0
    ? 'collect-evidence'
    : firstBlockingRecord
      ? 'review-proof'
      : firstRetryableRecord
        ? 'replay-evidence'
        : health.canOpenClaimGate && !blockedByClientAck
          ? 'open-claim-gate'
          : 'review-proof';

  return {
    contract: 'hosted-kernel evidence replay workflow handoff/v1',
    requestId: clientState.requestId,
    generatedAt,
    tenantId: boundary.tenantId,
    workspaceId: boundary.workspaceId,
    actorId: boundary.actorId,
    replayMode: clientState.replayMode,
    currentStep: clientState.workflowStep,
    nextStep: handoffStep,
    canHandoffToClaimGate: health.canOpenClaimGate
      && !blockedByClientAck
      && !blockedByBoundary
      && validationErrors.length === 0
      && missingSelectedClaimIds.length === 0,
    blockedByClientAcknowledgement: blockedByClientAck,
    blockedByBoundary,
    primaryClaimId: primaryRecord ? primaryRecord.claimId : null,
    primaryProofDigest: primaryRecord ? primaryRecord.proofDigest : null,
    missingSelectedClaimIds,
    queue,
    timelineCursor: timeline.length > 0 ? timeline[timeline.length - 1].order : null,
    command: blockedByClientAck
      ? 'acknowledge-proof'
      : blockedByBoundary
        ? 'request-boundary-permission'
        : health.nextAction.command,
    reason: blockedByClientAck
      ? 'proof_review_required_before_handoff'
      : blockedByBoundary
        ? 'claim_gate_handoff_permission_required'
      : health.nextAction.reason,
    lifecycleCommand: lifecycle.command
  };
}

function buildPreviewAcceptanceState(clientState, boundary, health, lifecycle, provider, workflowHandoff, records, validationErrors, generatedAt) {
  const selectedClaimIds = clientState.selectedClaimIds.length > 0
    ? clientState.selectedClaimIds
    : records.map((record) => record.claimId);
  const previewRecords = records
    .filter((record) => selectedClaimIds.includes(record.claimId))
    .map((record) => {
      const acknowledged = clientState.acknowledgedProofDigests.includes(record.proofDigest);
      const readyForAcceptance = record.status === 'accepted' && acknowledged;
      return {
        claimId: record.claimId,
        status: record.status,
        source: record.source,
        sourceType: record.sourceReceipt.sourceType,
        sourceSigner: record.sourceReceipt.signer,
        proofDigest: record.proofDigest,
        sourceReceiptDigest: record.sourceReceipt.digest,
        acknowledged,
        readyForAcceptance,
        readiness: record.status === 'blocked'
          ? 'blocked'
          : record.status === 'degraded'
            ? 'retry-required'
            : acknowledged
              ? 'accepted'
              : 'review-required',
        nextStep: record.status === 'blocked'
          ? {
              type: 'repair-proof',
              command: 'status',
              reason: record.audit.retry.reason,
              action: record.action
            }
          : record.status === 'degraded'
            ? {
                type: 'retry-replay',
                command: 'run-now',
                reason: record.audit.retry.reason,
                afterMs: record.audit.retry.nextBackoffMs,
                action: record.action
              }
            : acknowledged
              ? {
                  type: 'include-in-handoff',
                  command: 'handoff',
                  reason: 'proof_acknowledged',
                  action: 'Include this proof in the next claim-gate acceptance handoff.'
                }
              : {
                  type: 'acknowledge-proof',
                  command: 'acknowledge-proof',
                  reason: 'operator_review_required',
                  action: 'Review and acknowledge the proof digest before claim-gate acceptance.'
                }
      };
    });
  const missingSelectedClaimIds = selectedClaimIds
    .filter((claimId) => !records.some((record) => record.claimId === claimId))
    .sort();
  const validationSummary = {
    ok: validationErrors.length === 0,
    total: validationErrors.length,
    byCode: validationErrors.reduce((counts, error) => {
      counts[error.code] = (counts[error.code] || 0) + 1;
      return counts;
    }, {}),
    firstError: validationErrors[0]
      ? {
          code: validationErrors[0].code,
          path: validationErrors[0].path,
          claimId: validationErrors[0].claimId || null,
          action: validationErrors[0].action
        }
      : null
  };
  const blockers = [
    ...validationErrors.map((error) => ({
      type: 'validation',
      code: error.code,
      claimId: error.claimId || null,
      action: error.action
    })),
    ...missingSelectedClaimIds.map((claimId) => ({
      type: 'selection',
      code: 'SELECTED_CLAIM_NOT_FOUND',
      claimId,
      action: 'Remove the claim from clientState.selectedClaimIds or submit matching evidence.'
    })),
    ...previewRecords
      .filter((record) => record.readiness !== 'accepted')
      .map((record) => ({
        type: 'claim',
        code: record.readiness === 'review-required' ? 'PROOF_ACKNOWLEDGEMENT_REQUIRED' : 'CLAIM_NOT_READY_FOR_ACCEPTANCE',
        claimId: record.claimId,
        action: record.nextStep.action
      }))
  ];
  const readiness = {
    previewable: records.length > 0 && boundary.ok,
    replayRunnable: boundary.canReplay && lifecycle.enabled && !lifecycle.paused && validationErrors.length === 0,
    providerReady: provider.negotiated,
    claimGateReady: workflowHandoff.canHandoffToClaimGate && blockers.length === 0,
    acceptanceReady: health.canOpenClaimGate
      && provider.negotiated
      && workflowHandoff.canHandoffToClaimGate
      && blockers.length === 0
      && previewRecords.length > 0
  };

  return {
    contract: 'hosted-kernel evidence replay preview acceptance/v1',
    generatedAt,
    requestId: clientState.requestId,
    scope: {
      tenantId: boundary.tenantId,
      workspaceId: boundary.workspaceId,
      actorId: boundary.actorId
    },
    mode: clientState.replayMode,
    currentStep: clientState.workflowStep,
    nextStep: readiness.acceptanceReady
      ? {
          type: 'accept-claim-gate-preview',
          command: 'handoff',
          reason: 'preview_validated_and_acknowledged',
          action: 'Submit previewAcceptance.acceptanceEnvelope to the claim-gate route.'
        }
      : workflowHandoff.reason === 'proof_review_required_before_handoff'
        ? {
            type: 'acknowledge-proof',
            command: 'acknowledge-proof',
            reason: workflowHandoff.reason,
            action: 'Acknowledge every preview proof digest before requesting handoff.'
          }
        : {
            type: health.nextAction.type,
            command: health.nextAction.command,
            reason: health.nextAction.reason,
            action: blockers[0]?.action || 'Continue the hosted-kernel evidence replay workflow.'
          },
    readiness,
    validationSummary,
    blockers,
    preview: {
      total: previewRecords.length,
      acceptedTotal: previewRecords.filter((record) => record.readiness === 'accepted').length,
      reviewRequiredTotal: previewRecords.filter((record) => record.readiness === 'review-required').length,
      retryRequiredTotal: previewRecords.filter((record) => record.readiness === 'retry-required').length,
      blockedTotal: previewRecords.filter((record) => record.readiness === 'blocked').length,
      missingSelectedClaimIds,
      records: previewRecords
    },
    acceptanceEnvelope: readiness.acceptanceReady
      ? {
          contract: 'hosted-kernel claim-gate acceptance envelope/v1',
          requestId: clientState.requestId,
          tenantId: boundary.tenantId,
          workspaceId: boundary.workspaceId,
          acceptedClaimIds: previewRecords.map((record) => record.claimId).sort(),
          acceptedProofDigests: previewRecords.map((record) => record.proofDigest).sort(),
          providerId: provider.providerId,
          serviceId: provider.serviceId,
          envelopeDigest: proofDigest({
            requestId: clientState.requestId,
            tenantId: boundary.tenantId,
            workspaceId: boundary.workspaceId,
            providerId: provider.providerId,
            accepted: previewRecords.map((record) => ({
              claimId: record.claimId,
              proofDigest: record.proofDigest,
              sourceReceiptDigest: record.sourceReceiptDigest
            }))
          })
        }
      : null
  };
}

function buildClientRouteReadinessState(clientState, previewAcceptance, workflowHandoff, providerSync, externalHandoff, reporting, auditHandoff, workspaceScope, lifecycle, generatedAt) {
  const routeBlockers = [
    ...previewAcceptance.blockers.map((blocker) => ({
      source: blocker.type,
      code: blocker.code,
      claimId: blocker.claimId || null,
      action: blocker.action
    })),
    ...externalHandoff.blockedBy.map((reason) => ({
      source: 'external-handoff',
      code: reason.toUpperCase(),
      claimId: null,
      action: externalHandoff.action
    }))
  ];
  const acceptanceRequirements = [
    {
      key: 'tenant-boundary-valid',
      satisfied: previewAcceptance.validationSummary.ok,
      evidence: previewAcceptance.validationSummary.firstError?.code || 'validation_clean'
    },
    {
      key: 'proofs-reviewed',
      satisfied: previewAcceptance.preview.reviewRequiredTotal === 0,
      evidence: `${previewAcceptance.preview.acceptedTotal}/${previewAcceptance.preview.total} accepted`
    },
    {
      key: 'retry-budget-clean',
      satisfied: previewAcceptance.preview.retryRequiredTotal === 0,
      evidence: `${previewAcceptance.preview.retryRequiredTotal} retry-required`
    },
    {
      key: 'provider-sync-ready',
      satisfied: providerSync.ready,
      evidence: providerSync.cursor.next || providerSync.syncDigest
    },
    {
      key: 'audit-export-allowed',
      satisfied: auditHandoff.exportAllowed,
      evidence: auditHandoff.receiptDigest
    },
    {
      key: 'workspace-scope-clean',
      satisfied: workspaceScope.ok && workspaceScope.blockingViolationTotal === 0,
      evidence: workspaceScope.policyDigest
    }
  ];
  const selectedRows = previewAcceptance.preview.records.map((record) => ({
    claimId: record.claimId,
    readiness: record.readiness,
    acknowledged: record.acknowledged,
    proofDigest: record.proofDigest,
    sourceReceiptDigest: record.sourceReceiptDigest,
    nextStep: record.nextStep.type
  }));
  const routeState = previewAcceptance.readiness.acceptanceReady
    ? 'ready'
    : routeBlockers.length > 0
      ? 'blocked'
      : previewAcceptance.preview.total > 0
        ? 'needs-review'
        : 'empty';
  const routeTarget = routeState === 'ready'
    ? 'claim-gate.acceptance'
    : workflowHandoff.nextStep === 'replay-evidence'
      ? 'evidence-replay.run'
      : workflowHandoff.nextStep === 'collect-evidence'
        ? 'evidence-replay.collect'
        : 'evidence-replay.preview';
  const validationSummaryDigest = proofDigest({
    requestId: clientState.requestId,
    validationSummary: previewAcceptance.validationSummary,
    routeBlockers,
    acceptanceRequirements,
    selectedRows
  });

  return {
    contract: 'hosted-kernel evidence replay client route readiness/v1',
    generatedAt,
    requestId: clientState.requestId,
    routeState,
    routeTarget,
    mode: clientState.replayMode,
    currentStep: clientState.workflowStep,
    nextStep: previewAcceptance.nextStep,
    readyForSubmit: routeState === 'ready',
    submitCommand: routeState === 'ready' ? 'accept-preview' : previewAcceptance.nextStep.command,
    submitDisabledReason: routeState === 'ready'
      ? null
      : routeBlockers[0]?.code || previewAcceptance.nextStep.reason,
    routeBlockers,
    acceptanceRequirements,
    validationSummary: {
      ...previewAcceptance.validationSummary,
      digest: validationSummaryDigest
    },
    previewRows: selectedRows,
    routePayload: routeState === 'ready'
      ? {
          contract: 'hosted-kernel evidence replay route payload/v1',
          target: routeTarget,
          requestId: clientState.requestId,
          acceptanceEnvelope: previewAcceptance.acceptanceEnvelope,
          providerCursor: providerSync.cursor.next,
          externalHandoffIdempotencyKey: externalHandoff.idempotencyKey,
          auditReceiptDigest: auditHandoff.receiptDigest,
          workspaceScopeDigest: workspaceScope.policyDigest,
          reportingManifestDigest: reporting.exportManifest.manifestDigest,
          lifecycleCommandId: lifecycle.commandId,
          validationSummaryDigest
        }
      : null,
    explainableNextSteps: routeState === 'ready'
      ? [{
          type: 'submit-acceptance',
          command: 'accept-preview',
          target: routeTarget,
          reason: 'all_acceptance_requirements_satisfied',
          action: 'Submit routePayload to the claim-gate acceptance route and persist provider/audit cursors after acknowledgement.'
        }]
      : routeBlockers.slice(0, 5).map((blocker) => ({
          type: blocker.source,
          command: previewAcceptance.nextStep.command,
          target: routeTarget,
          reason: blocker.code,
          claimId: blocker.claimId,
          action: blocker.action
        }))
  };
}

function buildClientRuntimeAdoptionState(clientState, persistedState, workflowHandoff, previewAcceptance, clientRouteReadiness, externalHandoff, providerSync, generatedAt) {
  const previous = persistedState.clientRuntime || {};
  const selectedClaimIds = previewAcceptance.preview.records
    .map((record) => record.claimId)
    .sort();
  const acknowledgedProofDigests = previewAcceptance.preview.records
    .filter((record) => record.acknowledged)
    .map((record) => record.proofDigest)
    .sort();
  const nextWorkflowStep = workflowHandoff.nextStep;
  const nextRouteAction = typeof clientRouteReadiness.nextStep?.type === 'string'
    ? clientRouteReadiness.nextStep.type
    : workflowHandoff.nextStep;
  const handoffToken = proofDigest({
    requestId: clientState.requestId,
    routeState: clientRouteReadiness.routeState,
    routeTarget: clientRouteReadiness.routeTarget,
    selectedClaimIds,
    acknowledgedProofDigests,
    validationSummaryDigest: clientRouteReadiness.validationSummary.digest,
    externalHandoffState: externalHandoff.state,
    externalHandoffIdempotencyKey: externalHandoff.idempotencyKey,
    providerCursor: providerSync.cursor.next
  }).replace('fnv1a32:', 'client-handoff-');
  const previousTokenMatched = previous.handoffToken === handoffToken;
  const adoptionState = clientRouteReadiness.readyForSubmit
    ? externalHandoff.state === 'acked' || externalHandoff.state === 'ready'
      ? 'handoff-ready'
      : 'awaiting-provider-ack'
    : clientRouteReadiness.routeState === 'blocked'
      ? 'blocked'
      : previewAcceptance.preview.reviewRequiredTotal > 0
        ? 'awaiting-proof-review'
        : 'in-progress';
  const nextClientState = {
    contract: 'hosted-kernel evidence replay next client state/v1',
    requestId: clientState.requestId,
    replayMode: clientRouteReadiness.readyForSubmit ? 'handoff' : clientState.replayMode,
    workflowStep: nextWorkflowStep,
    selectedClaimIds,
    acknowledgedProofDigests,
    routeState: clientRouteReadiness.routeState,
    routeTarget: clientRouteReadiness.routeTarget,
    submitCommand: clientRouteReadiness.submitCommand,
    submitDisabledReason: clientRouteReadiness.submitDisabledReason,
    nextRouteAction,
    handoffToken
  };

  return {
    contract: 'hosted-kernel evidence replay client runtime adoption/v1',
    generatedAt,
    requestId: clientState.requestId,
    state: adoptionState,
    previous: {
      found: Boolean(previous.found),
      requestId: previous.requestId || null,
      routeState: previous.routeState || null,
      routeTarget: previous.routeTarget || null,
      workflowStep: previous.workflowStep || null,
      nextWorkflowStep: previous.nextWorkflowStep || null,
      handoffToken: previous.handoffToken || null,
      updatedAt: previous.updatedAt || null,
      tokenMatched: previousTokenMatched
    },
    nextClientState,
    persistencePatch: {
      contract: 'hosted-kernel evidence replay persisted client runtime/v1',
      requestId: clientState.requestId,
      routeState: clientRouteReadiness.routeState,
      routeTarget: clientRouteReadiness.routeTarget,
      workflowStep: clientState.workflowStep,
      nextWorkflowStep,
      handoffToken,
      submitDisabledReason: clientRouteReadiness.submitDisabledReason,
      updatedAt: generatedAt
    },
    handoff: {
      token: handoffToken,
      target: clientRouteReadiness.routeTarget,
      readyForSubmit: clientRouteReadiness.readyForSubmit,
      providerCommitState: externalHandoff.acknowledgement.commitState,
      providerCursor: providerSync.cursor.next,
      payloadDigest: clientRouteReadiness.routePayload
        ? proofDigest(clientRouteReadiness.routePayload)
        : null
    },
    action: clientRouteReadiness.readyForSubmit
      ? 'Persist clientRuntimeAdoption.persistencePatch and submit clientRouteReadiness.routePayload with the handoff token.'
      : 'Persist clientRuntimeAdoption.persistencePatch so the next request resumes the same review or repair workflow.'
  };
}

function buildRecoveryPlan(persistedState, lifecycle, currentSnapshot, health, records, validationErrors, providerSync, generatedAt) {
  const activeRuns = persistedState.recoveryJournal.activeRuns;
  const matchingActiveRun = activeRuns.find((run) => run.commandId === lifecycle.commandId) || null;
  const commandWasCompleted = Boolean(
    persistedState.recoveryJournal.lastCompleted
      && persistedState.recoveryJournal.lastCompleted.commandId === lifecycle.commandId
  );
  const blockedBy = [];

  if (!persistedState.ok) {
    blockedBy.push('persisted_state_invalid');
  }
  if (persistedState.stale) {
    blockedBy.push('persisted_state_stale');
  }
  if (health.state === 'unhealthy') {
    blockedBy.push('unhealthy_replay_state');
  }
  if (validationErrors.length > 0) {
    blockedBy.push('validation_errors_present');
  }
  if (!lifecycle.enabled) {
    blockedBy.push('lifecycle_disabled');
  }
  if (lifecycle.paused) {
    blockedBy.push('lifecycle_paused');
  }

  const replayCommandRequested = lifecycle.runRequested || lifecycle.schedule.due;
  const replayAllowed = replayCommandRequested
    && blockedBy.length === 0
    && !lifecycle.duplicateCommand
    && !matchingActiveRun
    && !commandWasCompleted;
  const recoveryState = lifecycle.duplicateCommand || commandWasCompleted
    ? 'idempotent-complete'
    : matchingActiveRun
      ? 'resume-inflight'
      : blockedBy.length > 0
        ? 'quarantined'
        : replayAllowed
          ? 'start-replay'
          : 'standby';
  const newRun = replayAllowed
    ? {
        commandId: lifecycle.commandId,
        requestId: lifecycle.commandId.replace(/^cmd-/, 'replay-'),
        state: 'pending',
        startedAt: generatedAt,
        updatedAt: generatedAt,
        proofDigest: currentSnapshot.proofDigest,
        providerCursor: providerSync.cursor.next,
        replayableDigestTotal: providerSync.replayableDigestTotal
      }
    : null;
  const carriedRuns = persistedState.recoveryJournal.runs.map((run) => {
    if (matchingActiveRun && run.commandId === matchingActiveRun.commandId && recoveryState === 'resume-inflight') {
      return {
        ...run,
        state: blockedBy.length > 0 ? 'failed' : run.state,
        updatedAt: generatedAt,
        proofDigest: run.proofDigest || currentSnapshot.proofDigest
      };
    }
    if ((persistedState.stale || !persistedState.ok) && (run.state === 'pending' || run.state === 'running')) {
      return {
        ...run,
        state: 'abandoned',
        updatedAt: generatedAt
      };
    }
    return run;
  });
  const nextRuns = (newRun ? carriedRuns.concat(newRun) : carriedRuns).slice(-RECOVERY_JOURNAL_LIMIT);

  return {
    contract: 'hosted-kernel evidence replay persisted recovery/v1',
    generatedAt,
    state: recoveryState,
    replayAllowed,
    replayCommandRequested,
    duplicateOrCompleted: lifecycle.duplicateCommand || commandWasCompleted,
    activeRunCount: activeRuns.length,
    blockedBy: [...new Set(blockedBy)],
    resumeFrom: matchingActiveRun
      ? {
          commandId: matchingActiveRun.commandId,
          requestId: matchingActiveRun.requestId,
          state: matchingActiveRun.state,
          proofDigest: matchingActiveRun.proofDigest,
          providerCursor: matchingActiveRun.providerCursor
        }
      : null,
    commandReceipt: {
      commandId: lifecycle.commandId,
      idempotencyKey: proofDigest({
        surfaceId,
        commandId: lifecycle.commandId,
        state: recoveryState,
        proofDigest: currentSnapshot.proofDigest,
        providerSyncDigest: providerSync.syncDigest
      }),
      action: replayAllowed
        ? 'Create the pending recovery journal run before dispatching replay side effects.'
        : recoveryState === 'resume-inflight'
          ? 'Resume the matching recovery journal run and update it only after provider acknowledgement.'
          : recoveryState === 'idempotent-complete'
            ? 'Return the previous command result without dispatching duplicate replay side effects.'
            : 'Do not dispatch replay side effects until recovery blockers are cleared.'
    },
    journalShape: {
      contract: persistedState.recoveryJournal.contract,
      runs: nextRuns,
      activeRunCommandIds: nextRuns
        .filter((run) => run.state === 'pending' || run.state === 'running')
        .map((run) => run.commandId),
      lastRunDigest: proofDigest({ generatedAt, runs: nextRuns })
    },
    replayScope: {
      evidenceTotal: records.length,
      acceptedTotal: records.filter((record) => record.status === 'accepted').length,
      replayableDigestTotal: providerSync.replayableDigestTotal,
      providerCursor: providerSync.cursor.next
    }
  };
}

function buildRestartStatus(persistedState, lifecycle, currentSnapshot, health, recovery) {
  const previousCommandResult = [...(persistedState.commandLedger || [])]
    .reverse()
    .find((entry) => entry.id === lifecycle.commandId) || null;
  const shouldRecordCommand = lifecycle.command !== 'status' && !lifecycle.duplicateCommand;
  const currentCommandResult = shouldRecordCommand
    ? {
        id: lifecycle.commandId,
        command: lifecycle.command,
        state: lifecycle.ok ? 'applied' : 'rejected',
        appliedAt: currentSnapshot.generatedAt,
        requestId: recovery.resumeFrom?.requestId || lifecycle.commandId.replace(/^cmd-/, 'replay-'),
        receiptDigest: recovery.commandReceipt.idempotencyKey,
        proofDigest: currentSnapshot.proofDigest,
        providerCursor: recovery.replayScope.providerCursor,
        recoveryState: recovery.state,
        replayAllowed: recovery.replayAllowed
      }
    : null;
  const commandLedger = lifecycle.command === 'status' || lifecycle.duplicateCommand
    ? persistedState.appliedCommandIds
    : persistedState.appliedCommandIds.concat(lifecycle.commandId).slice(-COMMAND_LEDGER_LIMIT);
  const commandResultLedger = (currentCommandResult
    ? (persistedState.commandLedger || []).filter((entry) => entry.id !== currentCommandResult.id).concat(currentCommandResult)
    : (persistedState.commandLedger || []))
    .slice(-COMMAND_LEDGER_LIMIT);
  const recovered = persistedState.found && persistedState.ok;
  const proofChanged = Boolean(
    persistedState.lastProofDigest
      && currentSnapshot.proofDigest
      && persistedState.lastProofDigest !== currentSnapshot.proofDigest
  );
  const status = !persistedState.found
    ? 'fresh'
    : !persistedState.ok
      ? 'recovery-invalid'
      : persistedState.stale
        ? 'recovered-stale'
        : lifecycle.duplicateCommand
          ? 'idempotent-replay'
          : 'recovered';

  return {
    contract: 'hosted-kernel evidence replay restart status/v1',
    status,
    recovered,
    stale: persistedState.stale,
    duplicateCommand: lifecycle.duplicateCommand,
    duplicateCommandResult: lifecycle.duplicateCommand
      ? {
          found: Boolean(previousCommandResult),
          id: previousCommandResult?.id || lifecycle.commandId,
          command: previousCommandResult?.command || lifecycle.command,
          state: previousCommandResult?.state || 'duplicate',
          appliedAt: previousCommandResult?.appliedAt || null,
          receiptDigest: previousCommandResult?.receiptDigest || recovery.commandReceipt.idempotencyKey,
          proofDigest: previousCommandResult?.proofDigest || persistedState.lastProofDigest,
          providerCursor: previousCommandResult?.providerCursor || recovery.replayScope.providerCursor,
          recoveryState: previousCommandResult?.recoveryState || recovery.state,
          replayAllowed: previousCommandResult?.replayAllowed ?? false,
          action: previousCommandResult
            ? 'Return this persisted command result for the duplicate lifecycle command without dispatching side effects.'
            : 'Duplicate command id was present in the legacy appliedCommandIds ledger; return read-only status and upgrade persistedStateShape.commandLedger.'
        }
      : null,
    recoveryState: recovery.state,
    replayAllowed: recovery.replayAllowed,
    commandId: lifecycle.commandId,
    lastGeneratedAt: persistedState.lastGeneratedAt,
    ageMs: persistedState.ageMs,
    proofChanged,
    restartSafe: persistedState.ok && !persistedState.stale && health.state !== 'unhealthy',
    persistedStateShape: {
      contract: persistedState.contract,
      lastGeneratedAt: currentSnapshot.generatedAt,
      lastProofDigest: currentSnapshot.proofDigest,
      appliedCommandIds: commandLedger,
      commandLedger: commandResultLedger,
      lifecycle: {
        enabled: lifecycle.enabled,
        paused: lifecycle.paused,
        disabledUntil: lifecycle.windows.disabledUntil,
        pausedUntil: lifecycle.windows.pausedUntil,
        windows: lifecycle.windows,
        schedule: lifecycle.schedule
      },
      recoveryJournal: recovery.journalShape
    },
    action: lifecycle.duplicateCommand
      ? 'Treat this lifecycle command as already applied and return the recovered status without replaying side effects.'
      : persistedState.stale
        ? 'Refresh evidence replay before opening the claim gate because recovered state is older than the restart safety window.'
        : recovered
          ? 'Continue from recovered evidence replay state and persist the returned persistedStateShape.'
          : 'Persist the returned persistedStateShape after this first evidence replay evaluation.'
  };
}

export function describeEvidenceReplaySurface(input = {}) {
  const now = input.now || new Date().toISOString();
  const clientState = normalizeClientRuntimeState(input, now);
  const persistedState = normalizePersistedReplayState(input, now);
  const lifecycle = normalizeLifecycleSettings(input, now, clientState.requestId, persistedState);
  const lifecycleControl = buildLifecycleControlState(lifecycle, persistedState, now);
  const reportingOptions = normalizeReportingOptions(input);
  const boundary = normalizeBoundaryContext(input, clientState);
  const workspaceScopePolicy = normalizeWorkspaceScopePolicy(input, boundary);
  const providerContract = normalizeIntegrationProviderContract(input, boundary, clientState, lifecycle, reportingOptions);
  const operationalHealth = normalizeOperationalHealth(input, now, providerContract, boundary, clientState, lifecycle, reportingOptions);
  const evidence = Array.isArray(input.evidence) ? input.evidence : [];
  const inputErrors = Array.isArray(input.evidence)
    ? []
    : [{
      code: 'EVIDENCE_ARRAY_REQUIRED',
      path: 'evidence',
      message: 'Evidence replay expects input.evidence to be an array.',
      action: 'Submit evidence as an ordered array of verifier observations.'
    }];

  const normalized = evidence.map((entry, index) => normalizeEvidenceEntry(entry, index, boundary));
  const preliminaryValidationErrors = [
    ...inputErrors,
    ...clientState.errors,
    ...persistedState.errors,
    ...lifecycle.errors,
    ...reportingOptions.errors,
    ...workspaceScopePolicy.errors,
    ...operationalHealth.errors,
    ...operationalHealth.blockingErrors,
    ...providerContract.errors,
    ...boundary.errors,
    ...boundaryPermissionErrors(boundary, clientState, lifecycle),
    ...normalized.filter((result) => !result.ok).map((result) => result.error)
  ];
  const replayRecords = normalized
    .filter((result) => result.ok)
    .map((result) => buildReplayRecord(result.value, input.retry || {}))
    .sort((left, right) => left.sequence - right.sequence || left.claimId.localeCompare(right.claimId));
  const workspaceScopeFindings = workspaceScopeRecordErrors(replayRecords, workspaceScopePolicy);
  const workspaceScope = {
    ...workspaceScopePolicy,
    ok: workspaceScopePolicy.ok && workspaceScopeFindings.every((finding) => !finding.blocking),
    findings: workspaceScopeFindings,
    violationTotal: workspaceScopeFindings.length,
    blockingViolationTotal: workspaceScopeFindings.filter((finding) => finding.blocking).length,
    advisoryViolationTotal: workspaceScopeFindings.filter((finding) => !finding.blocking).length
  };
  const validationErrors = preliminaryValidationErrors.concat(workspaceScopeFindings.filter((finding) => finding.blocking));
  const health = summarizeHealth(replayRecords, validationErrors, lifecycle, operationalHealth);
  const analytics = replayAnalytics(replayRecords, validationErrors);
  const timeline = buildReplayTimeline(replayRecords, validationErrors, now);
  const workflowHandoff = buildWorkflowHandoff(clientState, boundary, health, lifecycle, replayRecords, validationErrors, timeline, now);
  const currentSnapshot = {
    generatedAt: now,
    healthState: health.state,
    proofDigest: proofDigest({
      surfaceId,
      generatedAt: now,
      requestId: clientState.requestId,
      health,
      boundary: {
        tenantId: boundary.tenantId,
        workspaceId: boundary.workspaceId,
        actorId: boundary.actorId,
        permissions: boundary.permissions
      },
      clientState,
      providerContract: {
        providerId: providerContract.providerId,
        serviceId: providerContract.serviceId,
        protocol: providerContract.protocol,
        capabilities: providerContract.capabilities,
        requiredCapabilities: providerContract.requiredCapabilities,
        negotiated: providerContract.negotiated
      },
      workspaceScope: {
        mode: workspaceScope.mode,
        enforced: workspaceScope.enforced,
        policyDigest: workspaceScope.policyDigest,
        violationTotal: workspaceScope.violationTotal,
        blockingViolationTotal: workspaceScope.blockingViolationTotal
      },
      counters: analytics.counters,
      lifecycle,
      lifecycleControl: {
        commandApplied: lifecycleControl.commandApplied,
        idempotency: lifecycleControl.idempotency,
        settingsDigest: lifecycleControl.settingsDigest,
        scheduler: lifecycleControl.scheduler
      },
      replayRecords
    }),
    counters: analytics.counters
  };
  const history = buildHistorySnapshots(input.history, currentSnapshot);
  const reporting = buildReportingState(
    replayRecords,
    validationErrors,
    analytics,
    history,
    timeline,
    health,
    boundary,
    lifecycle,
    reportingOptions,
    now
  );
  const providerSync = buildProviderSyncState(providerContract, boundary, health, replayRecords, validationErrors, now);
  const providerAcknowledgement = normalizeProviderAcknowledgementReceipt(input, providerContract, providerSync, now);
  const providerValidationErrors = providerAcknowledgement.errors;
  const finalValidationErrors = validationErrors.concat(providerValidationErrors);
  const recovery = buildRecoveryPlan(persistedState, lifecycle, currentSnapshot, health, replayRecords, validationErrors, providerSync, now);
  const restart = buildRestartStatus(persistedState, lifecycle, currentSnapshot, health, recovery);
  const exportSummary = buildExportSummary(replayRecords, health, analytics, now);
  const auditHandoff = buildAuditHandoff(boundary, workspaceScope, health, lifecycle, analytics, replayRecords, validationErrors, now);
  const exportHistory = buildExportHistoryState(input, reporting, exportSummary, auditHandoff, providerSync, now);
  const reportingTimeline = timeline
    .concat(exportHistory.timelineEvents.map((event, index) => ({
      ...event,
      order: timeline.length + index
    })))
    .sort((left, right) => String(left.at).localeCompare(String(right.at)) || left.order - right.order);
  const previewAcceptance = buildPreviewAcceptanceState(
    clientState,
    boundary,
    health,
    lifecycle,
    providerContract,
    workflowHandoff,
    replayRecords,
    validationErrors,
    now
  );
  const externalHandoff = buildExternalHandoffState(
    providerContract,
    providerSync,
    providerAcknowledgement,
    boundary,
    health,
    workflowHandoff,
    auditHandoff,
    replayRecords,
    finalValidationErrors,
    now
  );
  const clientRouteReadiness = buildClientRouteReadinessState(
    clientState,
    previewAcceptance,
    workflowHandoff,
    providerSync,
    externalHandoff,
    reporting,
    auditHandoff,
    workspaceScope,
    lifecycle,
    now
  );
  const clientRuntimeAdoption = buildClientRuntimeAdoptionState(
    clientState,
    persistedState,
    workflowHandoff,
    previewAcceptance,
    clientRouteReadiness,
    externalHandoff,
    providerSync,
    now
  );
  const persistedStateShape = {
    ...restart.persistedStateShape,
    clientRuntime: clientRuntimeAdoption.persistencePatch
  };

  return {
    ok: health.state === 'healthy' && finalValidationErrors.length === 0,
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: 'hosted-kernel evidence replay health contract/v1',
    health,
    clientState: {
      contract: clientState.contract,
      ok: clientState.ok,
      requestId: clientState.requestId,
      requestedBy: clientState.requestedBy,
      replayMode: clientState.replayMode,
      workflowStep: clientState.workflowStep,
      selectedClaimIds: clientState.selectedClaimIds,
      acknowledgedProofDigests: clientState.acknowledgedProofDigests,
      runtimeAdoption: clientRuntimeAdoption
    },
    boundary: {
      contract: boundary.contract,
      ok: boundary.ok,
      tenantId: boundary.tenantId,
      workspaceId: boundary.workspaceId,
      actorId: boundary.actorId,
      roles: boundary.roles,
      permissions: boundary.permissions,
      canReplay: boundary.canReplay,
      canHandoff: boundary.canHandoff,
      canOpenClaimGate: boundary.canOpenClaimGate,
      canWriteLifecycle: boundary.canWriteLifecycle,
      canExportAudit: boundary.canExportAudit
    },
    workspaceScope: {
      contract: workspaceScope.contract,
      ok: workspaceScope.ok,
      mode: workspaceScope.mode,
      enforced: workspaceScope.enforced,
      tenantId: workspaceScope.tenantId,
      workspaceId: workspaceScope.workspaceId,
      allowedClaimPrefixes: workspaceScope.allowedClaimPrefixes,
      allowedSourceTypes: workspaceScope.allowedSourceTypes,
      requiredSourceIds: workspaceScope.requiredSourceIds,
      maxReplayClaims: workspaceScope.maxReplayClaims,
      policyDigest: workspaceScope.policyDigest,
      violationTotal: workspaceScope.violationTotal,
      blockingViolationTotal: workspaceScope.blockingViolationTotal,
      advisoryViolationTotal: workspaceScope.advisoryViolationTotal,
      findings: workspaceScope.findings
    },
    providerContract: {
      contract: providerContract.contract,
      ok: providerContract.ok,
      negotiated: providerContract.negotiated,
      providerId: providerContract.providerId,
      serviceId: providerContract.serviceId,
      protocol: providerContract.protocol,
      endpoint: providerContract.endpoint,
      scope: providerContract.scope,
      capabilities: providerContract.capabilities,
      requiredCapabilities: providerContract.requiredCapabilities,
      missingCapabilities: providerContract.missingCapabilities,
      serviceContract: providerContract.serviceContract,
      acknowledgement: providerContract.acknowledgement,
      sync: providerContract.sync
    },
    operationalHealth: {
      contract: operationalHealth.contract,
      ok: operationalHealth.ok,
      configured: operationalHealth.configured,
      state: operationalHealth.state,
      maxHeartbeatAgeMs: operationalHealth.maxHeartbeatAgeMs,
      requiredComponents: operationalHealth.requiredComponents,
      blockedBy: operationalHealth.blockedBy,
      degradedBy: operationalHealth.degradedBy,
      retryAdvice: operationalHealth.retryAdvice,
      degradedFindings: operationalHealth.degradedFindings,
      proof: operationalHealth.proof,
      dependencies: operationalHealth.dependencies.map((dependency) => ({
        component: dependency.component,
        state: dependency.state,
        lastOkAt: dependency.lastOkAt,
        ageMs: dependency.ageMs,
        stale: dependency.stale,
        circuitState: dependency.circuitState,
        consecutiveFailures: dependency.consecutiveFailures,
        blocking: dependency.blocking,
        degraded: dependency.degraded,
        lastError: dependency.lastError,
        action: dependency.action
      }))
    },
    lifecycle: {
      contract: lifecycle.contract,
      ok: lifecycle.ok,
      command: lifecycle.command,
      commandId: lifecycle.commandId,
      duplicateCommand: lifecycle.duplicateCommand,
      disablePolicy: lifecycle.disablePolicy,
      pausePolicy: lifecycle.pausePolicy,
      controlReason: lifecycle.controlReason,
      enabled: lifecycle.enabled,
      paused: lifecycle.paused,
      windows: lifecycle.windows,
      runRequested: lifecycle.runRequested,
      scheduleCleared: lifecycle.scheduleCleared,
      scheduleHeld: lifecycle.scheduleHeld,
      schedule: lifecycle.schedule,
      nextAction: health.nextAction,
      commandResult: lifecycleControl.commandResult,
      settingsPatch: lifecycleControl.settingsPatch,
      controlPlane: lifecycleControl
    },
    validation: {
      ok: finalValidationErrors.length === 0,
      errors: finalValidationErrors
    },
    replay: {
      total: replayRecords.length,
      accepted: replayRecords.filter((record) => record.status === 'accepted').length,
      degraded: replayRecords.filter((record) => record.status === 'degraded').length,
      blocked: replayRecords.filter((record) => record.status === 'blocked').length,
      records: replayRecords
    },
    analytics,
    reporting,
    timeline,
    reportingTimeline: {
      contract: 'hosted-kernel evidence replay reporting timeline/v1',
      generatedAt: now,
      retained: reportingTimeline.length,
      replayEventTotal: timeline.length,
      exportEventTotal: exportHistory.timelineEvents.length,
      lastEventAt: reportingTimeline[reportingTimeline.length - 1]?.at || null,
      events: reportingTimeline
    },
    exportHistory,
    workflowHandoff,
    previewAcceptance,
    clientRouteReadiness,
    providerSync,
    providerAcknowledgement,
    externalHandoff,
    clientRuntimeAdoption,
    recovery,
    history,
    restart: {
      ...restart,
      persistedStateShape
    },
    persistedState: persistedStateShape,
    exports: {
      summary: exportSummary,
      handoff: workflowHandoff,
      previewAcceptance,
      clientRouteReadiness,
      clientRuntimeAdoption,
      auditHandoff,
      externalHandoff,
      providerSync,
      reporting,
      exportHistory,
      persistedState: persistedStateShape,
      proofDigest: proofDigest({
        summary: exportSummary,
        reportingManifest: reporting.exportManifest,
        exportHistoryCurrent: exportHistory.current,
        auditHandoff: auditHandoff.exportAllowed ? auditHandoff.receiptDigest : null,
        externalHandoffState: externalHandoff.state,
        providerAcknowledgementState: providerAcknowledgement.state,
        providerAcknowledgementReceiptDigest: providerAcknowledgement.receiptDigest,
        providerSyncDigest: providerSync.syncDigest,
        workspaceScopeDigest: workspaceScope.policyDigest,
        workspaceScopeViolationTotal: workspaceScope.violationTotal,
        clientRouteReadiness: {
          routeState: clientRouteReadiness.routeState,
          routeTarget: clientRouteReadiness.routeTarget,
          validationSummaryDigest: clientRouteReadiness.validationSummary.digest
        },
        clientRuntimeAdoption: {
          state: clientRuntimeAdoption.state,
          handoffToken: clientRuntimeAdoption.handoff.token,
          nextWorkflowStep: clientRuntimeAdoption.nextClientState.workflowStep
        },
        recoveryJournalDigest: recovery.journalShape.lastRunDigest,
        operationalHealthState: operationalHealth.state,
        operationalBlockedBy: operationalHealth.blockedBy,
        operationalDegradedBy: operationalHealth.degradedBy,
        tenantId: boundary.tenantId,
        workspaceId: boundary.workspaceId
      })
    },
    audit: {
      proofDigest: proofDigest({
        surfaceId,
        generatedAt: now,
        health,
        boundary: {
          tenantId: boundary.tenantId,
          workspaceId: boundary.workspaceId,
          actorId: boundary.actorId,
          permissions: boundary.permissions
        },
        lifecycle,
        lifecycleControl,
        providerContract,
        workspaceScope: {
          contract: workspaceScope.contract,
          ok: workspaceScope.ok,
          mode: workspaceScope.mode,
          enforced: workspaceScope.enforced,
          policyDigest: workspaceScope.policyDigest,
          findings: workspaceScope.findings
        },
        operationalHealth: {
          state: operationalHealth.state,
          requiredComponents: operationalHealth.requiredComponents,
          blockedBy: operationalHealth.blockedBy,
          degradedBy: operationalHealth.degradedBy,
          retryAdvice: operationalHealth.retryAdvice,
          proofDigest: operationalHealth.proof.digest,
          dependencyDigests: operationalHealth.dependencies.map((dependency) => ({
            component: dependency.component,
            state: dependency.state,
            stale: dependency.stale,
            circuitState: dependency.circuitState,
            consecutiveFailures: dependency.consecutiveFailures,
            lastErrorCode: dependency.lastError?.code || null,
            digest: proofDigest({
              component: dependency.component,
              state: dependency.state,
              lastOkAt: dependency.lastOkAt,
              stale: dependency.stale,
              circuitState: dependency.circuitState,
              consecutiveFailures: dependency.consecutiveFailures,
              lastError: dependency.lastError
            })
          }))
        },
        providerSync,
        providerAcknowledgement,
        previewAcceptance: {
          readiness: previewAcceptance.readiness,
          validationSummary: previewAcceptance.validationSummary,
          preview: {
            total: previewAcceptance.preview.total,
            acceptedTotal: previewAcceptance.preview.acceptedTotal,
            reviewRequiredTotal: previewAcceptance.preview.reviewRequiredTotal,
            retryRequiredTotal: previewAcceptance.preview.retryRequiredTotal,
            blockedTotal: previewAcceptance.preview.blockedTotal
          },
          acceptanceEnvelopeDigest: previewAcceptance.acceptanceEnvelope?.envelopeDigest || null
        },
        clientRouteReadiness: {
          routeState: clientRouteReadiness.routeState,
          routeTarget: clientRouteReadiness.routeTarget,
          readyForSubmit: clientRouteReadiness.readyForSubmit,
          submitDisabledReason: clientRouteReadiness.submitDisabledReason,
          validationSummaryDigest: clientRouteReadiness.validationSummary.digest,
          routePayloadDigest: clientRouteReadiness.routePayload
            ? proofDigest(clientRouteReadiness.routePayload)
            : null
        },
        clientRuntimeAdoption: {
          state: clientRuntimeAdoption.state,
          handoffToken: clientRuntimeAdoption.handoff.token,
          nextClientState: clientRuntimeAdoption.nextClientState,
          persistencePatchDigest: proofDigest(clientRuntimeAdoption.persistencePatch)
        },
        externalHandoff,
        clientState,
        validationErrors: finalValidationErrors,
        replayRecords,
        workflowHandoff,
        analytics,
        reporting: {
          severity: reporting.severity,
          counters: reporting.counters,
          exportManifest: reporting.exportManifest
        },
        exportHistory: {
          current: exportHistory.current,
          counters: exportHistory.counters,
          deltaFromLatest: exportHistory.deltaFromLatest
        },
        recovery,
        restart,
        history: {
          retained: history.retained,
          deltaFromLatest: history.deltaFromLatest
        }
      }),
      handoff: auditHandoff,
      degradedMode: health.state === 'degraded',
      actionableErrors: validationErrors.concat(
        providerAcknowledgement.errors,
        exportHistory.errors,
        operationalHealth.blockingErrors,
        operationalHealth.degradedFindings,
        replayRecords
          .filter((record) => record.status === 'blocked')
          .map((record) => ({
            code: 'REPLAY_BLOCKED',
            claimId: record.claimId,
            message: 'Evidence replay reached a non-retryable failure state.',
            action: record.action
          }))
      )
    }
  };
}

export default describeEvidenceReplaySurface;
