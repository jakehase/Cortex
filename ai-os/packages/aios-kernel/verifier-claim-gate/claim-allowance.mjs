export const surfaceId = "aios_verifier-claim-gate_claim-allowance_064";
export const surfaceGroup = "verifier-claim-gate";
export const surfaceName = "claim-allowance";

const DEFAULT_REQUIRED_EVIDENCE = ["source", "proof", "owner"];
const DEFAULT_VERIFIER_EVIDENCE_POLICY = {
  requireVerifierIdentity: true,
  requireProofMaterial: true,
  allowIssuerAsVerifier: false
};
const DEFAULT_PROVIDER_CAPABILITIES = ["claim.read", "evidence.read", "proof.issue", "handoff.sync"];
const DEFAULT_PROVIDER_SERVICE_OPERATIONS = ["claimAllowance.review", "claimAllowance.issueProof", "claimAllowance.syncHandoff"];
const DEFAULT_PROVIDER_OPERATION_CAPABILITIES = {
  "claimAllowance.review": ["claim.read", "evidence.read"],
  "claimAllowance.issueProof": ["proof.issue"],
  "claimAllowance.syncHandoff": ["handoff.sync"]
};
const DEFAULT_REQUIRED_PERMISSIONS = ["claim.allowance.review", "claim.allowance.issue"];
const DEFAULT_REQUIRED_ROLES = ["verifier", "tenant-admin"];
const LIFECYCLE_COMMANDS = new Set([
  "evaluate-claim-allowance",
  "enable-claim-allowance",
  "disable-claim-allowance",
  "pause-claim-allowance",
  "resume-claim-allowance",
  "schedule-claim-allowance",
  "issue-claim-allowance",
  "accept-claim-allowance"
]);
const LIFECYCLE_SCHEDULE_MODES = new Set(["immediate", "manual", "windowed", "disabled"]);
const LIFECYCLE_SETTINGS_COMMANDS = new Set([
  "enable-claim-allowance",
  "disable-claim-allowance",
  "pause-claim-allowance",
  "resume-claim-allowance",
  "schedule-claim-allowance"
]);
const LIFECYCLE_RECOVERY_COMMANDS = new Set([
  "enable-claim-allowance",
  "resume-claim-allowance",
  "schedule-claim-allowance"
]);
const LIFECYCLE_ISSUE_COMMANDS = new Set([
  "evaluate-claim-allowance",
  "issue-claim-allowance"
]);
const LIFECYCLE_ACCEPTANCE_COMMANDS = new Set(["accept-claim-allowance"]);
const ACCEPTANCE_STATES = new Set(["accepted", "approved", "allowed"]);
const REJECTION_STATES = new Set(["rejected", "denied", "blocked"]);
const DEFAULT_CLIENT_STEP = "claim-allowance-review";
const PERSISTED_STATE_VERSION = 1;
const MAX_HISTORY_SNAPSHOTS = 12;
const MAX_COMMAND_LEDGER_ENTRIES = 16;
const RESTART_SAFE_STATUSES = new Set(["allowance-ready", "allowance-held", "allowance-issued"]);
const TERMINAL_COMMAND_STATUSES = new Set(["applied", "replayed", "superseded"]);
const ANALYTICS_EXPORT_FORMATS = new Set(["json", "jsonl", "csv"]);
const ANALYTICS_REDACTION_MODES = new Set(["none", "tenant-safe", "external"]);
const HEALTHY_STATES = new Set(["ok", "ready", "healthy", "available"]);
const DEGRADED_STATES = new Set(["degraded", "limited", "recovering"]);
const UNHEALTHY_STATES = new Set(["down", "failed", "unavailable", "timeout", "error"]);
const PROVIDER_READY_STATES = new Set(["ok", "ready", "healthy", "available", "connected", "synced"]);
const SERVICE_CONTRACT_READY_STATES = new Set(["ready", "active", "available", "bound", "synced"]);
const DEFAULT_RETRY_POLICY = {
  maxAttempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 8000,
  jitterMs: 125
};
const DEFAULT_LIFECYCLE_SETTINGS = {
  enabled: true,
  issueEnabled: true,
  acceptanceEnabled: true,
  handoffEnabled: true,
  scheduleMode: "immediate",
  minIntervalMs: 0
};

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeEvidence(rawEvidence) {
  return asArray(rawEvidence).map((entry, index) => {
    const candidate = entry && typeof entry === "object" ? entry : { value: entry };
    const type = normalizeText(candidate.type || candidate.kind || candidate.evidenceType) || "unknown";
    const ref = normalizeText(candidate.ref || candidate.uri || candidate.url || candidate.id);
    const digest = normalizeText(candidate.digest || candidate.hash || candidate.sha256);
    const accepted = candidate.accepted === true || ACCEPTANCE_STATES.has(normalizeText(candidate.status).toLowerCase());
    const rejected = candidate.rejected === true || REJECTION_STATES.has(normalizeText(candidate.status).toLowerCase());
    const proofRef = normalizeText(candidate.proofRef || candidate.proofId || candidate.verificationRef || candidate.attestationRef);
    const verifierId = normalizeText(candidate.verifierId || candidate.verifiedBy || candidate.attestedBy);
    const issuer = normalizeText(candidate.issuer || candidate.issuedBy || candidate.ownerId);
    const verifierTenantId = normalizeText(candidate.verifierTenantId || candidate.attestationTenantId || candidate.proofTenantId);
    const verifierWorkspaceId = normalizeText(candidate.verifierWorkspaceId || candidate.attestationWorkspaceId || candidate.proofWorkspaceId);
    const verifierClaimId = normalizeText(candidate.verifierClaimId || candidate.attestationClaimId || candidate.proofClaimId);
    const verifierSubject = normalizeText(candidate.verifierSubject || candidate.attestationSubject || candidate.proofSubject);

    return {
      id: normalizeText(candidate.id) || `${type}-${index + 1}`,
      type,
      ref,
      digest,
      proofRef,
      verifierId,
      issuer,
      verifierTenantId,
      verifierWorkspaceId,
      verifierClaimId,
      verifierSubject,
      claimId: normalizeText(candidate.claimId || candidate.claim),
      subject: normalizeText(candidate.subject || candidate.resource),
      tenantId: normalizeText(candidate.tenantId || candidate.tenant),
      workspaceId: normalizeText(candidate.workspaceId || candidate.workspace),
      ownerId: normalizeText(candidate.ownerId || candidate.owner || candidate.accountableOwner),
      accepted,
      rejected,
      present: Boolean(ref || digest || proofRef || verifierId || issuer || accepted),
      verified: candidate.verified === true || Boolean(digest || proofRef || verifierId || issuer),
      summary: normalizeText(candidate.summary || candidate.label || candidate.description)
    };
  });
}

function normalizeClaim(input) {
  const rawClaim = input.claim && typeof input.claim === "object" ? input.claim : input;
  return {
    id: normalizeText(rawClaim.claimId || rawClaim.id || input.claimId) || "unidentified-claim",
    subject: normalizeText(rawClaim.subject || rawClaim.resource || input.subject),
    requestedBy: normalizeText(rawClaim.requestedBy || rawClaim.actor || input.requestedBy),
    tenantId: normalizeText(rawClaim.tenantId || rawClaim.tenant || input.tenantId || input.tenant),
    workspaceId: normalizeText(rawClaim.workspaceId || rawClaim.workspace || input.workspaceId || input.workspace),
    route: normalizeText(rawClaim.route || input.route),
    action: normalizeText(rawClaim.action || rawClaim.intent || input.action) || "allow",
    allowanceReason: normalizeText(rawClaim.allowanceReason || rawClaim.reason || input.allowanceReason)
  };
}

function normalizeRequestContext(input) {
  const request = input.request && typeof input.request === "object" ? input.request : {};
  const headers = request.headers && typeof request.headers === "object" ? request.headers : {};
  const routeHint = normalizeText(input.route || request.route || request.path || headers["x-aios-route"]);
  const requestId = normalizeText(input.requestId || request.requestId || headers["x-request-id"]);
  const sessionId = normalizeText(input.sessionId || request.sessionId || headers["x-aios-session-id"]);
  const clientId = normalizeText(input.clientId || request.clientId || headers["x-aios-client-id"]);

  return {
    requestId: requestId || "untracked-request",
    sessionId: sessionId || "untracked-session",
    clientId: clientId || "untracked-client",
    tenantId: normalizeText(input.tenantId || request.tenantId || headers["x-aios-tenant-id"]),
    workspaceId: normalizeText(input.workspaceId || request.workspaceId || headers["x-aios-workspace-id"]),
    route: routeHint || `${surfaceGroup}/${surfaceName}`,
    origin: normalizeText(input.origin || request.origin || headers.origin),
    traceparent: normalizeText(input.traceparent || request.traceparent || headers.traceparent)
  };
}

function normalizeAccessPrincipal(input, claim) {
  const access = input.access && typeof input.access === "object" ? input.access : {};
  const actor = input.actor && typeof input.actor === "object" ? input.actor : {};
  const principal = access.principal && typeof access.principal === "object"
    ? access.principal
    : input.principal && typeof input.principal === "object"
      ? input.principal
      : actor;

  return {
    id: normalizeText(principal.id || principal.actorId || principal.userId || input.actorId || claim.requestedBy) || "unknown-principal",
    tenantId: normalizeText(principal.tenantId || access.tenantId || actor.tenantId || input.principalTenantId),
    workspaceId: normalizeText(principal.workspaceId || access.workspaceId || actor.workspaceId || input.principalWorkspaceId),
    roles: [
      ...asArray(principal.roles),
      ...asArray(access.roles),
      ...asArray(input.roles)
    ].map(normalizeText).filter(Boolean),
    permissions: [
      ...asArray(principal.permissions),
      ...asArray(access.permissions),
      ...asArray(input.permissions)
    ].map(normalizeText).filter(Boolean)
  };
}

function normalizeScopeGrants(input) {
  const access = input.access && typeof input.access === "object" ? input.access : {};
  const rawGrants = [
    ...asArray(access.scopeGrants),
    ...asArray(access.workspaceGrants),
    ...asArray(access.tenantGrants),
    ...asArray(input.scopeGrants)
  ];

  return rawGrants.map((grant, index) => {
    const candidate = grant && typeof grant === "object" ? grant : {};
    const tenantId = normalizeText(candidate.tenantId || candidate.tenant);
    const workspaceId = normalizeText(candidate.workspaceId || candidate.workspace);
    const scope = normalizeText(candidate.scope || candidate.scopeType).toLowerCase()
      || (workspaceId ? "workspace" : tenantId ? "tenant" : "global");

    return {
      id: normalizeText(candidate.id || candidate.grantId) || `scope-grant-${index + 1}`,
      scope,
      tenantId,
      workspaceId,
      roles: asArray(candidate.roles).map(normalizeText).filter(Boolean),
      permissions: asArray(candidate.permissions).map(normalizeText).filter(Boolean),
      deniedPermissions: asArray(candidate.deniedPermissions).map(normalizeText).filter(Boolean),
      expiresAt: normalizeText(candidate.expiresAt || candidate.validUntil),
      revoked: candidate.revoked === true || candidate.disabled === true
    };
  });
}

function grantMatchesBoundary(grant, expectedTenantId, expectedWorkspaceId, now) {
  const expiresAtMs = Date.parse(grant.expiresAt);
  const nowMs = Date.parse(now || "");
  const expired = Boolean(grant.expiresAt && Number.isFinite(expiresAtMs) && Number.isFinite(nowMs) && expiresAtMs <= nowMs);
  const tenantMatches = !grant.tenantId || !expectedTenantId || grant.tenantId === expectedTenantId;
  const workspaceMatches = !grant.workspaceId || !expectedWorkspaceId || grant.workspaceId === expectedWorkspaceId;
  const scopeMatches = grant.scope === "global"
    || (grant.scope === "tenant" && tenantMatches)
    || (grant.scope === "workspace" && tenantMatches && workspaceMatches)
    || (tenantMatches && workspaceMatches);

  return {
    matches: !grant.revoked && !expired && scopeMatches,
    expired,
    tenantMatches,
    workspaceMatches
  };
}

function buildScopedAuthorization({ input, principal, expectedTenantId, expectedWorkspaceId, requiredRoles, requiredPermissions }) {
  const grants = normalizeScopeGrants(input);
  const now = normalizeText(input.now);
  const grantMatches = grants.map((grant) => ({
    grant,
    match: grantMatchesBoundary(grant, expectedTenantId, expectedWorkspaceId, now)
  }));
  const applicableGrants = grantMatches
    .filter((entry) => entry.match.matches)
    .map((entry) => entry.grant);
  const hasScopedGrants = grants.length > 0;
  const roleSource = hasScopedGrants ? applicableGrants.flatMap((grant) => grant.roles) : principal.roles;
  const permissionSource = hasScopedGrants ? applicableGrants.flatMap((grant) => grant.permissions) : principal.permissions;
  const deniedPermissions = [...new Set(applicableGrants.flatMap((grant) => grant.deniedPermissions))];
  const scopedRoles = [...new Set(roleSource)];
  const scopedPermissions = [...new Set(permissionSource)].filter((permission) => !deniedPermissions.includes(permission));
  const missingScopedPermissions = requiredPermissions.filter((permission) => !scopedPermissions.includes(permission));
  const matchedScopedRoles = requiredRoles.filter((role) => scopedRoles.includes(role));
  const blockedGrantIds = grantMatches
    .filter((entry) => !entry.match.matches)
    .map((entry) => {
      const reasons = [
        ...(entry.grant.revoked ? ["revoked"] : []),
        ...(entry.match.expired ? ["expired"] : []),
        ...(!entry.match.tenantMatches ? ["tenant_mismatch"] : []),
        ...(!entry.match.workspaceMatches ? ["workspace_mismatch"] : [])
      ];
      return {
        grantId: entry.grant.id,
        scope: entry.grant.scope,
        tenantId: entry.grant.tenantId || null,
        workspaceId: entry.grant.workspaceId || null,
        reasons: reasons.length > 0 ? reasons : ["scope_mismatch"]
      };
    });

  return {
    contractType: "claim-allowance-scoped-authorization-v1",
    grantMode: hasScopedGrants ? "scoped-grants" : "principal-global",
    applicableGrantIds: applicableGrants.map((grant) => grant.id),
    blockedGrants: blockedGrantIds,
    scopedRoles,
    scopedPermissions,
    deniedPermissions,
    matchedRoles: requiredRoles.length === 0 ? scopedRoles : matchedScopedRoles,
    hasRequiredRole: requiredRoles.length === 0 || matchedScopedRoles.length > 0,
    missingPermissions: missingScopedPermissions,
    scopeComplete: !hasScopedGrants || applicableGrants.length > 0
  };
}

function normalizeScopeDelegations(input) {
  const access = input.access && typeof input.access === "object" ? input.access : {};
  const rawDelegations = [
    ...asArray(access.scopeDelegations),
    ...asArray(access.delegations),
    ...asArray(access.delegatedScopes),
    ...asArray(input.scopeDelegations),
    ...asArray(input.delegations)
  ];

  return rawDelegations.map((delegation, index) => {
    const candidate = delegation && typeof delegation === "object" ? delegation : {};
    const tenantId = normalizeText(candidate.tenantId || candidate.tenant || candidate.targetTenantId);
    const workspaceId = normalizeText(candidate.workspaceId || candidate.workspace || candidate.targetWorkspaceId);

    return {
      id: normalizeText(candidate.id || candidate.delegationId) || `scope-delegation-${index + 1}`,
      tenantId,
      workspaceId,
      delegatePrincipalId: normalizeText(candidate.delegatePrincipalId || candidate.principalId || candidate.actorId || candidate.userId),
      issuedBy: normalizeText(candidate.issuedBy || candidate.ownerId || candidate.grantorId),
      reason: normalizeText(candidate.reason || candidate.purpose || candidate.allowanceReason),
      proofRef: normalizeText(candidate.proofRef || candidate.proofId || candidate.auditRef || candidate.ticketId),
      roles: asArray(candidate.roles).map(normalizeText).filter(Boolean),
      permissions: asArray(candidate.permissions).map(normalizeText).filter(Boolean),
      deniedPermissions: asArray(candidate.deniedPermissions).map(normalizeText).filter(Boolean),
      expiresAt: normalizeText(candidate.expiresAt || candidate.validUntil),
      revoked: candidate.revoked === true || candidate.disabled === true
    };
  });
}

function delegationMatchesBoundary(delegation, principal, expectedTenantId, expectedWorkspaceId, now) {
  const expiresAtMs = Date.parse(delegation.expiresAt);
  const nowMs = Date.parse(now || "");
  const expired = Boolean(delegation.expiresAt && Number.isFinite(expiresAtMs) && Number.isFinite(nowMs) && expiresAtMs <= nowMs);
  const principalMatches = !delegation.delegatePrincipalId || delegation.delegatePrincipalId === principal.id;
  const tenantMatches = !delegation.tenantId || !expectedTenantId || delegation.tenantId === expectedTenantId;
  const workspaceMatches = !delegation.workspaceId || !expectedWorkspaceId || delegation.workspaceId === expectedWorkspaceId;

  return {
    matches: !delegation.revoked && !expired && principalMatches && tenantMatches && workspaceMatches,
    expired,
    principalMatches,
    tenantMatches,
    workspaceMatches
  };
}

function buildDelegationBoundary({ input, principal, expectedTenantId, expectedWorkspaceId, requiredRoles, requiredPermissions, tenantMismatch, workspaceMismatch }) {
  const access = input.access && typeof input.access === "object" ? input.access : {};
  const delegations = normalizeScopeDelegations(input);
  const now = normalizeText(input.now);
  const delegationRequested = access.delegated === true
    || input.delegated === true
    || normalizeText(access.mode).toLowerCase() === "delegated"
    || normalizeText(input.accessMode).toLowerCase() === "delegated";
  const required = delegationRequested || tenantMismatch || workspaceMismatch;
  const matches = delegations.map((delegation) => ({
    delegation,
    match: delegationMatchesBoundary(delegation, principal, expectedTenantId, expectedWorkspaceId, now)
  }));
  const applicableDelegations = matches
    .filter((entry) => entry.match.matches)
    .map((entry) => entry.delegation);
  const delegatedRoles = [...new Set(applicableDelegations.flatMap((delegation) => delegation.roles))];
  const delegatedPermissions = [...new Set(applicableDelegations.flatMap((delegation) => delegation.permissions))];
  const deniedPermissions = [...new Set(applicableDelegations.flatMap((delegation) => delegation.deniedPermissions))];
  const effectivePermissions = delegatedPermissions.filter((permission) => !deniedPermissions.includes(permission));
  const missingDelegatedPermissions = requiredPermissions.filter((permission) => !effectivePermissions.includes(permission));
  const matchedDelegatedRoles = requiredRoles.filter((role) => delegatedRoles.includes(role));
  const invalidDelegations = matches
    .filter((entry) => !entry.match.matches)
    .map((entry) => ({
      delegationId: entry.delegation.id,
      tenantId: entry.delegation.tenantId || null,
      workspaceId: entry.delegation.workspaceId || null,
      reasons: [
        ...(entry.delegation.revoked ? ["revoked"] : []),
        ...(entry.match.expired ? ["expired"] : []),
        ...(!entry.match.principalMatches ? ["principal_mismatch"] : []),
        ...(!entry.match.tenantMatches ? ["tenant_mismatch"] : []),
        ...(!entry.match.workspaceMatches ? ["workspace_mismatch"] : [])
      ]
    }));
  const proofComplete = applicableDelegations.length > 0
    && applicableDelegations.every((delegation) => delegation.issuedBy && delegation.reason && delegation.proofRef);
  const blockers = [
    ...(required && delegations.length === 0 ? ["delegation_required"] : []),
    ...(required && delegations.length > 0 && applicableDelegations.length === 0 ? ["delegation_scope_not_applicable"] : []),
    ...(required && applicableDelegations.length > 0 && !proofComplete ? ["delegation_proof_incomplete"] : []),
    ...(required && requiredRoles.length > 0 && matchedDelegatedRoles.length === 0 ? ["delegation_role_not_allowed"] : []),
    ...(required ? missingDelegatedPermissions.map((permission) => `delegation_missing_permission:${permission}`) : []),
    ...(required ? deniedPermissions
      .filter((permission) => requiredPermissions.includes(permission))
      .map((permission) => `delegation_denied_permission:${permission}`) : [])
  ];

  return {
    contractType: "claim-allowance-scope-delegation-boundary-v1",
    required,
    requested: delegationRequested,
    authorized: !required || blockers.length === 0,
    mode: required ? "delegated-boundary" : "direct-principal",
    applicableDelegationIds: applicableDelegations.map((delegation) => delegation.id),
    invalidDelegations,
    proofComplete,
    delegatedRoles,
    delegatedPermissions: effectivePermissions,
    deniedPermissions,
    matchedRoles: matchedDelegatedRoles,
    missingPermissions: required ? missingDelegatedPermissions : [],
    auditHandoff: {
      required,
      state: !required ? "not_required" : blockers.length === 0 ? "ready" : "blocked",
      proofRefs: applicableDelegations.map((delegation) => delegation.proofRef).filter(Boolean),
      issuedBy: [...new Set(applicableDelegations.map((delegation) => delegation.issuedBy).filter(Boolean))],
      reasons: [...new Set(applicableDelegations.map((delegation) => delegation.reason).filter(Boolean))]
    },
    blockers
  };
}

function normalizeBoundaryWaivers(input) {
  const access = input.access && typeof input.access === "object" ? input.access : {};
  const rawWaivers = [
    ...asArray(access.boundaryWaivers),
    ...asArray(access.crossBoundaryWaivers),
    ...asArray(input.boundaryWaivers),
    ...asArray(input.crossBoundaryWaivers)
  ];

  return rawWaivers.map((waiver, index) => {
    const candidate = waiver && typeof waiver === "object" ? waiver : {};
    const type = normalizeText(candidate.type || candidate.kind || candidate.scope).toLowerCase();

    return {
      id: normalizeText(candidate.id || candidate.waiverId || candidate.proofId) || `boundary-waiver-${index + 1}`,
      type: type || "cross-boundary",
      tenantId: normalizeText(candidate.tenantId || candidate.tenant || candidate.targetTenantId),
      workspaceId: normalizeText(candidate.workspaceId || candidate.workspace || candidate.targetWorkspaceId),
      principalId: normalizeText(candidate.principalId || candidate.actorId || candidate.userId),
      issuedBy: normalizeText(candidate.issuedBy || candidate.ownerId || candidate.approvedBy),
      reason: normalizeText(candidate.reason || candidate.purpose || candidate.allowanceReason),
      proofRef: normalizeText(candidate.proofRef || candidate.proofId || candidate.auditRef || candidate.ticketId),
      permissions: asArray(candidate.permissions).map(normalizeText).filter(Boolean),
      expiresAt: normalizeText(candidate.expiresAt || candidate.validUntil),
      revoked: candidate.revoked === true || candidate.disabled === true
    };
  });
}

function boundaryWaiverMatches(waiver, principal, expectedTenantId, expectedWorkspaceId, waiverType, now) {
  const expiresAtMs = Date.parse(waiver.expiresAt);
  const nowMs = Date.parse(now || "");
  const expired = Boolean(waiver.expiresAt && Number.isFinite(expiresAtMs) && Number.isFinite(nowMs) && expiresAtMs <= nowMs);
  const typeMatches = waiver.type === "cross-boundary" || waiver.type === waiverType;
  const principalMatches = !waiver.principalId || waiver.principalId === principal.id;
  const tenantMatches = !waiver.tenantId || !expectedTenantId || waiver.tenantId === expectedTenantId;
  const workspaceMatches = waiverType === "tenant"
    ? !waiver.workspaceId || !expectedWorkspaceId || waiver.workspaceId === expectedWorkspaceId
    : !waiver.workspaceId || waiver.workspaceId === expectedWorkspaceId;

  return {
    matches: !waiver.revoked && !expired && typeMatches && principalMatches && tenantMatches && workspaceMatches,
    expired,
    typeMatches,
    principalMatches,
    tenantMatches,
    workspaceMatches
  };
}

function buildCrossBoundaryWaiverGate({ input, principal, expectedTenantId, expectedWorkspaceId, tenantMismatch, workspaceMismatch, allowCrossTenant, allowCrossWorkspace }) {
  const waivers = normalizeBoundaryWaivers(input);
  const now = normalizeText(input.now);
  const requiredTypes = [
    ...(tenantMismatch && allowCrossTenant ? ["tenant"] : []),
    ...(workspaceMismatch && allowCrossWorkspace ? ["workspace"] : [])
  ];
  const requiredPermissionByType = {
    tenant: "claim.allowance.crossTenant",
    workspace: "claim.allowance.crossWorkspace"
  };
  const evaluations = requiredTypes.map((type) => {
    const matches = waivers.map((waiver) => ({
      waiver,
      match: boundaryWaiverMatches(waiver, principal, expectedTenantId, expectedWorkspaceId, type, now)
    }));
    const applicableWaivers = matches.filter((entry) => entry.match.matches).map((entry) => entry.waiver);
    const requiredPermission = requiredPermissionByType[type];
    const proofBackedWaivers = applicableWaivers.filter((waiver) => (
      waiver.issuedBy && waiver.reason && waiver.proofRef && waiver.permissions.includes(requiredPermission)
    ));

    return {
      type,
      requiredPermission,
      state: proofBackedWaivers.length > 0 ? "accepted" : applicableWaivers.length > 0 ? "proof_incomplete" : "missing",
      applicableWaiverIds: applicableWaivers.map((waiver) => waiver.id),
      acceptedWaiverIds: proofBackedWaivers.map((waiver) => waiver.id),
      proofRefs: proofBackedWaivers.map((waiver) => waiver.proofRef),
      rejectedWaivers: matches
        .filter((entry) => !entry.match.matches)
        .map((entry) => ({
          waiverId: entry.waiver.id,
          reasons: [
            ...(entry.waiver.revoked ? ["revoked"] : []),
            ...(entry.match.expired ? ["expired"] : []),
            ...(!entry.match.typeMatches ? ["type_mismatch"] : []),
            ...(!entry.match.principalMatches ? ["principal_mismatch"] : []),
            ...(!entry.match.tenantMatches ? ["tenant_mismatch"] : []),
            ...(!entry.match.workspaceMatches ? ["workspace_mismatch"] : [])
          ]
        }))
    };
  });
  const blockers = evaluations.flatMap((evaluation) => [
    ...(evaluation.state === "missing" ? [`cross_boundary_waiver_missing:${evaluation.type}`] : []),
    ...(evaluation.state === "proof_incomplete" ? [`cross_boundary_waiver_proof_incomplete:${evaluation.type}`] : [])
  ]);

  return {
    contractType: "claim-allowance-cross-boundary-waiver-gate-v1",
    required: requiredTypes.length > 0,
    state: blockers.length === 0 ? "clear" : "blocked",
    requiredTypes,
    evaluations,
    acceptedWaiverIds: evaluations.flatMap((evaluation) => evaluation.acceptedWaiverIds),
    proofRefs: evaluations.flatMap((evaluation) => evaluation.proofRefs),
    blockers
  };
}

function scopeValueState(expectedValue, observedValue) {
  if (!expectedValue) {
    return "missing_expected_scope";
  }
  if (!observedValue) {
    return "not_declared";
  }
  return observedValue === expectedValue ? "matched" : "mismatched";
}

function buildBoundaryAuditHandoff({
  claim,
  requestContext,
  principal,
  scopedAuthorization,
  delegationBoundary,
  expectedTenantId,
  expectedWorkspaceId,
  claimTenantId,
  claimWorkspaceId,
  requestTenantId,
  requestWorkspaceId,
  tenantMismatch,
  workspaceMismatch,
  crossBoundaryWaiverGate,
  blockers
}) {
  const boundaryKey = `${expectedTenantId || "tenant-missing"}:${expectedWorkspaceId || "workspace-missing"}`;
  const scopeAssertions = [
    {
      source: "claim",
      tenantId: claimTenantId || null,
      workspaceId: claimWorkspaceId || null,
      tenantState: scopeValueState(expectedTenantId, claimTenantId),
      workspaceState: scopeValueState(expectedWorkspaceId, claimWorkspaceId)
    },
    {
      source: "request",
      tenantId: requestTenantId || null,
      workspaceId: requestWorkspaceId || null,
      tenantState: scopeValueState(expectedTenantId, requestTenantId),
      workspaceState: scopeValueState(expectedWorkspaceId, requestWorkspaceId)
    },
    {
      source: "principal",
      tenantId: principal.tenantId || null,
      workspaceId: principal.workspaceId || null,
      tenantState: scopeValueState(expectedTenantId, principal.tenantId),
      workspaceState: scopeValueState(expectedWorkspaceId, principal.workspaceId)
    }
  ];
  const evidenceRefs = [
    ...scopedAuthorization.applicableGrantIds.map((grantId) => ({
      evidenceType: "scope-grant",
      id: grantId,
      state: "accepted"
    })),
    ...scopedAuthorization.blockedGrants.map((grant) => ({
      evidenceType: "scope-grant",
      id: grant.grantId,
      state: "rejected",
      reasons: grant.reasons
    })),
    ...delegationBoundary.applicableDelegationIds.map((delegationId) => ({
      evidenceType: "scope-delegation",
      id: delegationId,
      state: delegationBoundary.proofComplete ? "accepted" : "incomplete"
    })),
    ...delegationBoundary.invalidDelegations.map((delegation) => ({
      evidenceType: "scope-delegation",
      id: delegation.delegationId,
      state: "rejected",
      reasons: delegation.reasons
    })),
    ...crossBoundaryWaiverGate.evaluations.flatMap((evaluation) => [
      ...evaluation.acceptedWaiverIds.map((waiverId) => ({
        evidenceType: "cross-boundary-waiver",
        id: waiverId,
        waiverType: evaluation.type,
        state: "accepted"
      })),
      ...evaluation.applicableWaiverIds
        .filter((waiverId) => !evaluation.acceptedWaiverIds.includes(waiverId))
        .map((waiverId) => ({
          evidenceType: "cross-boundary-waiver",
          id: waiverId,
          waiverType: evaluation.type,
          state: "incomplete",
          requiredPermission: evaluation.requiredPermission
        })),
      ...evaluation.rejectedWaivers.map((waiver) => ({
        evidenceType: "cross-boundary-waiver",
        id: waiver.waiverId,
        waiverType: evaluation.type,
        state: "rejected",
        reasons: waiver.reasons
      }))
    ])
  ];
  const waiverReady = !crossBoundaryWaiverGate.required || crossBoundaryWaiverGate.state === "clear";
  const authorizationReady = scopedAuthorization.scopeComplete
    && scopedAuthorization.hasRequiredRole
    && scopedAuthorization.missingPermissions.length === 0
    && scopedAuthorization.deniedPermissions.filter((permission) => (
      scopedAuthorization.scopedPermissions.includes(permission)
    )).length === 0;
  const delegationReady = !delegationBoundary.required || delegationBoundary.authorized;
  const state = blockers.length === 0 && authorizationReady && delegationReady && waiverReady
    ? "ready"
    : blockers.some((blocker) => blocker.includes("mismatch") || blocker.includes("missing_tenant") || blocker.includes("missing_workspace") || blocker.includes("cross_boundary"))
      ? "scope_blocked"
      : "authorization_blocked";

  return {
    contractType: "claim-allowance-boundary-audit-handoff-v1",
    boundaryKey,
    state,
    safeForProviderHandoff: state === "ready",
    tenantIsolation: {
      expectedTenantId: expectedTenantId || null,
      mismatch: tenantMismatch,
      participatingTenantIds: [...new Set([claimTenantId, requestTenantId, principal.tenantId].filter(Boolean))]
    },
    workspaceIsolation: {
      expectedWorkspaceId: expectedWorkspaceId || null,
      mismatch: workspaceMismatch,
      participatingWorkspaceIds: [...new Set([claimWorkspaceId, requestWorkspaceId, principal.workspaceId].filter(Boolean))]
    },
    scopeAssertions,
    authorizationProof: {
      mode: scopedAuthorization.grantMode,
      applicableGrantIds: scopedAuthorization.applicableGrantIds,
      blockedGrantIds: scopedAuthorization.blockedGrants.map((grant) => grant.grantId),
      matchedRoles: scopedAuthorization.matchedRoles,
      grantedPermissions: scopedAuthorization.scopedPermissions,
      deniedPermissions: scopedAuthorization.deniedPermissions,
      missingPermissions: scopedAuthorization.missingPermissions
    },
    delegationProof: {
      required: delegationBoundary.required,
      requested: delegationBoundary.requested,
      authorized: delegationBoundary.authorized,
      applicableDelegationIds: delegationBoundary.applicableDelegationIds,
      invalidDelegationIds: delegationBoundary.invalidDelegations.map((delegation) => delegation.delegationId),
      proofComplete: delegationBoundary.proofComplete,
      auditHandoffState: delegationBoundary.auditHandoff.state,
      proofRefs: delegationBoundary.auditHandoff.proofRefs
    },
    crossBoundaryWaiverProof: {
      required: crossBoundaryWaiverGate.required,
      state: crossBoundaryWaiverGate.state,
      requiredTypes: crossBoundaryWaiverGate.requiredTypes,
      acceptedWaiverIds: crossBoundaryWaiverGate.acceptedWaiverIds,
      proofRefs: crossBoundaryWaiverGate.proofRefs
    },
    providerHandoffGuard: {
      requiredBeforeDispatch: true,
      dispatchAllowed: state === "ready",
      replayPartitionKey: `${boundaryKey}:${requestContext.requestId}:${claim.id}`,
      blockedBy: blockers
    },
    evidenceRefs
  };
}

function buildBoundaryDecision({ input, claim, requestContext }) {
  const access = input.access && typeof input.access === "object" ? input.access : {};
  const principal = normalizeAccessPrincipal(input, claim);
  const claimTenantId = claim.tenantId || normalizeText(access.claimTenantId);
  const claimWorkspaceId = claim.workspaceId || normalizeText(access.claimWorkspaceId);
  const requestTenantId = requestContext.tenantId || normalizeText(access.requestTenantId);
  const requestWorkspaceId = requestContext.workspaceId || normalizeText(access.requestWorkspaceId);
  const expectedTenantId = normalizeText(input.expectedTenantId || access.expectedTenantId) || claimTenantId || requestTenantId;
  const expectedWorkspaceId = normalizeText(input.expectedWorkspaceId || access.expectedWorkspaceId) || claimWorkspaceId || requestWorkspaceId;
  const requiredRoles = asArray(input.requiredRoles).length > 0
    ? asArray(input.requiredRoles).map(normalizeText).filter(Boolean)
    : DEFAULT_REQUIRED_ROLES;
  const requiredPermissions = asArray(input.requiredPermissions).length > 0
    ? asArray(input.requiredPermissions).map(normalizeText).filter(Boolean)
    : DEFAULT_REQUIRED_PERMISSIONS;
  const allowCrossTenant = access.allowCrossTenant === true || input.allowCrossTenant === true;
  const allowCrossWorkspace = access.allowCrossWorkspace === true || input.allowCrossWorkspace === true;
  const tenantMismatch = Boolean(expectedTenantId && claimTenantId && claimTenantId !== expectedTenantId)
    || Boolean(expectedTenantId && requestTenantId && requestTenantId !== expectedTenantId)
    || Boolean(principal.tenantId && expectedTenantId && principal.tenantId !== expectedTenantId);
  const workspaceMismatch = Boolean(expectedWorkspaceId && claimWorkspaceId && claimWorkspaceId !== expectedWorkspaceId)
    || Boolean(expectedWorkspaceId && requestWorkspaceId && requestWorkspaceId !== expectedWorkspaceId)
    || Boolean(principal.workspaceId && expectedWorkspaceId && principal.workspaceId !== expectedWorkspaceId);
  const scopedAuthorization = buildScopedAuthorization({
    input,
    principal,
    expectedTenantId,
    expectedWorkspaceId,
    requiredRoles,
    requiredPermissions
  });
  const delegationBoundary = buildDelegationBoundary({
    input,
    principal,
    expectedTenantId,
    expectedWorkspaceId,
    requiredRoles,
    requiredPermissions,
    tenantMismatch,
    workspaceMismatch
  });
  const crossBoundaryWaiverGate = buildCrossBoundaryWaiverGate({
    input,
    principal,
    expectedTenantId,
    expectedWorkspaceId,
    tenantMismatch,
    workspaceMismatch,
    allowCrossTenant,
    allowCrossWorkspace
  });
  const blockers = [
    ...(!expectedTenantId ? ["boundary_missing_tenant"] : []),
    ...(!expectedWorkspaceId ? ["boundary_missing_workspace"] : []),
    ...(tenantMismatch && !allowCrossTenant ? ["boundary_tenant_mismatch"] : []),
    ...(workspaceMismatch && !allowCrossWorkspace ? ["boundary_workspace_mismatch"] : []),
    ...crossBoundaryWaiverGate.blockers.map((blocker) => `boundary_${blocker}`),
    ...(!scopedAuthorization.scopeComplete ? ["boundary_scope_grant_missing"] : []),
    ...(!scopedAuthorization.hasRequiredRole ? ["boundary_role_not_allowed"] : []),
    ...scopedAuthorization.missingPermissions.map((permission) => `boundary_missing_permission:${permission}`),
    ...scopedAuthorization.deniedPermissions
      .filter((permission) => requiredPermissions.includes(permission))
      .map((permission) => `boundary_denied_permission:${permission}`),
    ...delegationBoundary.blockers.map((blocker) => `boundary_${blocker}`)
  ];
  const auditHandoff = buildBoundaryAuditHandoff({
    claim,
    requestContext,
    principal,
    scopedAuthorization,
    delegationBoundary,
    expectedTenantId,
    expectedWorkspaceId,
    claimTenantId,
    claimWorkspaceId,
    requestTenantId,
    requestWorkspaceId,
    tenantMismatch,
    workspaceMismatch,
    crossBoundaryWaiverGate,
    blockers
  });

  return {
    contractType: "claim-allowance-boundary-decision-v1",
    scoped: blockers.length === 0,
    status: blockers.length === 0 ? "scoped" : "blocked",
    principal,
    tenant: {
      expectedTenantId: expectedTenantId || null,
      claimTenantId: claimTenantId || null,
      requestTenantId: requestTenantId || null,
      principalTenantId: principal.tenantId || null,
      crossTenantAllowed: allowCrossTenant,
      mismatch: tenantMismatch
    },
    workspace: {
      expectedWorkspaceId: expectedWorkspaceId || null,
      claimWorkspaceId: claimWorkspaceId || null,
      requestWorkspaceId: requestWorkspaceId || null,
      principalWorkspaceId: principal.workspaceId || null,
      crossWorkspaceAllowed: allowCrossWorkspace,
      mismatch: workspaceMismatch
    },
    authorization: {
      requiredRoles,
      matchedRoles: scopedAuthorization.matchedRoles,
      requiredPermissions,
      grantedPermissions: scopedAuthorization.scopedPermissions.filter((permission) => requiredPermissions.includes(permission)),
      missingPermissions: scopedAuthorization.missingPermissions,
      hasRequiredRole: scopedAuthorization.hasRequiredRole,
      scopeMode: scopedAuthorization.grantMode
    },
    scopedAuthorization,
    delegationBoundary,
    crossBoundaryWaiverGate,
    auditHandoff,
    blockers
  };
}

