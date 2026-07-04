const MAILCHIMP_SCOPE_RULES = Object.freeze({
  campaigns: Object.freeze(["read", "write", "schedule"]),
  lists: Object.freeze(["read"]),
  templates: Object.freeze(["read", "write"]),
  reports: Object.freeze(["read"])
});

const DEFAULT_TRUTH_BOUNDARY = Object.freeze({
  source: "mailchimp-local-contract",
  externalWrites: false,
  requiresRuntimeAdapter: true
});

function normalizeToken(value) {
  return String(value ?? "").trim().toLowerCase();
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function normalizeScopes(scopes = []) {
  return uniqueSorted(scopes.map(normalizeToken));
}

function capabilityId(scope) {
  return `mailchimp.${scope}`;
}

function normalizeCapabilityGrant(grant = {}) {
  const scope = normalizeToken(typeof grant === "string" ? grant : grant.scope);
  const status = normalizeToken(grant.status) || (grant.granted ? "granted" : "unknown");
  return {
    id: capabilityId(scope),
    scope,
    status,
    granted: status === "granted" || grant.granted === true,
    grantId: String(grant.grantId ?? grant.id ?? "").trim(),
    grantedAt: String(grant.grantedAt ?? "").trim() || null,
    persistedAt: String(grant.persistedAt ?? "").trim() || null,
    source: normalizeToken(grant.source) || "runtime-state"
  };
}

function persistedGrantKey(scope, tenantId, workspaceId) {
  return [
    "mailchimp.capability",
    normalizeToken(tenantId) || "tenant",
    normalizeToken(workspaceId) || "workspace",
    normalizeToken(scope)
  ].join(".");
}

function commandIdFor(scope, tenantId, workspaceId, requestId) {
  return [
    "grant",
    persistedGrantKey(scope, tenantId, workspaceId),
    normalizeToken(requestId) || "request"
  ].join(".");
}

function handoffCheckpointId(tenantId, workspaceId, requestId, scopes = []) {
  return [
    "mailchimp.capability.handoff",
    normalizeToken(tenantId) || "tenant",
    normalizeToken(workspaceId) || "workspace",
    normalizeToken(requestId) || "request",
    scopes.map(normalizeToken).sort().join("+") || "no-scopes"
  ]
    .join(".")
    .replace(/[^a-z0-9.+]+/g, "-")
    .replace(/-+/g, "-");
}

function grantStateForHandoff(grant) {
  return {
    scope: grant.scope,
    status: grant.status,
    granted: grant.granted === true,
    stateKey: grant.stateKey,
    grantId: grant.grantId || null,
    persistedAt: grant.persistedAt,
    idempotencyKey: grant.idempotencyKey
  };
}

function capabilityLabel(scope) {
  const [resource, action] = normalizeToken(scope).split(":");
  const resourceLabel = resource ? resource.replace(/-/g, " ") : "mailchimp";
  const actionLabel = action ? action.replace(/-/g, " ") : "access";
  return `${resourceLabel} ${actionLabel}`;
}

function capabilityPreviewRow(grant, state) {
  const status = grant.granted
    ? "accepted"
    : grant.status === "denied"
      ? "denied"
      : "pending_acceptance";
  const canAccept = status === "pending_acceptance" && Boolean(state.tenantId && state.workspaceId);

  return {
    scope: grant.scope,
    label: capabilityLabel(grant.scope),
    status,
    granted: grant.granted === true,
    canAccept,
    stateKey: grant.stateKey,
    commandId: grant.idempotencyKey,
    nextAction: grant.granted
      ? "continue"
      : grant.status === "denied"
        ? "surface-denied-scope-and-keep-job-blocked"
        : canAccept
          ? "request-idempotent-mailchimp-scope-grant"
          : "bind-tenant-workspace-before-capability-grant",
  };
}

function normalizeCapabilityAcceptance(input = {}) {
  const acceptedScopes = new Set(normalizeScopes(input.acceptedScopes ?? input.scopes ?? []));
  const rejectedScopes = new Set(normalizeScopes(input.rejectedScopes ?? input.deniedScopes ?? []));
  const acceptedAll = input.acceptedAll === true || input.acceptance === true;
  const actor = String(input.acceptedBy ?? input.actor ?? input.operatorId ?? "").trim() || null;
  const decidedAt = String(input.acceptedAt ?? input.decidedAt ?? "").trim() || null;

  return {
    acceptedScopes,
    rejectedScopes,
    acceptedAll,
    actor,
    decidedAt,
    note: String(input.note ?? input.acceptanceNote ?? "").trim() || null,
  };
}

function capabilityValidationSummary(state, previewRows) {
  const missingTenant = !state.tenantId;
  const missingWorkspace = !state.workspaceId;
  const deniedRows = previewRows.filter((row) => row.status === "denied");
  const pendingRows = previewRows.filter((row) => row.status === "pending_acceptance");
  const issues = [
    ...(missingTenant
      ? [{
          code: "capability_preview_missing_tenant",
          severity: "error",
          field: "tenantId",
          action: "bind-tenant-before-capability-acceptance",
        }]
      : []),
    ...(missingWorkspace
      ? [{
          code: "capability_preview_missing_workspace",
          severity: "error",
          field: "workspaceId",
          action: "bind-workspace-before-capability-acceptance",
        }]
      : []),
    ...deniedRows.map((row) => ({
      code: "capability_preview_scope_denied",
      severity: "error",
      field: row.scope,
      action: "surface-denied-scope-and-keep-job-blocked",
    })),
    ...pendingRows.map((row) => ({
      code: "capability_preview_scope_pending",
      severity: "warning",
      field: row.scope,
      action: row.nextAction,
    })),
  ];

  return {
    status: issues.some((issue) => issue.severity === "error")
      ? "blocked"
      : pendingRows.length
        ? "needs_acceptance"
        : "ready",
    issueTotal: issues.length,
    blockingIssueTotal: issues.filter((issue) => issue.severity === "error").length,
    warningIssueTotal: issues.filter((issue) => issue.severity === "warning").length,
    issueCodes: issues.map((issue) => issue.code).sort(),
    issues,
  };
}

function normalizeActionPacketArray(values = []) {
  return uniqueSorted((Array.isArray(values) ? values : []).map((value) => String(value ?? "").trim()));
}

function normalizeActionPacketCount(value) {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function normalizeActionPacketSource(source = {}) {
  return source && typeof source === "object" ? source : {};
}

function actionPacketId(seed = {}) {
  return handoffCheckpointId(
    seed.tenantId,
    seed.workspaceId,
    seed.requestId,
    [
      seed.boundaryId,
      seed.providerJobId,
      seed.writeSetId,
      seed.previewStatus,
      seed.artifactStatus,
      seed.commitStatus,
      ...(seed.blockerCodes ?? []),
    ].filter(Boolean),
  );
}

function firstAction(candidates = [], fallback = "operator.review") {
  return candidates.map((candidate) => String(candidate ?? "").trim()).find(Boolean) ?? fallback;
}

function buildActionPacketSteps(packet) {
  const steps = [
    {
      id: "bind-request-state",
      label: "Bind request state",
      status: packet.client.missingState.length ? "blocked" : "complete",
      blockerCodes: packet.client.missingState.map((field) => `missing_client_${field}`),
      nextAction: "bind-client-runtime-state",
    },
    {
      id: "collect-preview-acceptance",
      label: "Collect preview acceptance",
      status: packet.preview.blockerCodes.length
        ? "blocked"
        : packet.preview.pendingCount || packet.preview.validationAccepted !== true
          ? "ready"
          : "complete",
      blockerCodes: packet.preview.blockerCodes,
      nextAction: packet.preview.pendingCount || packet.preview.validationAccepted !== true
        ? "collect-preview-acceptance"
        : "show-preview-summary",
    },
    {
      id: "persist-local-artifacts",
      label: "Persist local artifacts",
      status: packet.artifacts.pendingWriteCount > 0
        ? "ready"
        : packet.artifacts.status === "blocked"
          ? "blocked"
          : "complete",
      blockerCodes: packet.artifacts.blockerCodes,
      nextAction: packet.artifacts.pendingWriteCount > 0
        ? "persist-local-artifacts"
        : "observe-local-artifacts",
    },
    {
      id: "resolve-capabilities",
      label: "Resolve Mailchimp capabilities",
      status: packet.capabilities.deniedScopes.length
        ? "blocked"
        : packet.capabilities.missingScopes.length || packet.capabilities.pendingScopes.length
          ? "ready"
          : "complete",
      blockerCodes: [
        ...packet.capabilities.deniedScopes.map((scope) => `capability_denied:${scope}`),
        ...packet.capabilities.missingScopes.map((scope) => `capability_missing:${scope}`),
        ...packet.capabilities.pendingScopes.map((scope) => `capability_pending:${scope}`),
      ],
      nextAction: packet.capabilities.deniedScopes.length
        ? "surface-denied-scope-and-keep-job-blocked"
        : packet.capabilities.missingScopes.length || packet.capabilities.pendingScopes.length
          ? "request-idempotent-mailchimp-scope-grant"
          : "compile-capability-handoff-snapshot",
    },
    {
      id: "preflight-adapter-commit",
      label: "Preflight adapter commit",
      status: packet.adapterCommit.canCommit
        ? "ready"
        : packet.adapterCommit.blockerCodes.length
          ? "blocked"
          : "waiting",
      blockerCodes: packet.adapterCommit.blockerCodes,
      nextAction: packet.adapterCommit.nextAction,
    },
  ];

  return steps.map((step, index) => ({
    order: index + 1,
    ...step,
    active: step.status === "blocked" || step.status === "ready",
  }));
}

export function mailchimpCapabilityCatalog() {
  return Object.entries(MAILCHIMP_SCOPE_RULES).flatMap(([resource, actions]) =>
    actions.map((action) => {
      const scope = `${resource}:${action}`;
      return {
        id: capabilityId(scope),
        resource,
        action,
        scope,
        sideEffect: action === "write" || action === "schedule" ? "adapter-gated" : "read-only",
        truthBoundary: { ...DEFAULT_TRUTH_BOUNDARY }
      };
    })
  );
}

export function deriveMailchimpCapabilities(intent = {}) {
  const requested = new Set(normalizeScopes(intent.scopes));
  const operations = Array.isArray(intent.operations) ? intent.operations : [];

  for (const operation of operations) {
    const resource = normalizeToken(operation.resource);
    const action = normalizeToken(operation.action);
    if (MAILCHIMP_SCOPE_RULES[resource]?.includes(action)) {
      requested.add(`${resource}:${action}`);
    }
  }

  if (normalizeToken(intent.kind) === "campaign-send") {
    requested.add("campaigns:write");
    requested.add("campaigns:schedule");
    requested.add("lists:read");
  }

  if (intent.templateId) {
    requested.add("templates:read");
  }

  return normalizeScopes([...requested]).map((scope) => ({
    id: capabilityId(scope),
    scope,
    granted: false,
    reason: "declared-by-compiler",
    truthBoundary: { ...DEFAULT_TRUTH_BOUNDARY }
  }));
}

export function validateMailchimpCapabilities(job = {}, grantedCapabilities = []) {
  const required = normalizeScopes(job.capabilities?.map((capability) => capability.scope) ?? []);
  const granted = new Set(
    grantedCapabilities
      .filter((capability) => {
        if (typeof capability === "string") {
          return true;
        }
        return capability.granted === true || normalizeToken(capability.status) === "granted";
      })
      .map((capability) => (typeof capability === "string" ? capability : capability.scope))
      .map(normalizeToken)
  );

  const catalog = new Set(mailchimpCapabilityCatalog().map((capability) => capability.scope));
  const unknown = required.filter((scope) => !catalog.has(scope));
  const missing = required.filter((scope) => !granted.has(scope));
  const allowed = unknown.length === 0 && missing.length === 0;

  return {
    allowed,
    required,
    missing,
    unknown,
    status: allowed ? "ready" : "blocked",
    recovery: allowed
      ? []
      : [
          {
            code: "capability_grant_required",
            message: "Grant the missing Mailchimp scopes before adapter handoff.",
            scopes: missing
          }
        ],
    truthBoundary: {
      ...DEFAULT_TRUTH_BOUNDARY,
      evaluatedAgainst: "static-mailchimp-capability-catalog"
    }
  };
}

export function shapeMailchimpCapabilityState(intent = {}, persistedState = {}) {
  const tenantId = String(intent.tenantId ?? persistedState.tenantId ?? "").trim();
  const workspaceId = String(intent.workspaceId ?? persistedState.workspaceId ?? "").trim();
  const requestId = String(intent.requestId ?? persistedState.requestId ?? "").trim();
  const requiredScopes = deriveMailchimpCapabilities(intent).map((capability) => capability.scope);
  const grants = (persistedState.grants ?? persistedState.capabilities ?? [])
    .map(normalizeCapabilityGrant)
    .filter((grant) => grant.scope);
  const byScope = new Map(grants.map((grant) => [grant.scope, grant]));
  const shaped = requiredScopes.map((scope) => {
    const existing = byScope.get(scope);
    const stateKey = persistedGrantKey(scope, tenantId, workspaceId);
    return {
      stateKey,
      scope,
      status: existing?.granted ? "granted" : existing?.status === "denied" ? "denied" : "missing",
      granted: existing?.granted === true,
      grantId: existing?.grantId ?? "",
      persistedAt: existing?.persistedAt ?? null,
      idempotencyKey: commandIdFor(scope, tenantId, workspaceId, requestId)
    };
  });
  const missing = shaped.filter((grant) => !grant.granted).map((grant) => grant.scope);
  const denied = shaped.filter((grant) => grant.status === "denied").map((grant) => grant.scope);

  return {
    stateVersion: "aios.mailchimp.capability-state.v1",
    tenantId,
    workspaceId,
    requestId,
    requiredScopes,
    grants: shaped,
    status: missing.length === 0 ? "ready" : denied.length > 0 ? "blocked" : "needs_grant",
    restartSafe: true,
    recovery: missing.map((scope) => ({
      code: denied.includes(scope) ? "capability_denied" : "capability_grant_required",
      scope,
      stateKey: persistedGrantKey(scope, tenantId, workspaceId),
      commandId: commandIdFor(scope, tenantId, workspaceId, requestId),
      action:
        denied.includes(scope)
          ? "surface-denied-scope-and-keep-job-blocked"
          : "request-idempotent-mailchimp-scope-grant"
    })),
    truthBoundary: {
      ...DEFAULT_TRUTH_BOUNDARY,
      evaluatedAgainst: "persisted-local-capability-state",
      externalWrites: false
    }
  };
}

export function planMailchimpCapabilityCommands(intent = {}, persistedState = {}) {
  const state = shapeMailchimpCapabilityState(intent, persistedState);
  const commands = state.grants
    .filter((grant) => !grant.granted && grant.status !== "denied")
    .map((grant) => ({
      commandVersion: "aios.mailchimp.capability-command.v1",
      id: grant.idempotencyKey,
      type: "request-capability-grant",
      adapter: "mailchimp",
      scope: grant.scope,
      tenantId: state.tenantId,
      workspaceId: state.workspaceId,
      stateKey: grant.stateKey,
      idempotent: true,
      status: "pending_user_or_runtime_grant"
    }));

  return {
    planVersion: "aios.mailchimp.capability-command-plan.v1",
    status: state.status,
    commands,
    state,
    recovery: state.recovery,
    rollback: {
      supported: true,
      strategy: "leave-existing-grants-unchanged-and-drop-pending-grant-commands",
      commandIds: commands.map((command) => command.id)
    },
    truthBoundary: {
      ...DEFAULT_TRUTH_BOUNDARY,
      source: "deterministic-capability-command-planner",
      externalWrites: false
    }
  };
}

export function compileMailchimpCapabilityContract(intent = {}) {
  const capabilities = deriveMailchimpCapabilities(intent);
  const persistedState = shapeMailchimpCapabilityState(intent, intent.persistedCapabilityState ?? {});
  return {
    contractVersion: "aios.mailchimp.capabilities.v1",
    capabilities,
    requiredScopes: capabilities.map((capability) => capability.scope),
    persistedState,
    runtimeAdapter: {
      name: "mailchimp",
      handoff: "capability-checked-job-descriptor",
      stateContract: "aios.mailchimp.capability-state.v1"
    },
    rollback: {
      supported: true,
      strategy: "block-adapter-handoff-before-any-external-write",
      restartSafeStateKeys: persistedState.grants.map((grant) => grant.stateKey)
    },
    truthBoundary: { ...DEFAULT_TRUTH_BOUNDARY }
  };
}

export function compileMailchimpCapabilityHandoffSnapshot(intent = {}, persistedStateInput = {}) {
  const state = shapeMailchimpCapabilityState(intent, persistedStateInput);
  const requiredScopes = normalizeScopes(state.requiredScopes);
  const grantedScopes = normalizeScopes(
    state.grants.filter((grant) => grant.granted).map((grant) => grant.scope)
  );
  const deniedScopes = normalizeScopes(
    state.grants.filter((grant) => grant.status === "denied").map((grant) => grant.scope)
  );
  const pendingScopes = normalizeScopes(
    state.grants
      .filter((grant) => !grant.granted && grant.status !== "denied")
      .map((grant) => grant.scope)
  );
  const missingScopes = normalizeScopes(state.recovery.map((entry) => entry.scope));
  const checkpointId = handoffCheckpointId(
    state.tenantId,
    state.workspaceId,
    state.requestId,
    requiredScopes
  );
  const canHandoff =
    state.status === "ready" &&
    requiredScopes.length > 0 &&
    missingScopes.length === 0 &&
    deniedScopes.length === 0;

  return {
    snapshotVersion: "aios.mailchimp.capability-handoff.v1",
    checkpointId,
    tenantId: state.tenantId,
    workspaceId: state.workspaceId,
    requestId: state.requestId,
    status: canHandoff ? "ready" : deniedScopes.length > 0 ? "blocked" : "needs_grant",
    canHandoff,
    requiredScopes,
    grantedScopes,
    missingScopes,
    deniedScopes,
    pendingScopes,
    grants: state.grants.map(grantStateForHandoff),
    adapterGate: {
      name: "mailchimp",
      mode: "deferred-handoff",
      requiresAllScopesGranted: true,
      externalWritePermittedAfterVerification: canHandoff,
      checkpointId
    },
    recovery: [
      ...deniedScopes.map((scope) => ({
        code: "capability_denied",
        scope,
        action: "surface-denied-scope-and-keep-job-blocked"
      })),
      ...pendingScopes.map((scope) => ({
        code: "capability_grant_required",
        scope,
        action: "request-idempotent-mailchimp-scope-grant",
        commandId: commandIdFor(scope, state.tenantId, state.workspaceId, state.requestId)
      })),
      ...(!state.tenantId
        ? [{ code: "missing_capability_tenant", action: "bind-tenant-before-capability-handoff" }]
        : []),
      ...(!state.workspaceId
        ? [{ code: "missing_capability_workspace", action: "bind-workspace-before-capability-handoff" }]
        : [])
    ],
    rollback: {
      supported: true,
      strategy: "drop-capability-handoff-envelope-before-adapter-call",
      checkpointId,
      stateKeys: state.grants.map((grant) => grant.stateKey)
    },
    truthBoundary: {
      ...DEFAULT_TRUTH_BOUNDARY,
      source: "deterministic-capability-handoff-snapshot",
      evaluatedAgainst: "persisted-local-capability-state",
      externalWrites: false
    }
  };
}

export function compileMailchimpAdapterCommitCapabilityGate(intent = {}, persistedStateInput = {}, adapterState = {}) {
  const snapshot = compileMailchimpCapabilityHandoffSnapshot(intent, persistedStateInput);
  const commitMode = normalizeToken(adapterState.commitMode ?? intent.commitMode) || "dry-run";
  const artifactGate = adapterState.artifactGate && typeof adapterState.artifactGate === "object"
    ? adapterState.artifactGate
    : adapterState.adapterCommitGate && typeof adapterState.adapterCommitGate === "object"
      ? adapterState.adapterCommitGate
      : {};
  const artifactBlockers = Array.isArray(artifactGate.blockers)
    ? artifactGate.blockers.map((blocker) => ({
        code: normalizeToken(blocker.code || blocker.field || blocker) || "artifact_gate_blocker",
        field: String(blocker.field ?? "").trim() || null,
        action: String(blocker.action ?? "").trim() || "repair-artifact-commit-gate",
      }))
    : [];
  const pendingArtifactWrites = Number.isFinite(artifactGate.localArtifacts?.pendingWriteCount)
    ? Math.max(0, Math.floor(artifactGate.localArtifacts.pendingWriteCount))
    : Number.isFinite(adapterState.pendingArtifactWrites)
      ? Math.max(0, Math.floor(adapterState.pendingArtifactWrites))
      : 0;
  const commitIntentRequiresWrite =
    normalizeToken(intent.kind) === "audience-sync" ||
    normalizeToken(intent.kind) === "member-upsert" ||
    normalizeToken(intent.kind) === "campaign-send" ||
    commitMode === "adapter-mediated";
  const requiredWriteScopes = commitIntentRequiresWrite
    ? ["lists:read"]
    : [];
  const writeScopeMissing = requiredWriteScopes.filter((scope) => !snapshot.grantedScopes.includes(scope));
  const blockers = [
    ...snapshot.deniedScopes.map((scope) => ({
      code: "adapter_commit_capability_denied",
      field: scope,
      action: "surface-denied-scope-and-keep-adapter-commit-blocked",
    })),
    ...snapshot.pendingScopes.map((scope) => ({
      code: "adapter_commit_capability_pending",
      field: scope,
      action: "request-idempotent-mailchimp-scope-grant",
      commandId: commandIdFor(scope, snapshot.tenantId, snapshot.workspaceId, snapshot.requestId),
    })),
    ...writeScopeMissing.map((scope) => ({
      code: "adapter_commit_required_scope_missing",
      field: scope,
      action: "derive-and-grant-required-mailchimp-write-scope",
    })),
    ...(!snapshot.tenantId
      ? [{
          code: "adapter_commit_missing_tenant",
          field: "tenantId",
          action: "bind-tenant-before-adapter-commit",
        }]
      : []),
    ...(!snapshot.workspaceId
      ? [{
          code: "adapter_commit_missing_workspace",
          field: "workspaceId",
          action: "bind-workspace-before-adapter-commit",
        }]
      : []),
    ...(commitMode !== "adapter-mediated"
      ? [{
          code: "adapter_commit_dry_run_mode",
          field: "commitMode",
          action: "switch-to-adapter-mediated-commit-mode-before-external-write",
        }]
      : []),
    ...(pendingArtifactWrites > 0
      ? [{
          code: "adapter_commit_artifacts_pending",
          field: "artifactGate.localArtifacts.pendingWriteCount",
          action: "persist-local-artifacts-before-adapter-commit",
        }]
      : []),
    ...artifactBlockers,
  ];
  const canCommit = blockers.length === 0 && snapshot.canHandoff === true;
  const gateId = handoffCheckpointId(
    snapshot.tenantId,
    snapshot.workspaceId,
    snapshot.requestId,
    [...snapshot.requiredScopes, commitMode, artifactGate.writeSetId ?? adapterState.writeSetId ?? ""]
  );

  return {
    gateVersion: "aios.mailchimp.adapter-commit-capability-gate.v1",
    gateId,
    status: canCommit ? "ready" : blockers.some((blocker) => blocker.code.includes("denied")) ? "blocked" : "needs_grant_or_artifact",
    canCommit,
    commitMode,
    tenantId: snapshot.tenantId,
    workspaceId: snapshot.workspaceId,
    requestId: snapshot.requestId,
    checkpointId: snapshot.checkpointId,
    requiredScopes: uniqueSorted([...snapshot.requiredScopes, ...requiredWriteScopes]),
    grantedScopes: snapshot.grantedScopes,
    missingScopes: uniqueSorted([...snapshot.missingScopes, ...writeScopeMissing]),
    deniedScopes: snapshot.deniedScopes,
    pendingScopes: snapshot.pendingScopes,
    localArtifactGate: {
      status: String(artifactGate.status ?? "").trim() || "not_bound",
      writeSetId: String(artifactGate.writeSetId ?? adapterState.writeSetId ?? "").trim() || null,
      pendingWriteCount: pendingArtifactWrites,
      blockerCodes: artifactBlockers.map((blocker) => blocker.code),
    },
    adapterGate: {
      name: "mailchimp",
      mode: "commit-preflight",
      requiresAllScopesGranted: true,
      requiresLocalArtifactsPersisted: true,
      externalWritePermittedAfterVerification: canCommit,
      checkpointId: gateId,
    },
    blockers,
    recovery: blockers.map((blocker) => ({
      code: blocker.code,
      scope: blocker.field,
      action: blocker.action,
      commandId: blocker.commandId,
    })),
    rollback: {
      supported: true,
      strategy: "drop-adapter-commit-preflight-before-provider-write",
      checkpointId: gateId,
      stateKeys: snapshot.rollback.stateKeys,
    },
    truthBoundary: {
      ...DEFAULT_TRUTH_BOUNDARY,
      source: "deterministic-adapter-commit-capability-gate",
      evaluatedAgainst: "persisted-local-capability-and-artifact-state",
      externalWrites: false,
    },
  };
}

export function previewMailchimpCapabilityAcceptance(intent = {}, persistedStateInput = {}, acceptanceInput = {}) {
  const state = shapeMailchimpCapabilityState(intent, persistedStateInput);
  const acceptance = normalizeCapabilityAcceptance(acceptanceInput);
  const previewRows = state.grants.map((grant) => capabilityPreviewRow(grant, state));
  const validation = capabilityValidationSummary(state, previewRows);
  const acceptedScopes = acceptance.acceptedAll
    ? previewRows.filter((row) => row.canAccept).map((row) => row.scope)
    : previewRows.filter((row) => acceptance.acceptedScopes.has(row.scope)).map((row) => row.scope);
  const rejectedScopes = previewRows
    .filter((row) => acceptance.rejectedScopes.has(row.scope) || row.status === "denied")
    .map((row) => row.scope);
  const pendingScopes = previewRows
    .filter((row) => row.status === "pending_acceptance" && !acceptedScopes.includes(row.scope) && !rejectedScopes.includes(row.scope))
    .map((row) => row.scope);
  const unknownAcceptedScopes = [...acceptance.acceptedScopes]
    .filter((scope) => !previewRows.some((row) => row.scope === scope))
    .sort();
  const status = validation.status === "blocked" || rejectedScopes.length
    ? "blocked"
    : pendingScopes.length
      ? "needs_acceptance"
      : "ready_for_handoff";
  const previewId = handoffCheckpointId(
    state.tenantId,
    state.workspaceId,
    state.requestId,
    [...state.requiredScopes, status, acceptedScopes.join("+")]
  );

  return {
    previewVersion: "aios.mailchimp.capability-acceptance-preview.v1",
    previewId,
    status,
    tenantId: state.tenantId,
    workspaceId: state.workspaceId,
    requestId: state.requestId,
    requiredScopes: state.requiredScopes,
    previewRows,
    acceptance: {
      actor: acceptance.actor,
      decidedAt: acceptance.decidedAt,
      note: acceptance.note,
      acceptedAll: acceptance.acceptedAll,
      acceptedScopes,
      rejectedScopes,
      pendingScopes,
      unknownAcceptedScopes,
    },
    readiness: {
      canHandoff: status === "ready_for_handoff",
      validationStatus: validation.status,
      acceptedCount: acceptedScopes.length,
      rejectedCount: rejectedScopes.length,
      pendingCount: pendingScopes.length,
      nextAction: status === "ready_for_handoff"
        ? "compile-capability-handoff-snapshot"
        : status === "blocked"
          ? validation.issues.find((issue) => issue.severity === "error")?.action ?? "repair-capability-preview"
          : "collect-capability-acceptance",
    },
    validation,
    commands: previewRows
      .filter((row) => row.status === "pending_acceptance")
      .map((row) => ({
        commandVersion: "aios.mailchimp.capability-command.v1",
        id: row.commandId,
        type: "request-capability-grant",
        adapter: "mailchimp",
        scope: row.scope,
        tenantId: state.tenantId,
        workspaceId: state.workspaceId,
        stateKey: row.stateKey,
        status: acceptedScopes.includes(row.scope) ? "accepted_for_dispatch" : "pending_user_or_runtime_grant",
        idempotent: true,
      })),
    explanation: previewRows.map((row) => ({
      scope: row.scope,
      label: row.label,
      status: row.status,
      nextAction: row.nextAction,
    })),
    recovery: [
      ...validation.issues.map((issue) => ({
        code: issue.code,
        field: issue.field,
        action: issue.action,
      })),
      ...unknownAcceptedScopes.map((scope) => ({
        code: "capability_acceptance_unknown_scope",
        field: scope,
        action: "drop-unknown-scope-from-acceptance-payload",
      })),
    ],
    truthBoundary: {
      ...DEFAULT_TRUTH_BOUNDARY,
      source: "deterministic-capability-acceptance-preview",
      externalWrites: false,
    },
  };
}

function normalizeCapabilityHistoryEntry(entry = {}, index = 0) {
  const source = entry && typeof entry === "object" ? entry : {};
  const scopes = normalizeScopes(source.scopes ?? source.requiredScopes ?? []);
  const grantedScopes = normalizeScopes(source.grantedScopes ?? []);
  const missingScopes = normalizeScopes(source.missingScopes ?? []);
  const deniedScopes = normalizeScopes(source.deniedScopes ?? []);
  const status = normalizeToken(source.status) || (
    deniedScopes.length ? "blocked" : missingScopes.length ? "needs_grant" : "ready"
  );

  return {
    index,
    at: String(source.at ?? source.generatedAt ?? `history:${index}`).trim(),
    status,
    checkpointId: String(source.checkpointId ?? "").trim() || null,
    requiredScopes: scopes,
    grantedScopes,
    missingScopes,
    deniedScopes,
    counters: {
      required: scopes.length,
      granted: grantedScopes.length,
      missing: missingScopes.length,
      denied: deniedScopes.length,
    },
  };
}

function capabilityTimelineEvent(order, phase, status, action, detail = {}) {
  return {
    order,
    phase,
    status,
    action,
    detail,
    restartSafe: true,
  };
}

export function summarizeMailchimpCapabilityAnalytics(intent = {}, persistedStateInput = {}, options = {}) {
  const snapshot = compileMailchimpCapabilityHandoffSnapshot(intent, persistedStateInput);
  const acceptancePreview = previewMailchimpCapabilityAcceptance(
    intent,
    persistedStateInput,
    options.acceptance ?? options.acceptanceInput ?? {}
  );
  const history = (Array.isArray(options.history) ? options.history : [])
    .map(normalizeCapabilityHistoryEntry)
    .slice(-11);
  const current = normalizeCapabilityHistoryEntry({
    at: options.generatedAt ?? "logical:capability-analytics",
    status: snapshot.status,
    checkpointId: snapshot.checkpointId,
    requiredScopes: snapshot.requiredScopes,
    grantedScopes: snapshot.grantedScopes,
    missingScopes: snapshot.missingScopes,
    deniedScopes: snapshot.deniedScopes,
  }, history.length);
  const snapshots = [...history, current];
  const counters = {
    requiredScopeCount: snapshot.requiredScopes.length,
    grantedScopeCount: snapshot.grantedScopes.length,
    missingScopeCount: snapshot.missingScopes.length,
    deniedScopeCount: snapshot.deniedScopes.length,
    pendingScopeCount: snapshot.pendingScopes.length,
    commandCount: acceptancePreview.commands.length,
    acceptedScopeCount: acceptancePreview.acceptance.acceptedScopes.length,
    rejectedScopeCount: acceptancePreview.acceptance.rejectedScopes.length,
    unknownAcceptedScopeCount: acceptancePreview.acceptance.unknownAcceptedScopes.length,
    historySnapshotCount: snapshots.length,
    readySnapshotCount: snapshots.filter((entry) => entry.status === "ready").length,
    blockedSnapshotCount: snapshots.filter((entry) => entry.status === "blocked").length,
  };
  const timeline = [
    capabilityTimelineEvent(1, "derive-required-scopes", snapshot.requiredScopes.length ? "complete" : "blocked", "compile-mailchimp-capability-contract", {
      requiredScopes: snapshot.requiredScopes,
    }),
    capabilityTimelineEvent(2, "preview-acceptance", acceptancePreview.status, acceptancePreview.readiness.nextAction, {
      acceptedScopes: acceptancePreview.acceptance.acceptedScopes,
      pendingScopes: acceptancePreview.acceptance.pendingScopes,
    }),
    capabilityTimelineEvent(3, "handoff-snapshot", snapshot.status, snapshot.canHandoff ? "adapter-preflight" : "request-idempotent-mailchimp-scope-grant", {
      checkpointId: snapshot.checkpointId,
      canHandoff: snapshot.canHandoff,
    }),
    capabilityTimelineEvent(4, "export-summary", snapshot.canHandoff ? "ready" : "blocked", snapshot.canHandoff ? "export-capability-handoff" : acceptancePreview.readiness.nextAction, {
      missingScopes: snapshot.missingScopes,
      deniedScopes: snapshot.deniedScopes,
    }),
  ];
  const status = snapshot.deniedScopes.length
    ? "blocked"
    : snapshot.missingScopes.length || snapshot.pendingScopes.length
      ? "needs_grant"
      : "ready";
  const exportId = handoffCheckpointId(
    snapshot.tenantId,
    snapshot.workspaceId,
    snapshot.requestId,
    ["capability-analytics", status, ...snapshot.requiredScopes]
  );

  return {
    reportVersion: "aios.mailchimp.capability-analytics-report.v1",
    exportId,
    status,
    tenantId: snapshot.tenantId,
    workspaceId: snapshot.workspaceId,
    requestId: snapshot.requestId,
    checkpointId: snapshot.checkpointId,
    exportReady: status === "ready",
    nextAction: status === "ready"
      ? "export-capability-handoff-summary"
      : acceptancePreview.readiness.nextAction,
    counters,
    scopeSummary: {
      requiredScopes: snapshot.requiredScopes,
      grantedScopes: snapshot.grantedScopes,
      missingScopes: snapshot.missingScopes,
      deniedScopes: snapshot.deniedScopes,
      pendingScopes: snapshot.pendingScopes,
    },
    acceptanceSummary: acceptancePreview.acceptance,
    history: snapshots,
    timeline,
    recovery: [
      ...snapshot.recovery,
      ...acceptancePreview.recovery,
    ],
    truthBoundary: {
      ...DEFAULT_TRUTH_BOUNDARY,
      source: "deterministic-capability-analytics-report",
      externalWrites: false,
    },
  };
}

export function compileMailchimpWorkflowActionPacket(input = {}) {
  const source = normalizeActionPacketSource(input);
  const providerJob = normalizeActionPacketSource(source.providerJob);
  const lifecycle = normalizeActionPacketSource(providerJob.lifecycleState);
  const operatorState = normalizeActionPacketSource(source.operatorControlState);
  const runtime = normalizeActionPacketSource(source.clientRuntime ?? source.requestState);
  const writeSet = normalizeActionPacketSource(source.artifactWriteSet);
  const acceptance = normalizeActionPacketSource(source.previewAcceptance ?? writeSet.acceptance);
  const readiness = normalizeActionPacketSource(source.readiness ?? writeSet.readiness);
  const persistence = normalizeActionPacketSource(source.persistence ?? writeSet.persistence);
  const adapterCommitGate = normalizeActionPacketSource(source.adapterCommitGate ?? writeSet.adapterCommitGate);
  const capabilityGate = normalizeActionPacketSource(
    source.capabilityGate
      ?? source.capabilityNegotiation
      ?? adapterCommitGate.capabilityGate
      ?? providerJob.capabilityNegotiation,
  );
  const clientWorkflowHandoff = normalizeActionPacketSource(source.clientWorkflowHandoff ?? writeSet.clientWorkflowHandoff);
  const operatorReport = normalizeActionPacketSource(source.operatorReport ?? writeSet.operatorReport);
  const previewDecision = normalizeActionPacketSource(source.previewDecision);
  const blockingIssueCodes = normalizeActionPacketArray(
    source.blockingIssueCodes
      ?? previewDecision.readinessSummary?.blockingIssueCodes
      ?? clientWorkflowHandoff.validationSummary?.issueCodes
      ?? readiness.validation?.issueCodes,
  );
  const adapterBlockers = Array.isArray(adapterCommitGate.blockers)
    ? adapterCommitGate.blockers.map((blocker) => ({
        code: normalizeToken(blocker.code || blocker.field || blocker) || "adapter_commit_blocker",
        field: String(blocker.field ?? "").trim() || null,
        action: String(blocker.action ?? "").trim() || "repair-adapter-commit-gate",
      }))
    : [];
  const missingClientState = normalizeActionPacketArray(
    runtime.missingFields
      ?? runtime.requiredClientState
      ?? source.missingClientState
      ?? previewDecision.missingClientState,
  );
  const pendingWriteCount = normalizeActionPacketCount(
    adapterCommitGate.localArtifacts?.pendingWriteCount
      ?? persistence.counters?.readyToWrite
      ?? source.pendingArtifactWrites,
  );
  const deniedScopes = normalizeScopes(capabilityGate.deniedScopes ?? capabilityGate.denied ?? source.deniedScopes ?? []);
  const missingScopes = normalizeScopes(capabilityGate.missingScopes ?? capabilityGate.missing ?? source.missingScopes ?? []);
  const pendingScopes = normalizeScopes(capabilityGate.pendingScopes ?? source.pendingScopes ?? []);
  const grantedScopes = normalizeScopes(capabilityGate.grantedScopes ?? capabilityGate.granted ?? source.grantedScopes ?? []);
  const requiredScopes = normalizeScopes(capabilityGate.requiredScopes ?? capabilityGate.required ?? source.requiredScopes ?? []);
  const previewPending = normalizeActionPacketCount(
    acceptance.pendingCount
      ?? clientWorkflowHandoff.acceptance?.pendingCount
      ?? previewDecision.decisionSummary?.pendingRows,
  );
  const previewRejected = normalizeActionPacketCount(
    acceptance.rejectedCount
      ?? clientWorkflowHandoff.acceptance?.rejectedCount
      ?? previewDecision.decisionSummary?.rejectedRows,
  );
  const validationAccepted = acceptance.validationAccepted === true
    || clientWorkflowHandoff.acceptance?.validationAccepted === true
    || previewDecision.decisionSummary?.validationAccepted === true;
  const adapterBlockerCodes = normalizeActionPacketArray([
    ...adapterBlockers.map((blocker) => blocker.code),
    ...(Array.isArray(adapterCommitGate.blockerCodes) ? adapterCommitGate.blockerCodes : []),
  ]);
  const previewBlockerCodes = normalizeActionPacketArray([
    ...blockingIssueCodes,
    ...(previewRejected > 0 ? ["preview_acceptance_rejected"] : []),
  ]);
  const packetSeed = {
    tenantId: source.tenantId ?? runtime.tenantId ?? operatorState.tenantId,
    workspaceId: source.workspaceId ?? runtime.workspaceId ?? operatorState.workspaceId,
    requestId: source.requestId ?? runtime.requestId ?? operatorState.requestId,
    boundaryId: source.boundaryId ?? writeSet.boundaryId,
    providerJobId: source.providerJobId ?? providerJob.jobId ?? adapterCommitGate.providerJobId,
    writeSetId: persistence.writeSetId ?? adapterCommitGate.writeSetId,
    previewStatus: acceptance.status ?? previewDecision.status,
    artifactStatus: readiness.status ?? writeSet.status,
    commitStatus: adapterCommitGate.status,
    blockerCodes: [...previewBlockerCodes, ...adapterBlockerCodes],
  };
  const basePacket = {
    packetVersion: "aios.mailchimp.workflow-action-packet.v1",
    packetId: actionPacketId(packetSeed),
    provider: "mailchimp",
    tenantId: String(packetSeed.tenantId ?? "").trim(),
    workspaceId: String(packetSeed.workspaceId ?? "").trim(),
    requestId: String(packetSeed.requestId ?? "").trim(),
    boundaryId: packetSeed.boundaryId ?? null,
    providerJobId: packetSeed.providerJobId ?? null,
    writeSetId: packetSeed.writeSetId ?? null,
    client: {
      status: String(runtime.clientVisibleStatus ?? source.clientVisibleStatus ?? "").trim() || "provider_settings_review",
      missingState: missingClientState,
      nextAction: missingClientState.length ? "bind-client-runtime-state" : null,
    },
    preview: {
      status: String(acceptance.status ?? previewDecision.status ?? "").trim() || "not_bound",
      pendingCount: previewPending,
      rejectedCount: previewRejected,
      validationAccepted,
      blockerCodes: previewBlockerCodes,
      nextAction: previewPending || !validationAccepted
        ? "collect-preview-acceptance"
        : previewRejected
          ? "revise-preview-rows"
          : null,
    },
    artifacts: {
      status: String(persistence.status ?? readiness.status ?? writeSet.status ?? "").trim() || "not_bound",
      pendingWriteCount,
      writeSetId: packetSeed.writeSetId ?? null,
      blockerCodes: normalizeActionPacketArray(
        Array.isArray(persistence.recovery)
          ? persistence.recovery.map((entry) => entry.code)
          : [],
      ),
      nextAction: pendingWriteCount > 0 ? "persist-local-artifacts" : null,
    },
    capabilities: {
      status: String(capabilityGate.status ?? "").trim() || (deniedScopes.length || missingScopes.length ? "blocked" : "unknown"),
      requiredScopes,
      grantedScopes,
      missingScopes,
      deniedScopes,
      pendingScopes,
      nextAction: deniedScopes.length
        ? "surface-denied-scope-and-keep-job-blocked"
        : missingScopes.length || pendingScopes.length
          ? "request-idempotent-mailchimp-scope-grant"
          : null,
    },
    adapterCommit: {
      status: String(adapterCommitGate.status ?? "").trim() || "not_bound",
      canCommit: adapterCommitGate.canCommit === true,
      commitMode: String(adapterCommitGate.commitMode ?? providerJob.commitMode ?? "").trim() || "dry-run",
      blockerCodes: adapterBlockerCodes,
      nextAction: String(adapterCommitGate.nextAction ?? "").trim() || "repair-adapter-commit-gate",
    },
    operatorReport: {
      reportId: String(operatorReport.reportId ?? "").trim() || null,
      status: String(operatorReport.status ?? "").trim() || "not_bound",
      nextAction: String(operatorReport.nextAction ?? "").trim() || null,
      blockingSections: Array.isArray(operatorReport.blockingSections)
        ? operatorReport.blockingSections.map((section) => String(section.name ?? section).trim()).filter(Boolean).sort()
        : [],
    },
    lifecycle: {
      enabled: lifecycle.enabled === true || operatorState.enablementControls?.enabled === true,
      settingsRevision: String(lifecycle.settingsRevision ?? operatorState.settingsRevision ?? "").trim() || null,
      schedule: lifecycle.schedule ?? operatorState.schedulingControls ?? null,
      nextAction: String(lifecycle.nextAction ?? operatorState.nextAction ?? "").trim() || null,
    },
  };
  const steps = buildActionPacketSteps(basePacket);
  const activeStep = steps.find((step) => step.status === "blocked")
    ?? steps.find((step) => step.status === "ready")
    ?? steps.at(-1);
  const status = adapterCommitGate.canCommit === true
    ? "ready_for_adapter_commit"
    : steps.some((step) => step.status === "blocked")
      ? "blocked"
      : steps.some((step) => step.status === "ready")
        ? "needs_operator_action"
        : "ready_for_review";

  return {
    ...basePacket,
    status,
    primaryAction: firstAction([
      basePacket.client.nextAction,
      activeStep?.nextAction,
      basePacket.preview.nextAction,
      basePacket.artifacts.nextAction,
      basePacket.capabilities.nextAction,
      basePacket.adapterCommit.canCommit ? "adapter.commit-mailchimp-batch" : basePacket.adapterCommit.nextAction,
      basePacket.operatorReport.nextAction,
      basePacket.lifecycle.nextAction,
    ]),
    activeStepId: activeStep?.id ?? null,
    steps,
    issueSummary: {
      blockingCodes: normalizeActionPacketArray([
        ...basePacket.client.missingState.map((field) => `missing_client_${field}`),
        ...basePacket.preview.blockerCodes,
        ...basePacket.artifacts.blockerCodes,
        ...basePacket.adapterCommit.blockerCodes,
        ...basePacket.operatorReport.blockingSections.map((section) => `operator_report:${section}`),
      ]),
      missingScopeCount: missingScopes.length,
      deniedScopeCount: deniedScopes.length,
      pendingArtifactWriteCount: pendingWriteCount,
      pendingPreviewCount: previewPending,
    },
    restartSafe: true,
    truthBoundary: {
      ...DEFAULT_TRUTH_BOUNDARY,
      source: "deterministic-mailchimp-workflow-action-packet",
      externalWrites: false,
    },
  };
}