function normalizeClientState(input) {
  const clientState = input.clientState && typeof input.clientState === "object" ? input.clientState : {};
  const verifierState = clientState.verifierClaimGate && typeof clientState.verifierClaimGate === "object"
    ? clientState.verifierClaimGate
    : {};
  const allowanceState = verifierState.claimAllowance && typeof verifierState.claimAllowance === "object"
    ? verifierState.claimAllowance
    : {};
  const selectedEvidence = asArray(input.selectedEvidence || allowanceState.selectedEvidence)
    .map((value) => normalizeText(value))
    .filter(Boolean);

  return {
    activeStep: normalizeText(input.activeStep || allowanceState.activeStep) || DEFAULT_CLIENT_STEP,
    selectedEvidence,
    lastDecisionToken: normalizeText(input.lastDecisionToken || allowanceState.lastDecisionToken),
    handoffRoute: normalizeText(input.handoffRoute || allowanceState.handoffRoute),
    proofFormat: normalizeText(input.proofFormat || allowanceState.proofFormat) || "claim-allowance-proof-v1"
  };
}

function normalizeCommand(input, requestContext) {
  const rawCommand = input.command && typeof input.command === "object" ? input.command : {};
  const commandName = normalizeText(rawCommand.name || rawCommand.type || input.commandName) || "evaluate-claim-allowance";
  const commandId = normalizeText(rawCommand.id || rawCommand.commandId || input.commandId || input.idempotencyKey);
  const idempotencyKey = normalizeText(rawCommand.idempotencyKey || input.idempotencyKey || commandId);
  const rawLifecyclePatch = rawCommand.lifecycleSettings && typeof rawCommand.lifecycleSettings === "object"
    ? rawCommand.lifecycleSettings
    : rawCommand.settings && typeof rawCommand.settings === "object"
      ? rawCommand.settings
      : input.lifecycleSettingsPatch && typeof input.lifecycleSettingsPatch === "object"
        ? input.lifecycleSettingsPatch
        : {};

  return {
    name: commandName,
    commandId: commandId || `${requestContext.requestId}:${commandName}`,
    idempotencyKey: idempotencyKey || `${requestContext.requestId}:${commandName}`,
    requestedAt: normalizeText(rawCommand.requestedAt || input.requestedAt),
    requestedBy: normalizeText(rawCommand.requestedBy || input.requestedBy),
    lifecycleSettingsPatch: rawLifecyclePatch
  };
}

function normalizeBooleanSetting(value, fallback) {
  if (value === true || value === false) {
    return value;
  }
  const text = normalizeText(value).toLowerCase();
  if (["true", "enabled", "on", "yes"].includes(text)) {
    return true;
  }
  if (["false", "disabled", "off", "no"].includes(text)) {
    return false;
  }
  return fallback;
}

function normalizeLifecycleSettings(input, persistedState) {
  const rawSettings = input.lifecycleSettings && typeof input.lifecycleSettings === "object"
    ? input.lifecycleSettings
    : input.settings && typeof input.settings === "object"
      ? input.settings
      : {};
  const persistedSettings = persistedState.lifecycleSettings && typeof persistedState.lifecycleSettings === "object"
    ? persistedState.lifecycleSettings
    : {};
  const minIntervalMs = Number.isInteger(rawSettings.minIntervalMs) && rawSettings.minIntervalMs >= 0
    ? rawSettings.minIntervalMs
    : Number.isInteger(persistedSettings.minIntervalMs) && persistedSettings.minIntervalMs >= 0
      ? persistedSettings.minIntervalMs
      : DEFAULT_LIFECYCLE_SETTINGS.minIntervalMs;
  const scheduleMode = normalizeText(rawSettings.scheduleMode || rawSettings.mode || persistedSettings.scheduleMode).toLowerCase()
    || DEFAULT_LIFECYCLE_SETTINGS.scheduleMode;
  const invalidFields = [
    ...(!LIFECYCLE_SCHEDULE_MODES.has(scheduleMode) ? ["scheduleMode"] : []),
    ...(normalizeText(rawSettings.notBefore || persistedSettings.notBefore) && !Number.isFinite(Date.parse(normalizeText(rawSettings.notBefore || persistedSettings.notBefore))) ? ["notBefore"] : []),
    ...(normalizeText(rawSettings.disabledUntil || persistedSettings.disabledUntil) && !Number.isFinite(Date.parse(normalizeText(rawSettings.disabledUntil || persistedSettings.disabledUntil))) ? ["disabledUntil"] : []),
    ...(normalizeText(rawSettings.nextRunAt || persistedSettings.nextRunAt) && !Number.isFinite(Date.parse(normalizeText(rawSettings.nextRunAt || persistedSettings.nextRunAt))) ? ["nextRunAt"] : [])
  ];

  return {
    contractType: "claim-allowance-lifecycle-settings-v1",
    enabled: normalizeBooleanSetting(rawSettings.enabled ?? persistedSettings.enabled, DEFAULT_LIFECYCLE_SETTINGS.enabled),
    issueEnabled: normalizeBooleanSetting(rawSettings.issueEnabled ?? persistedSettings.issueEnabled, DEFAULT_LIFECYCLE_SETTINGS.issueEnabled),
    acceptanceEnabled: normalizeBooleanSetting(rawSettings.acceptanceEnabled ?? persistedSettings.acceptanceEnabled, DEFAULT_LIFECYCLE_SETTINGS.acceptanceEnabled),
    handoffEnabled: normalizeBooleanSetting(rawSettings.handoffEnabled ?? persistedSettings.handoffEnabled, DEFAULT_LIFECYCLE_SETTINGS.handoffEnabled),
    paused: normalizeBooleanSetting(rawSettings.paused ?? persistedSettings.paused, false),
    scheduleMode: LIFECYCLE_SCHEDULE_MODES.has(scheduleMode) ? scheduleMode : DEFAULT_LIFECYCLE_SETTINGS.scheduleMode,
    requestedScheduleMode: scheduleMode,
    notBefore: normalizeText(rawSettings.notBefore || persistedSettings.notBefore),
    disabledUntil: normalizeText(rawSettings.disabledUntil || persistedSettings.disabledUntil),
    nextRunAt: normalizeText(rawSettings.nextRunAt || persistedSettings.nextRunAt),
    minIntervalMs,
    lastIssuedAt: normalizeText(rawSettings.lastIssuedAt || persistedSettings.lastIssuedAt || persistedState.issuedAt),
    invalidFields
  };
}

function validateLifecycleSettings(settings) {
  const notBeforeMs = Date.parse(settings.notBefore);
  const disabledUntilMs = Date.parse(settings.disabledUntil);
  const nextRunAtMs = Date.parse(settings.nextRunAt);

  return [
    ...(!LIFECYCLE_SCHEDULE_MODES.has(settings.scheduleMode) ? ["scheduleMode"] : []),
    ...(settings.notBefore && !Number.isFinite(notBeforeMs) ? ["notBefore"] : []),
    ...(settings.disabledUntil && !Number.isFinite(disabledUntilMs) ? ["disabledUntil"] : []),
    ...(settings.nextRunAt && !Number.isFinite(nextRunAtMs) ? ["nextRunAt"] : []),
    ...(!Number.isInteger(settings.minIntervalMs) || settings.minIntervalMs < 0 ? ["minIntervalMs"] : []),
    ...(settings.scheduleMode === "windowed" && !settings.notBefore && !settings.nextRunAt ? ["windowedScheduleTarget"] : []),
    ...(settings.scheduleMode === "disabled" && settings.enabled ? ["disabledScheduleEnabled"] : []),
    ...(settings.enabled === false && settings.scheduleMode !== "disabled" ? ["disabledLifecycleScheduleMode"] : []),
    ...(Number.isFinite(disabledUntilMs) && Number.isFinite(nextRunAtMs) && nextRunAtMs < disabledUntilMs ? ["nextRunBeforeDisabledUntil"] : []),
    ...(Number.isFinite(disabledUntilMs) && Number.isFinite(notBeforeMs) && notBeforeMs < disabledUntilMs ? ["notBeforeBeforeDisabledUntil"] : [])
  ];
}

function normalizeLifecyclePatchValue(patch, key, fallback) {
  if (key === "minIntervalMs") {
    return Number.isInteger(patch.minIntervalMs) && patch.minIntervalMs >= 0 ? patch.minIntervalMs : fallback;
  }
  if (["enabled", "issueEnabled", "acceptanceEnabled", "handoffEnabled", "paused"].includes(key)) {
    return normalizeBooleanSetting(patch[key], fallback);
  }
  return normalizeText(patch[key]) || fallback;
}

function buildLifecycleCommandApplication({ command, settings, claim, requestContext, now }) {
  const patch = command.lifecycleSettingsPatch && typeof command.lifecycleSettingsPatch === "object"
    ? command.lifecycleSettingsPatch
    : {};
  const requestedMode = normalizeText(patch.scheduleMode || patch.mode || settings.requestedScheduleMode).toLowerCase();
  const requestedScheduleMode = LIFECYCLE_SCHEDULE_MODES.has(requestedMode)
    ? requestedMode
    : settings.scheduleMode;
  const scheduleFields = {
    scheduleMode: requestedScheduleMode,
    notBefore: normalizeLifecyclePatchValue(patch, "notBefore", settings.notBefore),
    disabledUntil: normalizeLifecyclePatchValue(patch, "disabledUntil", settings.disabledUntil),
    nextRunAt: normalizeLifecyclePatchValue(patch, "nextRunAt", settings.nextRunAt),
    minIntervalMs: normalizeLifecyclePatchValue(patch, "minIntervalMs", settings.minIntervalMs)
  };
  const commandAllowed = LIFECYCLE_COMMANDS.has(command.name);
  const mutatesSettings = LIFECYCLE_SETTINGS_COMMANDS.has(command.name);
  const requestedEnablement = normalizeBooleanSetting(patch.enabled, settings.enabled);
  const requestedPause = normalizeBooleanSetting(patch.paused, settings.paused);
  const mutationByCommand = {
    "enable-claim-allowance": {
      enabled: true,
      issueEnabled: normalizeLifecyclePatchValue(patch, "issueEnabled", true),
      paused: false,
      disabledUntil: "",
      scheduleMode: settings.scheduleMode === "disabled" ? "immediate" : settings.scheduleMode
    },
    "disable-claim-allowance": {
      enabled: false,
      issueEnabled: normalizeLifecyclePatchValue(patch, "issueEnabled", false),
      paused: false,
      disabledUntil: scheduleFields.disabledUntil,
      scheduleMode: "disabled"
    },
    "pause-claim-allowance": {
      paused: true,
      nextRunAt: scheduleFields.nextRunAt || settings.nextRunAt
    },
    "resume-claim-allowance": {
      enabled: true,
      paused: false,
      disabledUntil: "",
      scheduleMode: settings.scheduleMode === "disabled" ? "immediate" : settings.scheduleMode
    },
    "issue-claim-allowance": {
      lastIssuedAt: now
    },
    "schedule-claim-allowance": scheduleFields
  };
  const effectiveSettings = {
    ...settings,
    ...(mutatesSettings ? mutationByCommand[command.name] : {}),
    ...(command.name === "schedule-claim-allowance" && requestedScheduleMode === "disabled" ? { enabled: false, issueEnabled: false, paused: false } : {}),
    ...(command.name === "schedule-claim-allowance" && requestedScheduleMode !== "disabled" ? { enabled: requestedEnablement, paused: requestedPause } : {}),
    acceptanceEnabled: normalizeLifecyclePatchValue(patch, "acceptanceEnabled", settings.acceptanceEnabled),
    handoffEnabled: normalizeLifecyclePatchValue(patch, "handoffEnabled", settings.handoffEnabled)
  };
  const invalidFields = [...new Set([
    ...settings.invalidFields,
    ...validateLifecycleSettings(effectiveSettings)
  ])];
  const effectiveScheduleMode = LIFECYCLE_SCHEDULE_MODES.has(effectiveSettings.scheduleMode)
    ? effectiveSettings.scheduleMode
    : DEFAULT_LIFECYCLE_SETTINGS.scheduleMode;
  const normalizedEffectiveSettings = {
    ...effectiveSettings,
    scheduleMode: effectiveScheduleMode,
    requestedScheduleMode: requestedMode || settings.requestedScheduleMode || effectiveScheduleMode,
    invalidFields
  };
  const statePatch = mutatesSettings
    ? {
        contractType: "claim-allowance-lifecycle-settings-patch-v1",
        path: "verifierClaimGate.claimAllowance.lifecycleSettings",
        commandId: command.commandId,
        appliedAt: now,
        settings: normalizedEffectiveSettings
      }
    : null;
  const scheduleIntent = command.name === "schedule-claim-allowance"
    ? {
        mode: normalizedEffectiveSettings.scheduleMode,
        notBefore: normalizedEffectiveSettings.notBefore || null,
        disabledUntil: normalizedEffectiveSettings.disabledUntil || null,
        nextRunAt: normalizedEffectiveSettings.nextRunAt || null,
        minIntervalMs: normalizedEffectiveSettings.minIntervalMs,
        targetRequired: normalizedEffectiveSettings.scheduleMode === "windowed",
        disablesIssue: normalizedEffectiveSettings.scheduleMode === "disabled" || normalizedEffectiveSettings.enabled === false
      }
    : null;
  const nextActionState = !commandAllowed
    ? "command_rejected"
    : invalidFields.length > 0
      ? "settings_invalid"
      : command.name === "issue-claim-allowance"
        ? "issue_recorded"
        : command.name === "accept-claim-allowance"
          ? "acceptance_recorded"
          : command.name === "schedule-claim-allowance" && normalizedEffectiveSettings.scheduleMode === "windowed"
            ? "scheduled_window"
            : command.name === "disable-claim-allowance"
              ? "disabled"
              : command.name === "pause-claim-allowance"
                ? "paused"
                : command.name === "enable-claim-allowance" || command.name === "resume-claim-allowance"
                  ? "ready_for_evaluation"
                  : "evaluate_readiness";

  return {
    contractType: "claim-allowance-lifecycle-command-application-v1",
    applicationId: `${surfaceId}:${claim.id}:${command.commandId}:lifecycle-command`,
    generatedAt: now,
    claimId: claim.id,
    requestId: requestContext.requestId,
    commandName: command.name,
    commandAllowed,
    mutatesSettings,
    state: commandAllowed && invalidFields.length === 0 ? "applied" : "blocked",
    nextActionState,
    appliedPatch: statePatch,
    previousSettings: settings,
    effectiveSettings: normalizedEffectiveSettings,
    auditProof: {
      proofType: "claim-allowance-lifecycle-command-proof-v1",
      commandId: command.commandId,
      idempotencyKey: command.idempotencyKey,
      requestedBy: command.requestedBy || claim.requestedBy || "unknown",
      settingsChanged: mutatesSettings,
      changedFields: mutatesSettings
        ? Object.keys(mutationByCommand[command.name] || {}).filter((field) => settings[field] !== normalizedEffectiveSettings[field])
        : [],
      scheduleMode: normalizedEffectiveSettings.scheduleMode,
      notBefore: normalizedEffectiveSettings.notBefore || null,
      disabledUntil: normalizedEffectiveSettings.disabledUntil || null,
      nextRunAt: normalizedEffectiveSettings.nextRunAt || null,
      scheduleIntent,
      invalidFields
    },
    blockers: [
      ...(!commandAllowed ? [`lifecycle_command_not_allowed:${command.name}`] : []),
      ...invalidFields.map((field) => `lifecycle_settings_invalid:${field}`)
    ]
  };
}

function lifecycleCommandPolicy(commandName) {
  const lifecycleOperation = commandName.replace(/-claim-allowance$/, "");

  return {
    lifecycleOperation,
    mutatesSettings: LIFECYCLE_SETTINGS_COMMANDS.has(commandName),
    recoveryCommand: LIFECYCLE_RECOVERY_COMMANDS.has(commandName),
    issueCommand: LIFECYCLE_ISSUE_COMMANDS.has(commandName),
    acceptanceCommand: LIFECYCLE_ACCEPTANCE_COMMANDS.has(commandName),
    canBypassDisabled: ["enable-claim-allowance", "disable-claim-allowance"].includes(commandName),
    canBypassIssueDisabled: LIFECYCLE_SETTINGS_COMMANDS.has(commandName) || LIFECYCLE_ACCEPTANCE_COMMANDS.has(commandName),
    canBypassPaused: ["pause-claim-allowance", "resume-claim-allowance", "schedule-claim-allowance"].includes(commandName),
    canBypassScheduleDisabled: ["enable-claim-allowance", "disable-claim-allowance", "schedule-claim-allowance"].includes(commandName),
    canBypassDisabledUntil: LIFECYCLE_RECOVERY_COMMANDS.has(commandName) || commandName === "disable-claim-allowance",
    canBypassDueWindow: LIFECYCLE_RECOVERY_COMMANDS.has(commandName) || commandName === "disable-claim-allowance",
    requiresAcceptanceEnabled: LIFECYCLE_ACCEPTANCE_COMMANDS.has(commandName),
    requiresIssueEnabled: LIFECYCLE_ISSUE_COMMANDS.has(commandName)
  };
}

function buildLifecycleGate({ command, settings, now }) {
  const nowMs = Date.parse(now);
  const disabledUntilMs = Date.parse(settings.disabledUntil);
  const notBeforeMs = Date.parse(settings.notBefore);
  const nextRunAtMs = Date.parse(settings.nextRunAt);
  const lastIssuedMs = Date.parse(settings.lastIssuedAt);
  const intervalDueAtMs = Number.isFinite(lastIssuedMs) && settings.minIntervalMs > 0
    ? lastIssuedMs + settings.minIntervalMs
    : null;
  const scheduleDueAtMs = [notBeforeMs, nextRunAtMs, intervalDueAtMs]
    .filter((value) => Number.isFinite(value))
    .reduce((latest, value) => Math.max(latest, value), 0);
  const disabledUntilActive = Number.isFinite(nowMs) && Number.isFinite(disabledUntilMs) && disabledUntilMs > nowMs;
  const scheduleNotDue = settings.scheduleMode === "windowed"
    && Number.isFinite(nowMs)
    && scheduleDueAtMs > nowMs;
  const commandAllowed = LIFECYCLE_COMMANDS.has(command.name);
  const policy = lifecycleCommandPolicy(command.name);
  const blockers = [
    ...settings.invalidFields.map((field) => `lifecycle_settings_invalid:${field}`),
    ...(!commandAllowed ? [`lifecycle_command_not_allowed:${command.name}`] : []),
    ...(!settings.enabled && !policy.canBypassDisabled ? ["lifecycle_disabled"] : []),
    ...(!settings.issueEnabled && !policy.canBypassIssueDisabled ? ["lifecycle_issue_disabled"] : []),
    ...(!settings.acceptanceEnabled && policy.requiresAcceptanceEnabled ? ["lifecycle_acceptance_disabled"] : []),
    ...(settings.paused && !policy.canBypassPaused ? ["lifecycle_paused"] : []),
    ...(settings.scheduleMode === "disabled" && !policy.canBypassScheduleDisabled ? ["lifecycle_schedule_disabled"] : []),
    ...(disabledUntilActive && !policy.canBypassDisabledUntil ? ["lifecycle_disabled_until_active"] : []),
    ...(scheduleNotDue && !policy.canBypassDueWindow ? ["lifecycle_schedule_not_due"] : [])
  ];
  const issueBlockers = blockers.filter((blocker) => blocker !== "lifecycle_acceptance_disabled");
  const acceptanceBlockers = blockers.filter((blocker) => blocker !== "lifecycle_issue_disabled");
  const controlEnabled = settings.enabled && !settings.paused && settings.scheduleMode !== "disabled";
  const issueEnabled = controlEnabled && settings.issueEnabled && issueBlockers.length === 0;
  const acceptanceEnabled = controlEnabled && settings.acceptanceEnabled && acceptanceBlockers.length === 0;

  return {
    contractType: "claim-allowance-lifecycle-gate-v1",
    settings,
    command: {
      name: command.name,
      allowed: commandAllowed,
      lifecycleOperation: policy.lifecycleOperation,
      policy
    },
    enabled: issueEnabled,
    status: blockers.length === 0
      ? issueEnabled ? "enabled" : "disabled"
      : settings.enabled ? "blocked" : "disabled",
    canEvaluate: commandAllowed && policy.issueCommand && issueEnabled,
    canAccept: commandAllowed && acceptanceEnabled,
    canHandoff: settings.enabled && settings.handoffEnabled && issueBlockers.length === 0,
    canMutateSettings: commandAllowed && policy.mutatesSettings && settings.invalidFields.length === 0,
    controlActions: {
      canEnable: commandAllowed && (!settings.enabled || settings.scheduleMode === "disabled" || blockers.includes("lifecycle_disabled")),
      canDisable: commandAllowed && settings.enabled,
      canPause: commandAllowed && settings.enabled && !settings.paused && settings.scheduleMode !== "disabled",
      canResume: commandAllowed && (settings.paused || settings.scheduleMode === "disabled" || disabledUntilActive || scheduleNotDue),
      canSchedule: commandAllowed && settings.invalidFields.length === 0,
      recoveryCommandAllowed: commandAllowed && policy.recoveryCommand
    },
    scheduling: {
      mode: settings.scheduleMode,
      disabledUntil: settings.disabledUntil || null,
      notBefore: settings.notBefore || null,
      nextRunAt: settings.nextRunAt || null,
      minIntervalMs: settings.minIntervalMs,
      lastIssuedAt: settings.lastIssuedAt || null,
      dueAt: scheduleDueAtMs > 0 ? new Date(scheduleDueAtMs).toISOString() : null,
      due: !scheduleNotDue && !disabledUntilActive,
      disabledUntilActive,
      scheduleNotDue,
      commandCanBypassHold: policy.canBypassDisabledUntil || policy.canBypassDueWindow
    },
    blockers
  };
}

function normalizePersistedCommandLedger(persisted) {
  const rawLedger = [
    ...asArray(persisted.commandLedger),
    ...asArray(persisted.commands),
    ...asArray(persisted.idempotencyLedger)
  ];
  const seen = new Set();

  return rawLedger
    .map((entry, index) => {
      const candidate = entry && typeof entry === "object" ? entry : {};
      const commandId = normalizeText(candidate.commandId || candidate.id);
      const idempotencyKey = normalizeText(candidate.idempotencyKey || candidate.key || commandId);
      const decisionToken = normalizeText(candidate.decisionToken);
      const status = normalizeText(candidate.status || candidate.state).toLowerCase() || "unknown";
      const ledgerId = normalizeText(candidate.ledgerId)
        || `${commandId || idempotencyKey || "command"}:${decisionToken || index}`;

      return {
        ledgerId,
        commandId,
        idempotencyKey,
        claimId: normalizeText(candidate.claimId || candidate.claim),
        decisionToken,
        status,
        restartSafe: candidate.restartSafe === true || TERMINAL_COMMAND_STATUSES.has(status),
        requestedAt: normalizeText(candidate.requestedAt),
        appliedAt: normalizeText(candidate.appliedAt || candidate.completedAt || candidate.updatedAt),
        recoveryAction: normalizeText(candidate.recoveryAction),
        resultStatus: normalizeText(candidate.resultStatus || candidate.allowanceStatus),
        proofId: normalizeText(candidate.proofId || candidate.issuedProofId),
        blockedBy: asArray(candidate.blockedBy).map(normalizeText).filter(Boolean)
      };
    })
    .filter((entry) => {
      const key = `${entry.commandId}:${entry.idempotencyKey}:${entry.decisionToken}`;
      if ((!entry.commandId && !entry.idempotencyKey) || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .sort((a, b) => {
      const aMs = Date.parse(a.appliedAt || a.requestedAt);
      const bMs = Date.parse(b.appliedAt || b.requestedAt);
      if (Number.isFinite(aMs) && Number.isFinite(bMs)) {
        return aMs - bMs;
      }
      return a.ledgerId.localeCompare(b.ledgerId);
    })
    .slice(-MAX_COMMAND_LEDGER_ENTRIES);
}

function normalizePersistedClaimAllowance(input) {
  const rawState = input.persistedState && typeof input.persistedState === "object"
    ? input.persistedState
    : input.state && typeof input.state === "object"
      ? input.state
      : {};
  const rawGate = rawState.verifierClaimGate && typeof rawState.verifierClaimGate === "object"
    ? rawState.verifierClaimGate
    : {};
  const clientState = input.clientState && typeof input.clientState === "object" ? input.clientState : {};
  const clientGate = clientState.verifierClaimGate && typeof clientState.verifierClaimGate === "object"
    ? clientState.verifierClaimGate
    : {};
  const persisted = rawGate.claimAllowance && typeof rawGate.claimAllowance === "object"
    ? rawGate.claimAllowance
    : rawState.claimAllowance && typeof rawState.claimAllowance === "object"
      ? rawState.claimAllowance
      : clientGate.claimAllowance && typeof clientGate.claimAllowance === "object"
        ? clientGate.claimAllowance
        : {};

  return {
    version: Number.isInteger(persisted.version) ? persisted.version : 0,
    claimId: normalizeText(persisted.claimId),
    status: normalizeText(persisted.status || persisted.decisionStatus),
    decision: normalizeText(persisted.decision),
    decisionToken: normalizeText(persisted.decisionToken || persisted.lastDecisionToken),
    lastCommandId: normalizeText(persisted.lastCommandId || persisted.commandId),
    idempotencyKey: normalizeText(persisted.idempotencyKey),
    lastEvaluatedAt: normalizeText(persisted.lastEvaluatedAt || persisted.updatedAt),
    issuedAt: normalizeText(persisted.issuedAt),
    issuedProofId: normalizeText(persisted.issuedProofId || persisted.proofId),
    blockedBy: asArray(persisted.blockedBy).map(normalizeText).filter(Boolean),
    missingEvidenceTypes: asArray(persisted.missingEvidenceTypes).map(normalizeText).filter(Boolean),
    unsatisfiedRequiredEvidenceTypes: asArray(persisted.unsatisfiedRequiredEvidenceTypes).map(normalizeText).filter(Boolean),
    rejectedEvidenceIds: asArray(persisted.rejectedEvidenceIds).map(normalizeText).filter(Boolean),
    acceptedEvidenceTypes: asArray(persisted.acceptedEvidenceTypes).map(normalizeText).filter(Boolean),
    lifecycleSettings: persisted.lifecycleSettings && typeof persisted.lifecycleSettings === "object" ? persisted.lifecycleSettings : {},
    analytics: persisted.analytics && typeof persisted.analytics === "object" ? persisted.analytics : {},
    history: asArray(persisted.history),
    commandLedger: normalizePersistedCommandLedger(persisted)
  };
}

function normalizeRetryPolicy(input) {
  const retry = input.retryPolicy && typeof input.retryPolicy === "object" ? input.retryPolicy : {};
  const maxAttempts = Number.isInteger(retry.maxAttempts) && retry.maxAttempts > 0
    ? retry.maxAttempts
    : DEFAULT_RETRY_POLICY.maxAttempts;
  const baseDelayMs = Number.isInteger(retry.baseDelayMs) && retry.baseDelayMs > 0
    ? retry.baseDelayMs
    : DEFAULT_RETRY_POLICY.baseDelayMs;
  const maxDelayMs = Number.isInteger(retry.maxDelayMs) && retry.maxDelayMs >= baseDelayMs
    ? retry.maxDelayMs
    : DEFAULT_RETRY_POLICY.maxDelayMs;
  const jitterMs = Number.isInteger(retry.jitterMs) && retry.jitterMs >= 0
    ? retry.jitterMs
    : DEFAULT_RETRY_POLICY.jitterMs;

  return { maxAttempts, baseDelayMs, maxDelayMs, jitterMs };
}

function normalizeProviderServiceContracts(candidate, providerId) {
  const rawContracts = [
    ...asArray(candidate.serviceContracts),
    ...asArray(candidate.contracts),
    ...asArray(candidate.operations),
    ...(candidate.serviceContract && typeof candidate.serviceContract === "object" ? [candidate.serviceContract] : []),
    ...(candidate.operation || candidate.operationName || candidate.routeAction ? [candidate] : [])
  ];

  return rawContracts.map((contract, index) => {
    const entry = contract && typeof contract === "object" ? contract : { operation: contract };
    const operation = normalizeText(entry.operation || entry.operationName || entry.name || entry.type);
    const status = normalizeText(entry.status || entry.state || entry.externalState).toLowerCase() || "unknown";
    const endpoint = normalizeText(entry.endpoint || entry.handoffEndpoint || entry.callbackUrl || candidate.handoffEndpoint);
    const routeAction = normalizeText(entry.routeAction || entry.action || candidate.routeAction);
    const schemaVersion = normalizeText(entry.schemaVersion || entry.contractVersion || entry.version);
    const inputContract = normalizeText(entry.inputContract || entry.inputSchema || entry.requestSchema);
    const outputContract = normalizeText(entry.outputContract || entry.outputSchema || entry.responseSchema);
    const offeredCapabilities = [
      ...asArray(entry.capabilities),
      ...asArray(entry.supportedCapabilities),
      ...asArray(candidate.capabilities),
      ...asArray(candidate.supportedCapabilities),
      ...asArray(candidate.contractCapabilities)
    ].map(normalizeText).filter(Boolean);
    const requiredCapabilities = asArray(entry.requiredCapabilities)
      .map(normalizeText)
      .filter(Boolean);

    return {
      id: normalizeText(entry.id || entry.contractId) || `${providerId}:contract-${index + 1}`,
      providerId,
      operation: operation || `operation-${index + 1}`,
      schemaVersion,
      inputContract,
      outputContract,
      routeAction,
      endpoint,
      status,
      ready: SERVICE_CONTRACT_READY_STATES.has(status) && entry.disabled !== true && candidate.disabled !== true,
      disabled: entry.disabled === true || candidate.disabled === true,
      capabilities: [...new Set([...offeredCapabilities, ...requiredCapabilities])],
      offeredCapabilities: [...new Set(offeredCapabilities)],
      requiredCapabilities: [...new Set(requiredCapabilities)],
      ackMode: normalizeText(entry.ackMode || entry.deliveryMode) || (endpoint ? "external-ack" : "in-process"),
      tenantId: normalizeText(entry.tenantId || entry.tenant || candidate.tenantId || candidate.tenant),
      workspaceId: normalizeText(entry.workspaceId || entry.workspace || candidate.workspaceId || candidate.workspace),
      sync: {
        cursor: normalizeText(entry.syncCursor || entry.cursor || candidate.syncCursor || candidate.cursor),
        syncedAt: normalizeText(entry.syncedAt || entry.lastSyncAt || candidate.syncedAt || candidate.lastSyncAt),
        revision: normalizeText(entry.revision || candidate.revision),
        stale: entry.stale === true || entry.fresh === false || candidate.stale === true || candidate.fresh === false
      }
    };
  });
}

function normalizeProviderContracts(input) {
  const rawProviders = [
    ...asArray(input.providers),
    ...asArray(input.providerContracts),
    ...asArray(input.integrationProviders),
    ...(input.providerContract && typeof input.providerContract === "object" ? [input.providerContract] : [])
  ];

  return rawProviders.map((provider, index) => {
    const candidate = provider && typeof provider === "object" ? provider : { id: provider };
    const id = normalizeText(candidate.id || candidate.providerId || candidate.name) || `provider-${index + 1}`;
    const capabilities = [
      ...asArray(candidate.capabilities),
      ...asArray(candidate.supportedCapabilities),
      ...asArray(candidate.contractCapabilities)
    ].map(normalizeText).filter(Boolean);
    const status = normalizeText(candidate.status || candidate.state || candidate.health).toLowerCase() || "unknown";
    const syncedAt = normalizeText(candidate.syncedAt || candidate.lastSyncAt || candidate.updatedAt);
    const syncCursor = normalizeText(candidate.syncCursor || candidate.cursor || candidate.revision);
    const handoffEndpoint = normalizeText(candidate.handoffEndpoint || candidate.callbackUrl || candidate.routeAction);
    const serviceContracts = normalizeProviderServiceContracts(candidate, id);

    return {
      id,
      type: normalizeText(candidate.type || candidate.kind || candidate.service) || "integration-provider",
      version: normalizeText(candidate.version || candidate.contractVersion),
      tenantId: normalizeText(candidate.tenantId || candidate.tenant),
      workspaceId: normalizeText(candidate.workspaceId || candidate.workspace),
      status,
      ready: PROVIDER_READY_STATES.has(status) && candidate.disabled !== true,
      disabled: candidate.disabled === true,
      capabilities: [...new Set(capabilities)],
      serviceContracts,
      sync: {
        cursor: syncCursor,
        syncedAt,
        externalRef: normalizeText(candidate.externalRef || candidate.externalId || candidate.resourceId),
        stale: candidate.stale === true || candidate.fresh === false
      },
      failure: {
        code: normalizeText(candidate.failureCode || candidate.errorCode || candidate.code || candidate.reason),
        message: normalizeText(candidate.failureMessage || candidate.errorMessage || candidate.message || candidate.detail),
        retryable: candidate.retryable !== false && (
          DEGRADED_STATES.has(status)
          || UNHEALTHY_STATES.has(status)
          || candidate.stale === true
          || candidate.fresh === false
        ),
        attempt: Number.isInteger(candidate.attempt) && candidate.attempt > 0
          ? candidate.attempt
          : Number.isInteger(candidate.retryAttempt) && candidate.retryAttempt > 0
            ? candidate.retryAttempt
            : 0,
        lastFailedAt: normalizeText(candidate.lastFailedAt || candidate.failedAt || candidate.checkedAt || candidate.updatedAt),
        retryAfter: normalizeText(candidate.retryAfter || candidate.nextRetryAt)
      },
      handoff: {
        endpoint: handoffEndpoint,
        method: normalizeText(candidate.handoffMethod || candidate.method) || (handoffEndpoint ? "routeAction" : ""),
        state: normalizeText(candidate.handoffState || candidate.externalState || candidate.state)
      },
      namespace: {
        tenantId: normalizeText(candidate.tenantId || candidate.tenant) || null,
        workspaceId: normalizeText(candidate.workspaceId || candidate.workspace) || null,
        source: candidate.tenantId || candidate.tenant || candidate.workspaceId || candidate.workspace
          ? "provider"
          : "undeclared"
      }
    };
  });
}

function providerRecoveryDelayMs(attempt, retryPolicy) {
  const attemptNumber = Math.max(attempt, 1);
  return Math.min(
    retryPolicy.baseDelayMs * (2 ** Math.max(attemptNumber - 1, 0)) + retryPolicy.jitterMs,
    retryPolicy.maxDelayMs
  );
}

function buildProviderFailureState({ providers, missingCapabilities, serviceContractNegotiation, providerNamespaceBoundary, retryPolicy, now }) {
  const nowMs = Date.parse(now);
  const retryBaseMs = Number.isFinite(nowMs) ? nowMs : Date.now();
  const impairedProviders = providers.filter((provider) => !provider.ready || provider.sync.stale);
  const retryCandidates = impairedProviders
    .filter((provider) => provider.failure.retryable && provider.failure.attempt < retryPolicy.maxAttempts)
    .map((provider) => {
      const attemptsUsed = Math.max(provider.failure.attempt, 1);
      const delayMs = provider.failure.retryAfter
        ? null
        : providerRecoveryDelayMs(attemptsUsed, retryPolicy);

      return {
        providerId: provider.id,
        status: provider.status,
        code: provider.failure.code || (provider.sync.stale ? "provider_sync_stale" : "provider_unavailable"),
        retryAfter: provider.failure.retryAfter || new Date(retryBaseMs + delayMs).toISOString(),
        nextDelayMs: delayMs,
        attemptsUsed,
        attemptsRemaining: Math.max(retryPolicy.maxAttempts - attemptsUsed, 0)
      };
    });
  const exhaustedProviders = impairedProviders.filter((provider) => (
    provider.failure.retryable && provider.failure.attempt >= retryPolicy.maxAttempts
  ));
  const degradedProviders = providers.filter((provider) => provider.ready && provider.sync.stale);
  const downProviders = providers.filter((provider) => !provider.ready);
  const providerActions = [
    ...downProviders.map((provider) => ({
      actionId: `provider-action-restore-${provider.id}`,
      code: provider.failure.code || "provider_unavailable",
      providerId: provider.id,
      routeAction: "verifier.claimAllowance.negotiateProviderContract",
      label: `Restore ${provider.id}`,
      reason: provider.failure.message || `${provider.id} is ${provider.status} and cannot support claim allowance handoff.`,
      blocksIssue: true
    })),
    ...degradedProviders.map((provider) => ({
      actionId: `provider-action-refresh-${provider.id}`,
      code: "provider_sync_stale",
      providerId: provider.id,
      routeAction: "verifier.claimAllowance.syncHandoff",
      label: `Refresh ${provider.id}`,
      reason: `${provider.id} sync metadata is stale before claim allowance handoff.`,
      blocksIssue: true
    })),
    ...missingCapabilities.map((capability) => ({
      actionId: `provider-action-capability-${capability}`,
      code: `missing_provider_capability:${capability}`,
      providerId: null,
      routeAction: "verifier.claimAllowance.negotiateProviderContract",
      label: "Add provider capability",
      reason: `${capability} capability is required for claim allowance provider dispatch.`,
      blocksIssue: true
    })),
    ...serviceContractNegotiation.missingOperations.map((operation) => ({
      actionId: `provider-action-operation-${operation}`,
      code: `missing_provider_operation:${operation}`,
      providerId: null,
      routeAction: "verifier.claimAllowance.negotiateProviderContract",
      label: "Bind provider operation",
      reason: `${operation} must be bound before claim allowance can dispatch.`,
      blocksIssue: true
    })),
    ...serviceContractNegotiation.operationCapabilityStates
      .filter((state) => state.state === "capability_missing")
      .flatMap((state) => state.missingCapabilities.map((capability) => ({
        actionId: `provider-action-operation-capability-${state.operation}-${capability}`,
        code: `operation_capability_missing:${state.operation}:${capability}`,
        providerId: null,
        routeAction: "verifier.claimAllowance.negotiateProviderContract",
        label: "Negotiate operation capability",
        reason: `${state.operation} requires ${capability} on a bound service contract before allowance dispatch.`,
        blocksIssue: true
      })))
  ];
  const namespaceActions = providerNamespaceBoundary.blockers.map((blocker) => ({
    actionId: `provider-action-${blocker.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`,
    code: blocker,
    providerId: null,
    routeAction: "verifier.claimAllowance.resolveBoundary",
    label: "Scope provider namespace",
    reason: providerBlockerReason(blocker),
    blocksIssue: true
  }));
  const retryBackoffActive = retryCandidates.length > 0;
  const blocked = downProviders.length > 0
    || exhaustedProviders.length > 0
    || missingCapabilities.length > 0
    || serviceContractNegotiation.blockers.length > 0
    || providerNamespaceBoundary.blockers.length > 0;

  return {
    contractType: "claim-allowance-provider-failure-state-v1",
    state: blocked ? "blocked" : degradedProviders.length > 0 || retryBackoffActive ? "degraded" : "clear",
    dispatchGuard: {
      issueDispatchAllowed: !blocked && !retryBackoffActive && degradedProviders.length === 0,
      degradedDispatchMode: degradedProviders.length > 0 && !blocked ? "review-and-sync-only" : "none",
      retryBackoffActive,
      blocked
    },
    retryWindow: {
      policy: retryCandidates.length > 0 ? "provider-exponential-backoff" : "none",
      retryable: retryBackoffActive,
      nextRetryAfter: retryCandidates
        .map((candidate) => candidate.retryAfter)
        .sort()[0] || null,
      providers: retryCandidates,
      exhaustedProviderIds: exhaustedProviders.map((provider) => provider.id)
    },
    degradedMode: {
      active: degradedProviders.length > 0 && !blocked,
      providerIds: degradedProviders.map((provider) => provider.id),
      allowedOperations: degradedProviders.length > 0 && !blocked
        ? ["claimAllowance.review", "claimAllowance.syncHandoff"]
        : []
    },
    incidents: impairedProviders.map((provider) => ({
      incidentId: `provider:${provider.id}:${provider.status}`,
      providerId: provider.id,
      code: provider.failure.code || (provider.sync.stale ? "provider_sync_stale" : "provider_unavailable"),
      state: provider.ready ? "degraded" : "blocking",
      retryable: provider.failure.retryable,
      attempt: provider.failure.attempt,
      message: provider.failure.message || `${provider.id} provider health is ${provider.status}.`,
      observedAt: provider.failure.lastFailedAt || provider.sync.syncedAt || now
    })),
    operatorActions: [...providerActions, ...namespaceActions]
  };
}

function namespaceMatchState(expectedValue, observedValue) {
  if (!expectedValue) {
    return "expected_missing";
  }
  if (!observedValue) {
    return "undeclared";
  }
  return expectedValue === observedValue ? "matched" : "mismatched";
}

function providerNamespaceReasons({ expectedTenantId, expectedWorkspaceId, tenantId, workspaceId, requireDeclaredNamespace }) {
  const tenantState = namespaceMatchState(expectedTenantId, tenantId);
  const workspaceState = namespaceMatchState(expectedWorkspaceId, workspaceId);

  return {
    tenantState,
    workspaceState,
    reasons: [
      ...(tenantState === "expected_missing" ? ["expected_tenant_missing"] : []),
      ...(workspaceState === "expected_missing" ? ["expected_workspace_missing"] : []),
      ...(requireDeclaredNamespace && tenantState === "undeclared" ? ["tenant_undeclared"] : []),
      ...(requireDeclaredNamespace && workspaceState === "undeclared" ? ["workspace_undeclared"] : []),
      ...(tenantState === "mismatched" ? ["tenant_mismatch"] : []),
      ...(workspaceState === "mismatched" ? ["workspace_mismatch"] : [])
    ]
  };
}

function buildProviderNamespaceBoundary({ providers, serviceContractNegotiation, boundaryDecision }) {
  const expectedTenantId = boundaryDecision.tenant.expectedTenantId;
  const expectedWorkspaceId = boundaryDecision.workspace.expectedWorkspaceId;
  const boundBindings = serviceContractNegotiation.operationBindings.filter((binding) => binding.state === "bound");
  const providerById = new Map(providers.map((provider) => [provider.id, provider]));
  const contractById = new Map(providers.flatMap((provider) => provider.serviceContracts.map((contract) => [contract.id, contract])));
  const providerAssertions = providers.map((provider) => {
    const namespace = providerNamespaceReasons({
      expectedTenantId,
      expectedWorkspaceId,
      tenantId: provider.tenantId,
      workspaceId: provider.workspaceId,
      requireDeclaredNamespace: provider.handoff.endpoint || provider.serviceContracts.length > 0
    });

    return {
      providerId: provider.id,
      tenantId: provider.tenantId || null,
      workspaceId: provider.workspaceId || null,
      tenantState: namespace.tenantState,
      workspaceState: namespace.workspaceState,
      reasons: namespace.reasons
    };
  });
  const bindingAssertions = boundBindings.map((binding) => {
    const provider = providerById.get(binding.providerId) || {};
    const contract = contractById.get(binding.contractId) || {};
    const tenantId = contract.tenantId || provider.tenantId || "";
    const workspaceId = contract.workspaceId || provider.workspaceId || "";
    const namespace = providerNamespaceReasons({
      expectedTenantId,
      expectedWorkspaceId,
      tenantId,
      workspaceId,
      requireDeclaredNamespace: true
    });

    return {
      operation: binding.operation,
      providerId: binding.providerId,
      contractId: binding.contractId,
      tenantId: tenantId || null,
      workspaceId: workspaceId || null,
      namespaceSource: contract.tenantId || contract.workspaceId ? "service-contract" : provider.tenantId || provider.workspaceId ? "provider" : "undeclared",
      tenantState: namespace.tenantState,
      workspaceState: namespace.workspaceState,
      reasons: namespace.reasons
    };
  });
  const blockedProviders = providerAssertions.filter((assertion) => assertion.reasons.some((reason) => reason.endsWith("_mismatch")));
  const blockedBindings = bindingAssertions.filter((assertion) => assertion.reasons.length > 0);
  const blockers = [
    ...blockedProviders.flatMap((assertion) => assertion.reasons.map((reason) => `provider_namespace:${assertion.providerId}:${reason}`)),
    ...blockedBindings.flatMap((assertion) => assertion.reasons.map((reason) => `provider_binding_namespace:${assertion.operation}:${assertion.contractId}:${reason}`))
  ];

  return {
    contractType: "claim-allowance-provider-namespace-boundary-v1",
    expectedTenantId: expectedTenantId || null,
    expectedWorkspaceId: expectedWorkspaceId || null,
    state: blockers.length === 0 ? "scoped" : "blocked",
    safeForDispatch: blockers.length === 0,
    providerAssertions,
    bindingAssertions,
    blockedProviderIds: blockedProviders.map((assertion) => assertion.providerId),
    blockedBindingIds: blockedBindings.map((assertion) => assertion.contractId),
    auditHandoff: {
      state: blockers.length === 0 ? "ready" : "blocked",
      boundaryKey: `${expectedTenantId || "tenant-missing"}:${expectedWorkspaceId || "workspace-missing"}`,
      dispatchAllowed: blockers.length === 0,
      evidenceRefs: [
        ...providerAssertions.map((assertion) => ({
          evidenceType: "provider-namespace",
          id: assertion.providerId,
          state: assertion.reasons.length === 0 ? "accepted" : "review",
          reasons: assertion.reasons
        })),
        ...bindingAssertions.map((assertion) => ({
          evidenceType: "provider-binding-namespace",
          id: assertion.contractId,
          operation: assertion.operation,
          state: assertion.reasons.length === 0 ? "accepted" : "rejected",
          reasons: assertion.reasons
        }))
      ]
    },
    blockers
  };
}

function normalizeOperationCapabilityRequirements(input, requiredOperations) {
  const rawRequirements = input.operationCapabilityRequirements && typeof input.operationCapabilityRequirements === "object"
    ? input.operationCapabilityRequirements
    : input.serviceOperationCapabilities && typeof input.serviceOperationCapabilities === "object"
      ? input.serviceOperationCapabilities
      : {};
  const fallbackCapabilities = asArray(input.requiredProviderCapabilities).length > 0
    ? asArray(input.requiredProviderCapabilities).map(normalizeText).filter(Boolean)
    : DEFAULT_PROVIDER_CAPABILITIES;

  return requiredOperations.reduce((requirements, operation) => {
    const rawOperationRequirement = rawRequirements[operation];
    const operationCapabilities = Array.isArray(rawOperationRequirement)
      ? rawOperationRequirement
      : rawOperationRequirement && typeof rawOperationRequirement === "object"
        ? asArray(rawOperationRequirement.capabilities || rawOperationRequirement.requiredCapabilities)
        : DEFAULT_PROVIDER_OPERATION_CAPABILITIES[operation] || fallbackCapabilities;

    return {
      ...requirements,
      [operation]: [...new Set(operationCapabilities.map(normalizeText).filter(Boolean))]
    };
  }, {});
}

function buildOperationCapabilityState(contract, requiredCapabilities) {
  const offeredCapabilities = [...new Set((
    asArray(contract.offeredCapabilities).length > 0
      ? asArray(contract.offeredCapabilities)
      : asArray(contract.capabilities)
  ).map(normalizeText).filter(Boolean))];
  const missingCapabilities = requiredCapabilities.filter((capability) => !offeredCapabilities.includes(capability));

  return {
    contractType: "claim-allowance-operation-capability-state-v1",
    requiredCapabilities,
    offeredCapabilities,
    missingCapabilities,
    satisfied: missingCapabilities.length === 0,
    state: missingCapabilities.length === 0 ? "satisfied" : "missing_capability"
  };
}

function contractInvalidReasons(contract, expectedTenantId, expectedWorkspaceId, requiredOperationCapabilities = []) {
  const schemaMissing = !contract.schemaVersion && !contract.inputContract && !contract.outputContract;
  const routeMissing = !contract.routeAction && !contract.endpoint;
  const tenantMismatch = Boolean(expectedTenantId && contract.tenantId && contract.tenantId !== expectedTenantId);
  const workspaceMismatch = Boolean(expectedWorkspaceId && contract.workspaceId && contract.workspaceId !== expectedWorkspaceId);
  const capabilityState = buildOperationCapabilityState(contract, requiredOperationCapabilities);

  return [
    ...(contract.disabled ? ["disabled"] : []),
    ...(!contract.ready ? [`state:${contract.status}`] : []),
    ...(contract.sync.stale ? ["sync_stale"] : []),
    ...(schemaMissing ? ["schema_missing"] : []),
    ...(routeMissing ? ["route_missing"] : []),
    ...(tenantMismatch ? ["tenant_mismatch"] : []),
    ...(workspaceMismatch ? ["workspace_mismatch"] : []),
    ...capabilityState.missingCapabilities.map((capability) => `capability_missing:${capability}`)
  ];
}

function rankServiceContract(contract, expectedTenantId, expectedWorkspaceId) {
  return [
    contract.routeAction ? 16 : 0,
    contract.endpoint ? 8 : 0,
    contract.ackMode === "external-ack" ? 4 : 0,
    contract.schemaVersion ? 2 : 0,
    contract.tenantId && contract.tenantId === expectedTenantId ? 1 : 0,
    contract.workspaceId && contract.workspaceId === expectedWorkspaceId ? 1 : 0
  ].reduce((total, value) => total + value, 0);
}

function buildServiceOperationBindings({ requiredOperations, serviceContracts, expectedTenantId, expectedWorkspaceId, operationCapabilityRequirements }) {
  return requiredOperations.map((operation) => {
    const operationContracts = serviceContracts.filter((contract) => contract.operation === operation);
    const requiredOperationCapabilities = operationCapabilityRequirements[operation] || [];
    const candidates = operationContracts
      .map((contract) => ({
        contract,
        capabilityState: buildOperationCapabilityState(contract, requiredOperationCapabilities),
        invalidReasons: contractInvalidReasons(contract, expectedTenantId, expectedWorkspaceId, requiredOperationCapabilities),
        rank: rankServiceContract(contract, expectedTenantId, expectedWorkspaceId)
      }))
      .sort((a, b) => b.rank - a.rank || a.contract.id.localeCompare(b.contract.id));
    const selected = candidates.find((candidate) => candidate.invalidReasons.length === 0) || null;
    const fallback = selected || candidates[0] || null;
    const contract = fallback ? fallback.contract : null;

    return {
      contractType: "claim-allowance-service-operation-binding-v1",
      operation,
      state: selected ? "bound" : operationContracts.length > 0 ? "blocked" : "missing",
      providerId: contract ? contract.providerId : null,
      contractId: contract ? contract.id : null,
      routeAction: contract ? contract.routeAction || null : null,
      endpoint: contract ? contract.endpoint || null : null,
      ackMode: contract ? contract.ackMode : "none",
      schemaVersion: contract ? contract.schemaVersion || null : null,
      inputContract: contract ? contract.inputContract || null : null,
      outputContract: contract ? contract.outputContract || null : null,
      sync: contract ? contract.sync : { cursor: "", syncedAt: "", revision: "", stale: false },
      capabilityState: fallback
        ? fallback.capabilityState
        : buildOperationCapabilityState({ capabilities: [] }, requiredOperationCapabilities),
      candidateContractIds: operationContracts.map((candidate) => candidate.id),
      blockers: selected
        ? []
        : operationContracts.length === 0
          ? [`missing_provider_operation:${operation}`]
          : [...new Set(candidates.flatMap((candidate) => candidate.invalidReasons))]
    };
  });
}

function buildProviderServiceContractNegotiation({ input, providers, claim, requestContext }) {
  const requiredOperations = asArray(input.requiredProviderOperations).length > 0
    ? asArray(input.requiredProviderOperations).map(normalizeText).filter(Boolean)
    : DEFAULT_PROVIDER_SERVICE_OPERATIONS;
  const expectedTenantId = claim.tenantId || requestContext.tenantId;
  const expectedWorkspaceId = claim.workspaceId || requestContext.workspaceId;
  const serviceContracts = providers.flatMap((provider) => provider.serviceContracts);
  const operationCapabilityRequirements = normalizeOperationCapabilityRequirements(input, requiredOperations);
  const readyContracts = serviceContracts.filter((contract) => contract.ready && !contract.sync.stale);
  const offeredOperations = [...new Set(readyContracts.map((contract) => contract.operation).filter(Boolean))];
  const missingOperations = requiredOperations.filter((operation) => !offeredOperations.includes(operation));
  const invalidContracts = serviceContracts.filter((contract) => {
    return contractInvalidReasons(
      contract,
      expectedTenantId,
      expectedWorkspaceId,
      operationCapabilityRequirements[contract.operation] || []
    ).length > 0;
  });
  const invalidContractDetails = invalidContracts.map((contract) => {
    const requiredOperationCapabilities = operationCapabilityRequirements[contract.operation] || [];
    const capabilityState = buildOperationCapabilityState(contract, requiredOperationCapabilities);
    const reasons = contractInvalidReasons(contract, expectedTenantId, expectedWorkspaceId, requiredOperationCapabilities);

    return {
      contractId: contract.id,
      providerId: contract.providerId,
      operation: contract.operation,
      capabilityState,
      reasons
    };
  });
  const operationBindings = buildServiceOperationBindings({
    requiredOperations,
    serviceContracts,
    expectedTenantId,
    expectedWorkspaceId,
    operationCapabilityRequirements
  });
  const blockedBindings = operationBindings.filter((binding) => binding.state !== "bound");
  const operationCapabilityStates = requiredOperations.map((operation) => {
    const bindings = operationBindings.filter((binding) => binding.operation === operation);
    const boundBindings = bindings.filter((binding) => binding.state === "bound");
    const candidateContracts = serviceContracts.filter((contract) => contract.operation === operation);
    const candidateStates = candidateContracts.map((contract) => ({
      providerId: contract.providerId,
      contractId: contract.id,
      ...buildOperationCapabilityState(contract, operationCapabilityRequirements[operation] || [])
    }));

    return {
      contractType: "claim-allowance-operation-capability-negotiation-v1",
      operation,
      requiredCapabilities: operationCapabilityRequirements[operation] || [],
      state: boundBindings.length > 0
        ? "satisfied"
        : candidateStates.some((candidate) => candidate.missingCapabilities.length === 0)
          ? "blocked_by_contract_state"
          : candidateStates.length > 0
            ? "capability_missing"
            : "operation_missing",
      boundContractIds: boundBindings.map((binding) => binding.contractId),
      candidateStates,
      missingCapabilities: [...new Set(candidateStates.flatMap((candidate) => candidate.missingCapabilities))]
    };
  });
  const operationCapabilityBlockers = operationCapabilityStates
    .filter((state) => state.state === "capability_missing")
    .flatMap((state) => state.missingCapabilities.map((capability) => `operation_capability_missing:${state.operation}:${capability}`));

  return {
    contractType: "claim-allowance-provider-service-contract-v1",
    requiredOperations,
    operationCapabilityRequirements,
    operationCapabilityStates,
    offeredOperations,
    missingOperations,
    operationBindings,
    contracts: serviceContracts,
    readyContractIds: readyContracts.map((contract) => contract.id),
    invalidContracts: invalidContractDetails,
    syncMetadata: {
      status: serviceContracts.length === 0
        ? "not-configured"
        : invalidContractDetails.some((contract) => contract.reasons.includes("sync_stale")) ? "stale" : "synced",
      cursors: serviceContracts
        .filter((contract) => contract.sync.cursor || contract.sync.revision)
        .map((contract) => ({
          providerId: contract.providerId,
          contractId: contract.id,
          operation: contract.operation,
          cursor: contract.sync.cursor,
          revision: contract.sync.revision,
          syncedAt: contract.sync.syncedAt
        }))
    },
    dispatchManifest: {
      contractType: "claim-allowance-provider-dispatch-manifest-v1",
      state: blockedBindings.length === 0 ? "bound" : "blocked",
      requiredOperationCount: requiredOperations.length,
      boundOperationCount: operationBindings.filter((binding) => binding.state === "bound").length,
      bindings: operationBindings.map((binding) => ({
        operation: binding.operation,
        providerId: binding.providerId,
        contractId: binding.contractId,
        routeAction: binding.routeAction,
        endpoint: binding.endpoint,
        ackMode: binding.ackMode,
        schemaVersion: binding.schemaVersion,
        requiredCapabilities: binding.capabilityState.requiredCapabilities,
        satisfiedCapabilities: binding.capabilityState.offeredCapabilities
          .filter((capability) => binding.capabilityState.requiredCapabilities.includes(capability)),
        missingCapabilities: binding.capabilityState.missingCapabilities,
        syncCursor: binding.sync.cursor || null,
        state: binding.state
      }))
    },
    negotiated: missingOperations.length === 0
      && invalidContractDetails.length === 0
      && blockedBindings.length === 0
      && operationCapabilityBlockers.length === 0,
    blockers: [
      ...missingOperations.map((operation) => `missing_provider_operation:${operation}`),
      ...operationCapabilityBlockers,
      ...blockedBindings.flatMap((binding) => binding.blockers.map((blocker) => `operation_binding:${binding.operation}:${blocker}`)),
      ...invalidContractDetails.map((contract) => `provider_contract_invalid:${contract.contractId}:${contract.reasons.join("+")}`)
    ]
  };
}

function buildProviderNegotiation({ input, providers, claim, requestContext, command, boundaryDecision, now }) {
  const requiredCapabilities = asArray(input.requiredProviderCapabilities).length > 0
    ? asArray(input.requiredProviderCapabilities).map(normalizeText).filter(Boolean)
    : DEFAULT_PROVIDER_CAPABILITIES;
  const retryPolicy = normalizeRetryPolicy(input);
  const serviceContractNegotiation = buildProviderServiceContractNegotiation({ input, providers, claim, requestContext });
  const providerNamespaceBoundary = buildProviderNamespaceBoundary({
    providers,
    serviceContractNegotiation,
    boundaryDecision
  });
  const offeredCapabilities = new Set(
    providers
      .filter((provider) => provider.ready)
      .flatMap((provider) => provider.capabilities)
  );
  const missingCapabilities = requiredCapabilities.filter((capability) => !offeredCapabilities.has(capability));
  const unavailableProviders = providers.filter((provider) => !provider.ready);
  const syncStaleProviders = providers.filter((provider) => provider.sync.stale);
  const handoffProviders = providers.filter((provider) => provider.handoff.endpoint);
  const primaryHandoffProvider = handoffProviders[0] || null;
  const providerFailureState = buildProviderFailureState({
    providers,
    missingCapabilities,
    serviceContractNegotiation,
    providerNamespaceBoundary,
    retryPolicy,
    now
  });
  const canHandoffExternally = missingCapabilities.length === 0
    && unavailableProviders.length === 0
    && syncStaleProviders.length === 0
    && serviceContractNegotiation.negotiated
    && providerNamespaceBoundary.safeForDispatch
    && providerFailureState.dispatchGuard.issueDispatchAllowed
    && Boolean(primaryHandoffProvider);

  return {
    contractType: "claim-allowance-provider-contract-v1",
    requiredCapabilities,
    offeredCapabilities: [...offeredCapabilities],
    missingCapabilities,
    providers,
    unavailableProviderIds: unavailableProviders.map((provider) => provider.id),
    providerNamespaceBoundary,
    serviceContractNegotiation,
    providerFailureState,
    syncMetadata: {
      status: syncStaleProviders.length > 0 ? "stale" : providers.length > 0 ? "synced" : "not-configured",
      syncedProviderIds: providers.filter((provider) => provider.ready && !provider.sync.stale).map((provider) => provider.id),
      staleProviderIds: syncStaleProviders.map((provider) => provider.id),
      cursors: providers
        .filter((provider) => provider.sync.cursor)
        .map((provider) => ({ providerId: provider.id, cursor: provider.sync.cursor, syncedAt: provider.sync.syncedAt }))
    },
    externalHandoffState: {
      enabled: Boolean(primaryHandoffProvider),
      ready: canHandoffExternally,
      providerId: primaryHandoffProvider ? primaryHandoffProvider.id : null,
      endpoint: primaryHandoffProvider ? primaryHandoffProvider.handoff.endpoint : null,
      method: primaryHandoffProvider ? primaryHandoffProvider.handoff.method : null,
      state: canHandoffExternally ? "ready" : primaryHandoffProvider ? "blocked" : "not-configured",
      correlationId: `${requestContext.requestId}:${command.commandId}:${claim.id}`,
      claimId: claim.id,
      preparedAt: now,
      dispatchManifest: serviceContractNegotiation.dispatchManifest,
      failureState: providerFailureState
    },
    negotiated: missingCapabilities.length === 0
      && unavailableProviders.length === 0
      && syncStaleProviders.length === 0
      && serviceContractNegotiation.negotiated
      && providerNamespaceBoundary.safeForDispatch
      && providerFailureState.dispatchGuard.issueDispatchAllowed,
    blockers: [
      ...missingCapabilities.map((capability) => `missing_provider_capability:${capability}`),
      ...unavailableProviders.map((provider) => `provider_unavailable:${provider.id}`),
      ...syncStaleProviders.map((provider) => `provider_sync_stale:${provider.id}`),
      ...(providerFailureState.retryWindow.retryable ? ["provider_retry_backoff_active"] : []),
      ...providerFailureState.retryWindow.exhaustedProviderIds.map((providerId) => `provider_retry_exhausted:${providerId}`),
      ...providerNamespaceBoundary.blockers,
      ...serviceContractNegotiation.blockers
    ]
  };
}

function normalizeFailureSignals(input) {
  const rawFailures = [
    ...asArray(input.failures),
    ...asArray(input.operationalErrors),
    ...asArray(input.errors)
  ];

  return rawFailures.map((failure, index) => {
    const candidate = failure && typeof failure === "object" ? failure : { message: failure };
    const attempt = Number.isInteger(candidate.attempt) && candidate.attempt > 0 ? candidate.attempt : 1;
    const retryable = candidate.retryable === true || normalizeText(candidate.category).toLowerCase() === "transient";
    const severity = normalizeText(candidate.severity).toLowerCase() || (retryable ? "warning" : "error");

    return {
      id: normalizeText(candidate.id || candidate.code) || `failure-${index + 1}`,
      code: normalizeText(candidate.code || candidate.reason) || "operational_failure",
      component: normalizeText(candidate.component || candidate.service || candidate.stage) || "claim-allowance",
      message: normalizeText(candidate.message || candidate.detail) || "Claim allowance dependency reported a failure.",
      severity,
      retryable,
      attempt,
      action: normalizeText(candidate.action || candidate.nextAction)
    };
  });
}

function normalizeDependencyHealth(input) {
  const operationalHealth = input.operationalHealth && typeof input.operationalHealth === "object"
    ? input.operationalHealth
    : {};
  const dependencies = {
    verifier: operationalHealth.verifier || input.verifierHealth,
    evidenceRegistry: operationalHealth.evidenceRegistry || input.evidenceRegistryHealth,
    persistence: operationalHealth.persistence || input.persistenceHealth,
    proofIssuer: operationalHealth.proofIssuer || input.proofIssuerHealth
  };

  return Object.entries(dependencies).map(([name, raw]) => {
    const candidate = raw && typeof raw === "object" ? raw : {};
    const status = normalizeText(candidate.status || candidate.state || raw).toLowerCase() || "unknown";
    const latencyMs = Number.isFinite(candidate.latencyMs) ? candidate.latencyMs : null;
    const stale = candidate.stale === true || candidate.fresh === false;
    const unhealthy = UNHEALTHY_STATES.has(status);
    const degraded = DEGRADED_STATES.has(status) || stale;

    return {
      name,
      status,
      healthy: HEALTHY_STATES.has(status) && !stale,
      degraded,
      unhealthy,
      stale,
      latencyMs,
      checkedAt: normalizeText(candidate.checkedAt || candidate.observedAt),
      message: normalizeText(candidate.message || candidate.reason)
    };
  });
}

function computeRetryPlan({ failures, retryPolicy, now }) {
  const retryableFailures = failures.filter((failure) => failure.retryable);
  const highestAttempt = retryableFailures.reduce((max, failure) => Math.max(max, failure.attempt), 0);
  const attemptsRemaining = Math.max(retryPolicy.maxAttempts - highestAttempt, 0);
  const nextDelayMs = retryableFailures.length > 0 && attemptsRemaining > 0
    ? Math.min(retryPolicy.baseDelayMs * (2 ** Math.max(highestAttempt - 1, 0)) + retryPolicy.jitterMs, retryPolicy.maxDelayMs)
    : null;
  const nowMs = Date.parse(now);
  const retryBaseMs = Number.isFinite(nowMs) ? nowMs : Date.now();

  return {
    retryable: retryableFailures.length > 0 && attemptsRemaining > 0,
    attemptsUsed: highestAttempt,
    attemptsRemaining,
    nextDelayMs,
    retryAfter: nextDelayMs === null ? null : new Date(retryBaseMs + nextDelayMs).toISOString(),
    retryFailureIds: retryableFailures.map((failure) => failure.id),
    exhausted: retryableFailures.length > 0 && attemptsRemaining === 0
  };
}

function buildOperationalFailureState({
  dependencies,
  failures,
  retryPlan,
  actionableErrors,
  blocked,
  degraded,
  degradedModeRequested,
  now
}) {
  const dependencyIncidents = dependencies
    .filter((dependency) => dependency.unhealthy || dependency.degraded)
    .map((dependency) => ({
      incidentId: `dependency:${dependency.name}:${dependency.status}`,
      source: "dependency-health",
      component: dependency.name,
      code: dependency.unhealthy ? `dependency_${dependency.name}_unavailable` : `dependency_${dependency.name}_degraded`,
      severity: dependency.unhealthy ? "error" : "warning",
      retryable: dependency.degraded && !dependency.unhealthy,
      state: dependency.unhealthy ? "blocking" : "degraded",
      message: dependency.message || `${dependency.name} health is ${dependency.status}.`,
      observedAt: dependency.checkedAt || now,
      latencyMs: dependency.latencyMs,
      stale: dependency.stale
    }));
  const failureIncidents = failures.map((failure) => ({
    incidentId: `failure:${failure.id}`,
    source: "failure-signal",
    component: failure.component,
    code: failure.code,
    severity: failure.severity,
    retryable: failure.retryable,
    state: failure.retryable
      ? retryPlan.exhausted ? "retry_exhausted" : "retry_wait"
      : failure.severity === "warning" ? "degraded" : "blocking",
    message: failure.message,
    observedAt: now,
    attempt: failure.attempt,
    action: failure.action || null
  }));
  const retryIncident = retryPlan.exhausted
    ? [{
        incidentId: "retry:attempts-exhausted",
        source: "retry-policy",
        component: "claim-allowance",
        code: "retry_attempts_exhausted",
        severity: "error",
        retryable: false,
        state: "blocking",
        message: "Retry attempts are exhausted for retryable claim allowance failures.",
        observedAt: now,
        attempt: retryPlan.attemptsUsed,
        action: "Escalate or start a new command after the underlying dependency recovers."
      }]
    : [];
  const incidents = [...dependencyIncidents, ...failureIncidents, ...retryIncident];
  const severityRank = { critical: 4, error: 3, warning: 2, info: 1 };
  const severity = incidents.reduce((highest, incident) => (
    severityRank[incident.severity] > severityRank[highest] ? incident.severity : highest
  ), blocked ? "error" : degraded ? "warning" : "info");
  const operatorActions = actionableErrors.map((error, index) => ({
    actionId: `operational-action-${index + 1}:${error.code}`,
    code: error.code,
    component: error.component,
    routeAction: "verifier.claimAllowance.resolveOperationalError",
    label: `Resolve ${error.component}`,
    reason: error.message,
    action: error.action,
    blocksIssue: blocked
  }));
  const retryAction = retryPlan.retryable
    ? [{
        actionId: "operational-action-retry",
        code: "retry_backoff_active",
        component: "claim-allowance",
        routeAction: "verifier.claimAllowance.retry",
        label: "Retry claim allowance",
        reason: `Retry window opens at ${retryPlan.retryAfter}.`,
        action: `Retry after ${retryPlan.retryAfter}.`,
        blocksIssue: true
      }]
    : [];

  return {
    contractType: "claim-allowance-operational-failure-state-v1",
    state: blocked ? "blocked" : degraded ? "degraded" : "clear",
    severity,
    evaluatedAt: now,
    issueGuard: {
      issueAllowed: !blocked && !degradedModeRequested && !retryPlan.retryable,
      degradedModeIssueDisabled: degradedModeRequested,
      retryBackoffActive: retryPlan.retryable,
      blocked
    },
    retryWindow: {
      policy: retryPlan.retryFailureIds.length > 0 ? "exponential-backoff" : "none",
      retryable: retryPlan.retryable,
      attemptsUsed: retryPlan.attemptsUsed,
      attemptsRemaining: retryPlan.attemptsRemaining,
      retryAfter: retryPlan.retryAfter,
      nextDelayMs: retryPlan.nextDelayMs,
      exhausted: retryPlan.exhausted,
      failureIds: retryPlan.retryFailureIds
    },
    degradedMode: {
      requested: degradedModeRequested,
      active: degraded,
      safeReadOnly: degraded && !blocked,
      allowedOperations: degraded && !blocked
        ? ["claimAllowance.review", "claimAllowance.collectEvidence", "claimAllowance.syncHandoff"]
        : []
    },
    incidents,
    operatorActions: [...retryAction, ...operatorActions],
    healthCheckSummary: dependencies.map((dependency) => ({
      component: dependency.name,
      status: dependency.status,
      state: dependency.unhealthy ? "unhealthy" : dependency.degraded ? "degraded" : dependency.healthy ? "healthy" : "unknown",
      stale: dependency.stale,
      checkedAt: dependency.checkedAt || null,
      message: dependency.message || null
    })),
    proofAnnotations: incidents.map((incident) => ({
      annotationType: "operational-failure",
      incidentId: incident.incidentId,
      component: incident.component,
      code: incident.code,
      state: incident.state,
      severity: incident.severity
    }))
  };
}

function buildOperationalHealth(input, now) {
  const retryPolicy = normalizeRetryPolicy(input);
  const failures = normalizeFailureSignals(input);
  const dependencies = normalizeDependencyHealth(input);
  const retryPlan = computeRetryPlan({ failures, retryPolicy, now });
  const unavailableDependencies = dependencies.filter((dependency) => dependency.unhealthy);
  const degradedDependencies = dependencies.filter((dependency) => dependency.degraded && !dependency.unhealthy);
  const fatalFailures = failures.filter((failure) => !failure.retryable && failure.severity !== "warning");
  const degradedModeRequested = input.degradedMode === true || normalizeText(input.mode).toLowerCase() === "degraded";
  const degraded = degradedModeRequested || degradedDependencies.length > 0 || retryPlan.retryable;
  const blocked = unavailableDependencies.length > 0 || fatalFailures.length > 0 || retryPlan.exhausted;
  const actionableErrors = [
    ...unavailableDependencies.map((dependency) => ({
      code: `dependency_${dependency.name}_unavailable`,
      component: dependency.name,
      message: dependency.message || `${dependency.name} is unavailable for claim allowance issuance.`,
      action: `Restore ${dependency.name} health before issuing allowance.`
    })),
    ...fatalFailures.map((failure) => ({
      code: failure.code,
      component: failure.component,
      message: failure.message,
      action: failure.action || "Resolve the failure and resubmit the claim allowance command."
    })),
    ...(retryPlan.exhausted ? [{
      code: "retry_attempts_exhausted",
      component: "claim-allowance",
      message: "Retry attempts are exhausted for retryable claim allowance failures.",
      action: "Escalate or start a new command after the underlying dependency recovers."
    }] : [])
  ];
  const failureState = buildOperationalFailureState({
    dependencies,
    failures,
    retryPlan,
    actionableErrors,
    blocked,
    degraded,
    degradedModeRequested,
    now
  });

  return {
    status: blocked ? "unhealthy" : degraded ? "degraded" : "healthy",
    canIssue: !blocked && !degradedModeRequested && !retryPlan.retryable,
    degraded,
    degradedMode: degradedModeRequested,
    blocked,
    dependencies,
    failures,
    retryPolicy,
    retryPlan,
    actionableErrors,
    failureState
  };
}

function evidenceTruthState(expectedValue, observedValue) {
  if (!observedValue) {
    return "undeclared";
  }
  if (!expectedValue) {
    return "expected_missing";
  }
  return observedValue === expectedValue ? "matched" : "mismatched";
}

function evidenceIdentity(entry) {
  return entry.digest || entry.proofRef || entry.ref || entry.id;
}

function evidenceVerifierChannels(entry) {
  return [
    ...(entry.verifierId ? ["verifierId"] : []),
    ...(entry.issuer ? ["issuer"] : []),
    ...(entry.proofRef ? ["proofRef"] : []),
    ...(entry.digest ? ["digest"] : [])
  ];
}

function normalizeVerifierEvidencePolicy(input) {
  const rawPolicy = input.verifierEvidencePolicy && typeof input.verifierEvidencePolicy === "object"
    ? input.verifierEvidencePolicy
    : input.evidencePolicy && typeof input.evidencePolicy === "object"
      ? input.evidencePolicy
      : {};

  return {
    contractType: "claim-allowance-verifier-evidence-policy-v1",
    requireVerifierIdentity: normalizeBooleanSetting(
      rawPolicy.requireVerifierIdentity ?? rawPolicy.requireVerifier ?? rawPolicy.verifierIdentityRequired,
      DEFAULT_VERIFIER_EVIDENCE_POLICY.requireVerifierIdentity
    ),
    requireProofMaterial: normalizeBooleanSetting(
      rawPolicy.requireProofMaterial ?? rawPolicy.requireProof ?? rawPolicy.proofMaterialRequired,
      DEFAULT_VERIFIER_EVIDENCE_POLICY.requireProofMaterial
    ),
    allowIssuerAsVerifier: normalizeBooleanSetting(
      rawPolicy.allowIssuerAsVerifier ?? rawPolicy.trustIssuerAsVerifier,
      DEFAULT_VERIFIER_EVIDENCE_POLICY.allowIssuerAsVerifier
    )
  };
}

function buildVerifierEvidenceRequirement(entry, verifierEvidencePolicy) {
  const verifierIdentityChannels = [
    ...(entry.verifierId ? ["verifierId"] : []),
    ...(verifierEvidencePolicy.allowIssuerAsVerifier && entry.issuer ? ["issuer"] : [])
  ];
  const proofMaterialChannels = [
    ...(entry.proofRef ? ["proofRef"] : []),
    ...(entry.digest ? ["digest"] : [])
  ];
  const verifierIdentitySatisfied = !verifierEvidencePolicy.requireVerifierIdentity || verifierIdentityChannels.length > 0;
  const proofMaterialSatisfied = !verifierEvidencePolicy.requireProofMaterial || proofMaterialChannels.length > 0;
  const reasons = [
    ...(!verifierIdentitySatisfied ? ["verifier_identity_missing"] : []),
    ...(!proofMaterialSatisfied ? ["verifier_proof_material_missing"] : [])
  ];

  return {
    contractType: "claim-allowance-verifier-evidence-requirement-v1",
    policy: verifierEvidencePolicy,
    verifierIdentitySatisfied,
    proofMaterialSatisfied,
    satisfied: verifierIdentitySatisfied && proofMaterialSatisfied,
    verifierIdentityChannels,
    proofMaterialChannels,
    reasons
  };
}

function evidenceTruthBoundaryReasons({ claim, entry, expectedTenantId, expectedWorkspaceId }) {
  const tenantState = evidenceTruthState(expectedTenantId, entry.tenantId);
  const workspaceState = evidenceTruthState(expectedWorkspaceId, entry.workspaceId);
  const claimState = evidenceTruthState(claim.id, entry.claimId);
  const subjectState = evidenceTruthState(claim.subject, entry.subject);
  const reasons = [
    ...(tenantState === "undeclared" ? ["tenant_undeclared"] : []),
    ...(workspaceState === "undeclared" ? ["workspace_undeclared"] : []),
    ...(claimState === "undeclared" ? ["claim_undeclared"] : []),
    ...(tenantState === "mismatched" ? ["tenant_mismatch"] : []),
    ...(workspaceState === "mismatched" ? ["workspace_mismatch"] : []),
    ...(claimState === "mismatched" ? ["claim_mismatch"] : []),
    ...(subjectState === "mismatched" ? ["subject_mismatch"] : [])
  ];

  return {
    tenantState,
    workspaceState,
    claimState,
    subjectState,
    complete: reasons.length === 0,
    reasons
  };
}

function verifierBoundaryValue(entry, field, fallback) {
  return normalizeText(entry[field]) || fallback || "";
}

function evidenceVerifierBoundaryReasons({ claim, entry, expectedTenantId, expectedWorkspaceId, verifierRequirement }) {
  if (!verifierRequirement.satisfied) {
    return {
      tenantState: "not_verifier_backed",
      workspaceState: "not_verifier_backed",
      claimState: "not_verifier_backed",
      subjectState: "not_verifier_backed",
      complete: false,
      reasons: verifierRequirement.reasons.length > 0
        ? verifierRequirement.reasons
        : ["verifier_evidence_missing"]
    };
  }

  const verifierTenantId = verifierBoundaryValue(entry, "verifierTenantId", entry.tenantId);
  const verifierWorkspaceId = verifierBoundaryValue(entry, "verifierWorkspaceId", entry.workspaceId);
  const verifierClaimId = verifierBoundaryValue(entry, "verifierClaimId", entry.claimId);
  const verifierSubject = verifierBoundaryValue(entry, "verifierSubject", entry.subject);
  const tenantState = evidenceTruthState(expectedTenantId, verifierTenantId);
  const workspaceState = evidenceTruthState(expectedWorkspaceId, verifierWorkspaceId);
  const claimState = evidenceTruthState(claim.id, verifierClaimId);
  const subjectState = evidenceTruthState(claim.subject, verifierSubject);
  const reasons = [
    ...(tenantState === "undeclared" ? ["verifier_tenant_undeclared"] : []),
    ...(workspaceState === "undeclared" ? ["verifier_workspace_undeclared"] : []),
    ...(claimState === "undeclared" ? ["verifier_claim_undeclared"] : []),
    ...(tenantState === "mismatched" ? ["verifier_tenant_mismatch"] : []),
    ...(workspaceState === "mismatched" ? ["verifier_workspace_mismatch"] : []),
    ...(claimState === "mismatched" ? ["verifier_claim_mismatch"] : []),
    ...(subjectState === "mismatched" ? ["verifier_subject_mismatch"] : [])
  ];

  return {
    tenantId: verifierTenantId || null,
    workspaceId: verifierWorkspaceId || null,
    claimId: verifierClaimId || null,
    subject: verifierSubject || null,
    tenantState,
    workspaceState,
    claimState,
    subjectState,
    complete: reasons.length === 0,
    reasons
  };
}

function distinctBoundaryKeys(assertions, keyBuilder) {
  return [...new Set(assertions.map(keyBuilder).filter(Boolean))];
}

function buildBoundaryContradictions(evidenceAssertions) {
  return [...new Set(evidenceAssertions.map((assertion) => assertion.type).filter(Boolean))]
    .map((type) => {
      const acceptedAssertions = evidenceAssertions.filter((assertion) => assertion.type === type && assertion.accepted);
      const evidenceBoundaryKeys = distinctBoundaryKeys(acceptedAssertions, (assertion) => (
        assertion.tenantState === "matched" || assertion.workspaceState === "matched" || assertion.claimState === "matched"
          ? `${assertion.tenantId || "tenant-missing"}:${assertion.workspaceId || "workspace-missing"}:${assertion.claimId || "claim-missing"}`
          : ""
      ));
      const verifierBoundaryKeys = distinctBoundaryKeys(acceptedAssertions, (assertion) => (
        assertion.verifierBoundary && assertion.verifierBoundary.complete
          ? `${assertion.verifierBoundary.tenantId || "tenant-missing"}:${assertion.verifierBoundary.workspaceId || "workspace-missing"}:${assertion.verifierBoundary.claimId || "claim-missing"}`
          : ""
      ));

      return {
        type,
        acceptedEvidenceIds: acceptedAssertions.map((assertion) => assertion.evidenceId),
        evidenceBoundaryKeys,
        verifierBoundaryKeys
      };
    })
    .filter((entry) => entry.evidenceBoundaryKeys.length > 1 || entry.verifierBoundaryKeys.length > 1);
}

function buildRequiredEvidenceQuorum(requiredEvidence, evidenceAssertions) {
  return requiredEvidence.map((type) => {
    const assertions = evidenceAssertions.filter((assertion) => assertion.type === type);
    const usableAssertions = assertions.filter((assertion) => assertion.usable);
    const acceptedAssertions = assertions.filter((assertion) => assertion.accepted);
    const verifierBackedAssertions = assertions.filter((assertion) => assertion.hasVerifierEvidence);
    const rejectedAssertions = assertions.filter((assertion) => assertion.rejected);
    const boundaryBlockedAssertions = assertions.filter((assertion) => assertion.truthBoundaryReasons.length > 0);
    const identitySet = [...new Set(usableAssertions.map((assertion) => assertion.identity).filter(Boolean))];
    const ambiguous = identitySet.length > 1;
    const status = usableAssertions.length === 0
      ? acceptedAssertions.length > 0 && verifierBackedAssertions.length === 0
        ? "accepted_without_verifier_evidence"
        : rejectedAssertions.length > 0
          ? "rejected"
          : boundaryBlockedAssertions.length > 0
            ? "truth_boundary_blocked"
            : "missing"
      : ambiguous
        ? "ambiguous"
        : "satisfied";

    return {
      type,
      status,
      satisfied: status === "satisfied",
      acceptedEvidenceIds: acceptedAssertions.map((assertion) => assertion.evidenceId),
      usableEvidenceIds: usableAssertions.map((assertion) => assertion.evidenceId),
      verifierEvidenceIds: verifierBackedAssertions.map((assertion) => assertion.evidenceId),
      rejectedEvidenceIds: rejectedAssertions.map((assertion) => assertion.evidenceId),
      boundaryBlockedEvidenceIds: boundaryBlockedAssertions.map((assertion) => assertion.evidenceId),
      identities: identitySet,
      ambiguous,
      blockers: [
        ...(usableAssertions.length === 0 ? [`required_evidence_missing:${type}`] : []),
        ...(acceptedAssertions.length > 0 && verifierBackedAssertions.length === 0 ? [`required_evidence_verifier_missing:${type}`] : []),
        ...(boundaryBlockedAssertions.length > 0 ? [`required_evidence_truth_boundary:${type}`] : []),
        ...(ambiguous ? [`required_evidence_ambiguous:${type}`] : [])
      ]
    };
  });
}

function consensusFieldState(values) {
  const declaredValues = [...new Set(values.map(normalizeText).filter(Boolean))];

  return {
    values: declaredValues,
    consensusValue: declaredValues.length === 1 ? declaredValues[0] : null,
    state: declaredValues.length === 0
      ? "undeclared"
      : declaredValues.length === 1
        ? "matched"
        : "conflicted"
  };
}

function buildRequiredEvidenceConsensus({ claim, requiredEvidence, evidenceAssertions }) {
  const usableByType = requiredEvidence.map((type) => ({
    type,
    assertions: evidenceAssertions.filter((assertion) => assertion.type === type && assertion.usable)
  }));
  const missingTypes = usableByType
    .filter((entry) => entry.assertions.length === 0)
    .map((entry) => entry.type);
  const participatingAssertions = usableByType.flatMap((entry) => entry.assertions.map((assertion) => ({
    evidenceType: entry.type,
    evidenceId: assertion.evidenceId,
    identity: assertion.identity || null,
    tenantId: assertion.verifierBoundary.tenantId || assertion.tenantId || null,
    workspaceId: assertion.verifierBoundary.workspaceId || assertion.workspaceId || null,
    claimId: assertion.verifierBoundary.claimId || assertion.claimId || null,
    subject: assertion.verifierBoundary.subject || assertion.subject || null,
    verifierId: assertion.verifierId || null,
    proofRef: assertion.proofRef || null,
    digest: assertion.digest || null
  })));
  const fields = {
    tenantId: consensusFieldState(participatingAssertions.map((assertion) => assertion.tenantId)),
    workspaceId: consensusFieldState(participatingAssertions.map((assertion) => assertion.workspaceId)),
    claimId: consensusFieldState(participatingAssertions.map((assertion) => assertion.claimId)),
    subject: consensusFieldState(participatingAssertions.map((assertion) => assertion.subject)),
    identity: consensusFieldState(participatingAssertions.map((assertion) => assertion.identity))
  };
  const requiredConsensusFields = ["tenantId", "workspaceId", "claimId", "subject"];
  const fieldConflicts = requiredConsensusFields
    .map((field) => [field, fields[field]])
    .filter(([, state]) => state.state === "conflicted")
    .map(([field, state]) => ({ field, values: state.values }));
  const claimMismatchFields = [
    ...(fields.claimId.consensusValue && fields.claimId.consensusValue !== claim.id ? ["claimId"] : []),
    ...(fields.subject.consensusValue && claim.subject && fields.subject.consensusValue !== claim.subject ? ["subject"] : [])
  ];
  const blockers = [
    ...missingTypes.map((type) => `required_evidence_consensus_missing:${type}`),
    ...fieldConflicts.map((conflict) => `required_evidence_consensus_conflict:${conflict.field}`),
    ...claimMismatchFields.map((field) => `required_evidence_consensus_claim_mismatch:${field}`)
  ];

  return {
    contractType: "claim-allowance-required-evidence-consensus-v1",
    state: blockers.length === 0 ? "agreed" : missingTypes.length > 0 ? "incomplete" : "conflicted",
    requiredTypes: requiredEvidence,
    participatingTypes: usableByType
      .filter((entry) => entry.assertions.length > 0)
      .map((entry) => entry.type),
    missingTypes,
    fieldConsensus: fields,
    fieldConflicts,
    claimMismatchFields,
    participatingAssertions,
    consensusKey: [
      fields.tenantId.consensusValue || "tenant-unresolved",
      fields.workspaceId.consensusValue || "workspace-unresolved",
      fields.claimId.consensusValue || "claim-unresolved",
      fields.identity.consensusValue || "identity-unresolved"
    ].join(":"),
    blockers
  };
}

function evidenceReviewActionForIssues(issues, assertion, claim) {
  if (issues.some((issue) => [
    "verifier_identity_missing",
    "verifier_proof_material_missing",
    "verifier_evidence_missing"
  ].includes(issue))) {
    return {
      routeAction: "verifier.claimAllowance.attachVerifierEvidence",
      label: "Attach verifier evidence",
      payload: {
        claimId: claim.id,
        evidenceId: assertion.evidenceId,
        evidenceType: assertion.type,
        requiredFields: assertion.verifierRequirement.reasons
      }
    };
  }
  if (issues.some((issue) => issue.includes("mismatch") || issue.includes("undeclared"))) {
    return {
      routeAction: "verifier.claimAllowance.resolveEvidenceBoundary",
      label: "Resolve evidence boundary",
      payload: {
        claimId: claim.id,
        evidenceId: assertion.evidenceId,
        evidenceType: assertion.type,
        tenantId: assertion.tenantId,
        workspaceId: assertion.workspaceId,
        verifierBoundary: assertion.verifierBoundary
      }
    };
  }
  if (assertion.rejected || assertion.selfContradictory) {
    return {
      routeAction: "verifier.claimAllowance.reviewEvidenceDecision",
      label: "Review evidence decision",
      payload: {
        claimId: claim.id,
        evidenceId: assertion.evidenceId,
        evidenceType: assertion.type,
        accepted: assertion.accepted,
        rejected: assertion.rejected
      }
    };
  }
  return {
    routeAction: "verifier.claimAllowance.review",
    label: "Review evidence",
    payload: {
      claimId: claim.id,
      evidenceId: assertion.evidenceId,
      evidenceType: assertion.type
    }
  };
}

function buildEvidenceAcceptanceReview({ claim, requiredEvidence, evidenceTruthGate, requiredEvidenceQuorum, requiredEvidenceConsensus }) {
  const requiredTypeSet = new Set(requiredEvidence);
  const contradictionEvidenceIds = new Set([
    ...evidenceTruthGate.contradictions.self.map((entry) => entry.evidenceId),
    ...evidenceTruthGate.contradictions.identity.flatMap((entry) => entry.evidenceIds),
    ...evidenceTruthGate.contradictions.type.flatMap((entry) => [
      ...entry.acceptedEvidenceIds,
      ...entry.rejectedEvidenceIds
    ]),
    ...evidenceTruthGate.contradictions.boundary.flatMap((entry) => entry.acceptedEvidenceIds)
  ].filter(Boolean));
  const rows = evidenceTruthGate.evidenceAssertions.map((assertion) => {
    const issues = [
      ...assertion.verifierRequirement.reasons,
      ...assertion.truthBoundaryReasons,
      ...(assertion.selfContradictory ? ["self_contradictory"] : []),
      ...(assertion.rejected ? ["rejected"] : []),
      ...(contradictionEvidenceIds.has(assertion.evidenceId) ? ["contradiction_present"] : []),
      ...(!assertion.present ? ["evidence_not_present"] : [])
    ];
    const state = assertion.usable
      ? "accepted_for_allowance"
      : assertion.rejected || assertion.selfContradictory || contradictionEvidenceIds.has(assertion.evidenceId)
        ? "decision_review_required"
        : issues.some((issue) => [
            "verifier_identity_missing",
            "verifier_proof_material_missing",
            "verifier_evidence_missing"
          ].includes(issue))
          ? "verifier_evidence_required"
          : assertion.truthBoundaryReasons.length > 0
            ? "truth_boundary_review_required"
            : assertion.accepted
              ? "accepted_but_not_usable"
              : "not_accepted";

    return {
      contractType: "claim-allowance-evidence-acceptance-row-v1",
      evidenceId: assertion.evidenceId,
      evidenceType: assertion.type,
      required: requiredTypeSet.has(assertion.type),
      state,
      usableForAllowance: assertion.usable,
      accepted: assertion.accepted,
      rejected: assertion.rejected,
      verifierBacked: assertion.hasVerifierEvidence,
      verifierChannels: assertion.verifierChannels,
      proofRef: assertion.proofRef,
      digest: assertion.digest,
      boundary: {
        tenantState: assertion.tenantState,
        workspaceState: assertion.workspaceState,
        claimState: assertion.claimState,
        subjectState: assertion.subjectState,
        verifierBoundary: assertion.verifierBoundary
      },
      issues: [...new Set(issues)],
      nextAction: evidenceReviewActionForIssues(issues, assertion, claim)
    };
  });
  const requirementCoverage = requiredEvidenceQuorum.map((entry) => ({
    type: entry.type,
    status: entry.status,
    satisfied: entry.satisfied,
    usableEvidenceIds: entry.usableEvidenceIds,
    verifierEvidenceIds: entry.verifierEvidenceIds,
    blockers: entry.blockers
  }));
  const rowsRequiringReview = rows.filter((row) => row.state !== "accepted_for_allowance");
  const routeActions = rowsRequiringReview.map((row, index) => ({
    id: `evidence-review-${row.evidenceId}`,
    priority: index + 1,
    evidenceId: row.evidenceId,
    evidenceType: row.evidenceType,
    routeAction: row.nextAction.routeAction,
    label: row.nextAction.label,
    payload: row.nextAction.payload,
    issues: row.issues
  }));

  return {
    contractType: "claim-allowance-evidence-acceptance-review-v1",
    state: rowsRequiringReview.length === 0 && requiredEvidenceConsensus.state === "agreed"
      ? "ready"
      : requiredEvidenceConsensus.state === "conflicted"
        ? "conflicted"
        : "needs_review",
    requiredTypes: requiredEvidence,
    acceptedForAllowanceIds: rows.filter((row) => row.usableForAllowance).map((row) => row.evidenceId),
    verifierBackedIds: rows.filter((row) => row.verifierBacked).map((row) => row.evidenceId),
    reviewRequiredIds: rowsRequiringReview.map((row) => row.evidenceId),
    requirementCoverage,
    consensus: {
      state: requiredEvidenceConsensus.state,
      consensusKey: requiredEvidenceConsensus.consensusKey,
      blockers: requiredEvidenceConsensus.blockers
    },
    rows,
    routeActions
  };
}

function buildEvidenceTruthGate({ claim, evidence, boundaryDecision, verifierEvidencePolicy }) {
  const expectedTenantId = boundaryDecision.tenant.expectedTenantId;
  const expectedWorkspaceId = boundaryDecision.workspace.expectedWorkspaceId;
  const evidenceAssertions = evidence.map((entry) => {
    const selfContradictory = entry.accepted && entry.rejected;
    const verifierChannels = evidenceVerifierChannels(entry);
    const verifierRequirement = buildVerifierEvidenceRequirement(entry, verifierEvidencePolicy);
    const hasVerifierEvidence = verifierRequirement.satisfied;
    const truthBoundary = evidenceTruthBoundaryReasons({
      claim,
      entry,
      expectedTenantId,
      expectedWorkspaceId
    });
    const verifierBoundary = evidenceVerifierBoundaryReasons({
      claim,
      entry,
      expectedTenantId,
      expectedWorkspaceId,
      verifierRequirement
    });
    const truthBoundaryReasons = [
      ...truthBoundary.reasons,
      ...verifierBoundary.reasons
    ];
    const unverifiable = entry.accepted && (!hasVerifierEvidence || !verifierBoundary.complete);

    return {
      evidenceId: entry.id,
      type: entry.type,
      identity: evidenceIdentity(entry),
      tenantId: entry.tenantId || null,
      workspaceId: entry.workspaceId || null,
      claimId: entry.claimId || null,
      subject: entry.subject || null,
      accepted: entry.accepted,
      rejected: entry.rejected,
      present: entry.present,
      verified: entry.verified,
      hasVerifierEvidence,
      verifierChannels,
      verifierRequirement,
      verifierId: entry.verifierId || null,
      proofRef: entry.proofRef || null,
      digest: entry.digest || null,
      issuer: entry.issuer || null,
      tenantState: truthBoundary.tenantState,
      workspaceState: truthBoundary.workspaceState,
      claimState: truthBoundary.claimState,
      subjectState: truthBoundary.subjectState,
      truthBoundaryComplete: truthBoundary.complete,
      verifierBoundary,
      truthBoundaryReasons,
      selfContradictory,
      unverifiable,
      usable: entry.present
        && entry.accepted
        && !entry.rejected
        && hasVerifierEvidence
        && truthBoundary.complete
        && verifierBoundary.complete
        && truthBoundaryReasons.length === 0
    };
  });
  const statusByIdentity = evidenceAssertions.reduce((groups, assertion) => {
    const entry = evidence.find((candidate) => candidate.id === assertion.evidenceId) || {};
    const identity = entry.digest || entry.ref || entry.proofRef;
    if (!identity) {
      return groups;
    }
    const key = `${entry.type}:${identity}`;
    return {
      ...groups,
      [key]: [...(groups[key] || []), assertion]
    };
  }, {});
  const identityContradictions = Object.entries(statusByIdentity)
    .filter(([, assertions]) => assertions.some((entry) => entry.accepted) && assertions.some((entry) => entry.rejected))
    .map(([identity, assertions]) => ({
      identity,
      evidenceIds: assertions.map((entry) => entry.evidenceId),
      acceptedEvidenceIds: assertions.filter((entry) => entry.accepted).map((entry) => entry.evidenceId),
      rejectedEvidenceIds: assertions.filter((entry) => entry.rejected).map((entry) => entry.evidenceId)
    }));
  const typeContradictions = [...new Set(evidenceAssertions
    .filter((assertion) => assertion.accepted)
    .map((assertion) => assertion.type))]
    .filter((type) => evidenceAssertions.some((assertion) => assertion.type === type && assertion.rejected))
    .map((type) => ({
      type,
      acceptedEvidenceIds: evidenceAssertions.filter((assertion) => assertion.type === type && assertion.accepted).map((assertion) => assertion.evidenceId),
      rejectedEvidenceIds: evidenceAssertions.filter((assertion) => assertion.type === type && assertion.rejected).map((assertion) => assertion.evidenceId)
    }));
  const truthBoundaryViolations = evidenceAssertions.filter((assertion) => assertion.truthBoundaryReasons.length > 0);
  const unverifiableAcceptedEvidence = evidenceAssertions.filter((assertion) => assertion.unverifiable);
  const verifierPolicyViolations = evidenceAssertions.filter((assertion) => (
    assertion.accepted && assertion.verifierRequirement.reasons.length > 0
  ));
  const selfContradictions = evidenceAssertions.filter((assertion) => assertion.selfContradictory);
  const boundaryContradictions = buildBoundaryContradictions(evidenceAssertions);
  const blockers = [
    ...selfContradictions.map((assertion) => `evidence_self_contradiction:${assertion.evidenceId}`),
    ...identityContradictions.map((contradiction) => `evidence_identity_contradiction:${contradiction.identity}`),
    ...typeContradictions.map((contradiction) => `evidence_type_contradiction:${contradiction.type}`),
    ...boundaryContradictions.map((contradiction) => `evidence_boundary_contradiction:${contradiction.type}`),
    ...truthBoundaryViolations.map((assertion) => `evidence_truth_boundary:${assertion.evidenceId}:${assertion.truthBoundaryReasons.join("+")}`),
    ...verifierPolicyViolations.map((assertion) => `evidence_verifier_policy:${assertion.evidenceId}:${assertion.verifierRequirement.reasons.join("+")}`),
    ...unverifiableAcceptedEvidence.map((assertion) => `evidence_unverified:${assertion.evidenceId}`)
  ];

  return {
    contractType: "claim-allowance-evidence-truth-gate-v1",
    state: blockers.length === 0 ? "clear" : "blocked",
    expectedTenantId: expectedTenantId || null,
    expectedWorkspaceId: expectedWorkspaceId || null,
    verifierEvidencePolicy,
    acceptedEvidenceIds: evidenceAssertions.filter((assertion) => assertion.usable).map((assertion) => assertion.evidenceId),
    verifierEvidenceIds: evidenceAssertions.filter((assertion) => assertion.hasVerifierEvidence).map((assertion) => assertion.evidenceId),
    rejectedEvidenceIds: evidenceAssertions.filter((assertion) => assertion.rejected).map((assertion) => assertion.evidenceId),
    evidenceAssertions,
    contradictions: {
      self: selfContradictions,
      identity: identityContradictions,
      type: typeContradictions,
      boundary: boundaryContradictions
    },
    truthBoundaryViolations,
    unverifiableAcceptedEvidence,
    verifierPolicyViolations,
    blockers
  };
}

function buildValidationSummary({ claim, evidence, requiredEvidence, boundaryDecision, verifierEvidencePolicy }) {
  const missingClaimFields = ["subject", "requestedBy", "allowanceReason"].filter((field) => !claim[field]);
  const evidenceTruthGate = buildEvidenceTruthGate({ claim, evidence, boundaryDecision, verifierEvidencePolicy });
  const requiredEvidenceQuorum = buildRequiredEvidenceQuorum(requiredEvidence, evidenceTruthGate.evidenceAssertions);
  const requiredEvidenceConsensus = buildRequiredEvidenceConsensus({
    claim,
    requiredEvidence,
    evidenceAssertions: evidenceTruthGate.evidenceAssertions
  });
  const acceptedEvidenceTypes = new Set(
    evidence
      .filter((entry) => evidenceTruthGate.acceptedEvidenceIds.includes(entry.id))
      .map((entry) => entry.type)
  );
  const unsatisfiedRequiredEvidence = requiredEvidenceQuorum.filter((entry) => !entry.satisfied);
  const ambiguousRequiredEvidence = requiredEvidenceQuorum.filter((entry) => entry.ambiguous);
  const verifierMissingRequiredEvidence = requiredEvidenceQuorum.filter((entry) => (
    entry.status === "accepted_without_verifier_evidence"
  ));
  const rejectedEvidence = evidence.filter((entry) => entry.rejected);
  const missingEvidenceTypes = requiredEvidence.filter((type) => !acceptedEvidenceTypes.has(type));
  const errors = [
    ...missingClaimFields.map((field) => ({
      code: `missing_${field}`,
      field,
      message: `Claim allowance requires ${field}.`
    })),
    ...missingEvidenceTypes.map((type) => ({
      code: `missing_${type}_evidence`,
      field: "evidence",
      message: `Accepted ${type} evidence is required before allowance.`
    })),
    ...verifierMissingRequiredEvidence.map((entry) => ({
      code: `missing_${entry.type}_verifier_evidence`,
      field: "evidence",
      message: `Accepted ${entry.type} evidence must include verifier, proof, or digest evidence before allowance.`
    })),
    ...ambiguousRequiredEvidence.map((entry) => ({
      code: `ambiguous_${entry.type}_evidence`,
      field: "evidence",
      message: `${entry.type} evidence resolves to multiple verifier-backed identities and requires review.`
    })),
    ...rejectedEvidence.map((entry) => ({
      code: "rejected_evidence",
      field: "evidence",
      message: `${entry.id} is rejected and cannot support allowance.`
    })),
    ...evidenceTruthGate.unverifiableAcceptedEvidence.map((entry) => ({
      code: "unverified_evidence",
      field: "evidence",
      message: `${entry.evidenceId} is accepted but lacks verifier, proof, or digest evidence.`
    })),
    ...evidenceTruthGate.verifierPolicyViolations.map((entry) => ({
      code: "verifier_evidence_policy_violation",
      field: "evidence",
      message: `${entry.evidenceId} does not satisfy verifier evidence policy (${entry.verifierRequirement.reasons.join(", ")}).`
    })),
    ...evidenceTruthGate.truthBoundaryViolations.map((entry) => ({
      code: "evidence_truth_boundary_violation",
      field: "evidence",
      message: `${entry.evidenceId} does not match the claim allowance truth boundary (${entry.truthBoundaryReasons.join(", ")}).`
    })),
    ...evidenceTruthGate.contradictions.self.map((entry) => ({
      code: "contradictory_evidence",
      field: "evidence",
      message: `${entry.evidenceId} is both accepted and rejected.`
    })),
    ...evidenceTruthGate.contradictions.identity.map((entry) => ({
      code: "contradictory_evidence_identity",
      field: "evidence",
      message: `${entry.identity} has both accepted and rejected evidence records.`
    })),
    ...evidenceTruthGate.contradictions.type.map((entry) => ({
      code: "contradictory_evidence_type",
      field: "evidence",
      message: `${entry.type} evidence has accepted and rejected records and requires verifier review.`
    })),
    ...evidenceTruthGate.contradictions.boundary.map((entry) => ({
      code: "contradictory_evidence_boundary",
      field: "evidence",
      message: `${entry.type} evidence resolves to multiple tenant, workspace, or verifier boundaries and requires review.`
    })),
    ...requiredEvidenceConsensus.fieldConflicts.map((entry) => ({
      code: `required_evidence_consensus_conflict_${entry.field}`,
      field: "evidence",
      message: `Required evidence does not agree on ${entry.field}: ${entry.values.join(", ")}.`
    })),
    ...requiredEvidenceConsensus.claimMismatchFields.map((field) => ({
      code: `required_evidence_consensus_claim_mismatch_${field}`,
      field: "evidence",
      message: `Required evidence consensus does not match the claim ${field}.`
    }))
  ];
  const evidenceAcceptanceReview = buildEvidenceAcceptanceReview({
    claim,
    requiredEvidence,
    evidenceTruthGate,
    requiredEvidenceQuorum,
    requiredEvidenceConsensus
  });

  return {
    valid: errors.length === 0,
    errors,
    acceptedEvidenceTypes: [...acceptedEvidenceTypes],
    missingEvidenceTypes,
    rejectedEvidenceIds: rejectedEvidence.map((entry) => entry.id),
    requiredEvidenceQuorum,
    requiredEvidenceConsensus,
    evidenceAcceptanceReview,
    unsatisfiedRequiredEvidence,
    verifierEvidencePolicy,
    evidenceTruthGate
  };
}

function buildReadiness(validationSummary, input, operationalHealth, providerNegotiation, boundaryDecision, lifecycleGate) {
  const previewOnly = input.previewOnly === true || input.mode === "preview";
  const manualApprovalRequired = input.requireManualApproval === true;
  const allowanceAccepted = input.accept === true || ACCEPTANCE_STATES.has(normalizeText(input.acceptanceStatus).toLowerCase());
  const blockedBy = [
    ...validationSummary.errors.map((error) => error.code),
    ...(manualApprovalRequired && !allowanceAccepted ? ["manual_acceptance_required"] : []),
    ...(operationalHealth.blocked ? ["operational_health_blocked"] : []),
    ...(operationalHealth.retryPlan.retryable ? ["retry_backoff_active"] : []),
    ...(operationalHealth.degradedMode ? ["degraded_mode_issue_disabled"] : []),
    ...boundaryDecision.blockers,
    ...providerNegotiation.blockers,
    ...lifecycleGate.blockers
  ];

  return {
    ready: blockedBy.length === 0 && !previewOnly && operationalHealth.canIssue && lifecycleGate.status === "enabled",
    previewOnly,
    manualApprovalRequired,
    allowanceAccepted,
    operationalStatus: operationalHealth.status,
    boundaryStatus: boundaryDecision.status,
    providerContractStatus: providerNegotiation.negotiated ? "negotiated" : "blocked",
    lifecycleStatus: lifecycleGate.status,
    blockedBy,
    state: blockedBy.length === 0 && !previewOnly ? "ready" : previewOnly ? "preview" : "blocked"
  };
}

function buildPersistedRecoveryStatus({ persistedState, claim, command, decisionToken, readiness, validationSummary, now }) {
  const sameClaim = persistedState.claimId === claim.id;
  const expectedStatus = readiness.ready ? "allowance-ready" : "allowance-held";
  const persistedStatusRestartSafe = RESTART_SAFE_STATUSES.has(persistedState.status);
  const sameDecision = sameClaim && persistedState.decisionToken === decisionToken;
  const commandEntries = persistedState.commandLedger.filter((entry) => (
    entry.claimId === claim.id
    && (
      entry.commandId === command.commandId
      || (entry.idempotencyKey && entry.idempotencyKey === command.idempotencyKey)
    )
  ));
  const exactDecisionEntries = commandEntries.filter((entry) => entry.decisionToken === decisionToken);
  const terminalEntries = exactDecisionEntries.filter((entry) => TERMINAL_COMMAND_STATUSES.has(entry.status));
  const inFlightEntries = commandEntries.filter((entry) => !TERMINAL_COMMAND_STATUSES.has(entry.status));
  const conflictingEntries = commandEntries.filter((entry) => (
    entry.decisionToken
    && entry.decisionToken !== decisionToken
    && entry.status !== "superseded"
  ));
  const matchingTerminalEntry = terminalEntries.find((entry) => (
    entry.restartSafe
    || RESTART_SAFE_STATUSES.has(entry.resultStatus)
    || entry.resultStatus === expectedStatus
  )) || null;
  const duplicateIdempotencyEntries = persistedState.commandLedger.filter((entry) => (
    entry.claimId === claim.id
    && entry.idempotencyKey
    && entry.idempotencyKey === command.idempotencyKey
    && entry.commandId !== command.commandId
  ));
  const staleStateReasons = [
    ...(persistedState.version > 0 && persistedState.version !== PERSISTED_STATE_VERSION ? ["state_version_mismatch"] : []),
    ...(persistedState.claimId && !sameClaim ? ["state_claim_mismatch"] : []),
    ...(sameClaim && persistedState.decisionToken && persistedState.decisionToken !== decisionToken ? ["decision_token_changed"] : []),
    ...(sameDecision && persistedState.status && !persistedStatusRestartSafe ? ["persisted_status_not_restart_safe"] : []),
    ...(sameDecision && persistedState.status && persistedState.status !== expectedStatus && !RESTART_SAFE_STATUSES.has(persistedState.status) ? ["persisted_status_drift"] : []),
    ...(conflictingEntries.length > 0 ? ["conflicting_command_decision"] : []),
    ...(inFlightEntries.length > 0 ? ["inflight_command_requires_recovery"] : [])
  ];
  const currentEvidenceKey = [
    ...validationSummary.acceptedEvidenceTypes.map((type) => `accepted:${type}`),
    ...validationSummary.missingEvidenceTypes.map((type) => `missing:${type}`),
    ...validationSummary.rejectedEvidenceIds.map((id) => `rejected:${id}`)
  ].sort().join("|");
  const persistedEvidenceKey = [
    ...persistedState.acceptedEvidenceTypes.map((type) => `accepted:${type}`),
    ...persistedState.missingEvidenceTypes.map((type) => `missing:${type}`),
    ...persistedState.rejectedEvidenceIds.map((id) => `rejected:${id}`)
  ].sort().join("|");
  const evidenceChanged = Boolean(sameClaim && persistedEvidenceKey && persistedEvidenceKey !== currentEvidenceKey);
  const replayDisposition = matchingTerminalEntry
    ? "return-recorded-result"
    : exactDecisionEntries.length > 0
      ? "recover-command-result"
      : duplicateIdempotencyEntries.length > 0
        ? "dedupe-idempotency-key"
        : inFlightEntries.length > 0
          ? "resume-or-supersede-inflight"
          : sameDecision && persistedStatusRestartSafe && !evidenceChanged
            ? "resume-persisted-decision"
            : "evaluate-new-state";
  const blockers = [
    ...(staleStateReasons.includes("state_claim_mismatch") ? ["recovery_claim_mismatch"] : []),
    ...(staleStateReasons.includes("state_version_mismatch") ? ["recovery_state_version_mismatch"] : []),
    ...(staleStateReasons.includes("conflicting_command_decision") ? ["recovery_command_conflict"] : []),
    ...(staleStateReasons.includes("persisted_status_not_restart_safe") ? ["recovery_status_not_restart_safe"] : [])
  ];
  const state = blockers.length > 0
    ? "requires_refresh"
    : matchingTerminalEntry || (sameDecision && persistedStatusRestartSafe && !evidenceChanged)
      ? "restart_safe"
      : inFlightEntries.length > 0
        ? "recovering_inflight"
        : sameClaim
          ? "refreshable"
          : "new_state";

  return {
    contractType: "claim-allowance-persisted-recovery-status-v1",
    generatedAt: now,
    state,
    replayDisposition,
    sameClaim,
    sameDecision,
    expectedStatus,
    persistedStatus: persistedState.status || null,
    persistedStatusRestartSafe,
    evidenceChanged,
    staleStateReasons,
    blockers,
    matchingTerminalEntry: matchingTerminalEntry
      ? {
          ledgerId: matchingTerminalEntry.ledgerId,
          commandId: matchingTerminalEntry.commandId,
          idempotencyKey: matchingTerminalEntry.idempotencyKey,
          status: matchingTerminalEntry.status,
          resultStatus: matchingTerminalEntry.resultStatus || null,
          proofId: matchingTerminalEntry.proofId || null,
          appliedAt: matchingTerminalEntry.appliedAt || null
        }
      : null,
    inFlightCommands: inFlightEntries.map((entry) => ({
      ledgerId: entry.ledgerId,
      commandId: entry.commandId,
      idempotencyKey: entry.idempotencyKey,
      status: entry.status,
      decisionToken: entry.decisionToken || null,
      requestedAt: entry.requestedAt || null,
      recoveryAction: entry.recoveryAction || "recover-or-supersede"
    })),
    conflictingCommands: conflictingEntries.map((entry) => ({
      ledgerId: entry.ledgerId,
      commandId: entry.commandId,
      idempotencyKey: entry.idempotencyKey,
      status: entry.status,
      decisionToken: entry.decisionToken
    })),
    duplicateIdempotencyLedgerIds: duplicateIdempotencyEntries.map((entry) => entry.ledgerId),
    stateShape: {
      namespace: "verifierClaimGate.claimAllowance",
      version: PERSISTED_STATE_VERSION,
      previousVersion: persistedState.version,
      restartSafeStatuses: [...RESTART_SAFE_STATUSES],
      terminalCommandStatuses: [...TERMINAL_COMMAND_STATUSES]
    }
  };
}

function buildRecoveryPlan({ claim, readiness, validationSummary, persistedState, command, decisionToken, now }) {
  const recoveryStatus = buildPersistedRecoveryStatus({
    persistedState,
    claim,
    command,
    decisionToken,
    readiness,
    validationSummary,
    now
  });
  const sameClaim = persistedState.claimId === claim.id;
  const ledgerMatch = persistedState.commandLedger.find((entry) => (
    entry.claimId === claim.id
    && entry.decisionToken === decisionToken
    && (
      entry.commandId === command.commandId ||
      (entry.idempotencyKey && entry.idempotencyKey === command.idempotencyKey)
    )
  )) || null;
  const sameDecision = sameClaim && persistedState.decisionToken === decisionToken;
  const sameCommand = Boolean(ledgerMatch) || (sameDecision && (
    persistedState.lastCommandId === command.commandId ||
    (persistedState.idempotencyKey && persistedState.idempotencyKey === command.idempotencyKey)
  ));
  const restartSafeStatus = (sameDecision && RESTART_SAFE_STATUSES.has(persistedState.status))
    || Boolean(ledgerMatch && ledgerMatch.restartSafe);
  const incomingStatus = readiness.ready ? "allowance-ready" : "allowance-held";
  const statusChanged = Boolean(persistedState.status && persistedState.status !== incomingStatus);
  const forcedRefresh = recoveryStatus.blockers.length > 0 || recoveryStatus.evidenceChanged;
  const recoveryAction = forcedRefresh
    ? "refresh-unsafe-persisted-state"
    : sameCommand
    ? "replay-existing-command"
    : restartSafeStatus
      ? "resume-persisted-status"
      : sameClaim
        ? "refresh-claim-allowance-state"
        : "create-claim-allowance-state";

  return {
    recovered: sameClaim,
    idempotentReplay: sameCommand,
    restartSafe: !forcedRefresh && (restartSafeStatus || !persistedState.claimId || recoveryStatus.state === "restart_safe"),
    recoveryAction,
    recoveryStatus,
    previousStatus: persistedState.status || null,
    nextStatus: incomingStatus,
    statusChanged,
    ledgerMatch: ledgerMatch
      ? {
          ledgerId: ledgerMatch.ledgerId,
          commandId: ledgerMatch.commandId,
          idempotencyKey: ledgerMatch.idempotencyKey,
          status: ledgerMatch.status,
          appliedAt: ledgerMatch.appliedAt || null,
          resultStatus: ledgerMatch.resultStatus || null,
          proofId: ledgerMatch.proofId || null
        }
      : null,
    statusReason: readiness.ready
      ? "Required evidence and acceptance gates are satisfied."
      : "Claim allowance remains held until validation blockers are cleared.",
    resumedAt: sameClaim ? now : null,
    persistedBlockedBy: persistedState.blockedBy,
    persistedMissingEvidenceTypes: persistedState.missingEvidenceTypes,
    currentBlockedBy: readiness.blockedBy,
    currentMissingEvidenceTypes: validationSummary.missingEvidenceTypes,
    recoveryBlockers: recoveryStatus.blockers
  };
}

function buildCommandPersistenceEnvelope({ persistedState, claim, readiness, validationSummary, command, decisionToken, requestContext, recoveryPlan, proof, now }) {
  const priorLedger = persistedState.commandLedger;
  const resultStatus = recoveryPlan.nextStatus;
  const priorEntry = recoveryPlan.ledgerMatch
    ? priorLedger.find((entry) => entry.ledgerId === recoveryPlan.ledgerMatch.ledgerId) || null
    : null;
  const status = recoveryPlan.idempotentReplay ? "replayed" : "applied";
  const recoveryStatus = recoveryPlan.recoveryStatus || {
    state: "unknown",
    replayDisposition: "evaluate-new-state",
    blockers: []
  };
  const currentEntry = {
    ledgerId: `${surfaceId}:${claim.id}:${command.idempotencyKey || command.commandId}:${decisionToken}`,
    commandId: command.commandId,
    idempotencyKey: command.idempotencyKey,
    claimId: claim.id,
    decisionToken,
    status,
    restartSafe: true,
    requestedAt: command.requestedAt || now,
    appliedAt: priorEntry && recoveryPlan.idempotentReplay ? priorEntry.appliedAt || now : now,
    recoveryAction: recoveryPlan.recoveryAction,
    resultStatus,
    proofId: readiness.ready ? proof.proofId : priorEntry ? priorEntry.proofId : "",
    blockedBy: readiness.blockedBy
  };
  const compactedLedger = [...priorLedger.filter((entry) => (
    entry.commandId !== command.commandId
    && entry.idempotencyKey !== command.idempotencyKey
  )), currentEntry].slice(-MAX_COMMAND_LEDGER_ENTRIES);
  const duplicateCommands = priorLedger.filter((entry) => (
    entry.ledgerId !== currentEntry.ledgerId
    && entry.claimId === claim.id
    && (
      entry.commandId === command.commandId ||
      (entry.idempotencyKey && entry.idempotencyKey === command.idempotencyKey)
    )
  ));

  return {
    contractType: "claim-allowance-command-persistence-v1",
    commandStatusId: `${surfaceId}:${claim.id}:${command.commandId}:command-status`,
    generatedAt: now,
    state: recoveryStatus.blockers.length > 0
      ? "recovery_required"
      : readiness.ready ? "complete" : "held",
    status: recoveryStatus.replayDisposition === "return-recorded-result" ? "replayed" : status,
    restartSafe: recoveryPlan.restartSafe,
    idempotentReplay: recoveryPlan.idempotentReplay,
    resultStatus,
    command: {
      name: command.name,
      commandId: command.commandId,
      idempotencyKey: command.idempotencyKey,
      requestedAt: command.requestedAt || now,
      requestId: requestContext.requestId
    },
    replay: {
      disposition: recoveryStatus.replayDisposition,
      recoveryState: recoveryStatus.state,
      matchedLedgerId: recoveryPlan.ledgerMatch ? recoveryPlan.ledgerMatch.ledgerId : null,
      matchingTerminalLedgerId: recoveryStatus.matchingTerminalEntry ? recoveryStatus.matchingTerminalEntry.ledgerId : null,
      duplicateCommandCount: duplicateCommands.length,
      duplicateLedgerIds: duplicateCommands.map((entry) => entry.ledgerId),
      inFlightLedgerIds: recoveryStatus.inFlightCommands ? recoveryStatus.inFlightCommands.map((entry) => entry.ledgerId) : [],
      conflictLedgerIds: recoveryStatus.conflictingCommands ? recoveryStatus.conflictingCommands.map((entry) => entry.ledgerId) : []
    },
    persistedStateShape: {
      namespace: "verifierClaimGate.claimAllowance",
      version: PERSISTED_STATE_VERSION,
      ledgerLimit: MAX_COMMAND_LEDGER_ENTRIES,
      requiredFields: ["claimId", "decisionToken", "status", "lastCommandId", "idempotencyKey", "commandLedger"],
      restartSafeStatuses: [...RESTART_SAFE_STATUSES],
      terminalCommandStatuses: [...TERMINAL_COMMAND_STATUSES]
    },
    recoveryStatus,
    recoveryBlockers: recoveryStatus.blockers,
    result: {
      decision: readiness.ready ? "allow" : "hold",
      acceptedEvidenceTypes: validationSummary.acceptedEvidenceTypes,
      missingEvidenceTypes: validationSummary.missingEvidenceTypes,
      blockedBy: readiness.blockedBy,
      proofId: readiness.ready ? proof.proofId : null
    },
    currentEntry,
    commandLedger: compactedLedger
  };
}

function providerBlockerLabel(blocker) {
  if (blocker.startsWith("operation_binding:")) {
    return "Bind provider dispatch";
  }
  if (blocker.startsWith("missing_provider_capability:")) {
    return "Connect provider capability";
  }
  if (blocker.startsWith("missing_provider_operation:")) {
    return "Bind provider operation";
  }
  if (blocker.startsWith("operation_capability_missing:")) {
    return "Negotiate operation capability";
  }
  if (blocker.startsWith("provider_contract_invalid:")) {
    return "Repair provider contract";
  }
  if (blocker.startsWith("provider_namespace:") || blocker.startsWith("provider_binding_namespace:")) {
    return "Scope provider namespace";
  }
  if (blocker.startsWith("provider_sync_stale:")) {
    return "Refresh provider sync";
  }
  if (blocker === "provider_retry_backoff_active") {
    return "Wait for provider retry";
  }
  if (blocker.startsWith("provider_retry_exhausted:")) {
    return "Escalate provider recovery";
  }
  return "Restore provider contract";
}

function providerBlockerReason(blocker) {
  if (blocker.startsWith("operation_binding:")) {
    const [, operation, reason] = blocker.split(":");
    return `${operation} dispatch binding is blocked by ${reason || "provider contract state"}.`;
  }
  if (blocker.startsWith("missing_provider_capability:")) {
    return `${blocker.slice("missing_provider_capability:".length)} capability is required before external allowance handoff.`;
  }
  if (blocker.startsWith("missing_provider_operation:")) {
    return `${blocker.slice("missing_provider_operation:".length)} operation must be bound before claim allowance handoff.`;
  }
  if (blocker.startsWith("operation_capability_missing:")) {
    const [, operation, capability] = blocker.split(":");
    return `${operation} service contract must advertise ${capability || "the required"} capability before claim allowance handoff.`;
  }
  if (blocker.startsWith("provider_contract_invalid:")) {
    return `${blocker.slice("provider_contract_invalid:".length)} service contract must expose route, schema, sync, and scope metadata.`;
  }
  if (blocker.startsWith("provider_binding_namespace:")) {
    const [, operation, contractId, reason] = blocker.split(":");
    return `${operation} contract ${contractId} must declare the expected tenant and workspace before dispatch (${reason || "namespace_blocked"}).`;
  }
  if (blocker.startsWith("provider_namespace:")) {
    const [, providerId, reason] = blocker.split(":");
    return `${providerId} provider namespace must match the claim allowance boundary (${reason || "namespace_blocked"}).`;
  }
  if (blocker.startsWith("provider_sync_stale:")) {
    return `${blocker.slice("provider_sync_stale:".length)} sync metadata is stale and must be refreshed before allowance.`;
  }
  if (blocker === "provider_retry_backoff_active") {
    return "A provider retry backoff window is active; wait for the retry window or resolve the provider failure before dispatch.";
  }
  if (blocker.startsWith("provider_retry_exhausted:")) {
    return `${blocker.slice("provider_retry_exhausted:".length)} exhausted provider retry attempts and needs operator recovery.`;
  }
  return `${blocker.slice("provider_unavailable:".length)} must be ready before allowance can be issued.`;
}

function lifecycleBlockerStep(blocker, lifecycleGate) {
  const reasonByCode = {
    lifecycle_disabled: "Claim allowance is disabled for this route and must be enabled before evaluation can issue.",
    lifecycle_issue_disabled: "Issuing allowance proofs is disabled in lifecycle settings.",
    lifecycle_paused: "Claim allowance is paused and must be resumed before issuing.",
    lifecycle_schedule_disabled: "Lifecycle scheduling is disabled for claim allowance.",
    lifecycle_disabled_until_active: `Claim allowance is disabled until ${lifecycleGate.scheduling.disabledUntil}.`,
    lifecycle_schedule_not_due: `Claim allowance is scheduled for ${lifecycleGate.scheduling.dueAt}.`
  };
  const actionByCode = {
    lifecycle_disabled: "verifier.claimAllowance.enable",
    lifecycle_issue_disabled: "verifier.claimAllowance.enableIssue",
    lifecycle_paused: "verifier.claimAllowance.resume",
    lifecycle_schedule_disabled: "verifier.claimAllowance.schedule",
    lifecycle_disabled_until_active: "verifier.claimAllowance.schedule",
    lifecycle_schedule_not_due: "verifier.claimAllowance.schedule"
  };

  return {
    id: `resolve-${blocker.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`,
    label: blocker.startsWith("lifecycle_settings_invalid:")
      ? "Fix lifecycle settings"
      : blocker.startsWith("lifecycle_command_not_allowed:")
        ? "Use allowed lifecycle command"
        : blocker === "lifecycle_paused"
          ? "Resume claim allowance"
          : blocker === "lifecycle_disabled"
            ? "Enable claim allowance"
            : "Update allowance schedule",
    routeAction: actionByCode[blocker] || "verifier.claimAllowance.updateLifecycleSettings",
    reason: blocker.startsWith("lifecycle_settings_invalid:")
      ? `${blocker.slice("lifecycle_settings_invalid:".length)} is not a valid lifecycle setting.`
      : blocker.startsWith("lifecycle_command_not_allowed:")
        ? `${blocker.slice("lifecycle_command_not_allowed:".length)} is not an allowed claim allowance lifecycle command.`
        : reasonByCode[blocker] || "Lifecycle settings must be updated before claim allowance can proceed."
  };
}

function buildNextSteps({ claim, readiness, validationSummary, operationalHealth, providerNegotiation, boundaryDecision, lifecycleGate }) {
  if (readiness.ready) {
    return [
      {
        id: "issue-allowance-proof",
        label: "Issue allowance proof",
        routeAction: "verifier.claimAllowance.issue",
        reason: `${claim.id} has the required accepted evidence and can be allowed.`
      }
    ];
  }

  const missingEvidenceSteps = validationSummary.missingEvidenceTypes.map((type) => ({
    id: `attach-${type}-evidence`,
    label: `Attach accepted ${type} evidence`,
    routeAction: "verifier.claimAllowance.collectEvidence",
    reason: `${type} evidence is missing or not accepted.`
  }));

  const claimFieldSteps = validationSummary.errors
    .filter((error) => error.code.startsWith("missing_") && error.field !== "evidence")
    .map((error) => ({
      id: `complete-${error.field}`,
      label: `Complete ${error.field}`,
      routeAction: "verifier.claimAllowance.completeClaim",
      reason: error.message
    }));

  const acceptanceStep = readiness.manualApprovalRequired && !readiness.allowanceAccepted
    ? [{
        id: "record-manual-acceptance",
        label: "Record manual acceptance",
        routeAction: "verifier.claimAllowance.accept",
        reason: "This route requires an explicit acceptance before allowance can proceed."
      }]
    : [];
  const retryStep = operationalHealth.retryPlan.retryable
    ? [{
        id: "retry-claim-allowance",
        label: "Retry claim allowance",
        routeAction: "verifier.claimAllowance.retry",
        reason: `Retry after ${operationalHealth.retryPlan.retryAfter}.`
      }]
    : [];
  const operationalSteps = operationalHealth.actionableErrors.map((error) => ({
    id: `resolve-${error.code}`,
    label: `Resolve ${error.component}`,
    routeAction: "verifier.claimAllowance.resolveOperationalError",
    reason: error.action
  }));
  const lifecycleSteps = lifecycleGate.blockers.map((blocker) => lifecycleBlockerStep(blocker, lifecycleGate));
  const providerSteps = providerNegotiation.blockers.map((blocker) => ({
    id: `resolve-${blocker.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`,
    label: providerBlockerLabel(blocker),
    routeAction: "verifier.claimAllowance.negotiateProviderContract",
    reason: providerBlockerReason(blocker)
  }));
  const boundarySteps = boundaryDecision.blockers.map((blocker) => ({
    id: `resolve-${blocker.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`,
    label: blocker.startsWith("boundary_missing_permission:")
      ? "Grant allowance permission"
      : blocker.startsWith("boundary_cross_boundary_waiver_")
        ? "Attach boundary waiver"
      : blocker.startsWith("boundary_delegation_")
        ? "Resolve delegated scope"
      : blocker === "boundary_role_not_allowed"
        ? "Assign verifier role"
        : "Resolve workspace boundary",
    routeAction: "verifier.claimAllowance.resolveBoundary",
    reason: blocker.startsWith("boundary_missing_permission:")
      ? `${blocker.slice("boundary_missing_permission:".length)} permission is required for this allowance.`
      : blocker.startsWith("boundary_cross_boundary_waiver_missing:")
        ? `${blocker.slice("boundary_cross_boundary_waiver_missing:".length)} cross-boundary allowance requires an approved waiver with audit proof.`
        : blocker.startsWith("boundary_cross_boundary_waiver_proof_incomplete:")
          ? `${blocker.slice("boundary_cross_boundary_waiver_proof_incomplete:".length)} cross-boundary waiver must include issuer, reason, proof reference, and the required cross-boundary permission.`
      : blocker.startsWith("boundary_delegation_missing_permission:")
        ? `${blocker.slice("boundary_delegation_missing_permission:".length)} permission must be present on the delegated scope.`
        : blocker === "boundary_delegation_required"
          ? "A delegated tenant or workspace boundary requires an explicit scope delegation."
          : blocker === "boundary_delegation_scope_not_applicable"
            ? "Delegation records exist but none apply to this principal, tenant, and workspace."
            : blocker === "boundary_delegation_proof_incomplete"
              ? "Delegation audit proof must include issuer, reason, and proof reference before allowance."
              : blocker === "boundary_delegation_role_not_allowed"
                ? "The delegated scope must carry an allowed verifier role."
                : blocker === "boundary_tenant_mismatch"
                  ? "The claim, request, and principal must resolve to the same tenant before allowance."
                  : blocker === "boundary_workspace_mismatch"
                    ? "The claim, request, and principal must resolve to the same workspace before allowance."
                    : blocker === "boundary_missing_tenant"
                      ? "A tenant scope is required before allowance can be evaluated."
                      : blocker === "boundary_missing_workspace"
                        ? "A workspace scope is required before allowance can be evaluated."
                        : "The principal does not have an allowed role for claim allowance."
  }));

  return [...lifecycleSteps, ...boundarySteps, ...claimFieldSteps, ...missingEvidenceSteps, ...acceptanceStep, ...retryStep, ...operationalSteps, ...providerSteps];
}

function classifyNextStep(step) {
  if (step.routeAction === "verifier.claimAllowance.issue") {
    return "issue";
  }
  if (step.routeAction === "verifier.claimAllowance.accept") {
    return "acceptance";
  }
  if (step.routeAction === "verifier.claimAllowance.collectEvidence") {
    return "evidence";
  }
  if (step.routeAction === "verifier.claimAllowance.completeClaim") {
    return "claim";
  }
  if (step.routeAction === "verifier.claimAllowance.retry") {
    return "retry";
  }
  if (step.routeAction === "verifier.claimAllowance.negotiateProviderContract") {
    return "provider";
  }
  if (step.routeAction === "verifier.claimAllowance.resolveBoundary") {
    return "boundary";
  }
  if (step.routeAction === "verifier.claimAllowance.resolveOperationalError") {
    return "operations";
  }
  if ([
    "verifier.claimAllowance.enable",
    "verifier.claimAllowance.enableIssue",
    "verifier.claimAllowance.resume",
    "verifier.claimAllowance.schedule",
    "verifier.claimAllowance.updateLifecycleSettings"
  ].includes(step.routeAction)) {
    return "lifecycle";
  }
  return "review";
}

function buildValidationDisplay(validationSummary) {
  const groupedErrors = validationSummary.errors.reduce((groups, error) => {
    const field = error.field || "claim";
    return {
      ...groups,
      [field]: [...(groups[field] || []), {
        code: error.code,
        message: error.message
      }]
    };
  }, {});

  return {
    contractType: "claim-allowance-validation-display-v1",
    valid: validationSummary.valid,
    status: validationSummary.valid ? "pass" : "needs_input",
    summaryText: validationSummary.valid
      ? "All required claim fields and accepted evidence are present."
      : `${validationSummary.errors.length} validation item${validationSummary.errors.length === 1 ? "" : "s"} require attention.`,
    counts: {
      errors: validationSummary.errors.length,
      acceptedEvidenceTypes: validationSummary.acceptedEvidenceTypes.length,
      missingEvidenceTypes: validationSummary.missingEvidenceTypes.length,
      unsatisfiedRequiredEvidence: validationSummary.unsatisfiedRequiredEvidence.length,
      rejectedEvidenceIds: validationSummary.rejectedEvidenceIds.length,
      truthBoundaryViolations: validationSummary.evidenceTruthGate.truthBoundaryViolations.length,
      verifierPolicyViolations: validationSummary.evidenceTruthGate.verifierPolicyViolations.length,
      requiredEvidenceConsensusBlockers: validationSummary.requiredEvidenceConsensus.blockers.length,
      evidenceReviewRows: validationSummary.evidenceAcceptanceReview.rows.length,
      evidenceReviewRequired: validationSummary.evidenceAcceptanceReview.reviewRequiredIds.length,
      contradictions: validationSummary.evidenceTruthGate.contradictions.self.length
        + validationSummary.evidenceTruthGate.contradictions.identity.length
        + validationSummary.evidenceTruthGate.contradictions.type.length
        + validationSummary.evidenceTruthGate.contradictions.boundary.length,
      verifierEvidenceIds: validationSummary.evidenceTruthGate.verifierEvidenceIds.length
    },
    groupedErrors,
    acceptedEvidenceTypes: validationSummary.acceptedEvidenceTypes,
    missingEvidenceTypes: validationSummary.missingEvidenceTypes,
    requiredEvidenceQuorum: validationSummary.requiredEvidenceQuorum,
    requiredEvidenceConsensus: validationSummary.requiredEvidenceConsensus,
    evidenceAcceptanceReview: validationSummary.evidenceAcceptanceReview,
    unsatisfiedRequiredEvidence: validationSummary.unsatisfiedRequiredEvidence,
    rejectedEvidenceIds: validationSummary.rejectedEvidenceIds,
    evidenceTruthGate: validationSummary.evidenceTruthGate
  };
}

function buildReadinessChecklist({ readiness, validationSummary, operationalHealth, providerNegotiation, boundaryDecision, lifecycleGate }) {
  return [
    {
      id: "lifecycle-controls",
      label: "Lifecycle controls",
      state: lifecycleGate.status === "enabled" ? "complete" : lifecycleGate.status === "disabled" ? "blocked" : "warning",
      blockerCodes: lifecycleGate.blockers,
      detail: lifecycleGate.status === "enabled"
        ? "Claim allowance lifecycle settings allow evaluation and issuing."
        : "Lifecycle settings, enablement, pause, or scheduling controls are blocking allowance."
    },
    {
      id: "tenant-workspace-boundary",
      label: "Tenant and workspace boundary",
      state: boundaryDecision.scoped ? "complete" : "blocked",
      blockerCodes: boundaryDecision.blockers,
      detail: boundaryDecision.scoped
        ? "Claim, request, and principal scopes are aligned for this allowance."
        : "Tenant, workspace, role, or permission boundary blockers remain."
    },
    {
      id: "claim-validation",
      label: "Claim validation",
      state: validationSummary.valid ? "complete" : "blocked",
      blockerCodes: validationSummary.errors.map((error) => error.code),
      detail: validationSummary.valid
        ? "Claim fields and evidence requirements are satisfied."
        : "Claim fields or accepted evidence are incomplete."
    },
    {
      id: "manual-acceptance",
      label: "Manual acceptance",
      state: readiness.manualApprovalRequired
        ? readiness.allowanceAccepted ? "complete" : "blocked"
        : "not_required",
      blockerCodes: readiness.manualApprovalRequired && !readiness.allowanceAccepted ? ["manual_acceptance_required"] : [],
      detail: readiness.manualApprovalRequired
        ? readiness.allowanceAccepted ? "Manual acceptance is recorded." : "Manual acceptance must be recorded before issuing."
        : "This route does not require manual acceptance."
    },
    {
      id: "operational-health",
      label: "Operational health",
      state: operationalHealth.canIssue ? "complete" : operationalHealth.degraded ? "warning" : "blocked",
      blockerCodes: [
        ...(operationalHealth.blocked ? ["operational_health_blocked"] : []),
        ...(operationalHealth.retryPlan.retryable ? ["retry_backoff_active"] : []),
        ...(operationalHealth.degradedMode ? ["degraded_mode_issue_disabled"] : [])
      ],
      detail: `Operational status is ${operationalHealth.status}.`
    },
    {
      id: "provider-contract",
      label: "Provider contract",
      state: providerNegotiation.negotiated ? "complete" : "blocked",
      blockerCodes: providerNegotiation.blockers,
      detail: providerNegotiation.negotiated
        ? "Required provider capabilities are negotiated."
        : "Provider capability or availability blockers remain."
    }
  ];
}

function buildPreviewContract({ claim, evidence, requiredEvidence, readiness, validationSummary, nextSteps, requestContext, command, decisionToken, operationalHealth, providerNegotiation, boundaryDecision, lifecycleGate, lifecycleCommandApplication, now }) {
  const validationDisplay = buildValidationDisplay(validationSummary);
  const checklist = buildReadinessChecklist({ readiness, validationSummary, operationalHealth, providerNegotiation, boundaryDecision, lifecycleGate });
  const nextStepGroups = nextSteps.reduce((groups, step, index) => {
    const group = classifyNextStep(step);
    const item = {
      ...step,
      group,
      priority: index + 1,
      disabled: false
    };
    return {
      ...groups,
      [group]: [...(groups[group] || []), item]
    };
  }, {});
  const primaryNextStep = nextSteps[0] || null;
  const acceptanceDisabledReason = readiness.manualApprovalRequired && !validationSummary.valid
    ? "Resolve validation blockers before recording acceptance."
    : readiness.manualApprovalRequired && !lifecycleGate.canAccept
      ? "Enable acceptance lifecycle controls before recording acceptance."
    : readiness.manualApprovalRequired && operationalHealth.blocked
      ? "Resolve operational blockers before recording acceptance."
      : readiness.manualApprovalRequired && !boundaryDecision.scoped
        ? "Resolve tenant, workspace, role, and permission blockers before recording acceptance."
        : null;

  return {
    contractType: "claim-allowance-user-preview-v1",
    previewId: `${surfaceId}:${claim.id}:${command.commandId}:preview`,
    generatedAt: now,
    route: requestContext.route,
    claimId: claim.id,
    decisionToken,
    displayState: readiness.ready ? "ready" : readiness.previewOnly ? "preview" : "needs_attention",
    statusTone: readiness.ready ? "success" : readiness.previewOnly ? "neutral" : "warning",
    headline: readiness.ready ? "Ready to issue allowance" : "Allowance needs review",
    summaryText: readiness.ready
      ? `${claim.id} can be issued with ${validationSummary.acceptedEvidenceTypes.length} accepted evidence type${validationSummary.acceptedEvidenceTypes.length === 1 ? "" : "s"}.`
      : `${claim.id} is held by ${readiness.blockedBy.length} blocker${readiness.blockedBy.length === 1 ? "" : "s"}.`,
    evidencePreview: {
      observedCount: evidence.length,
      requiredTypes: requiredEvidence,
      acceptedTypes: validationSummary.acceptedEvidenceTypes,
      missingTypes: validationSummary.missingEvidenceTypes,
      requiredEvidenceQuorum: validationSummary.requiredEvidenceQuorum,
      requiredEvidenceConsensus: validationSummary.requiredEvidenceConsensus,
      acceptanceReview: validationSummary.evidenceAcceptanceReview,
      rejectedIds: validationSummary.rejectedEvidenceIds,
      truthGate: validationSummary.evidenceTruthGate
    },
    acceptanceControl: {
      required: readiness.manualApprovalRequired,
      accepted: readiness.allowanceAccepted,
      canAccept: readiness.manualApprovalRequired && !readiness.allowanceAccepted && !acceptanceDisabledReason,
      disabledReason: acceptanceDisabledReason,
      action: "verifier.claimAllowance.accept",
      payload: {
        claimId: claim.id,
        decisionToken,
        commandId: command.commandId
      }
    },
    readinessChecklist: checklist,
    validation: validationDisplay,
    boundary: {
      status: boundaryDecision.status,
      scoped: boundaryDecision.scoped,
      tenant: boundaryDecision.tenant,
      workspace: boundaryDecision.workspace,
      authorization: boundaryDecision.authorization,
      delegationBoundary: boundaryDecision.delegationBoundary,
      auditHandoff: boundaryDecision.auditHandoff,
      blockers: boundaryDecision.blockers
    },
    lifecycleControls: {
      status: lifecycleGate.status,
      enabled: lifecycleGate.enabled,
      canEvaluate: lifecycleGate.canEvaluate,
      canAccept: lifecycleGate.canAccept,
      canHandoff: lifecycleGate.canHandoff,
      scheduling: lifecycleGate.scheduling,
      nextActionState: lifecycleCommandApplication.nextActionState,
      commandApplication: lifecycleCommandApplication,
      command: lifecycleGate.command,
      blockers: lifecycleGate.blockers,
      settings: lifecycleGate.settings
    },
    nextStepGroups,
    primaryNextStep,
    providerServiceContract: {
      negotiated: providerNegotiation.serviceContractNegotiation.negotiated,
      requiredOperations: providerNegotiation.serviceContractNegotiation.requiredOperations,
      offeredOperations: providerNegotiation.serviceContractNegotiation.offeredOperations,
      missingOperations: providerNegotiation.serviceContractNegotiation.missingOperations,
      operationCapabilityStates: providerNegotiation.serviceContractNegotiation.operationCapabilityStates,
      operationBindings: providerNegotiation.serviceContractNegotiation.operationBindings,
      dispatchManifest: providerNegotiation.serviceContractNegotiation.dispatchManifest,
      invalidContracts: providerNegotiation.serviceContractNegotiation.invalidContracts,
      syncMetadata: providerNegotiation.serviceContractNegotiation.syncMetadata
    },
    operationalHealth: {
      status: operationalHealth.status,
      canIssue: operationalHealth.canIssue,
      degraded: operationalHealth.degraded,
      blocked: operationalHealth.blocked,
      failureState: operationalHealth.failureState
    },
    providerNamespaceBoundary: providerNegotiation.providerNamespaceBoundary,
    handoffReady: providerNegotiation.externalHandoffState.ready,
    issueEnabled: readiness.ready
  };
}

function buildAcceptanceRouteContract({ claim, readiness, validationSummary, nextSteps, requestContext, command, decisionToken, operationalHealth, providerNegotiation, boundaryDecision, lifecycleGate, lifecycleCommandApplication, now }) {
  const acceptanceBlockers = [
    ...(!validationSummary.valid ? validationSummary.errors.map((error) => error.code) : []),
    ...(operationalHealth.blocked ? ["operational_health_blocked"] : []),
    ...(operationalHealth.retryPlan.retryable ? ["retry_backoff_active"] : []),
    ...(!boundaryDecision.scoped ? boundaryDecision.blockers : []),
    ...(!providerNegotiation.negotiated ? providerNegotiation.blockers : []),
    ...(!lifecycleGate.canAccept ? lifecycleGate.blockers.length > 0 ? lifecycleGate.blockers : ["lifecycle_acceptance_disabled"] : [])
  ];
  const canRecordAcceptance = readiness.manualApprovalRequired
    && !readiness.allowanceAccepted
    && acceptanceBlockers.length === 0;
  const canIssueAfterAcceptance = readiness.ready || (
    readiness.manualApprovalRequired
    && !readiness.allowanceAccepted
    && acceptanceBlockers.length === 0
    && !readiness.previewOnly
  );
  const routeValidationSummary = {
    status: validationSummary.valid ? "valid" : "invalid",
    errorCount: validationSummary.errors.length,
    blockerCount: readiness.blockedBy.length,
    acceptedEvidenceTypes: validationSummary.acceptedEvidenceTypes,
    missingEvidenceTypes: validationSummary.missingEvidenceTypes,
    rejectedEvidenceIds: validationSummary.rejectedEvidenceIds,
      evidenceTruthGateState: validationSummary.evidenceTruthGate.state,
      evidenceAcceptanceReviewState: validationSummary.evidenceAcceptanceReview.state,
      evidenceAcceptanceReviewRequiredIds: validationSummary.evidenceAcceptanceReview.reviewRequiredIds,
      requiredEvidenceConsensusState: validationSummary.requiredEvidenceConsensus.state,
      requiredEvidenceConsensusBlockers: validationSummary.requiredEvidenceConsensus.blockers,
      evidenceTruthBoundaryViolationCount: validationSummary.evidenceTruthGate.truthBoundaryViolations.length,
      verifierPolicyViolationCount: validationSummary.evidenceTruthGate.verifierPolicyViolations.length,
      contradictoryEvidenceCount: validationSummary.evidenceTruthGate.contradictions.self.length
        + validationSummary.evidenceTruthGate.contradictions.identity.length
        + validationSummary.evidenceTruthGate.contradictions.type.length
        + validationSummary.evidenceTruthGate.contradictions.boundary.length,
    boundaryStatus: boundaryDecision.status,
    providerContractStatus: providerNegotiation.negotiated ? "negotiated" : "blocked",
    operationalStatus: operationalHealth.status
  };
  const submitPayload = {
    surfaceId,
    contractType: "claim-allowance-acceptance-submit-v1",
    claimId: claim.id,
    decisionToken,
    commandId: command.commandId,
    idempotencyKey: command.idempotencyKey,
    requestId: requestContext.requestId,
    tenantId: boundaryDecision.tenant.expectedTenantId,
    workspaceId: boundaryDecision.workspace.expectedWorkspaceId,
    principalId: boundaryDecision.principal.id,
    acceptedEvidenceTypes: validationSummary.acceptedEvidenceTypes,
    providerHandoffCorrelationId: providerNegotiation.externalHandoffState.correlationId
  };
  const blockedReason = canRecordAcceptance
    ? null
    : readiness.allowanceAccepted
      ? "Manual acceptance is already recorded for this decision token."
      : !readiness.manualApprovalRequired
        ? "This route can issue without manual acceptance."
        : !lifecycleGate.canAccept
          ? "Lifecycle controls do not currently allow recording acceptance."
        : acceptanceBlockers.length > 0
          ? "Clear validation, boundary, provider, or operational blockers before accepting."
          : readiness.previewOnly
            ? "Preview mode cannot persist manual acceptance."
            : "Acceptance is not available for the current claim allowance state.";
  const nextRouteActions = nextSteps.map((step, index) => ({
    id: step.id,
    routeAction: step.routeAction,
    label: step.label,
    reason: step.reason,
    group: classifyNextStep(step),
    priority: index + 1
  }));

  return {
    contractType: "claim-allowance-route-acceptance-v1",
    generatedAt: now,
    route: requestContext.route,
    claimId: claim.id,
    decisionToken,
    acceptanceState: readiness.allowanceAccepted ? "accepted" : canRecordAcceptance ? "awaiting_acceptance" : "blocked",
    canRecordAcceptance,
    canIssueAfterAcceptance,
    blockedReason,
    blockers: [...new Set(acceptanceBlockers)],
    routeValidationSummary,
    lifecycleControls: {
      status: lifecycleGate.status,
      canAccept: lifecycleGate.canAccept,
      canHandoff: lifecycleGate.canHandoff,
      scheduling: lifecycleGate.scheduling,
      nextActionState: lifecycleCommandApplication.nextActionState,
      commandApplication: lifecycleCommandApplication,
      blockers: lifecycleGate.blockers
    },
    submit: {
      method: "POST",
      routeAction: "verifier.claimAllowance.accept",
      enabled: canRecordAcceptance,
      payload: submitPayload
    },
    issue: {
      routeAction: "verifier.claimAllowance.issue",
      enabled: canIssueAfterAcceptance,
      payload: {
        ...submitPayload,
        contractType: "claim-allowance-issue-submit-v1",
        proofRequired: true
      }
    },
    nextRouteActions
  };
}

function buildReadinessRouteSnapshot({ claim, readiness, validationSummary, nextSteps, previewContract, acceptanceRouteContract, requestContext, command, decisionToken, operationalHealth, providerNegotiation, boundaryDecision, lifecycleGate, now }) {
  const checklist = previewContract.readinessChecklist || [];
  const blockingChecklistItems = checklist.filter((item) => item.state === "blocked");
  const warningChecklistItems = checklist.filter((item) => item.state === "warning");
  const primaryNextStep = previewContract.primaryNextStep || nextSteps[0] || null;
  const issueBinding = providerNegotiation.serviceContractNegotiation.operationBindings
    .find((binding) => binding.operation === "claimAllowance.issueProof") || null;
  const reviewBinding = providerNegotiation.serviceContractNegotiation.operationBindings
    .find((binding) => binding.operation === "claimAllowance.review") || null;
  const syncBinding = providerNegotiation.serviceContractNegotiation.operationBindings
    .find((binding) => binding.operation === "claimAllowance.syncHandoff") || null;
  const routeState = readiness.ready
    ? "ready_to_issue"
    : acceptanceRouteContract.canRecordAcceptance
      ? "awaiting_acceptance"
      : readiness.previewOnly
        ? "preview_only"
        : "blocked";
  const validationHeadline = validationSummary.valid
    ? "Validation passed"
    : `${validationSummary.errors.length} validation blocker${validationSummary.errors.length === 1 ? "" : "s"}`;
  const acceptanceHeadline = readiness.manualApprovalRequired
    ? readiness.allowanceAccepted
      ? "Manual acceptance recorded"
      : acceptanceRouteContract.canRecordAcceptance
        ? "Manual acceptance can be recorded"
        : "Manual acceptance blocked"
    : "Manual acceptance not required";
  const providerHeadline = providerNegotiation.negotiated
    ? "Provider contracts negotiated"
    : `${providerNegotiation.blockers.length} provider blocker${providerNegotiation.blockers.length === 1 ? "" : "s"}`;

  return {
    contractType: "claim-allowance-readiness-route-snapshot-v1",
    snapshotId: `${surfaceId}:${claim.id}:${command.commandId}:readiness-route`,
    generatedAt: now,
    route: requestContext.route,
    claimId: claim.id,
    decisionToken,
    routeState,
    outcome: readiness.ready ? "allow" : "hold",
    issue: {
      enabled: readiness.ready,
      routeAction: "verifier.claimAllowance.issue",
      proofRequired: true,
      providerId: issueBinding ? issueBinding.providerId : providerNegotiation.externalHandoffState.providerId,
      contractId: issueBinding ? issueBinding.contractId : null,
      endpoint: issueBinding ? issueBinding.endpoint : providerNegotiation.externalHandoffState.endpoint,
      blockedBy: readiness.ready ? [] : readiness.blockedBy
    },
    acceptance: {
      required: readiness.manualApprovalRequired,
      accepted: readiness.allowanceAccepted,
      enabled: acceptanceRouteContract.canRecordAcceptance,
      state: acceptanceRouteContract.acceptanceState,
      routeAction: acceptanceRouteContract.submit.routeAction,
      blockedReason: acceptanceRouteContract.blockedReason,
      blockers: acceptanceRouteContract.blockers,
      submitPayload: acceptanceRouteContract.submit.payload
    },
    validation: {
      headline: validationHeadline,
      valid: validationSummary.valid,
      errorCount: validationSummary.errors.length,
      missingEvidenceTypes: validationSummary.missingEvidenceTypes,
      rejectedEvidenceIds: validationSummary.rejectedEvidenceIds,
      acceptedEvidenceTypes: validationSummary.acceptedEvidenceTypes,
      evidenceAcceptanceReview: validationSummary.evidenceAcceptanceReview,
      groupedErrors: previewContract.validation.groupedErrors
    },
    readiness: {
      state: readiness.state,
      ready: readiness.ready,
      previewOnly: readiness.previewOnly,
      blockerCount: readiness.blockedBy.length,
      blockedBy: readiness.blockedBy,
      checklistComplete: checklist.filter((item) => item.state === "complete" || item.state === "not_required").length,
      checklistTotal: checklist.length,
      blockingChecklistItemIds: blockingChecklistItems.map((item) => item.id),
      warningChecklistItemIds: warningChecklistItems.map((item) => item.id)
    },
    operations: {
      status: operationalHealth.status,
      severity: operationalHealth.failureState.severity,
      state: operationalHealth.failureState.state,
      issueAllowed: operationalHealth.failureState.issueGuard.issueAllowed,
      retryAfter: operationalHealth.failureState.retryWindow.retryAfter,
      incidentCount: operationalHealth.failureState.incidents.length,
      operatorActionCount: operationalHealth.failureState.operatorActions.length,
      failureState: operationalHealth.failureState
    },
    explainability: {
      validation: validationHeadline,
      acceptance: acceptanceHeadline,
      lifecycle: lifecycleGate.status === "enabled" ? "Lifecycle controls allow issuing" : "Lifecycle controls are blocking issuing",
      boundary: boundaryDecision.scoped ? "Tenant and workspace boundary is scoped" : "Tenant, workspace, role, or permission boundary is blocked",
      provider: providerHeadline,
      operations: operationalHealth.status === "healthy" ? "Operational dependencies are healthy" : `Operational status is ${operationalHealth.status}`,
      primaryNextStep: primaryNextStep ? primaryNextStep.reason : "No next step is available for this claim allowance state."
    },
    nextStep: primaryNextStep
      ? {
          id: primaryNextStep.id,
          label: primaryNextStep.label,
          routeAction: primaryNextStep.routeAction,
          group: classifyNextStep(primaryNextStep),
          reason: primaryNextStep.reason
        }
      : null,
    routeActions: {
      review: reviewBinding ? reviewBinding.routeAction || "verifier.claimAllowance.review" : "verifier.claimAllowance.review",
      accept: acceptanceRouteContract.submit.routeAction,
      issue: issueBinding ? issueBinding.routeAction || "verifier.claimAllowance.issue" : "verifier.claimAllowance.issue",
      syncHandoff: syncBinding ? syncBinding.routeAction || "verifier.claimAllowance.syncHandoff" : "verifier.claimAllowance.syncHandoff"
    },
    providerDispatch: {
      negotiated: providerNegotiation.negotiated,
      externalHandoffReady: providerNegotiation.externalHandoffState.ready,
      dispatchManifest: providerNegotiation.serviceContractNegotiation.dispatchManifest,
      issueBinding,
      reviewBinding,
      syncBinding
    },
    auditKeys: {
      requestId: requestContext.requestId,
      commandId: command.commandId,
      idempotencyKey: command.idempotencyKey,
      tenantId: boundaryDecision.tenant.expectedTenantId,
      workspaceId: boundaryDecision.workspace.expectedWorkspaceId,
      principalId: boundaryDecision.principal.id,
      providerHandoffCorrelationId: providerNegotiation.externalHandoffState.correlationId
    }
  };
}

function normalizeClientRuntime(input) {
  const rawRuntime = input.clientRuntime && typeof input.clientRuntime === "object"
    ? input.clientRuntime
    : {};
  const clientState = input.clientState && typeof input.clientState === "object" ? input.clientState : {};
  const runtimeState = clientState.runtime && typeof clientState.runtime === "object" ? clientState.runtime : {};
  const workflowState = clientState.workflow && typeof clientState.workflow === "object" ? clientState.workflow : {};
  const supportedRouteActions = [
    ...asArray(rawRuntime.supportedRouteActions),
    ...asArray(rawRuntime.routeActions),
    ...asArray(runtimeState.supportedRouteActions),
    ...asArray(workflowState.supportedRouteActions)
  ].map(normalizeText).filter(Boolean);
  const acceptedContracts = [
    ...asArray(rawRuntime.acceptedContracts),
    ...asArray(rawRuntime.contracts),
    ...asArray(runtimeState.acceptedContracts)
  ].map(normalizeText).filter(Boolean);
  const stateStores = [
    ...asArray(rawRuntime.stateStores),
    ...asArray(runtimeState.stateStores),
    ...asArray(clientState.stateStores)
  ].map(normalizeText).filter(Boolean);

  return {
    runtimeId: normalizeText(rawRuntime.runtimeId || rawRuntime.id || runtimeState.runtimeId) || "unregistered-client-runtime",
    version: normalizeText(rawRuntime.version || runtimeState.version),
    supportedRouteActions: [...new Set(supportedRouteActions)],
    acceptedContracts: [...new Set(acceptedContracts)],
    stateStores: [...new Set(stateStores)],
    canPersistPatch: rawRuntime.canPersistPatch === true || runtimeState.canPersistPatch === true || stateStores.length > 0,
    canQueueHandoff: rawRuntime.canQueueHandoff !== false && runtimeState.canQueueHandoff !== false,
    canRenderPreview: rawRuntime.canRenderPreview !== false && runtimeState.canRenderPreview !== false,
    lastAdoptedDecisionToken: normalizeText(rawRuntime.lastAdoptedDecisionToken || runtimeState.lastAdoptedDecisionToken),
    lastHandoffRouteAction: normalizeText(rawRuntime.lastHandoffRouteAction || runtimeState.lastHandoffRouteAction)
  };
}

function buildRuntimeWorkflowAdoptionPlan({
  runtime,
  readiness,
  nextSteps,
  previewContract,
  acceptanceRouteContract,
  readinessRouteSnapshot,
  hostedKernelIssue,
  selectedRouteAction,
  unsupportedRouteActions,
  missingContracts,
  requestContext,
  command,
  decisionToken
}) {
  const routeSupported = unsupportedRouteActions.length === 0
    || !unsupportedRouteActions.includes(selectedRouteAction);
  const previewContractAccepted = missingContracts.length === 0
    || !missingContracts.includes(previewContract.contractType);
  const acceptanceContractAccepted = missingContracts.length === 0
    || !missingContracts.includes(acceptanceRouteContract.contractType);
  const routeSnapshotAccepted = missingContracts.length === 0
    || !missingContracts.includes(readinessRouteSnapshot.contractType);
  const issueContractAccepted = missingContracts.length === 0
    || !missingContracts.includes(hostedKernelIssue.contractType);
  const stages = [
    {
      stage: "preview",
      contractType: previewContract.contractType,
      routeAction: readinessRouteSnapshot.routeActions.review,
      state: runtime.canRenderPreview && previewContractAccepted ? "ready" : "held",
      required: true,
      blockers: [
        ...(!runtime.canRenderPreview ? ["client_runtime_preview_renderer_missing"] : []),
        ...(!previewContractAccepted ? [`client_runtime_contract_not_accepted:${previewContract.contractType}`] : [])
      ]
    },
    {
      stage: "readiness-route",
      contractType: readinessRouteSnapshot.contractType,
      routeAction: readinessRouteSnapshot.routeActions.review,
      state: routeSnapshotAccepted ? "ready" : "held",
      required: true,
      blockers: [
        ...(!routeSnapshotAccepted ? [`client_runtime_contract_not_accepted:${readinessRouteSnapshot.contractType}`] : [])
      ]
    },
    {
      stage: "acceptance",
      contractType: acceptanceRouteContract.contractType,
      routeAction: acceptanceRouteContract.submit.routeAction,
      state: !readiness.manualApprovalRequired
        ? "not_required"
        : acceptanceRouteContract.canRecordAcceptance && acceptanceContractAccepted
          ? "ready"
          : "held",
      required: readiness.manualApprovalRequired,
      blockers: [
        ...(!acceptanceContractAccepted ? [`client_runtime_contract_not_accepted:${acceptanceRouteContract.contractType}`] : []),
        ...acceptanceRouteContract.blockers
      ]
    },
    {
      stage: "issue",
      contractType: hostedKernelIssue.contractType,
      routeAction: readinessRouteSnapshot.routeActions.issue,
      state: readiness.ready && hostedKernelIssue.enabled && issueContractAccepted ? "ready" : "held",
      required: readiness.ready,
      blockers: [
        ...(!issueContractAccepted ? [`client_runtime_contract_not_accepted:${hostedKernelIssue.contractType}`] : []),
        ...hostedKernelIssue.blockers
      ]
    },
    {
      stage: "sync-handoff",
      contractType: hostedKernelIssue.syncOutput.contractType,
      routeAction: readinessRouteSnapshot.routeActions.syncHandoff,
      state: runtime.canQueueHandoff && hostedKernelIssue.handoffLedger.state !== "blocked" ? "ready" : "held",
      required: readiness.ready || hostedKernelIssue.handoffLedger.pendingAckIds.length > 0,
      blockers: [
        ...(!runtime.canQueueHandoff ? ["client_runtime_handoff_queue_disabled"] : []),
        ...hostedKernelIssue.handoffLedger.blockers
      ]
    }
  ];
  const selectedStep = nextSteps.find((step) => step.routeAction === selectedRouteAction) || null;
  const selectedStage = stages.find((stage) => stage.routeAction === selectedRouteAction) || stages[0];
  const blockingStages = stages.filter((stage) => stage.required && stage.blockers.length > 0);
  const pendingStageNames = stages
    .filter((stage) => ["held", "ready"].includes(stage.state))
    .map((stage) => stage.stage);

  return {
    contractType: "claim-allowance-runtime-workflow-adoption-plan-v1",
    state: blockingStages.length === 0 && routeSupported ? "adoptable" : "held",
    selectedStage: selectedStage.stage,
    selectedRouteAction,
    selectedStepId: selectedStep ? selectedStep.id : null,
    routeSupported,
    runtimeId: runtime.runtimeId,
    requestBinding: {
      requestId: requestContext.requestId,
      sessionId: requestContext.sessionId,
      clientId: requestContext.clientId,
      commandId: command.commandId,
      idempotencyKey: command.idempotencyKey,
      decisionToken
    },
    statePatchBinding: {
      namespace: "verifierClaimGate.claimAllowance",
      activeStep: readiness.ready ? "claim-allowance-issue" : "claim-allowance-review",
      lastDecisionToken: decisionToken,
      patchRequired: true,
      persistable: runtime.canPersistPatch
    },
    stages,
    pendingStageNames,
    unsupportedRouteActions,
    missingContracts,
    blockers: [
      ...(!routeSupported ? [`client_runtime_route_action_not_supported:${selectedRouteAction}`] : []),
      ...blockingStages.flatMap((stage) => stage.blockers.map((blocker) => `${stage.stage}:${blocker}`))
    ]
  };
}

function buildClientRuntimeAdoption({ input, claim, readiness, nextSteps, previewContract, acceptanceRouteContract, readinessRouteSnapshot, hostedKernelIssue, requestContext, command, decisionToken, now }) {
  const runtime = normalizeClientRuntime(input);
  const requiredContracts = [
    previewContract.contractType,
    acceptanceRouteContract.contractType,
    readinessRouteSnapshot.contractType,
    hostedKernelIssue.contractType,
    hostedKernelIssue.proofOutput.contractType,
    hostedKernelIssue.syncOutput.contractType
  ].filter(Boolean);
  const requestedRouteActions = [...new Set([
    ...nextSteps.map((step) => step.routeAction),
    readinessRouteSnapshot.routeActions.review,
    readinessRouteSnapshot.routeActions.accept,
    readinessRouteSnapshot.routeActions.issue,
    readinessRouteSnapshot.routeActions.syncHandoff,
    hostedKernelIssue.delivery.routeAction
  ].filter(Boolean))];
  const routeSupportOpen = runtime.supportedRouteActions.length === 0;
  const unsupportedRouteActions = routeSupportOpen
    ? []
    : requestedRouteActions.filter((routeAction) => !runtime.supportedRouteActions.includes(routeAction));
  const contractAcceptanceOpen = runtime.acceptedContracts.length === 0;
  const missingContracts = contractAcceptanceOpen
    ? []
    : requiredContracts.filter((contractType) => !runtime.acceptedContracts.includes(contractType));
  const supportedPreferredStep = nextSteps.find((step) => (
    routeSupportOpen || runtime.supportedRouteActions.includes(step.routeAction)
  )) || null;
  const fallbackRouteAction = routeSupportOpen || runtime.supportedRouteActions.includes(readinessRouteSnapshot.routeActions.review)
    ? readinessRouteSnapshot.routeActions.review
    : runtime.supportedRouteActions[0] || readinessRouteSnapshot.routeActions.review;
  const selectedRouteAction = supportedPreferredStep
    ? supportedPreferredStep.routeAction
    : readiness.ready
      ? routeSupportOpen || runtime.supportedRouteActions.includes(readinessRouteSnapshot.routeActions.issue)
        ? readinessRouteSnapshot.routeActions.issue
        : fallbackRouteAction
      : fallbackRouteAction;
  const canAdopt = runtime.canRenderPreview
    && runtime.canPersistPatch
    && (routeSupportOpen || unsupportedRouteActions.length < requestedRouteActions.length);
  const adoptionBlockers = [
    ...(!runtime.canRenderPreview ? ["client_runtime_preview_renderer_missing"] : []),
    ...(!runtime.canPersistPatch ? ["client_runtime_state_store_missing"] : []),
    ...(!runtime.canQueueHandoff ? ["client_runtime_handoff_queue_disabled"] : []),
    ...(requestedRouteActions.length > 0 && !routeSupportOpen && unsupportedRouteActions.length === requestedRouteActions.length
      ? ["client_runtime_route_actions_unsupported"]
      : []),
    ...missingContracts.map((contractType) => `client_runtime_contract_not_accepted:${contractType}`)
  ];
  const workflowAdoptionPlan = buildRuntimeWorkflowAdoptionPlan({
    runtime,
    readiness,
    nextSteps,
    previewContract,
    acceptanceRouteContract,
    readinessRouteSnapshot,
    hostedKernelIssue,
    selectedRouteAction,
    unsupportedRouteActions,
    missingContracts,
    requestContext,
    command,
    decisionToken
  });

  return {
    contractType: "claim-allowance-client-runtime-adoption-v1",
    adoptionId: `${surfaceId}:${claim.id}:${command.commandId}:client-runtime-adoption`,
    generatedAt: now,
    route: requestContext.route,
    claimId: claim.id,
    decisionToken,
    runtime,
    state: adoptionBlockers.length === 0 ? "adoptable" : canAdopt ? "partially_adoptable" : "blocked",
    canAdopt,
    selectedRouteAction,
    selectedStepId: supportedPreferredStep ? supportedPreferredStep.id : null,
    requestedRouteActions,
    unsupportedRouteActions,
    requiredContracts,
    missingContracts,
    proofConsumer: {
      proofId: hostedKernelIssue.proofOutput.proofId,
      proofType: hostedKernelIssue.proofOutput.proofType,
      decision: hostedKernelIssue.proofOutput.decision,
      readyForClient: hostedKernelIssue.enabled && missingContracts.length === 0
    },
    handoffQueue: {
      enabled: runtime.canQueueHandoff,
      deliveryMode: hostedKernelIssue.delivery.mode,
      routeAction: selectedRouteAction,
      providerId: hostedKernelIssue.delivery.providerId,
      contractId: hostedKernelIssue.delivery.contractId,
      correlationId: hostedKernelIssue.delivery.correlationId,
      idempotencyKey: command.idempotencyKey,
      queueState: runtime.canQueueHandoff && canAdopt ? "enqueue" : "hold"
    },
    statePatchTarget: {
      stores: runtime.stateStores,
      namespace: "verifierClaimGate.claimAllowance",
      patchRequired: true,
      persistable: runtime.canPersistPatch
    },
    workflowAdoptionPlan,
    blockers: adoptionBlockers
  };
}

function normalizeHistorySnapshots(input, persistedState) {
  const rawHistory = [
    ...asArray(input.claimAllowanceHistory),
    ...asArray(input.history),
    ...persistedState.history
  ];
  const seen = new Set();

  return rawHistory
    .map((entry, index) => {
      const candidate = entry && typeof entry === "object" ? entry : {};
      const evaluatedAt = normalizeText(candidate.evaluatedAt || candidate.generatedAt || candidate.at || candidate.timestamp);
      const decision = normalizeText(candidate.decision);
      const status = normalizeText(candidate.status || candidate.readinessState);
      const claimId = normalizeText(candidate.claimId || candidate.claim);
      const snapshotId = normalizeText(candidate.snapshotId || candidate.id) || `${claimId || "claim"}:${evaluatedAt || index}`;

      return {
        snapshotId,
        evaluatedAt,
        claimId,
        decision,
        status,
        blockedBy: asArray(candidate.blockedBy).map(normalizeText).filter(Boolean),
        missingEvidenceTypes: asArray(candidate.missingEvidenceTypes).map(normalizeText).filter(Boolean),
        unsatisfiedRequiredEvidenceTypes: asArray(candidate.unsatisfiedRequiredEvidenceTypes).map(normalizeText).filter(Boolean),
        acceptedEvidenceTypes: asArray(candidate.acceptedEvidenceTypes).map(normalizeText).filter(Boolean),
        rejectedEvidenceIds: asArray(candidate.rejectedEvidenceIds).map(normalizeText).filter(Boolean),
        operationalStatus: normalizeText(candidate.operationalStatus),
        boundaryStatus: normalizeText(candidate.boundaryStatus),
        boundaryBlockers: asArray(candidate.boundaryBlockers).map(normalizeText).filter(Boolean),
        providerContractStatus: normalizeText(candidate.providerContractStatus),
        providerBlockers: asArray(candidate.providerBlockers).map(normalizeText).filter(Boolean),
        lifecycleStatus: normalizeText(candidate.lifecycleStatus),
        lifecycleBlockers: asArray(candidate.lifecycleBlockers).map(normalizeText).filter(Boolean),
        retryable: candidate.retryable === true,
        proofId: normalizeText(candidate.proofId || candidate.issuedProofId)
      };
    })
    .filter((snapshot) => {
      if (!snapshot.snapshotId || seen.has(snapshot.snapshotId)) {
        return false;
      }
      seen.add(snapshot.snapshotId);
      return true;
    })
    .sort((a, b) => {
      const aMs = Date.parse(a.evaluatedAt);
      const bMs = Date.parse(b.evaluatedAt);
      if (Number.isFinite(aMs) && Number.isFinite(bMs)) {
        return aMs - bMs;
      }
      return a.snapshotId.localeCompare(b.snapshotId);
    })
    .slice(-MAX_HISTORY_SNAPSHOTS);
}

function buildCurrentHistorySnapshot({ claim, readiness, validationSummary, operationalHealth, boundaryDecision, lifecycleGate, proof, command, now }) {
  return {
    snapshotId: `${surfaceId}:${claim.id}:${command.commandId}:${readiness.ready ? "allow" : "hold"}`,
    evaluatedAt: now,
    claimId: claim.id,
    subject: claim.subject,
    decision: readiness.ready ? "allow" : "hold",
    status: readiness.state,
    blockedBy: readiness.blockedBy,
    missingEvidenceTypes: validationSummary.missingEvidenceTypes,
    unsatisfiedRequiredEvidenceTypes: validationSummary.unsatisfiedRequiredEvidence.map((entry) => entry.type),
    acceptedEvidenceTypes: validationSummary.acceptedEvidenceTypes,
    rejectedEvidenceIds: validationSummary.rejectedEvidenceIds,
    requiredEvidenceQuorum: validationSummary.requiredEvidenceQuorum,
    requiredEvidenceConsensus: validationSummary.requiredEvidenceConsensus,
    evidenceTruthGateState: validationSummary.evidenceTruthGate.state,
    evidenceTruthGateBlockers: validationSummary.evidenceTruthGate.blockers,
    verifierEvidencePolicy: validationSummary.verifierEvidencePolicy,
    verifierPolicyViolationIds: validationSummary.evidenceTruthGate.verifierPolicyViolations.map((entry) => entry.evidenceId),
    operationalStatus: operationalHealth.status,
    boundaryStatus: boundaryDecision.status,
    boundaryBlockers: boundaryDecision.blockers,
    providerContractStatus: readiness.providerContractStatus,
    providerBlockers: readiness.blockedBy.filter((blocker) => (
      blocker.startsWith("missing_provider_") ||
      blocker.startsWith("operation_capability_missing:") ||
      blocker.startsWith("provider_") ||
      blocker.startsWith("operation_binding:")
    )),
    lifecycleStatus: lifecycleGate.status,
    lifecycleBlockers: lifecycleGate.blockers,
    retryable: operationalHealth.retryPlan.retryable,
    proofId: proof.proofId
  };
}

function buildTimeline({ history, currentSnapshot, recoveryPlan, now }) {
  const snapshots = [...history, currentSnapshot].slice(-MAX_HISTORY_SNAPSHOTS);
  const previous = snapshots.length > 1 ? snapshots[snapshots.length - 2] : null;
  const firstHeld = snapshots.find((snapshot) => snapshot.decision === "hold");
  const firstAllowed = snapshots.find((snapshot) => snapshot.decision === "allow");
  const transitions = previous && previous.decision !== currentSnapshot.decision
    ? [{
        from: previous.decision || "unknown",
        to: currentSnapshot.decision,
        at: now,
        reason: currentSnapshot.decision === "allow"
          ? "All allowance gates are satisfied."
          : "Allowance gates require more attention."
      }]
    : [];

  return {
    currentSnapshotId: currentSnapshot.snapshotId,
    previousSnapshotId: previous ? previous.snapshotId : null,
    firstHeldAt: firstHeld ? firstHeld.evaluatedAt : null,
    firstAllowedAt: firstAllowed ? firstAllowed.evaluatedAt : null,
    lastTransitionAt: transitions.length > 0 ? now : null,
    recoveryAction: recoveryPlan.recoveryAction,
    snapshots,
    transitions
  };
}

function buildAnalyticsCounters({ evidence, validationSummary, readiness, operationalHealth, providerNegotiation, boundaryDecision, lifecycleGate, persistedState, history }) {
  const priorCounters = persistedState.analytics && typeof persistedState.analytics.counters === "object"
    ? persistedState.analytics.counters
    : {};
  const numericPrior = (key) => Number.isFinite(priorCounters[key]) ? priorCounters[key] : 0;

  return {
    evaluations: numericPrior("evaluations") + 1,
    allowed: numericPrior("allowed") + (readiness.ready ? 1 : 0),
    held: numericPrior("held") + (readiness.ready ? 0 : 1),
    previewOnly: numericPrior("previewOnly") + (readiness.previewOnly ? 1 : 0),
    manualAcceptanceRequired: numericPrior("manualAcceptanceRequired") + (readiness.manualApprovalRequired ? 1 : 0),
    missingEvidenceEvents: numericPrior("missingEvidenceEvents") + validationSummary.missingEvidenceTypes.length,
    unsatisfiedRequiredEvidenceEvents: numericPrior("unsatisfiedRequiredEvidenceEvents") + validationSummary.unsatisfiedRequiredEvidence.length,
    verifierEvidenceBlocks: numericPrior("verifierEvidenceBlocks") + validationSummary.unsatisfiedRequiredEvidence
      .filter((entry) => entry.status === "accepted_without_verifier_evidence").length
      + validationSummary.evidenceTruthGate.verifierPolicyViolations.length,
    requiredEvidenceConsensusBlocks: numericPrior("requiredEvidenceConsensusBlocks")
      + validationSummary.requiredEvidenceConsensus.blockers.length,
    rejectedEvidenceEvents: numericPrior("rejectedEvidenceEvents") + validationSummary.rejectedEvidenceIds.length,
    acceptedEvidenceEvents: numericPrior("acceptedEvidenceEvents") + validationSummary.acceptedEvidenceTypes.length,
    operationalBlocks: numericPrior("operationalBlocks") + (operationalHealth.blocked ? 1 : 0),
    degradedEvaluations: numericPrior("degradedEvaluations") + (operationalHealth.degraded ? 1 : 0),
    retryBackoffs: numericPrior("retryBackoffs") + (operationalHealth.retryPlan.retryable ? 1 : 0),
    operationalFailureIncidents: numericPrior("operationalFailureIncidents") + operationalHealth.failureState.incidents.length,
    operationalOperatorActions: numericPrior("operationalOperatorActions") + operationalHealth.failureState.operatorActions.length,
    boundaryBlocks: numericPrior("boundaryBlocks") + (boundaryDecision.scoped ? 0 : 1),
    tenantBoundaryMismatches: numericPrior("tenantBoundaryMismatches") + (boundaryDecision.tenant.mismatch ? 1 : 0),
    workspaceBoundaryMismatches: numericPrior("workspaceBoundaryMismatches") + (boundaryDecision.workspace.mismatch ? 1 : 0),
    permissionBlocks: numericPrior("permissionBlocks") + boundaryDecision.authorization.missingPermissions.length,
    providerContractBlocks: numericPrior("providerContractBlocks") + (providerNegotiation.negotiated ? 0 : 1),
    lifecycleBlocks: numericPrior("lifecycleBlocks") + (lifecycleGate.blockers.length > 0 ? 1 : 0),
    lifecycleScheduleHolds: numericPrior("lifecycleScheduleHolds") + (lifecycleGate.blockers.includes("lifecycle_schedule_not_due") ? 1 : 0),
    externalHandoffsReady: numericPrior("externalHandoffsReady") + (providerNegotiation.externalHandoffState.ready ? 1 : 0),
    evidenceObserved: numericPrior("evidenceObserved") + evidence.length,
    historySnapshots: history.length
  };
}

function diffStringSets(previousValues, currentValues) {
  const previous = new Set(asArray(previousValues).map(normalizeText).filter(Boolean));
  const current = new Set(asArray(currentValues).map(normalizeText).filter(Boolean));

  return {
    added: [...current].filter((value) => !previous.has(value)),
    cleared: [...previous].filter((value) => !current.has(value)),
    unchanged: [...current].filter((value) => previous.has(value))
  };
}

function classifyBlocker(blocker) {
  if (blocker.startsWith("boundary_")) {
    return "boundary";
  }
  if (
    blocker.startsWith("missing_provider_") ||
    blocker.startsWith("operation_capability_missing:") ||
    blocker.startsWith("provider_") ||
    blocker.startsWith("operation_binding:")
  ) {
    return "provider";
  }
  if (
    blocker.startsWith("missing_") ||
    blocker.startsWith("ambiguous_") ||
    blocker === "rejected_evidence" ||
    blocker.startsWith("unverified_evidence") ||
    blocker.startsWith("verifier_evidence_policy") ||
    blocker.startsWith("required_evidence_consensus_") ||
    blocker.startsWith("evidence_boundary_contradiction") ||
    blocker.startsWith("evidence_truth_boundary") ||
    blocker.startsWith("contradictory_evidence")
  ) {
    return "evidence";
  }
  if (blocker === "manual_acceptance_required") {
    return "acceptance";
  }
  if (blocker === "operational_health_blocked" || blocker === "retry_backoff_active" || blocker === "degraded_mode_issue_disabled") {
    return "operations";
  }
  if (blocker.startsWith("lifecycle_")) {
    return "lifecycle";
  }
  return "claim";
}

function summarizeBlockersByGroup(blockers) {
  return asArray(blockers).reduce((groups, blocker) => {
    const code = normalizeText(blocker);
    if (!code) {
      return groups;
    }
    const group = classifyBlocker(code);
    return {
      ...groups,
      [group]: [...(groups[group] || []), code]
    };
  }, {});
}

function buildAnalyticsDeltas({ previousSnapshot, currentSnapshot }) {
  const blockerDelta = diffStringSets(previousSnapshot ? previousSnapshot.blockedBy : [], currentSnapshot.blockedBy);
  const missingEvidenceDelta = diffStringSets(previousSnapshot ? previousSnapshot.missingEvidenceTypes : [], currentSnapshot.missingEvidenceTypes);
  const acceptedEvidenceDelta = diffStringSets(previousSnapshot ? previousSnapshot.acceptedEvidenceTypes : [], currentSnapshot.acceptedEvidenceTypes);
  const rejectedEvidenceDelta = diffStringSets(previousSnapshot ? previousSnapshot.rejectedEvidenceIds : [], currentSnapshot.rejectedEvidenceIds);
  const boundaryBlockerDelta = diffStringSets(previousSnapshot ? previousSnapshot.boundaryBlockers : [], currentSnapshot.boundaryBlockers);
  const providerBlockerDelta = diffStringSets(previousSnapshot ? previousSnapshot.providerBlockers : [], currentSnapshot.providerBlockers);
  const lifecycleBlockerDelta = diffStringSets(previousSnapshot ? previousSnapshot.lifecycleBlockers : [], currentSnapshot.lifecycleBlockers);

  return {
    contractType: "claim-allowance-analytics-delta-v1",
    comparedSnapshotId: previousSnapshot ? previousSnapshot.snapshotId : null,
    currentSnapshotId: currentSnapshot.snapshotId,
    decisionChanged: Boolean(previousSnapshot && previousSnapshot.decision !== currentSnapshot.decision),
    statusChanged: Boolean(previousSnapshot && previousSnapshot.status !== currentSnapshot.status),
    operationalStatusChanged: Boolean(previousSnapshot && previousSnapshot.operationalStatus !== currentSnapshot.operationalStatus),
    boundaryStatusChanged: Boolean(previousSnapshot && previousSnapshot.boundaryStatus !== currentSnapshot.boundaryStatus),
    providerContractStatusChanged: Boolean(previousSnapshot && previousSnapshot.providerContractStatus !== currentSnapshot.providerContractStatus),
    lifecycleStatusChanged: Boolean(previousSnapshot && previousSnapshot.lifecycleStatus !== currentSnapshot.lifecycleStatus),
    blockerDelta,
    missingEvidenceDelta,
    acceptedEvidenceDelta,
    rejectedEvidenceDelta,
    boundaryBlockerDelta,
    providerBlockerDelta,
    lifecycleBlockerDelta,
    blockerGroups: summarizeBlockersByGroup(currentSnapshot.blockedBy)
  };
}

function buildAnalyticsEvents({ claim, requestContext, command, readiness, validationSummary, operationalHealth, providerNegotiation, boundaryDecision, lifecycleGate, currentSnapshot, deltas, now }) {
  const base = {
    surfaceId,
    claimId: claim.id,
    requestId: requestContext.requestId,
    commandId: command.commandId,
    emittedAt: now
  };
  const events = [
    {
      ...base,
      eventType: "claim_allowance_evaluated",
      severity: readiness.ready ? "info" : "warning",
      snapshotId: currentSnapshot.snapshotId,
      decision: currentSnapshot.decision,
      status: currentSnapshot.status,
      blockerCount: readiness.blockedBy.length
    },
    {
      ...base,
      eventType: "claim_allowance_evidence_state",
      severity: validationSummary.valid ? "info" : "warning",
      acceptedCount: validationSummary.acceptedEvidenceTypes.length,
      missingCount: validationSummary.missingEvidenceTypes.length,
      rejectedCount: validationSummary.rejectedEvidenceIds.length,
      verifierEvidenceCount: validationSummary.evidenceTruthGate.verifierEvidenceIds.length,
      truthBoundaryViolationCount: validationSummary.evidenceTruthGate.truthBoundaryViolations.length,
      requiredEvidenceConsensusState: validationSummary.requiredEvidenceConsensus.state,
      requiredEvidenceConsensusBlockers: validationSummary.requiredEvidenceConsensus.blockers,
      contradictionCount: validationSummary.evidenceTruthGate.contradictions.self.length
        + validationSummary.evidenceTruthGate.contradictions.identity.length
        + validationSummary.evidenceTruthGate.contradictions.type.length
        + validationSummary.evidenceTruthGate.contradictions.boundary.length,
      truthGateState: validationSummary.evidenceTruthGate.state,
      acceptedAdded: deltas.acceptedEvidenceDelta.added,
      missingCleared: deltas.missingEvidenceDelta.cleared,
      rejectedAdded: deltas.rejectedEvidenceDelta.added
    },
    {
      ...base,
      eventType: "claim_allowance_boundary_state",
      severity: boundaryDecision.scoped ? "info" : "error",
      status: boundaryDecision.status,
      tenantId: boundaryDecision.tenant.expectedTenantId,
      workspaceId: boundaryDecision.workspace.expectedWorkspaceId,
      blockerAdded: deltas.boundaryBlockerDelta.added,
      blockerCleared: deltas.boundaryBlockerDelta.cleared
    },
    {
      ...base,
      eventType: "claim_allowance_lifecycle_state",
      severity: lifecycleGate.status === "enabled" ? "info" : "warning",
      status: lifecycleGate.status,
      commandName: lifecycleGate.command.name,
      scheduleMode: lifecycleGate.scheduling.mode,
      dueAt: lifecycleGate.scheduling.dueAt,
      blockerAdded: deltas.lifecycleBlockerDelta.added,
      blockerCleared: deltas.lifecycleBlockerDelta.cleared
    },
    {
      ...base,
      eventType: "claim_allowance_provider_state",
      severity: providerNegotiation.negotiated ? "info" : "error",
      status: providerNegotiation.negotiated ? "negotiated" : "blocked",
      missingCapabilityCount: providerNegotiation.missingCapabilities.length,
      unavailableProviderCount: providerNegotiation.unavailableProviderIds.length,
      serviceContractSyncStatus: providerNegotiation.serviceContractNegotiation.syncMetadata.status,
      namespaceBoundaryState: providerNegotiation.providerNamespaceBoundary.state,
      externalHandoffState: providerNegotiation.externalHandoffState.state,
      providerFailureState: providerNegotiation.providerFailureState.state,
      providerRetryable: providerNegotiation.providerFailureState.retryWindow.retryable,
      providerRetryAfter: providerNegotiation.providerFailureState.retryWindow.nextRetryAfter,
      providerIncidentIds: providerNegotiation.providerFailureState.incidents.map((incident) => incident.incidentId),
      blockerAdded: deltas.providerBlockerDelta.added,
      blockerCleared: deltas.providerBlockerDelta.cleared
    },
    {
      ...base,
      eventType: "claim_allowance_operational_state",
      severity: operationalHealth.blocked ? "error" : operationalHealth.degraded ? "warning" : "info",
      status: operationalHealth.status,
      failureState: operationalHealth.failureState.state,
      failureSeverity: operationalHealth.failureState.severity,
      incidentIds: operationalHealth.failureState.incidents.map((incident) => incident.incidentId),
      operatorActionIds: operationalHealth.failureState.operatorActions.map((action) => action.actionId),
      retryable: operationalHealth.retryPlan.retryable,
      retryAfter: operationalHealth.retryPlan.retryAfter,
      actionableErrorCodes: operationalHealth.actionableErrors.map((error) => error.code)
    }
  ];

  return events.map((event, index) => ({
    eventId: `${currentSnapshot.snapshotId}:event-${index + 1}:${event.eventType}`,
    contractType: "claim-allowance-analytics-event-v1",
    ...event
  }));
}

function buildExportRows({ events, deltas, timeline, counters }) {
  const eventRows = events.map((event) => ({
    rowType: "event",
    rowId: event.eventId,
    emittedAt: event.emittedAt,
    claimId: event.claimId,
    eventType: event.eventType,
    severity: event.severity,
    status: event.status || event.decision || null,
    blockerCount: Number.isFinite(event.blockerCount) ? event.blockerCount : null,
    payload: event
  }));
  const deltaRows = [
    ["blocker_added", deltas.blockerDelta.added],
    ["blocker_cleared", deltas.blockerDelta.cleared],
    ["missing_evidence_added", deltas.missingEvidenceDelta.added],
    ["missing_evidence_cleared", deltas.missingEvidenceDelta.cleared],
    ["accepted_evidence_added", deltas.acceptedEvidenceDelta.added],
    ["provider_blocker_added", deltas.providerBlockerDelta.added],
    ["boundary_blocker_added", deltas.boundaryBlockerDelta.added],
    ["lifecycle_blocker_added", deltas.lifecycleBlockerDelta.added],
    ["lifecycle_blocker_cleared", deltas.lifecycleBlockerDelta.cleared]
  ].flatMap(([rowType, values]) => values.map((value) => ({
    rowType,
    rowId: `${timeline.currentSnapshotId}:${rowType}:${value}`,
    emittedAt: events[0] ? events[0].emittedAt : null,
    claimId: events[0] ? events[0].claimId : null,
    eventType: rowType,
    severity: rowType.endsWith("_cleared") ? "info" : "warning",
    status: value,
    blockerCount: counters.held,
    payload: { value, currentSnapshotId: timeline.currentSnapshotId, comparedSnapshotId: deltas.comparedSnapshotId }
  })));

  return {
    contractType: "claim-allowance-export-rows-v1",
    rowCount: eventRows.length + deltaRows.length,
    columns: ["rowType", "rowId", "emittedAt", "claimId", "eventType", "severity", "status", "blockerCount", "payload"],
    rows: [...eventRows, ...deltaRows]
  };
}

function buildExportSummary({ claim, requestContext, readiness, validationSummary, operationalHealth, providerNegotiation, boundaryDecision, lifecycleGate, counters, timeline, deltas, events, exportRows, proof, now }) {
  return {
    exportType: "claim-allowance-analytics-summary-v1",
    generatedAt: now,
    surfaceId,
    route: requestContext.route,
    claim: {
      claimId: claim.id,
      subject: claim.subject,
      requestedBy: claim.requestedBy,
      action: claim.action
    },
    decision: readiness.ready ? "allow" : "hold",
    readinessState: readiness.state,
    blockerCount: readiness.blockedBy.length,
    evidenceSummary: {
      acceptedTypes: validationSummary.acceptedEvidenceTypes,
      missingTypes: validationSummary.missingEvidenceTypes,
      rejectedIds: validationSummary.rejectedEvidenceIds,
      requiredEvidenceConsensusState: validationSummary.requiredEvidenceConsensus.state,
      requiredEvidenceConsensusKey: validationSummary.requiredEvidenceConsensus.consensusKey,
      requiredEvidenceConsensusBlockers: validationSummary.requiredEvidenceConsensus.blockers,
      truthGateState: validationSummary.evidenceTruthGate.state,
      verifierEvidenceIds: validationSummary.evidenceTruthGate.verifierEvidenceIds,
      truthBoundaryViolationIds: validationSummary.evidenceTruthGate.truthBoundaryViolations.map((entry) => entry.evidenceId),
      contradictionBlockers: validationSummary.evidenceTruthGate.blockers.filter((blocker) => blocker.includes("contradiction"))
    },
    operationalSummary: {
      status: operationalHealth.status,
      degraded: operationalHealth.degraded,
      retryable: operationalHealth.retryPlan.retryable,
      actionableErrorCodes: operationalHealth.actionableErrors.map((error) => error.code),
      failureState: {
        contractType: operationalHealth.failureState.contractType,
        state: operationalHealth.failureState.state,
        severity: operationalHealth.failureState.severity,
        incidentCount: operationalHealth.failureState.incidents.length,
        operatorActionCount: operationalHealth.failureState.operatorActions.length,
        retryAfter: operationalHealth.failureState.retryWindow.retryAfter,
        issueAllowed: operationalHealth.failureState.issueGuard.issueAllowed
      }
    },
    boundarySummary: {
      status: boundaryDecision.status,
      tenantId: boundaryDecision.tenant.expectedTenantId,
      workspaceId: boundaryDecision.workspace.expectedWorkspaceId,
      principalId: boundaryDecision.principal.id,
      matchedRoles: boundaryDecision.authorization.matchedRoles,
      missingPermissions: boundaryDecision.authorization.missingPermissions,
      delegation: {
        required: boundaryDecision.delegationBoundary.required,
        authorized: boundaryDecision.delegationBoundary.authorized,
        applicableDelegationIds: boundaryDecision.delegationBoundary.applicableDelegationIds,
        proofComplete: boundaryDecision.delegationBoundary.proofComplete,
        auditHandoffState: boundaryDecision.delegationBoundary.auditHandoff.state
      },
      boundaryAuditHandoff: {
        contractType: boundaryDecision.auditHandoff.contractType,
        state: boundaryDecision.auditHandoff.state,
        safeForProviderHandoff: boundaryDecision.auditHandoff.safeForProviderHandoff,
        boundaryKey: boundaryDecision.auditHandoff.boundaryKey,
        dispatchAllowed: boundaryDecision.auditHandoff.providerHandoffGuard.dispatchAllowed,
        evidenceRefCount: boundaryDecision.auditHandoff.evidenceRefs.length
      },
      blockers: boundaryDecision.blockers
    },
    providerSummary: {
      negotiated: providerNegotiation.negotiated,
      missingCapabilities: providerNegotiation.missingCapabilities,
      unavailableProviderIds: providerNegotiation.unavailableProviderIds,
      serviceContracts: {
        negotiated: providerNegotiation.serviceContractNegotiation.negotiated,
        missingOperations: providerNegotiation.serviceContractNegotiation.missingOperations,
        operationCapabilityStates: providerNegotiation.serviceContractNegotiation.operationCapabilityStates,
        invalidContractIds: providerNegotiation.serviceContractNegotiation.invalidContracts.map((contract) => contract.contractId),
        syncStatus: providerNegotiation.serviceContractNegotiation.syncMetadata.status,
        boundOperationCount: providerNegotiation.serviceContractNegotiation.dispatchManifest.boundOperationCount
      },
      namespaceBoundary: {
        state: providerNegotiation.providerNamespaceBoundary.state,
        safeForDispatch: providerNegotiation.providerNamespaceBoundary.safeForDispatch,
        blockedProviderIds: providerNegotiation.providerNamespaceBoundary.blockedProviderIds,
        blockedBindingIds: providerNegotiation.providerNamespaceBoundary.blockedBindingIds,
        evidenceRefCount: providerNegotiation.providerNamespaceBoundary.auditHandoff.evidenceRefs.length
      },
      dispatchManifest: providerNegotiation.serviceContractNegotiation.dispatchManifest,
      externalHandoffState: providerNegotiation.externalHandoffState.state,
      failureState: {
        contractType: providerNegotiation.providerFailureState.contractType,
        state: providerNegotiation.providerFailureState.state,
        issueDispatchAllowed: providerNegotiation.providerFailureState.dispatchGuard.issueDispatchAllowed,
        retryAfter: providerNegotiation.providerFailureState.retryWindow.nextRetryAfter,
        incidentCount: providerNegotiation.providerFailureState.incidents.length,
        operatorActionCount: providerNegotiation.providerFailureState.operatorActions.length
      }
    },
    lifecycleSummary: {
      status: lifecycleGate.status,
      enabled: lifecycleGate.enabled,
      commandAllowed: lifecycleGate.command.allowed,
      scheduleMode: lifecycleGate.scheduling.mode,
      dueAt: lifecycleGate.scheduling.dueAt,
      blockers: lifecycleGate.blockers
    },
    counters,
    deltaSummary: {
      decisionChanged: deltas.decisionChanged,
      statusChanged: deltas.statusChanged,
      blockerAddedCount: deltas.blockerDelta.added.length,
      blockerClearedCount: deltas.blockerDelta.cleared.length,
      acceptedEvidenceAddedCount: deltas.acceptedEvidenceDelta.added.length,
      missingEvidenceClearedCount: deltas.missingEvidenceDelta.cleared.length
    },
    eventSummary: {
      eventCount: events.length,
      exportRowCount: exportRows.rowCount,
      severities: events.reduce((counts, event) => ({
        ...counts,
        [event.severity]: (counts[event.severity] || 0) + 1
      }), {})
    },
    timeline: {
      currentSnapshotId: timeline.currentSnapshotId,
      previousSnapshotId: timeline.previousSnapshotId,
      firstHeldAt: timeline.firstHeldAt,
      firstAllowedAt: timeline.firstAllowedAt,
      lastTransitionAt: timeline.lastTransitionAt
    },
    proofId: proof.proofId
  };
}

function normalizeAnalyticsExportRequest(input, requestContext) {
  const rawExport = input.analyticsExport && typeof input.analyticsExport === "object"
    ? input.analyticsExport
    : input.exportRequest && typeof input.exportRequest === "object"
      ? input.exportRequest
      : {};
  const format = normalizeText(rawExport.format || rawExport.type).toLowerCase() || "json";
  const redactionMode = normalizeText(rawExport.redactionMode || rawExport.redaction || rawExport.visibility).toLowerCase() || "tenant-safe";
  const requestedSince = normalizeText(rawExport.since || rawExport.from || rawExport.windowStart);
  const requestedUntil = normalizeText(rawExport.until || rawExport.to || rawExport.windowEnd);
  const includeRows = rawExport.includeRows !== false;
  const includeEvents = rawExport.includeEvents !== false;
  const includeTimeline = rawExport.includeTimeline !== false;
  const destination = rawExport.destination && typeof rawExport.destination === "object" ? rawExport.destination : {};
  const invalidFields = [
    ...(!ANALYTICS_EXPORT_FORMATS.has(format) ? ["format"] : []),
    ...(!ANALYTICS_REDACTION_MODES.has(redactionMode) ? ["redactionMode"] : []),
    ...(requestedSince && !Number.isFinite(Date.parse(requestedSince)) ? ["since"] : []),
    ...(requestedUntil && !Number.isFinite(Date.parse(requestedUntil)) ? ["until"] : [])
  ];

  return {
    contractType: "claim-allowance-analytics-export-request-v1",
    requestedBy: normalizeText(rawExport.requestedBy || requestContext.clientId),
    format: ANALYTICS_EXPORT_FORMATS.has(format) ? format : "json",
    requestedFormat: format,
    redactionMode: ANALYTICS_REDACTION_MODES.has(redactionMode) ? redactionMode : "tenant-safe",
    includeRows,
    includeEvents,
    includeTimeline,
    since: requestedSince || null,
    until: requestedUntil || null,
    destination: {
      type: normalizeText(destination.type || rawExport.destinationType) || "client-download",
      uri: normalizeText(destination.uri || destination.url || rawExport.destinationUri),
      routeAction: normalizeText(destination.routeAction || rawExport.routeAction) || "verifier.claimAllowance.exportAnalytics",
      ackRequired: destination.ackRequired === true || rawExport.ackRequired === true
    },
    invalidFields
  };
}

function buildAnalyticsExportManifest({ input, claim, requestContext, command, readiness, timeline, events, exportRows, exportSummary, now }) {
  const exportRequest = normalizeAnalyticsExportRequest(input, requestContext);
  const tenantId = exportSummary.boundarySummary.tenantId || "tenant-missing";
  const workspaceId = exportSummary.boundarySummary.workspaceId || "workspace-missing";
  const datasetId = `${surfaceId}:${tenantId}:${workspaceId}:${claim.id}:analytics-export`;
  const selectedRows = exportRequest.includeRows ? exportRows.rows : [];
  const selectedEvents = exportRequest.includeEvents ? events : [];
  const selectedSnapshots = exportRequest.includeTimeline ? timeline.snapshots : [];
  const rowCount = selectedRows.length + selectedEvents.length + selectedSnapshots.length;
  const containsExternalDestination = exportRequest.destination.type !== "client-download" || Boolean(exportRequest.destination.uri);
  const blockers = [
    ...exportRequest.invalidFields.map((field) => `analytics_export_invalid:${field}`),
    ...(exportRequest.redactionMode === "none" && containsExternalDestination ? ["analytics_export_redaction_required"] : []),
    ...(rowCount === 0 ? ["analytics_export_empty"] : [])
  ];

  return {
    contractType: "claim-allowance-analytics-export-manifest-v1",
    manifestId: `${datasetId}:${command.commandId}`,
    generatedAt: now,
    datasetId,
    state: blockers.length === 0 ? "ready" : "blocked",
    exportAllowed: blockers.length === 0,
    request: exportRequest,
    partition: {
      tenantId,
      workspaceId,
      claimId: claim.id,
      decision: readiness.ready ? "allow" : "hold",
      snapshotId: timeline.currentSnapshotId,
      requestId: requestContext.requestId,
      commandId: command.commandId
    },
    schema: {
      format: exportRequest.format,
      rowContractType: exportRows.contractType,
      eventContractType: "claim-allowance-analytics-event-v1",
      summaryContractType: exportSummary.exportType,
      columns: exportRows.columns,
      primaryKeys: ["rowId", "eventId", "snapshotId"],
      redactionMode: exportRequest.redactionMode
    },
    files: [
      ...(exportRequest.includeRows ? [{
        fileId: `${datasetId}:rows`,
        logicalName: "claim-allowance-analytics-rows",
        format: exportRequest.format,
        rowCount: exportRows.rows.length,
        contentType: exportRequest.format === "csv" ? "text/csv" : "application/json",
        contractType: exportRows.contractType
      }] : []),
      ...(exportRequest.includeEvents ? [{
        fileId: `${datasetId}:events`,
        logicalName: "claim-allowance-analytics-events",
        format: exportRequest.format === "csv" ? "jsonl" : exportRequest.format,
        rowCount: events.length,
        contentType: "application/json",
        contractType: "claim-allowance-analytics-event-v1"
      }] : []),
      ...(exportRequest.includeTimeline ? [{
        fileId: `${datasetId}:timeline`,
        logicalName: "claim-allowance-history-timeline",
        format: "json",
        rowCount: timeline.snapshots.length,
        contentType: "application/json",
        contractType: "claim-allowance-history-timeline-v1"
      }] : [])
    ],
    retention: {
      policy: "claim-allowance-analytics-retention-v1",
      maxSnapshots: MAX_HISTORY_SNAPSHOTS,
      snapshotCount: timeline.snapshots.length,
      oldestSnapshotAt: timeline.snapshots[0] ? timeline.snapshots[0].evaluatedAt : null,
      newestSnapshotAt: timeline.snapshots[timeline.snapshots.length - 1] ? timeline.snapshots[timeline.snapshots.length - 1].evaluatedAt : null
    },
    delivery: {
      routeAction: exportRequest.destination.routeAction,
      destinationType: exportRequest.destination.type,
      destinationUri: exportRequest.redactionMode === "external" ? null : exportRequest.destination.uri || null,
      ackRequired: exportRequest.destination.ackRequired,
      idempotencyKey: `${command.idempotencyKey || command.commandId}:${timeline.currentSnapshotId}:analytics-export`,
      state: blockers.length === 0 ? "queued" : "held"
    },
    blockers
  };
}

function buildAllowanceEvaluationReportState({ validationSummary, readiness, providerNegotiation, boundaryDecision, lifecycleGate, operationalHealth, timeline, deltas, counters, exportManifest }) {
  const truthGate = validationSummary.evidenceTruthGate;
  const contradictionCount = truthGate.contradictions.self.length
    + truthGate.contradictions.identity.length
    + truthGate.contradictions.type.length
    + truthGate.contradictions.boundary.length;
  const verifierEvidenceRequiredTypes = validationSummary.requiredEvidenceQuorum
    .filter((entry) => entry.status === "accepted_without_verifier_evidence")
    .map((entry) => entry.type);
  const blockerGroups = summarizeBlockersByGroup(readiness.blockedBy);
  const historicalHeldCount = timeline.snapshots.filter((snapshot) => snapshot.decision === "hold").length;
  const historicalAllowedCount = timeline.snapshots.filter((snapshot) => snapshot.decision === "allow").length;
  const reportBlockers = [
    ...(truthGate.state !== "clear" ? ["report_truth_gate_blocked"] : []),
    ...(verifierEvidenceRequiredTypes.length > 0 ? ["report_verifier_evidence_incomplete"] : []),
    ...(validationSummary.requiredEvidenceConsensus.state !== "agreed" ? ["report_required_evidence_consensus_not_agreed"] : []),
    ...(contradictionCount > 0 ? ["report_contradictions_present"] : []),
    ...(!boundaryDecision.auditHandoff.safeForProviderHandoff ? ["report_boundary_handoff_not_safe"] : []),
    ...(!providerNegotiation.providerNamespaceBoundary.safeForDispatch ? ["report_provider_namespace_not_safe"] : []),
    ...(!lifecycleGate.canHandoff ? ["report_lifecycle_handoff_blocked"] : []),
    ...(!operationalHealth.failureState.issueGuard.issueAllowed ? ["report_operational_issue_guard_blocked"] : []),
    ...(!exportManifest.exportAllowed ? exportManifest.blockers.map((blocker) => `report_${blocker}`) : [])
  ];

  return {
    contractType: "claim-allowance-evaluation-report-state-v1",
    state: readiness.ready && reportBlockers.length === 0
      ? "allowance_report_ready"
      : readiness.ready
        ? "allowance_ready_report_limited"
        : "allowance_report_blocked",
    decision: readiness.ready ? "allow" : "hold",
    qualityCounters: {
      verifierEvidenceRequiredTypes: verifierEvidenceRequiredTypes.length,
      verifierPolicyViolations: truthGate.verifierPolicyViolations.length,
      truthBoundaryViolations: truthGate.truthBoundaryViolations.length,
      contradictions: contradictionCount,
      requiredEvidenceConsensusBlockers: validationSummary.requiredEvidenceConsensus.blockers.length,
      boundaryBlockers: boundaryDecision.blockers.length,
      providerBlockers: providerNegotiation.blockers.length,
      lifecycleBlockers: lifecycleGate.blockers.length,
      operationalIncidents: operationalHealth.failureState.incidents.length,
      exportBlockers: exportManifest.blockers.length
    },
    historyCounters: {
      snapshotCount: timeline.snapshots.length,
      historicalHeldCount,
      historicalAllowedCount,
      evaluations: counters.evaluations,
      held: counters.held,
      allowed: counters.allowed
    },
    timelineState: {
      currentSnapshotId: timeline.currentSnapshotId,
      previousSnapshotId: timeline.previousSnapshotId,
      decisionChanged: deltas.decisionChanged,
      blockerAddedCount: deltas.blockerDelta.added.length,
      blockerClearedCount: deltas.blockerDelta.cleared.length,
      firstHeldAt: timeline.firstHeldAt,
      firstAllowedAt: timeline.firstAllowedAt,
      lastTransitionAt: timeline.lastTransitionAt
    },
    blockerGroups,
    exportState: {
      allowed: exportManifest.exportAllowed,
      manifestId: exportManifest.manifestId,
      datasetId: exportManifest.datasetId,
      deliveryState: exportManifest.delivery.state,
      fileCount: exportManifest.files.length,
      blockers: exportManifest.blockers
    },
    reportBlockers: [...new Set(reportBlockers)]
  };
}

function buildAnalyticsReport({ input, claim, evidence, readiness, validationSummary, operationalHealth, providerNegotiation, boundaryDecision, lifecycleGate, persistedState, requestContext, command, recoveryPlan, proof, now }) {
  const history = normalizeHistorySnapshots(input, persistedState);
  const currentSnapshot = buildCurrentHistorySnapshot({
    claim,
    readiness,
    validationSummary,
    operationalHealth,
    boundaryDecision,
    lifecycleGate,
    proof,
    command,
    now
  });
  const timeline = buildTimeline({ history, currentSnapshot, recoveryPlan, now });
  const previousSnapshot = timeline.previousSnapshotId
    ? timeline.snapshots.find((snapshot) => snapshot.snapshotId === timeline.previousSnapshotId)
    : null;
  const deltas = buildAnalyticsDeltas({ previousSnapshot, currentSnapshot });
  const counters = buildAnalyticsCounters({
    evidence,
    validationSummary,
    readiness,
    operationalHealth,
    providerNegotiation,
    boundaryDecision,
    lifecycleGate,
    persistedState,
    history: timeline.snapshots
  });
  const events = buildAnalyticsEvents({
    claim,
    requestContext,
    command,
    readiness,
    validationSummary,
    operationalHealth,
    providerNegotiation,
    boundaryDecision,
    lifecycleGate,
    currentSnapshot,
    deltas,
    now
  });
  const exportRows = buildExportRows({ events, deltas, timeline, counters });
  const exportSummary = buildExportSummary({
    claim,
    requestContext,
    readiness,
    validationSummary,
    operationalHealth,
    providerNegotiation,
    boundaryDecision,
    lifecycleGate,
    counters,
    timeline,
    deltas,
    events,
    exportRows,
    proof,
    now
  });
  const exportManifest = buildAnalyticsExportManifest({
    input,
    claim,
    requestContext,
    command,
    readiness,
    timeline,
    events,
    exportRows,
    exportSummary,
    now
  });
  const evaluationReportState = buildAllowanceEvaluationReportState({
    validationSummary,
    readiness,
    providerNegotiation,
    boundaryDecision,
    lifecycleGate,
    operationalHealth,
    timeline,
    deltas,
    counters,
    exportManifest
  });

  return {
    counters,
    deltas,
    events,
    exportRows,
    exportManifest,
    evaluationReportState,
    currentSnapshot,
    history: timeline.snapshots,
    timeline,
    exportSummary
  };
}

function buildPersistedStatePatch({ claim, readiness, validationSummary, readinessRouteSnapshot, clientRuntimeAdoption, requestContext, command, recoveryPlan, commandPersistence, proof, hostedKernelIssue, operationalHealth, providerNegotiation, boundaryDecision, lifecycleGate, lifecycleCommandApplication, analyticsReport, now }) {
  return {
    version: PERSISTED_STATE_VERSION,
    surfaceId,
    claimId: claim.id,
    subject: claim.subject,
    status: recoveryPlan.nextStatus,
    decision: readiness.ready ? "allow" : "hold",
    decisionToken: `${surfaceId}:${claim.id}:${readiness.ready ? "ready" : "hold"}`,
    lastCommandId: command.commandId,
    idempotencyKey: command.idempotencyKey,
    commandStatus: commandPersistence.status,
    commandStatusId: commandPersistence.commandStatusId,
    lastEvaluatedAt: now,
    requestId: requestContext.requestId,
    sessionId: requestContext.sessionId,
    clientId: requestContext.clientId,
    tenantId: boundaryDecision.tenant.expectedTenantId,
    workspaceId: boundaryDecision.workspace.expectedWorkspaceId,
    principalId: boundaryDecision.principal.id,
    blockedBy: readiness.blockedBy,
    missingEvidenceTypes: validationSummary.missingEvidenceTypes,
    unsatisfiedRequiredEvidenceTypes: validationSummary.unsatisfiedRequiredEvidence.map((entry) => entry.type),
    requiredEvidenceQuorum: validationSummary.requiredEvidenceQuorum,
    rejectedEvidenceIds: validationSummary.rejectedEvidenceIds,
    acceptedEvidenceTypes: validationSummary.acceptedEvidenceTypes,
    requiredEvidenceConsensus: validationSummary.requiredEvidenceConsensus,
    evidenceAcceptanceReview: validationSummary.evidenceAcceptanceReview,
    evidenceTruthGate: validationSummary.evidenceTruthGate,
    issuedAt: readiness.ready ? now : null,
    issuedProofId: readiness.ready ? proof.proofId : null,
    hostedKernelIssue: {
      contractType: hostedKernelIssue.contractType,
      envelopeId: hostedKernelIssue.envelopeId,
      status: hostedKernelIssue.status,
      enabled: hostedKernelIssue.enabled,
      deliveryMode: hostedKernelIssue.delivery.mode,
      routeAction: hostedKernelIssue.delivery.routeAction,
      providerId: hostedKernelIssue.delivery.providerId,
      correlationId: hostedKernelIssue.delivery.correlationId,
      handoffLedgerId: hostedKernelIssue.handoffLedger.ledgerId,
      handoffLedgerState: hostedKernelIssue.handoffLedger.state,
      pendingProviderAckIds: hostedKernelIssue.handoffLedger.pendingAckIds,
      providerHandoffReplayKey: hostedKernelIssue.handoffLedger.replayKey,
      proofId: hostedKernelIssue.proofOutput.proofId,
      blockers: hostedKernelIssue.blockers
    },
    clientRuntimeAdoption: {
      contractType: clientRuntimeAdoption.contractType,
      adoptionId: clientRuntimeAdoption.adoptionId,
      state: clientRuntimeAdoption.state,
      canAdopt: clientRuntimeAdoption.canAdopt,
      runtimeId: clientRuntimeAdoption.runtime.runtimeId,
      selectedRouteAction: clientRuntimeAdoption.selectedRouteAction,
      selectedStage: clientRuntimeAdoption.workflowAdoptionPlan.selectedStage,
      missingContracts: clientRuntimeAdoption.missingContracts,
      unsupportedRouteActions: clientRuntimeAdoption.unsupportedRouteActions,
      queueState: clientRuntimeAdoption.handoffQueue.queueState,
      workflowAdoptionState: clientRuntimeAdoption.workflowAdoptionPlan.state,
      workflowAdoptionBlockers: clientRuntimeAdoption.workflowAdoptionPlan.blockers,
      blockers: clientRuntimeAdoption.blockers
    },
    lifecycleSettings: lifecycleGate.settings,
    lifecycleCommandApplication,
    lifecycleNextActionState: lifecycleCommandApplication.nextActionState,
    lifecycleControls: {
      contractType: lifecycleGate.contractType,
      status: lifecycleGate.status,
      enabled: lifecycleGate.enabled,
      canEvaluate: lifecycleGate.canEvaluate,
      canAccept: lifecycleGate.canAccept,
      canHandoff: lifecycleGate.canHandoff,
      scheduling: lifecycleGate.scheduling,
      nextActionState: lifecycleCommandApplication.nextActionState,
      commandApplicationId: lifecycleCommandApplication.applicationId,
      command: lifecycleGate.command,
      blockers: lifecycleGate.blockers
    },
    readinessRouteSnapshot,
    restartSafe: recoveryPlan.restartSafe,
    recoveryAction: recoveryPlan.recoveryAction,
    recoveryStatus: recoveryPlan.recoveryStatus,
    recoveryBlockers: recoveryPlan.recoveryBlockers,
    commandPersistence,
    commandLedger: commandPersistence.commandLedger,
    operationalStatus: operationalHealth.status,
    degradedMode: operationalHealth.degradedMode,
    retryAfter: operationalHealth.retryPlan.retryAfter,
    actionableErrorCodes: operationalHealth.actionableErrors.map((error) => error.code),
    operationalFailureState: operationalHealth.failureState,
    boundary: {
      contractType: boundaryDecision.contractType,
      status: boundaryDecision.status,
      scoped: boundaryDecision.scoped,
      tenant: boundaryDecision.tenant,
      workspace: boundaryDecision.workspace,
      authorization: boundaryDecision.authorization,
      delegationBoundary: boundaryDecision.delegationBoundary,
      auditHandoff: boundaryDecision.auditHandoff,
      blockers: boundaryDecision.blockers
    },
    providerContract: {
      contractType: providerNegotiation.contractType,
      negotiated: providerNegotiation.negotiated,
      requiredCapabilities: providerNegotiation.requiredCapabilities,
      offeredCapabilities: providerNegotiation.offeredCapabilities,
      missingCapabilities: providerNegotiation.missingCapabilities,
      unavailableProviderIds: providerNegotiation.unavailableProviderIds,
      providerNamespaceBoundary: providerNegotiation.providerNamespaceBoundary,
      serviceContractNegotiation: providerNegotiation.serviceContractNegotiation,
      providerFailureState: providerNegotiation.providerFailureState,
      syncMetadata: providerNegotiation.syncMetadata,
      externalHandoffState: providerNegotiation.externalHandoffState,
      dispatchManifest: providerNegotiation.serviceContractNegotiation.dispatchManifest
    },
    analytics: {
      counters: analyticsReport.counters,
      deltas: analyticsReport.deltas,
      events: analyticsReport.events,
      exportRows: analyticsReport.exportRows,
      exportManifest: analyticsReport.exportManifest,
      evaluationReportState: analyticsReport.evaluationReportState,
      exportSummary: analyticsReport.exportSummary
    },
    history: analyticsReport.history
  };
}

function buildClientStatePatch({ claim, readiness, validationSummary, nextSteps, previewContract, acceptanceRouteContract, readinessRouteSnapshot, clientRuntimeAdoption, requestContext, clientState, command, recoveryPlan, commandPersistence, proof, hostedKernelIssue, operationalHealth, providerNegotiation, boundaryDecision, lifecycleGate, lifecycleCommandApplication, analyticsReport, now }) {
  const nextAction = nextSteps[0] || null;
  const persistedStatePatch = buildPersistedStatePatch({
    claim,
    readiness,
    validationSummary,
    readinessRouteSnapshot,
    clientRuntimeAdoption,
    requestContext,
    command,
    recoveryPlan,
    commandPersistence,
    proof,
    hostedKernelIssue,
    operationalHealth,
    providerNegotiation,
    boundaryDecision,
    lifecycleGate,
    lifecycleCommandApplication,
    analyticsReport,
    now
  });

  return {
    verifierClaimGate: {
      claimAllowance: {
        activeStep: readiness.ready ? "claim-allowance-issue" : DEFAULT_CLIENT_STEP,
        claimId: claim.id,
        subject: claim.subject,
        decision: readiness.ready ? "allow" : "hold",
        decisionToken: `${surfaceId}:${claim.id}:${readiness.ready ? "ready" : "hold"}`,
        lastEvaluatedAt: now,
        requestId: requestContext.requestId,
        sessionId: requestContext.sessionId,
        tenantId: boundaryDecision.tenant.expectedTenantId,
        workspaceId: boundaryDecision.workspace.expectedWorkspaceId,
        principalId: boundaryDecision.principal.id,
        selectedEvidence: clientState.selectedEvidence,
        missingEvidenceTypes: validationSummary.missingEvidenceTypes,
        unsatisfiedRequiredEvidenceTypes: validationSummary.unsatisfiedRequiredEvidence.map((entry) => entry.type),
        blockedBy: readiness.blockedBy,
        requiredEvidenceQuorum: validationSummary.requiredEvidenceQuorum,
        requiredEvidenceConsensus: validationSummary.requiredEvidenceConsensus,
        evidenceAcceptanceReview: validationSummary.evidenceAcceptanceReview,
        evidenceTruthGate: validationSummary.evidenceTruthGate,
        nextRouteAction: clientRuntimeAdoption.selectedRouteAction || (nextAction ? nextAction.routeAction : null),
        previewContract,
        acceptanceRouteContract,
        readinessRouteSnapshot,
        clientRuntimeAdoption,
        hostedKernelIssue,
        persistedState: persistedStatePatch,
        recoveryAction: recoveryPlan.recoveryAction,
        recoveryStatus: recoveryPlan.recoveryStatus,
        recoveryBlockers: recoveryPlan.recoveryBlockers,
        restartSafeStatus: recoveryPlan.nextStatus,
        idempotentReplay: recoveryPlan.idempotentReplay,
        lastCommandId: command.commandId,
        commandPersistence: {
          contractType: commandPersistence.contractType,
          commandStatusId: commandPersistence.commandStatusId,
          state: commandPersistence.state,
          status: commandPersistence.status,
          restartSafe: commandPersistence.restartSafe,
          idempotentReplay: commandPersistence.idempotentReplay,
          resultStatus: commandPersistence.resultStatus,
          recoveryStatus: commandPersistence.recoveryStatus,
          recoveryBlockers: commandPersistence.recoveryBlockers,
          replay: commandPersistence.replay,
          persistedStateShape: commandPersistence.persistedStateShape,
          currentEntry: commandPersistence.currentEntry
        },
        runtimeAdoption: {
          state: clientRuntimeAdoption.state,
          canAdopt: clientRuntimeAdoption.canAdopt,
          runtimeId: clientRuntimeAdoption.runtime.runtimeId,
          selectedRouteAction: clientRuntimeAdoption.selectedRouteAction,
          selectedStepId: clientRuntimeAdoption.selectedStepId,
          selectedStage: clientRuntimeAdoption.workflowAdoptionPlan.selectedStage,
          requestedRouteActions: clientRuntimeAdoption.requestedRouteActions,
          unsupportedRouteActions: clientRuntimeAdoption.unsupportedRouteActions,
          missingContracts: clientRuntimeAdoption.missingContracts,
          handoffQueue: clientRuntimeAdoption.handoffQueue,
          statePatchTarget: clientRuntimeAdoption.statePatchTarget,
          workflowAdoptionPlan: clientRuntimeAdoption.workflowAdoptionPlan,
          blockers: clientRuntimeAdoption.blockers
        },
        operationalHealth: {
          status: operationalHealth.status,
          degraded: operationalHealth.degraded,
          degradedMode: operationalHealth.degradedMode,
          retryable: operationalHealth.retryPlan.retryable,
          retryAfter: operationalHealth.retryPlan.retryAfter,
          actionableErrors: operationalHealth.actionableErrors,
          failureState: operationalHealth.failureState
        },
        boundary: {
          status: boundaryDecision.status,
          scoped: boundaryDecision.scoped,
          blockers: boundaryDecision.blockers,
          tenant: boundaryDecision.tenant,
          workspace: boundaryDecision.workspace,
          authorization: boundaryDecision.authorization,
          delegationBoundary: boundaryDecision.delegationBoundary,
          auditHandoff: boundaryDecision.auditHandoff
        },
        providerContract: {
          negotiated: providerNegotiation.negotiated,
          blockers: providerNegotiation.blockers,
          serviceContracts: {
            requiredOperations: providerNegotiation.serviceContractNegotiation.requiredOperations,
            offeredOperations: providerNegotiation.serviceContractNegotiation.offeredOperations,
            missingOperations: providerNegotiation.serviceContractNegotiation.missingOperations,
            operationCapabilityStates: providerNegotiation.serviceContractNegotiation.operationCapabilityStates,
            operationBindings: providerNegotiation.serviceContractNegotiation.operationBindings,
            dispatchManifest: providerNegotiation.serviceContractNegotiation.dispatchManifest,
            invalidContracts: providerNegotiation.serviceContractNegotiation.invalidContracts,
            syncMetadata: providerNegotiation.serviceContractNegotiation.syncMetadata
          },
          namespaceBoundary: providerNegotiation.providerNamespaceBoundary,
          failureState: providerNegotiation.providerFailureState,
          syncMetadata: providerNegotiation.syncMetadata,
          externalHandoffState: providerNegotiation.externalHandoffState,
          dispatchManifest: providerNegotiation.serviceContractNegotiation.dispatchManifest
        },
        lifecycleControls: {
          status: lifecycleGate.status,
          enabled: lifecycleGate.enabled,
          canEvaluate: lifecycleGate.canEvaluate,
          canAccept: lifecycleGate.canAccept,
          canHandoff: lifecycleGate.canHandoff,
          scheduling: lifecycleGate.scheduling,
          nextActionState: lifecycleCommandApplication.nextActionState,
          commandApplication: lifecycleCommandApplication,
          command: lifecycleGate.command,
          blockers: lifecycleGate.blockers,
          settings: lifecycleGate.settings
        },
        analytics: {
          counters: analyticsReport.counters,
          evaluationReportState: analyticsReport.evaluationReportState,
          currentSnapshotId: analyticsReport.currentSnapshot.snapshotId,
          deltaSummary: {
            comparedSnapshotId: analyticsReport.deltas.comparedSnapshotId,
            decisionChanged: analyticsReport.deltas.decisionChanged,
            blockerAdded: analyticsReport.deltas.blockerDelta.added,
            blockerCleared: analyticsReport.deltas.blockerDelta.cleared,
            missingEvidenceCleared: analyticsReport.deltas.missingEvidenceDelta.cleared,
            acceptedEvidenceAdded: analyticsReport.deltas.acceptedEvidenceDelta.added
          },
          recentEvents: analyticsReport.events.map((event) => ({
            eventId: event.eventId,
            eventType: event.eventType,
            severity: event.severity,
            emittedAt: event.emittedAt,
            status: event.status || event.decision || null
          })),
          exportManifest: analyticsReport.exportManifest,
          exportReady: analyticsReport.exportSummary,
          exportRows: analyticsReport.exportRows,
          timeline: {
            previousSnapshotId: analyticsReport.timeline.previousSnapshotId,
            firstHeldAt: analyticsReport.timeline.firstHeldAt,
            firstAllowedAt: analyticsReport.timeline.firstAllowedAt,
            lastTransitionAt: analyticsReport.timeline.lastTransitionAt
          }
        }
      }
    }
  };
}

function buildWorkflowHandoff({ claim, readiness, validationSummary, nextSteps, previewContract, acceptanceRouteContract, readinessRouteSnapshot, clientRuntimeAdoption, requestContext, clientState, command, recoveryPlan, commandPersistence, proof, hostedKernelIssue, operationalHealth, providerNegotiation, boundaryDecision, lifecycleGate, lifecycleCommandApplication, analyticsReport, now }) {
  const nextAction = nextSteps[0] || {
    id: "stay-on-claim-allowance",
    label: "Review claim allowance",
    routeAction: "verifier.claimAllowance.review",
    reason: "No follow-up action is available for the current claim allowance state."
  };
  const routeAction = clientState.handoffRoute || clientRuntimeAdoption.selectedRouteAction || nextAction.routeAction;
  const proofRequired = readiness.ready || validationSummary.acceptedEvidenceTypes.length > 0;

  return {
    id: `${claim.id}:${nextAction.id}`,
    label: nextAction.label,
    routeAction,
    route: requestContext.route,
    issuedAt: now,
    userVisibleState: readiness.ready ? "ready_to_issue" : "needs_attention",
    reason: nextAction.reason,
    payload: {
      surfaceId,
      claimId: claim.id,
      subject: claim.subject,
      requestedBy: claim.requestedBy,
      tenantId: boundaryDecision.tenant.expectedTenantId,
      workspaceId: boundaryDecision.workspace.expectedWorkspaceId,
      principalId: boundaryDecision.principal.id,
      decision: readiness.ready ? "allow" : "hold",
      blockedBy: readiness.blockedBy,
      missingEvidenceTypes: validationSummary.missingEvidenceTypes,
      rejectedEvidenceIds: validationSummary.rejectedEvidenceIds,
      acceptedEvidenceTypes: validationSummary.acceptedEvidenceTypes,
      evidenceAcceptanceReview: validationSummary.evidenceAcceptanceReview,
      evidenceTruthGate: validationSummary.evidenceTruthGate,
      requiredEvidenceConsensus: validationSummary.requiredEvidenceConsensus,
      proofFormat: clientState.proofFormat,
      proofRequired,
      previewContract,
      acceptanceRouteContract,
      readinessRouteSnapshot,
      clientRuntimeAdoption,
      proof,
      hostedKernelIssue,
      command,
      recovery: recoveryPlan,
      commandPersistence,
      operationalHealth: {
        status: operationalHealth.status,
        canIssue: operationalHealth.canIssue,
        degraded: operationalHealth.degraded,
        degradedMode: operationalHealth.degradedMode,
        retryPlan: operationalHealth.retryPlan,
        actionableErrors: operationalHealth.actionableErrors,
        failureState: operationalHealth.failureState
      },
      boundary: {
        status: boundaryDecision.status,
        scoped: boundaryDecision.scoped,
        blockers: boundaryDecision.blockers,
        tenant: boundaryDecision.tenant,
        workspace: boundaryDecision.workspace,
        authorization: boundaryDecision.authorization,
        delegationBoundary: boundaryDecision.delegationBoundary,
        auditHandoff: boundaryDecision.auditHandoff
      },
      providerContract: {
        negotiated: providerNegotiation.negotiated,
        requiredCapabilities: providerNegotiation.requiredCapabilities,
        missingCapabilities: providerNegotiation.missingCapabilities,
        serviceContractNegotiation: providerNegotiation.serviceContractNegotiation,
        namespaceBoundary: providerNegotiation.providerNamespaceBoundary,
        syncMetadata: providerNegotiation.syncMetadata,
        externalHandoffState: providerNegotiation.externalHandoffState,
        dispatchManifest: providerNegotiation.serviceContractNegotiation.dispatchManifest
      },
      lifecycleControls: {
        status: lifecycleGate.status,
        enabled: lifecycleGate.enabled,
        canEvaluate: lifecycleGate.canEvaluate,
        canAccept: lifecycleGate.canAccept,
        canHandoff: lifecycleGate.canHandoff,
        scheduling: lifecycleGate.scheduling,
        nextActionState: lifecycleCommandApplication.nextActionState,
        commandApplication: lifecycleCommandApplication,
        command: lifecycleGate.command,
        blockers: lifecycleGate.blockers
      },
      runtimeAdoption: {
        state: clientRuntimeAdoption.state,
        canAdopt: clientRuntimeAdoption.canAdopt,
        selectedRouteAction: clientRuntimeAdoption.selectedRouteAction,
        workflowAdoptionPlan: clientRuntimeAdoption.workflowAdoptionPlan,
        handoffQueue: clientRuntimeAdoption.handoffQueue,
        proofConsumer: clientRuntimeAdoption.proofConsumer,
        blockers: clientRuntimeAdoption.blockers
      },
      analytics: {
        summary: analyticsReport.exportSummary,
        evaluationReportState: analyticsReport.evaluationReportState,
        deltas: analyticsReport.deltas,
        events: analyticsReport.events,
        exportRows: analyticsReport.exportRows,
        exportManifest: analyticsReport.exportManifest
      }
    },
    clientStatePatch: buildClientStatePatch({
      claim,
      readiness,
      validationSummary,
      nextSteps,
      previewContract,
      acceptanceRouteContract,
      readinessRouteSnapshot,
      clientRuntimeAdoption,
      requestContext,
      clientState,
      command,
      recoveryPlan,
      commandPersistence,
      proof,
      hostedKernelIssue,
      operationalHealth,
      providerNegotiation,
      boundaryDecision,
      lifecycleGate,
      lifecycleCommandApplication,
      analyticsReport,
      now
    })
  };
}

function buildProof({ claim, readiness, validationSummary, evidence, providerNegotiation, boundaryDecision, now }) {
  const proofInputs = evidence
    .filter((entry) => entry.present)
    .map((entry) => ({
      id: entry.id,
      type: entry.type,
      ref: entry.ref,
      digest: entry.digest,
      proofRef: entry.proofRef,
      verifierId: entry.verifierId,
      accepted: entry.accepted
    }));

  return {
    proofId: `${surfaceId}:${claim.id}:${readiness.ready ? "ready" : "hold"}:${validationSummary.acceptedEvidenceTypes.join("+") || "no-evidence"}`,
    proofType: "claim-allowance-preview-v1",
    issuedAt: now,
    claimId: claim.id,
    decision: readiness.ready ? "allowance-ready" : "allowance-not-ready",
    validationHashInputs: {
      claimId: claim.id,
      subject: claim.subject,
      requestedBy: claim.requestedBy,
      tenantId: boundaryDecision.tenant.expectedTenantId,
      workspaceId: boundaryDecision.workspace.expectedWorkspaceId,
      principalId: boundaryDecision.principal.id,
      acceptedEvidenceTypes: validationSummary.acceptedEvidenceTypes
    },
    evidenceTruthGate: validationSummary.evidenceTruthGate,
    requiredEvidenceConsensus: validationSummary.requiredEvidenceConsensus,
    evidenceAcceptanceReview: validationSummary.evidenceAcceptanceReview,
    boundary: {
      contractType: boundaryDecision.contractType,
      scoped: boundaryDecision.scoped,
      status: boundaryDecision.status,
      blockers: boundaryDecision.blockers,
      authorization: boundaryDecision.authorization,
      delegationBoundary: boundaryDecision.delegationBoundary,
      auditHandoff: boundaryDecision.auditHandoff
    },
    providerContract: {
      contractType: providerNegotiation.contractType,
      negotiated: providerNegotiation.negotiated,
      requiredCapabilities: providerNegotiation.requiredCapabilities,
      offeredCapabilities: providerNegotiation.offeredCapabilities,
      requiredOperations: providerNegotiation.serviceContractNegotiation.requiredOperations,
      offeredOperations: providerNegotiation.serviceContractNegotiation.offeredOperations,
      missingOperations: providerNegotiation.serviceContractNegotiation.missingOperations,
      operationCapabilityStates: providerNegotiation.serviceContractNegotiation.operationCapabilityStates,
      operationBindings: providerNegotiation.serviceContractNegotiation.operationBindings,
      dispatchManifest: providerNegotiation.serviceContractNegotiation.dispatchManifest,
      namespaceBoundary: providerNegotiation.providerNamespaceBoundary,
      failureState: providerNegotiation.providerFailureState,
      invalidServiceContracts: providerNegotiation.serviceContractNegotiation.invalidContracts,
      syncStatus: providerNegotiation.syncMetadata.status,
      serviceContractSyncStatus: providerNegotiation.serviceContractNegotiation.syncMetadata.status,
      externalHandoffState: providerNegotiation.externalHandoffState.state
    },
    proofInputs
  };
}

function buildProviderHandoffLedger({ claim, readiness, requestContext, command, proof, providerNegotiation, lifecycleGate, now }) {
  const operationBindings = providerNegotiation.serviceContractNegotiation.operationBindings;
  const dispatchBindings = providerNegotiation.serviceContractNegotiation.dispatchManifest.bindings;
  const externalState = providerNegotiation.externalHandoffState;
  const operationReceipts = dispatchBindings.map((binding, index) => {
    const operationBinding = operationBindings.find((candidate) => candidate.operation === binding.operation) || {};
    const ackRequired = binding.ackMode === "external-ack" || Boolean(binding.endpoint);
    const blocked = binding.state !== "bound" || !lifecycleGate.canHandoff || !providerNegotiation.negotiated;
    const dispatchState = !readiness.ready
      ? "held"
      : blocked
        ? "blocked"
        : ackRequired
          ? "awaiting_external_ack"
          : "acknowledged";
    const ackId = `${externalState.correlationId}:${binding.operation || `operation-${index + 1}`}`;

    return {
      contractType: "claim-allowance-provider-operation-receipt-v1",
      receiptId: ackId,
      operation: binding.operation,
      providerId: binding.providerId,
      contractId: binding.contractId,
      routeAction: binding.routeAction,
      endpoint: binding.endpoint,
      ackMode: binding.ackMode,
      ackRequired,
      dispatchState,
      schemaVersion: binding.schemaVersion,
      syncCursor: binding.syncCursor,
      capabilityState: operationBinding.capabilityState || {
        requiredCapabilities: binding.requiredCapabilities || [],
        offeredCapabilities: binding.satisfiedCapabilities || [],
        missingCapabilities: binding.missingCapabilities || [],
        satisfied: asArray(binding.missingCapabilities).length === 0,
        state: asArray(binding.missingCapabilities).length === 0 ? "satisfied" : "missing_capability"
      },
      proofId: proof.proofId,
      decision: proof.decision,
      blockers: [
        ...(binding.state !== "bound" ? [`operation_not_bound:${binding.operation}`] : []),
        ...(!lifecycleGate.canHandoff ? ["lifecycle_handoff_disabled"] : []),
        ...(!providerNegotiation.negotiated ? ["provider_contract_not_negotiated"] : [])
      ],
      handoffPayload: {
        surfaceId,
        claimId: claim.id,
        decisionToken: `${surfaceId}:${claim.id}:${readiness.ready ? "ready" : "hold"}`,
        requestId: requestContext.requestId,
        commandId: command.commandId,
        idempotencyKey: command.idempotencyKey,
        correlationId: externalState.correlationId,
        proofId: proof.proofId,
        tenantId: proof.validationHashInputs.tenantId,
        workspaceId: proof.validationHashInputs.workspaceId,
        principalId: proof.validationHashInputs.principalId
      }
    };
  });
  const requiredProviderAcks = operationReceipts.filter((receipt) => receipt.ackRequired);
  const pendingProviderAcks = requiredProviderAcks.filter((receipt) => receipt.dispatchState === "awaiting_external_ack");
  const blockedReceipts = operationReceipts.filter((receipt) => receipt.dispatchState === "blocked");
  const syncCursorWatermark = providerNegotiation.serviceContractNegotiation.syncMetadata.cursors
    .map((cursor) => `${cursor.providerId}:${cursor.contractId}:${cursor.cursor || cursor.revision || "unversioned"}`)
    .sort()
    .join("|");
  const ledgerBlockers = [
    ...(!externalState.enabled ? ["external_handoff_not_configured"] : []),
    ...(readiness.ready && !externalState.ready ? ["external_handoff_not_ready"] : []),
    ...(!providerNegotiation.providerNamespaceBoundary.safeForDispatch ? ["provider_namespace_handoff_not_safe"] : []),
    ...blockedReceipts.flatMap((receipt) => receipt.blockers.map((blocker) => `${receipt.operation}:${blocker}`))
  ];

  return {
    contractType: "claim-allowance-provider-handoff-ledger-v1",
    ledgerId: `${surfaceId}:${claim.id}:${command.commandId}:provider-handoff-ledger`,
    generatedAt: now,
    state: !readiness.ready
      ? "held"
      : ledgerBlockers.length > 0
        ? "blocked"
        : pendingProviderAcks.length > 0
          ? "pending_provider_ack"
          : "acknowledged",
    correlationId: externalState.correlationId,
    providerId: externalState.providerId,
    endpoint: externalState.endpoint,
    method: externalState.method,
    externalState: externalState.state,
    syncCursorWatermark,
    dispatchManifestState: providerNegotiation.serviceContractNegotiation.dispatchManifest.state,
    requiredAckIds: requiredProviderAcks.map((receipt) => receipt.receiptId),
    pendingAckIds: pendingProviderAcks.map((receipt) => receipt.receiptId),
    acknowledgedIds: operationReceipts
      .filter((receipt) => receipt.dispatchState === "acknowledged")
      .map((receipt) => receipt.receiptId),
    receipts: operationReceipts,
    replayKey: `${command.idempotencyKey || command.commandId}:${proof.proofId}:${syncCursorWatermark || "no-sync-cursor"}`,
    blockers: ledgerBlockers
  };
}

function buildHostedKernelIssueEnvelope({ claim, evidence, readiness, validationSummary, requestContext, command, proof, providerNegotiation, boundaryDecision, lifecycleGate, operationalHealth, now }) {
  const boundServiceContracts = providerNegotiation.serviceContractNegotiation.operationBindings
    .filter((binding) => binding.state === "bound")
    .map((binding) => ({
      contractId: binding.contractId,
      providerId: binding.providerId,
      operation: binding.operation,
      routeAction: binding.routeAction,
      endpoint: binding.endpoint,
      ackMode: binding.ackMode,
      schemaVersion: binding.schemaVersion,
      inputContract: binding.inputContract,
      outputContract: binding.outputContract,
      capabilityState: binding.capabilityState,
      sync: binding.sync
    }));
  const issueContract = boundServiceContracts.find((contract) => contract.operation === "claimAllowance.issueProof") || null;
  const syncContract = boundServiceContracts.find((contract) => contract.operation === "claimAllowance.syncHandoff") || null;
  const reviewContract = boundServiceContracts.find((contract) => contract.operation === "claimAllowance.review") || null;
  const deliveryContract = issueContract || syncContract || reviewContract;
  const deliveryBlockers = [
    ...(!deliveryContract ? ["hosted_kernel_delivery_contract_missing"] : []),
    ...(!providerNegotiation.negotiated ? ["hosted_kernel_provider_contract_not_negotiated"] : []),
    ...(!providerNegotiation.providerNamespaceBoundary.safeForDispatch ? ["hosted_kernel_provider_namespace_not_scoped"] : []),
    ...(!operationalHealth.canIssue ? ["hosted_kernel_operational_issue_disabled"] : []),
    ...(!boundaryDecision.scoped ? ["hosted_kernel_boundary_not_scoped"] : []),
    ...(!boundaryDecision.auditHandoff.safeForProviderHandoff ? ["hosted_kernel_boundary_handoff_not_safe"] : []),
    ...(!lifecycleGate.canHandoff ? ["hosted_kernel_lifecycle_handoff_disabled"] : [])
  ];
  const enabled = readiness.ready && deliveryBlockers.length === 0;
  const evidenceRefs = evidence
    .filter((entry) => entry.present)
    .map((entry) => ({
      evidenceId: entry.id,
      type: entry.type,
      ref: entry.ref || null,
      digest: entry.digest || null,
      accepted: entry.accepted,
      rejected: entry.rejected
    }));
  const handoffLedger = buildProviderHandoffLedger({
    claim,
    readiness,
    requestContext,
    command,
    proof,
    providerNegotiation,
    lifecycleGate,
    now
  });

  return {
    contractType: "claim-allowance-hosted-kernel-issue-envelope-v1",
    envelopeId: `${surfaceId}:${claim.id}:${command.commandId}:hosted-kernel-issue`,
    generatedAt: now,
    status: enabled ? "ready_to_deliver" : readiness.ready ? "delivery_blocked" : "held",
    enabled,
    claim: {
      claimId: claim.id,
      subject: claim.subject,
      action: claim.action,
      requestedBy: claim.requestedBy,
      tenantId: boundaryDecision.tenant.expectedTenantId,
      workspaceId: boundaryDecision.workspace.expectedWorkspaceId,
      boundaryKey: boundaryDecision.auditHandoff.boundaryKey
    },
    decision: {
      value: readiness.ready ? "allow" : "hold",
      readinessState: readiness.state,
      decisionToken: `${surfaceId}:${claim.id}:${readiness.ready ? "ready" : "hold"}`,
      acceptedEvidenceTypes: validationSummary.acceptedEvidenceTypes,
      missingEvidenceTypes: validationSummary.missingEvidenceTypes,
      rejectedEvidenceIds: validationSummary.rejectedEvidenceIds,
      evidenceTruthGateState: validationSummary.evidenceTruthGate.state,
      evidenceTruthGateBlockers: validationSummary.evidenceTruthGate.blockers,
      evidenceAcceptanceReviewState: validationSummary.evidenceAcceptanceReview.state,
      evidenceAcceptanceReviewRequiredIds: validationSummary.evidenceAcceptanceReview.reviewRequiredIds,
      requiredEvidenceConsensusState: validationSummary.requiredEvidenceConsensus.state,
      requiredEvidenceConsensusBlockers: validationSummary.requiredEvidenceConsensus.blockers,
      blockedBy: readiness.blockedBy
    },
    proofOutput: {
      contractType: "claim-allowance-proof-output-v1",
      proofId: proof.proofId,
      proofType: proof.proofType,
      issuedAt: proof.issuedAt,
      decision: proof.decision,
      validationHashInputs: proof.validationHashInputs,
      evidenceRefs,
      evidenceTruthGate: validationSummary.evidenceTruthGate,
      providerHandoffLedgerId: handoffLedger.ledgerId,
      providerHandoffReplayKey: handoffLedger.replayKey,
      boundaryAuditHandoff: boundaryDecision.auditHandoff
    },
    delivery: {
      mode: providerNegotiation.externalHandoffState.enabled ? "external-provider" : "in-process",
      routeAction: deliveryContract ? deliveryContract.routeAction || "verifier.claimAllowance.issue" : "verifier.claimAllowance.review",
      providerId: deliveryContract ? deliveryContract.providerId : providerNegotiation.externalHandoffState.providerId,
      contractId: deliveryContract ? deliveryContract.contractId : null,
      operation: deliveryContract ? deliveryContract.operation : null,
      endpoint: deliveryContract ? deliveryContract.endpoint : providerNegotiation.externalHandoffState.endpoint,
      ackMode: deliveryContract ? deliveryContract.ackMode : "none",
      correlationId: providerNegotiation.externalHandoffState.correlationId,
      requestId: requestContext.requestId,
      commandId: command.commandId,
      idempotencyKey: command.idempotencyKey
    },
    syncOutput: {
      contractType: "claim-allowance-handoff-sync-output-v1",
      requiredOperations: providerNegotiation.serviceContractNegotiation.requiredOperations,
      boundContracts: boundServiceContracts,
      dispatchManifest: providerNegotiation.serviceContractNegotiation.dispatchManifest,
      syncMetadata: providerNegotiation.syncMetadata,
      serviceContractSyncMetadata: providerNegotiation.serviceContractNegotiation.syncMetadata,
      providerNamespaceBoundary: providerNegotiation.providerNamespaceBoundary,
      handoffLedger
    },
    auditOutput: {
      contractType: "claim-allowance-audit-proof-output-v1",
      principalId: boundaryDecision.principal.id,
      tenant: boundaryDecision.tenant,
      workspace: boundaryDecision.workspace,
      authorization: boundaryDecision.authorization,
      delegationBoundary: boundaryDecision.delegationBoundary,
      boundaryAuditHandoff: boundaryDecision.auditHandoff,
      providerContractStatus: providerNegotiation.negotiated ? "negotiated" : "blocked",
      providerNamespaceBoundary: providerNegotiation.providerNamespaceBoundary,
      providerFailureState: providerNegotiation.providerFailureState,
      providerHandoffLedger: {
        ledgerId: handoffLedger.ledgerId,
        state: handoffLedger.state,
        correlationId: handoffLedger.correlationId,
        requiredAckIds: handoffLedger.requiredAckIds,
        pendingAckIds: handoffLedger.pendingAckIds,
        replayKey: handoffLedger.replayKey,
        blockers: handoffLedger.blockers
      },
      evidenceTruthGate: validationSummary.evidenceTruthGate,
      operationalStatus: operationalHealth.status,
      operationalFailureState: operationalHealth.failureState,
      lifecycleStatus: lifecycleGate.status,
      lifecycleBlockers: lifecycleGate.blockers,
      generatedAt: now
    },
    handoffLedger,
    blockers: [...new Set([...deliveryBlockers, ...handoffLedger.blockers, ...readiness.blockedBy])]
  };
}

export function describeClaimAllowanceSurface(input = {}) {
  const now = input.now || new Date().toISOString();
  const requestContext = normalizeRequestContext(input);
  const command = normalizeCommand(input, requestContext);
  const clientState = normalizeClientState(input);
  const persistedState = normalizePersistedClaimAllowance(input);
  const claim = normalizeClaim(input);
  const evidence = normalizeEvidence(input.evidence);
  const requiredEvidence = asArray(input.requiredEvidence).length > 0
    ? asArray(input.requiredEvidence).map(normalizeText).filter(Boolean)
    : DEFAULT_REQUIRED_EVIDENCE;
  const verifierEvidencePolicy = normalizeVerifierEvidencePolicy(input);
  const operationalHealth = buildOperationalHealth(input, now);
  const providerContracts = normalizeProviderContracts(input);
  const boundaryDecision = buildBoundaryDecision({ input, claim, requestContext });
  const validationSummary = buildValidationSummary({
    claim,
    evidence,
    requiredEvidence,
    boundaryDecision,
    verifierEvidencePolicy
  });
  const providerNegotiation = buildProviderNegotiation({
    input,
    providers: providerContracts,
    claim,
    requestContext,
    command,
    boundaryDecision,
    now
  });
  const lifecycleSettings = normalizeLifecycleSettings(input, persistedState);
  const lifecycleCommandApplication = buildLifecycleCommandApplication({
    command,
    settings: lifecycleSettings,
    claim,
    requestContext,
    now
  });
  const lifecycleGate = {
    ...buildLifecycleGate({ command, settings: lifecycleCommandApplication.effectiveSettings, now }),
    commandApplication: lifecycleCommandApplication,
    nextActionState: lifecycleCommandApplication.nextActionState
  };
  const readiness = buildReadiness(validationSummary, input, operationalHealth, providerNegotiation, boundaryDecision, lifecycleGate);
  const nextSteps = buildNextSteps({ claim, readiness, validationSummary, operationalHealth, providerNegotiation, boundaryDecision, lifecycleGate });
  const decisionToken = `${surfaceId}:${claim.id}:${readiness.ready ? "ready" : "hold"}`;
  const previewContract = buildPreviewContract({
    claim,
    evidence,
    requiredEvidence,
    readiness,
    validationSummary,
    nextSteps,
    requestContext,
    command,
    decisionToken,
    operationalHealth,
    providerNegotiation,
    boundaryDecision,
    lifecycleGate,
    lifecycleCommandApplication,
    now
  });
  const acceptanceRouteContract = buildAcceptanceRouteContract({
    claim,
    readiness,
    validationSummary,
    nextSteps,
    requestContext,
    command,
    decisionToken,
    operationalHealth,
    providerNegotiation,
    boundaryDecision,
    lifecycleGate,
    lifecycleCommandApplication,
    now
  });
  const readinessRouteSnapshot = buildReadinessRouteSnapshot({
    claim,
    readiness,
    validationSummary,
    nextSteps,
    previewContract,
    acceptanceRouteContract,
    requestContext,
    command,
    decisionToken,
    operationalHealth,
    providerNegotiation,
    boundaryDecision,
    lifecycleGate,
    now
  });
  const proof = buildProof({ claim, readiness, validationSummary, evidence, providerNegotiation, boundaryDecision, now });
  const hostedKernelIssue = buildHostedKernelIssueEnvelope({
    claim,
    evidence,
    readiness,
    validationSummary,
    requestContext,
    command,
    proof,
    providerNegotiation,
    boundaryDecision,
    lifecycleGate,
    operationalHealth,
    now
  });
  const clientRuntimeAdoption = buildClientRuntimeAdoption({
    input,
    claim,
    readiness,
    nextSteps,
    previewContract,
    acceptanceRouteContract,
    readinessRouteSnapshot,
    hostedKernelIssue,
    requestContext,
    command,
    decisionToken,
    now
  });
  const recoveryPlan = buildRecoveryPlan({
    claim,
    readiness,
    validationSummary,
    persistedState,
    command,
    decisionToken,
    now
  });
  const commandPersistence = buildCommandPersistenceEnvelope({
    persistedState,
    claim,
    readiness,
    validationSummary,
    command,
    decisionToken,
    requestContext,
    recoveryPlan,
    proof,
    now
  });
  const analyticsReport = buildAnalyticsReport({
    input,
    claim,
    evidence,
    readiness,
    validationSummary,
    operationalHealth,
    providerNegotiation,
    boundaryDecision,
    lifecycleGate,
    persistedState,
    requestContext,
    command,
    recoveryPlan,
    proof,
    now
  });
  const workflowHandoff = buildWorkflowHandoff({
    claim,
    readiness,
    validationSummary,
    nextSteps,
    previewContract,
    acceptanceRouteContract,
    readinessRouteSnapshot,
    clientRuntimeAdoption,
    requestContext,
    clientState,
    command,
    recoveryPlan,
    commandPersistence,
    proof,
    hostedKernelIssue,
    operationalHealth,
    providerNegotiation,
    boundaryDecision,
    lifecycleGate,
    lifecycleCommandApplication,
    analyticsReport,
    now
  });

  return {
    ok: readiness.ready,
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: "hosted-kernel claim allowance preview and acceptance contract v1",
    preview: {
      claim,
      decision: readiness.ready ? "allow" : "hold",
      userVisibleStatus: readiness.ready
        ? "Claim allowance is ready to issue."
        : "Claim allowance needs more validation before it can be issued.",
      evidenceCount: evidence.length,
      requiredEvidence,
      contract: previewContract
    },
    previewContract,
    readinessRouteSnapshot,
    requestContext,
    clientState: {
      ...clientState,
      patch: workflowHandoff.clientStatePatch
    },
    acceptance: {
      accepted: readiness.allowanceAccepted,
      required: readiness.manualApprovalRequired,
      acceptedAt: readiness.allowanceAccepted ? now : null,
      decisionToken,
      routeContract: acceptanceRouteContract
    },
    command,
    persistence: {
      prior: persistedState,
      recovery: recoveryPlan,
      recoveryStatus: recoveryPlan.recoveryStatus,
      commandPersistence,
      next: workflowHandoff.clientStatePatch.verifierClaimGate.claimAllowance.persistedState
    },
    readiness,
    operationalHealth,
    lifecycleControls: lifecycleGate,
    lifecycleCommandApplication,
    boundary: boundaryDecision,
    providerContract: providerNegotiation,
    validationSummary,
    analytics: analyticsReport,
    nextSteps,
    workflowHandoff,
    hostedKernelIssue,
    clientRuntimeAdoption,
    audit: {
      route: claim.route || `${surfaceGroup}/${surfaceName}`,
      actor: claim.requestedBy || "unknown",
      requestContext,
      clientStatePatch: workflowHandoff.clientStatePatch,
      handoff: {
        id: workflowHandoff.id,
        routeAction: workflowHandoff.routeAction,
        userVisibleState: workflowHandoff.userVisibleState
      },
      command,
      persistence: {
        priorStatus: persistedState.status || null,
        nextStatus: recoveryPlan.nextStatus,
        recoveryAction: recoveryPlan.recoveryAction,
        idempotentReplay: recoveryPlan.idempotentReplay,
        restartSafe: recoveryPlan.restartSafe,
        recoveryStatus: recoveryPlan.recoveryStatus,
        recoveryBlockers: recoveryPlan.recoveryBlockers,
        commandStatusId: commandPersistence.commandStatusId,
        commandStatus: commandPersistence.status,
        ledgerSize: commandPersistence.commandLedger.length,
        replay: commandPersistence.replay
      },
      operationalHealth: {
        status: operationalHealth.status,
        blocked: operationalHealth.blocked,
        degraded: operationalHealth.degraded,
        degradedMode: operationalHealth.degradedMode,
        retryPlan: operationalHealth.retryPlan,
        actionableErrors: operationalHealth.actionableErrors,
        dependencies: operationalHealth.dependencies,
        failureState: operationalHealth.failureState
      },
      boundary: {
        contractType: boundaryDecision.contractType,
        status: boundaryDecision.status,
        scoped: boundaryDecision.scoped,
        principal: boundaryDecision.principal,
        tenant: boundaryDecision.tenant,
        workspace: boundaryDecision.workspace,
        authorization: boundaryDecision.authorization,
        delegationBoundary: boundaryDecision.delegationBoundary,
        auditHandoff: boundaryDecision.auditHandoff,
        blockers: boundaryDecision.blockers
      },
      providerContract: {
        contractType: providerNegotiation.contractType,
        negotiated: providerNegotiation.negotiated,
        blockers: providerNegotiation.blockers,
        providers: providerNegotiation.providers,
        serviceContractNegotiation: providerNegotiation.serviceContractNegotiation,
        providerFailureState: providerNegotiation.providerFailureState,
        syncMetadata: providerNegotiation.syncMetadata,
        externalHandoffState: providerNegotiation.externalHandoffState
      },
      lifecycleControls: lifecycleGate,
      lifecycleCommandApplication,
      analytics: {
        counters: analyticsReport.counters,
        evaluationReportState: analyticsReport.evaluationReportState,
        deltas: analyticsReport.deltas,
        events: analyticsReport.events,
        exportRows: analyticsReport.exportRows,
        exportManifest: analyticsReport.exportManifest,
        currentSnapshot: analyticsReport.currentSnapshot,
        timeline: analyticsReport.timeline,
        exportSummary: analyticsReport.exportSummary
      },
      evidence,
      previewContract,
      acceptanceRouteContract,
      readinessRouteSnapshot,
      clientRuntimeAdoption,
      proof,
      hostedKernelIssue
    },
    evidence
  };
}

export default describeClaimAllowanceSurface;
