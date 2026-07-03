const REQUIRED_MAILCHIMP_FACTS = new Set(["audience_id", "campaign_id", "segment_id", "template_id"]);

function stableId(prefix, parts) {
  const input = parts.filter((part) => part !== undefined && part !== null).join("|");
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function normalizeIdentifier(value, fallback) {
  const raw = String(value ?? fallback ?? "").trim();
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, "-")
    .replace(/^-+|-+$/g, "") || fallback;
}

function asArray(value) {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function parseRuleLine(line, index) {
  const match = line.match(/^claim\s+([a-zA-Z0-9_.:-]+)\s+(requires|observes|blocks|allows)\s+(.+)$/);
  if (!match) {
    throw new Error(`Invalid claim gate rule: ${line}`);
  }
  const [, subject, operator, rest] = match;
  const values = rest.split(",").map((item) => normalizeIdentifier(item, "fact")).filter(Boolean);
  return {
    id: stableId("rule", [subject, operator, values.join(","), index]),
    subject: normalizeIdentifier(subject, "mailchimp.claim"),
    operator,
    values,
  };
}

function parseClaimSource(source) {
  if (typeof source !== "string") {
    return { ...source };
  }
  const trimmed = source.trim();
  if (!trimmed) {
    return {};
  }
  if (trimmed.startsWith("{")) {
    return JSON.parse(trimmed);
  }
  const rules = [];
  const manifest = {};
  for (const line of trimmed.split(/\r?\n/)) {
    const clean = line.replace(/#.*$/, "").trim();
    if (!clean) {
      continue;
    }
    if (clean.startsWith("claim ")) {
      rules.push(parseRuleLine(clean, rules.length));
      continue;
    }
    const pair = clean.match(/^([a-zA-Z0-9_.:-]+)\s*[:=]\s*(.+)$/);
    if (pair) {
      manifest[pair[1]] = pair[2].includes(",")
        ? pair[2].split(",").map((item) => item.trim()).filter(Boolean)
        : pair[2].trim();
      continue;
    }
    throw new Error(`Invalid claim gate line: ${line}`);
  }
  return { ...manifest, rules };
}

function normalizeEvidence(entry) {
  if (typeof entry === "string") {
    return { fact: normalizeIdentifier(entry, "fact"), source: "declared", freshness: "current-run" };
  }
  return {
    fact: normalizeIdentifier(entry?.fact ?? entry?.name, "fact"),
    source: normalizeIdentifier(entry?.source, "declared"),
    freshness: entry?.freshness ? String(entry.freshness) : "current-run",
    valueHash: entry?.valueHash ? String(entry.valueHash) : undefined,
  };
}

function normalizeRule(entry, index) {
  if (typeof entry === "string") {
    return parseRuleLine(entry, index);
  }
  return {
    id: normalizeIdentifier(entry?.id, `rule-${index + 1}`),
    subject: normalizeIdentifier(entry?.subject, "mailchimp.claim"),
    operator: ["requires", "observes", "blocks", "allows"].includes(entry?.operator) ? entry.operator : "requires",
    values: asArray(entry?.values ?? entry?.facts).map((value) => normalizeIdentifier(value, "fact")),
  };
}

function normalizeClientRuntime(value, gateName) {
  const source = typeof value === "string" ? { workflowId: value } : { ...value };
  const requestId = normalizeIdentifier(source.requestId ?? source.request ?? gateName, "mailchimp-request");
  const workflowId = normalizeIdentifier(source.workflowId ?? source.workflow ?? gateName, "mailchimp-workflow");
  const tenantId = normalizeIdentifier(source.tenantId ?? source.tenant ?? "mailchimp-tenant", "mailchimp-tenant");
  const workspaceId = normalizeIdentifier(source.workspaceId ?? source.workspace ?? tenantId, tenantId);
  const actorRole = normalizeIdentifier(source.actorRole ?? source.role ?? "operator", "operator");
  const handoffMode = ["interactive", "background", "approval"].includes(source.handoffMode)
    ? source.handoffMode
    : "approval";
  return {
    requestId,
    workflowId,
    tenantId,
    workspaceId,
    actorRole,
    handoffMode,
    clientStateKey: normalizeIdentifier(
      source.clientStateKey,
      `mailchimp:${tenantId}:${workflowId}:${requestId}`,
    ),
    continuationToken: source.continuationToken
      ? normalizeIdentifier(source.continuationToken, "continuation")
      : stableId("continue", [tenantId, workflowId, requestId]),
    requestedAt: source.requestedAt ? String(source.requestedAt) : "compile-time",
    visibleStatus: source.visibleStatus ? String(source.visibleStatus) : "waiting-for-claim-gate",
  };
}

function normalizeRolePolicy(entry, index) {
  const source = typeof entry === "string" ? { role: entry } : { ...entry };
  const role = normalizeIdentifier(source.role ?? source.name, `role-${index + 1}`);
  const canApprove = source.canApprove === true || role === "approver" || role === "admin";
  const canExecute = source.canExecute !== false;
  return {
    role,
    canApprove,
    canExecute,
    maxExternalWrites: Number.isInteger(source.maxExternalWrites) && source.maxExternalWrites >= 0
      ? source.maxExternalWrites
      : canApprove
        ? 25
        : 0,
    notes: source.notes ? String(source.notes) : undefined,
  };
}

function normalizeWorkspacePolicy(entry, tenantId, index) {
  const source = typeof entry === "string" ? { workspaceId: entry } : { ...entry };
  const workspaceId = normalizeIdentifier(source.workspaceId ?? source.workspace ?? source.id, `${tenantId}-workspace-${index + 1}`);
  const allowedRoles = asArray(source.allowedRoles ?? source.roles)
    .map((role) => normalizeIdentifier(role, "operator"))
    .filter(Boolean);
  return {
    workspaceId,
    isolationKey: stableId("workspace", [tenantId, workspaceId]),
    allowedRoles: allowedRoles.length > 0 ? [...new Set(allowedRoles)] : ["operator", "approver", "admin"],
    requiresApprovalForExternalWrite: source.requiresApprovalForExternalWrite !== false,
    allowedCapabilities: asArray(source.allowedCapabilities ?? source.capabilities)
      .map((capability) => normalizeIdentifier(capability, "capability"))
      .filter(Boolean)
      .sort(),
  };
}

function normalizeTenantPermissionPolicy(value, clientRuntime) {
  const source = typeof value === "string" ? { tenantId: value } : { ...value };
  const tenantId = normalizeIdentifier(source.tenantId ?? source.tenant ?? clientRuntime.tenantId, clientRuntime.tenantId);
  const defaultWorkspace = normalizeWorkspacePolicy(
    {
      workspaceId: clientRuntime.workspaceId,
      allowedRoles: source.allowedRoles ?? source.roles,
      requiresApprovalForExternalWrite: source.requiresApprovalForExternalWrite,
      allowedCapabilities: source.allowedCapabilities ?? source.capabilities,
    },
    tenantId,
    0,
  );
  const declaredWorkspaces = asArray(source.workspaces ?? source.workspacePolicy)
    .map((entry, index) => normalizeWorkspacePolicy(entry, tenantId, index + 1));
  const workspaceMap = new Map([defaultWorkspace, ...declaredWorkspaces].map((workspace) => [workspace.workspaceId, workspace]));
  const rolePolicies = asArray(source.rolePolicies ?? source.rolesPolicy ?? source.rolePolicy)
    .map(normalizeRolePolicy);
  const roleMap = new Map(rolePolicies.map((policy) => [policy.role, policy]));
  for (const workspace of workspaceMap.values()) {
    for (const role of workspace.allowedRoles) {
      if (!roleMap.has(role)) {
        roleMap.set(role, normalizeRolePolicy({ role }, roleMap.size));
      }
    }
  }
  return {
    tenantId,
    defaultWorkspaceId: defaultWorkspace.workspaceId,
    workspaceIsolation: source.workspaceIsolation === false ? "advisory" : "strict",
    auditRequired: source.auditRequired !== false,
    allowedRoles: [...new Set([...workspaceMap.values()].flatMap((workspace) => workspace.allowedRoles))].sort(),
    workspaces: [...workspaceMap.values()].sort((left, right) => left.workspaceId.localeCompare(right.workspaceId)),
    rolePolicies: [...roleMap.values()].sort((left, right) => left.role.localeCompare(right.role)),
    boundaryId: stableId("perm", [
      tenantId,
      [...workspaceMap.values()].map((workspace) => `${workspace.workspaceId}:${workspace.allowedRoles.join("+")}`).join(","),
      [...roleMap.values()].map((role) => `${role.role}:${role.canApprove}:${role.canExecute}:${role.maxExternalWrites}`).join(","),
    ]),
  };
}

function resolveWorkspacePolicy(tenantPolicy, workspaceId) {
  return tenantPolicy.workspaces.find((workspace) => workspace.workspaceId === workspaceId)
    ?? tenantPolicy.workspaces.find((workspace) => workspace.workspaceId === tenantPolicy.defaultWorkspaceId)
    ?? tenantPolicy.workspaces[0];
}

function buildTenantBoundaryReport(ast) {
  const workspacePolicy = resolveWorkspacePolicy(ast.tenantPolicy, ast.clientRuntime.workspaceId);
  const rolePolicy = ast.tenantPolicy.rolePolicies.find((policy) => policy.role === ast.clientRuntime.actorRole);
  const roleAllowedInWorkspace = workspacePolicy.allowedRoles.includes(ast.clientRuntime.actorRole);
  return {
    id: ast.tenantPolicy.boundaryId,
    tenantId: ast.tenantPolicy.tenantId,
    workspaceId: ast.clientRuntime.workspaceId,
    workspaceIsolationKey: workspacePolicy.isolationKey,
    isolationMode: ast.tenantPolicy.workspaceIsolation,
    actorRole: ast.clientRuntime.actorRole,
    roleAllowedInWorkspace,
    actorCanExecute: Boolean(rolePolicy?.canExecute && roleAllowedInWorkspace),
    actorCanApprove: Boolean(rolePolicy?.canApprove && roleAllowedInWorkspace),
    maxExternalWrites: rolePolicy?.maxExternalWrites ?? 0,
    allowedCapabilities: workspacePolicy.allowedCapabilities,
    auditRequired: ast.tenantPolicy.auditRequired,
    safeBoundaryBehavior: roleAllowedInWorkspace ? "handoff-with-audit" : "hold-for-tenant-review",
  };
}

function buildTenantAuditHandoffContract(ast, compiledRules, requestState) {
  const tenantBoundary = buildTenantBoundaryReport(ast);
  const pendingFacts = requestState.pendingFacts;
  const blockedRules = compiledRules.filter((rule) => rule.status === "blocked");
  const scopeChecks = [
    {
      name: "tenant-policy",
      expected: ast.tenantPolicy.tenantId,
      observed: ast.clientRuntime.tenantId,
      state: ast.tenantPolicy.tenantId === ast.clientRuntime.tenantId ? "matched" : "mismatch",
    },
    {
      name: "workspace-policy",
      expected: ast.clientRuntime.workspaceId,
      observed: tenantBoundary.workspaceId,
      state: tenantBoundary.workspaceId === ast.clientRuntime.workspaceId ? "matched" : "mismatch",
    },
    {
      name: "actor-role",
      expected: tenantBoundary.actorRole,
      observed: tenantBoundary.roleAllowedInWorkspace ? tenantBoundary.actorRole : null,
      state: tenantBoundary.roleAllowedInWorkspace ? "matched" : "denied",
    },
  ];
  const requiredAcknowledgements = [
    ...(ast.tenantPolicy.auditRequired ? ["tenant_boundary"] : []),
    ...(pendingFacts.length > 0 ? ["claim_evidence"] : []),
    ...(!tenantBoundary.actorCanExecute ? ["tenant_review"] : []),
  ];
  const blockers = [
    ...(scopeChecks.some((check) => check.state === "mismatch") ? ["tenant_scope_mismatch"] : []),
    ...(scopeChecks.some((check) => check.state === "denied") ? ["actor_role_denied"] : []),
    ...(!requestState.restartSafe ? ["request_state_not_restart_safe"] : []),
    ...(tenantBoundary.auditRequired && !ast.clientRuntime.requestId ? ["audit_request_missing"] : []),
  ].sort();
  const warnings = [
    ...(pendingFacts.length > 0 ? ["pending_claim_evidence"] : []),
    ...(blockedRules.length > 0 ? ["blocked_claim_rules"] : []),
    ...(ast.tenantPolicy.auditRequired ? ["tenant_audit_required"] : []),
  ].sort();
  const state = blockers.length
    ? "blocked"
    : warnings.length
      ? "review"
      : "ready";
  const auditShape = {
    gateId: ast.id,
    requestId: ast.clientRuntime.requestId,
    workflowId: ast.clientRuntime.workflowId,
    tenantId: tenantBoundary.tenantId,
    workspaceId: tenantBoundary.workspaceId,
    actorRole: tenantBoundary.actorRole,
    boundaryId: tenantBoundary.id,
    state,
    requestStateVersion: requestState.version,
    pendingFacts,
    blockedRuleIds: blockedRules.map((rule) => rule.id),
    scopeChecks,
  };
  const auditDigest = stableId("audithash", [
    auditShape.gateId,
    auditShape.requestStateVersion,
    auditShape.state,
    JSON.stringify(scopeChecks),
    pendingFacts.join(","),
    blockedRules.map((rule) => rule.id).join(","),
  ]);
  const auditRecordId = stableId("audithand", [
    ast.id,
    requestState.version,
    tenantBoundary.id,
    auditDigest,
  ]);
  const commands = [
    {
      id: stableId("cmd", [auditRecordId, "persist-tenant-audit"]),
      type: "persist-tenant-audit",
      idempotencyKey: stableId("idem", [auditRecordId, "persist-tenant-audit"]),
      statusAfterReplay: state,
      writes: ["tenantBoundaryId", "auditDigest", "scopeChecks", "requiredAcknowledgements"],
      conflict: "return-existing",
    },
    ...(blockers.length ? [{
      id: stableId("cmd", [auditRecordId, "raise-tenant-escalation", blockers.join(",")]),
      type: "raise-tenant-escalation",
      idempotencyKey: stableId("idem", [auditRecordId, "raise-tenant-escalation", blockers.join(",")]),
      statusAfterReplay: "needs-tenant-review",
      writes: ["blockers", "requiredActions"],
      conflict: "return-existing",
    }] : []),
  ];
  return {
    id: auditRecordId,
    contractVersion: "aios.mailchimp.tenant-audit-handoff.v1",
    product: "mailchimp",
    state,
    ready: state === "ready",
    tenantId: tenantBoundary.tenantId,
    workspaceId: tenantBoundary.workspaceId,
    actorRole: tenantBoundary.actorRole,
    boundaryId: tenantBoundary.id,
    auditRequired: ast.tenantPolicy.auditRequired,
    auditDigest,
    scopeChecks,
    requiredAcknowledgements,
    commands,
    blockers,
    warnings,
    nextAction: state === "blocked"
      ? tenantAuditAction(blockers[0])
      : state === "review"
        ? "review-tenant-audit-handoff"
        : "persist-tenant-audit-handoff",
  };
}

function buildWorkflowHandoff(ast, compiledRules) {
  const blockedRules = compiledRules.filter((rule) => rule.status === "blocked");
  const tenantBoundary = buildTenantBoundaryReport(ast);
  const requiredActions = blockedRules.flatMap((rule) => (
    rule.operator === "blocks"
      ? [{ type: "remove-block", ruleId: rule.id, subject: rule.subject }]
      : rule.missing.map((fact) => ({ type: "provide-evidence", ruleId: rule.id, fact }))
  ));
  if (!tenantBoundary.roleAllowedInWorkspace) {
    requiredActions.push({
      type: "repair-tenant-permission",
      tenantId: tenantBoundary.tenantId,
      workspaceId: tenantBoundary.workspaceId,
      actorRole: tenantBoundary.actorRole,
    });
  }
  return {
    requestId: ast.clientRuntime.requestId,
    workflowId: ast.clientRuntime.workflowId,
    tenantId: ast.clientRuntime.tenantId,
    workspaceId: ast.clientRuntime.workspaceId,
    handoffMode: ast.clientRuntime.handoffMode,
    continuationToken: ast.clientRuntime.continuationToken,
    visibleStatus: blockedRules.length > 0 || !tenantBoundary.actorCanExecute ? "needs-evidence" : "ready-for-runtime",
    nextAction: blockedRules.length > 0
      ? "collect-missing-evidence"
      : tenantBoundary.actorCanExecute
        ? "handoff-to-runtime-adapter"
        : "repair-tenant-permission",
    requiredActions,
    tenantBoundary,
  };
}

function buildRequestStateSnapshot(ast, compiledRules, evidenceFacts) {
  const pendingFacts = [...new Set(compiledRules.flatMap((rule) => rule.missing))].sort();
  const blockedRules = compiledRules.filter((rule) => rule.status === "blocked");
  const status = blockedRules.length > 0 ? "needs-evidence" : "ready-for-runtime";
  const version = stableId("state", [
    ast.clientRuntime.tenantId,
    ast.clientRuntime.workflowId,
    ast.clientRuntime.requestId,
    compiledRules.map((rule) => `${rule.id}:${rule.status}:${rule.missing.join("+")}`).join(","),
  ]);
  const resumeCursor = stableId("cursor", [
    ast.clientRuntime.clientStateKey,
    ast.clientRuntime.continuationToken,
    status,
    pendingFacts.join(","),
  ]);
  const commandBase = [
    ast.clientRuntime.tenantId,
    ast.clientRuntime.workflowId,
    ast.clientRuntime.requestId,
    version,
  ];
  const commands = [
    {
      id: stableId("cmd", [...commandBase, "persist-claim-state"]),
      type: "persist-claim-state",
      idempotencyKey: stableId("idem", [...commandBase, "persist-claim-state"]),
      statusAfterReplay: status,
      writes: ["status", "verifiedFacts", "pendingFacts", "resumeCursor"],
      conflict: "return-existing",
    },
    ...pendingFacts.map((fact) => ({
      id: stableId("cmd", [...commandBase, "await-evidence", fact]),
      type: "await-evidence",
      fact,
      idempotencyKey: stableId("idem", [...commandBase, "await-evidence", fact]),
      statusAfterReplay: "needs-evidence",
      writes: ["pendingFacts", "requiredActions"],
      conflict: "return-existing",
    })),
  ];
  return {
    key: ast.clientRuntime.clientStateKey,
    version,
    status,
    terminal: status === "ready-for-runtime",
    restartSafe: true,
    resumeCursor,
    continuationToken: ast.clientRuntime.continuationToken,
    verifiedFacts: [...evidenceFacts].sort(),
    pendingFacts,
    blockedRuleIds: blockedRules.map((rule) => rule.id),
    commands,
    recoveryPaths: {
      onRestart: pendingFacts.length > 0 ? "resume-evidence-collection" : "handoff-to-runtime-adapter",
      onDuplicateCommand: "return-existing-state",
      onStaleVersion: "reload-latest-request-state",
      rollback: "release-claim-gate-hold",
    },
    visibleStatus: {
      waiting: "waiting-for-claim-gate",
      current: status,
      afterEvidence: pendingFacts.length > 0 ? "ready-for-runtime" : status,
      blocked: "blocked",
    },
  };
}

function buildClientResumeContract(ast, compiledRules, requestState) {
  const blockedRules = compiledRules.filter((rule) => rule.status === "blocked");
  const evidenceActions = requestState.pendingFacts.map((fact) => ({
    id: stableId("resumeact", [requestState.key, requestState.version, "evidence", fact]),
    type: "collect-evidence",
    fact,
    statusAfterCompletion: "claim-evidence-recorded",
    resumesWith: requestState.resumeCursor,
  }));
  const boundary = buildTenantBoundaryReport(ast);
  const boundaryAction = boundary.actorCanExecute ? null : {
    id: stableId("resumeact", [requestState.key, requestState.version, "tenant-boundary", boundary.id]),
    type: "repair-tenant-boundary",
    tenantId: boundary.tenantId,
    workspaceId: boundary.workspaceId,
    actorRole: boundary.actorRole,
    statusAfterCompletion: "tenant-boundary-reviewed",
    resumesWith: requestState.resumeCursor,
  };
  const actions = [
    ...evidenceActions,
    ...(boundaryAction ? [boundaryAction] : []),
  ];
  const blockedRuleSummaries = blockedRules.map((rule) => ({
    ruleId: rule.id,
    subject: rule.subject,
    operator: rule.operator,
    missingFacts: rule.missing,
    actionIds: actions
      .filter((action) => rule.missing.includes(action.fact))
      .map((action) => action.id),
  }));
  const screenState = requestState.status === "ready-for-runtime" && boundary.actorCanExecute
    ? "ready"
    : requestState.pendingFacts.length > 0
      ? "needs-evidence"
      : "needs-tenant-review";
  return {
    id: stableId("clientresume", [
      ast.id,
      requestState.version,
      requestState.resumeCursor,
      boundary.id,
      screenState,
    ]),
    contractVersion: "aios.mailchimp.client-resume.v1",
    product: "mailchimp",
    requestId: ast.clientRuntime.requestId,
    workflowId: ast.clientRuntime.workflowId,
    tenantId: ast.clientRuntime.tenantId,
    workspaceId: ast.clientRuntime.workspaceId,
    stateKey: requestState.key,
    stateVersion: requestState.version,
    continuationToken: ast.clientRuntime.continuationToken,
    resumeCursor: requestState.resumeCursor,
    screenState,
    visibleStatus: screenState === "ready"
      ? "ready-for-runtime"
      : screenState === "needs-evidence"
        ? "needs-mailchimp-evidence"
        : "needs-tenant-review",
    primaryAction: actions[0]?.type ?? "continue-runtime-handoff",
    actions,
    blockedRuleSummaries,
    durableSnapshot: {
      status: requestState.status,
      verifiedFacts: requestState.verifiedFacts,
      pendingFacts: requestState.pendingFacts,
      blockedRuleIds: requestState.blockedRuleIds,
      commandIds: requestState.commands.map((command) => command.id),
    },
    restartSemantics: {
      restartSafe: requestState.restartSafe,
      onRestart: actions.length > 0 ? "resume-client-actions" : "continue-runtime-handoff",
      onDuplicateAction: "return-existing-request-state",
      onEvidenceMutation: "recompute-claim-state-version",
    },
  };
}

function countBy(items, keySelector) {
  return items.reduce((counts, item) => {
    const key = keySelector(item);
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function buildClaimGateReporting(ast, compiledRules, issues, requestState, tenantAuditHandoff = null) {
  const tenantBoundary = buildTenantBoundaryReport(ast);
  const verifiedFacts = requestState.verifiedFacts;
  const pendingFacts = requestState.pendingFacts;
  const blockedRules = compiledRules.filter((rule) => rule.status === "blocked");
  const satisfiedRules = compiledRules.filter((rule) => rule.status === "satisfied");
  const issueCounts = countBy(issues, (issue) => issue.severity);
  const ruleOperatorCounts = countBy(compiledRules, (rule) => rule.operator);
  const ruleStatusCounts = countBy(compiledRules, (rule) => rule.status);
  const historyScope = [
    ast.id,
    requestState.version,
    tenantBoundary.id,
    requestState.status,
  ];
  const snapshots = [
    {
      id: stableId("gatehist", [...historyScope, "compiled"]),
      sequence: 1,
      type: "claim-gate-compiled",
      status: requestState.status,
      requestId: ast.clientRuntime.requestId,
      workflowId: ast.clientRuntime.workflowId,
      verifiedFacts: verifiedFacts.length,
      pendingFacts: pendingFacts.length,
      blockedRules: blockedRules.length,
    },
    {
      id: stableId("gatehist", [...historyScope, "tenant-boundary"]),
      sequence: 2,
      type: "tenant-boundary-evaluated",
      status: tenantBoundary.actorCanExecute ? "tenant-ready" : "tenant-hold",
      tenantId: tenantBoundary.tenantId,
      workspaceId: tenantBoundary.workspaceId,
      actorRole: tenantBoundary.actorRole,
      roleAllowedInWorkspace: tenantBoundary.roleAllowedInWorkspace,
      safeBoundaryBehavior: tenantBoundary.safeBoundaryBehavior,
    },
    {
      id: stableId("gatehist", [...historyScope, "tenant-audit", tenantAuditHandoff?.auditDigest]),
      sequence: 3,
      type: "tenant-audit-handoff",
      status: tenantAuditHandoff?.state ?? "unknown",
      tenantId: tenantBoundary.tenantId,
      workspaceId: tenantBoundary.workspaceId,
      auditDigest: tenantAuditHandoff?.auditDigest ?? null,
      commandCount: tenantAuditHandoff?.commands?.length ?? 0,
      nextAction: tenantAuditHandoff?.nextAction ?? null,
    },
    {
      id: stableId("gatehist", [...historyScope, "evidence"]),
      sequence: 4,
      type: pendingFacts.length > 0 ? "evidence-pending" : "evidence-complete",
      status: pendingFacts.length > 0 ? "needs-evidence" : "ready-for-runtime",
      facts: pendingFacts.length > 0 ? pendingFacts : verifiedFacts,
      nextAction: pendingFacts.length > 0 ? "collect-missing-evidence" : "handoff-to-runtime-adapter",
      resumeCursor: requestState.resumeCursor,
    },
  ];
  const timeline = [
    {
      sequence: 1,
      event: "persist-claim-state",
      status: requestState.status,
      commandId: requestState.commands.find((command) => command.type === "persist-claim-state")?.id ?? null,
      restartSafe: requestState.restartSafe,
    },
    ...pendingFacts.map((fact, index) => ({
      sequence: index + 2,
      event: "await-evidence",
      status: "needs-evidence",
      fact,
      commandId: requestState.commands.find((command) => command.fact === fact)?.id ?? null,
      restartSafe: requestState.restartSafe,
    })),
    {
      sequence: pendingFacts.length + 2,
      event: tenantBoundary.actorCanExecute ? "runtime-handoff-ready" : "tenant-review-required",
      status: tenantBoundary.actorCanExecute && pendingFacts.length === 0 ? "ready-for-runtime" : "blocked",
      commandId: null,
      restartSafe: requestState.restartSafe,
    },
  ];
  const exportSummary = {
    format: "aios.mailchimp.claim-gate.v1",
    gateId: ast.id,
    product: ast.product,
    requestId: ast.clientRuntime.requestId,
    workflowId: ast.clientRuntime.workflowId,
    tenantId: tenantBoundary.tenantId,
    workspaceId: tenantBoundary.workspaceId,
    status: requestState.status,
    admissionReady: requestState.status === "ready-for-runtime" && tenantBoundary.actorCanExecute,
    counters: {
      rulesTotal: compiledRules.length,
      rulesSatisfied: satisfiedRules.length,
      rulesBlocked: blockedRules.length,
      evidenceDeclared: ast.evidence.length,
      verifiedFacts: verifiedFacts.length,
      pendingFacts: pendingFacts.length,
      issuesTotal: issues.length,
      commandsPlanned: requestState.commands.length,
      tenantRolesAllowed: ast.tenantPolicy.allowedRoles.length,
      workspacePolicies: ast.tenantPolicy.workspaces.length,
      tenantAuditReady: tenantAuditHandoff?.ready ? 1 : 0,
      tenantAuditCommands: tenantAuditHandoff?.commands?.length ?? 0,
      tenantAuditBlockers: tenantAuditHandoff?.blockers?.length ?? 0,
    },
    byRuleOperator: ruleOperatorCounts,
    byRuleStatus: ruleStatusCounts,
    byIssueSeverity: issueCounts,
    pendingFacts,
    blockedRuleIds: blockedRules.map((rule) => rule.id),
    resumeCursor: requestState.resumeCursor,
    tenantAuditDigest: tenantAuditHandoff?.auditDigest ?? null,
    tenantAuditState: tenantAuditHandoff?.state ?? "unknown",
    historySnapshotIds: snapshots.map((snapshot) => snapshot.id),
  };
  return {
    generatedBy: "claim-gate-compiler",
    counters: exportSummary.counters,
    byRuleOperator: ruleOperatorCounts,
    byRuleStatus: ruleStatusCounts,
    byIssueSeverity: issueCounts,
    snapshots,
    timeline,
    exportSummary,
  };
}

function buildClaimAcceptanceContract(ast, compiledRules, issues, requestState, reporting) {
  const tenantBoundary = buildTenantBoundaryReport(ast);
  const pendingFacts = requestState.pendingFacts;
  const errorIssues = issues.filter((issue) => issue.severity === "error");
  const warningIssues = issues.filter((issue) => issue.severity === "warning");
  const blockedRules = compiledRules.filter((rule) => rule.status === "blocked");
  const readyForRuntime = requestState.status === "ready-for-runtime"
    && tenantBoundary.actorCanExecute
    && errorIssues.length === 0;
  const acceptanceToken = stableId("claimaccept", [
    ast.id,
    requestState.version,
    requestState.resumeCursor,
    tenantBoundary.id,
    reporting.exportSummary.status,
    pendingFacts.join(","),
  ]);
  const requiredInputs = [
    {
      name: "claimAcceptanceToken",
      value: acceptanceToken,
      required: true,
      reason: "Binds client acceptance to the exact claim-state preview.",
    },
    {
      name: "claimStateVersion",
      value: requestState.version,
      required: true,
      reason: "Prevents accepting a stale claim gate state after evidence changes.",
    },
    {
      name: "tenantBoundaryId",
      value: tenantBoundary.id,
      required: true,
      reason: "Binds acceptance to the active tenant permission boundary.",
    },
    {
      name: "resumeCursor",
      value: requestState.resumeCursor,
      required: pendingFacts.length > 0,
      reason: "Lets clients resume evidence collection without recomputing gate state.",
    },
  ];
  const validationChecks = [
    {
      name: "claim-evidence",
      status: pendingFacts.length > 0 ? "blocked" : "ready",
      detail: pendingFacts.length > 0
        ? `${pendingFacts.length} Mailchimp claim fact(s) still need evidence.`
        : "All Mailchimp claim facts required by the gate are verified.",
      nextAction: pendingFacts.length > 0 ? "collect-missing-evidence" : "acknowledge-claim-preview",
      factNames: pendingFacts,
    },
    {
      name: "tenant-boundary",
      status: tenantBoundary.actorCanExecute ? "ready" : "blocked",
      detail: tenantBoundary.actorCanExecute
        ? `Actor role ${tenantBoundary.actorRole} can execute in workspace ${tenantBoundary.workspaceId}.`
        : `Actor role ${tenantBoundary.actorRole} is held for tenant review in workspace ${tenantBoundary.workspaceId}.`,
      nextAction: tenantBoundary.actorCanExecute ? "acknowledge-tenant-boundary" : "repair-tenant-permission",
      boundaryId: tenantBoundary.id,
    },
    {
      name: "issue-review",
      status: errorIssues.length > 0 ? "blocked" : warningIssues.length > 0 ? "review" : "ready",
      detail: errorIssues.length > 0
        ? `${errorIssues.length} claim gate error(s) block acceptance.`
        : warningIssues.length > 0
          ? `${warningIssues.length} claim gate warning(s) should be reviewed.`
          : "Claim gate validation has no blocking issues.",
      nextAction: errorIssues.length > 0 ? "repair-claim-gate-errors" : "review-claim-gate-preview",
      issueCodes: issues.map((issue) => issue.code),
    },
    {
      name: "request-state",
      status: requestState.restartSafe ? "ready" : "blocked",
      detail: requestState.restartSafe
        ? `Request state ${requestState.key} can resume from cursor ${requestState.resumeCursor}.`
        : `Request state ${requestState.key} is not restart-safe.`,
      nextAction: requestState.restartSafe ? "persist-claim-acknowledgment" : "repair-request-state",
      commandIds: requestState.commands.map((command) => command.id),
    },
  ];
  const blockingChecks = validationChecks.filter((check) => check.status === "blocked");
  const reviewChecks = validationChecks.filter((check) => check.status === "review");
  const acknowledgementCommand = {
    id: stableId("cmd", [
      ast.clientRuntime.tenantId,
      ast.clientRuntime.workflowId,
      ast.clientRuntime.requestId,
      requestState.version,
      "persist-claim-acknowledgment",
    ]),
    type: "persist-claim-acknowledgment",
    idempotencyKey: stableId("idem", [
      ast.clientRuntime.clientStateKey,
      acceptanceToken,
      "persist-claim-acknowledgment",
    ]),
    statusAfterReplay: readyForRuntime ? "claim-preview-accepted" : "claim-preview-recorded",
    writes: ["claimAcceptanceToken", "claimStateVersion", "tenantBoundaryId", "acceptedAt"],
    conflict: "return-existing",
  };
  return {
    id: stableId("claimpreview", [acceptanceToken, requestState.key, tenantBoundary.id]),
    format: "aios.mailchimp.claim-acceptance.v1",
    product: "mailchimp",
    status: readyForRuntime
      ? "ready"
      : blockingChecks.length > 0
        ? "blocked"
        : "review",
    visibleStatus: readyForRuntime
      ? "ready-to-acknowledge"
      : blockingChecks.length > 0
        ? "blocked-before-acknowledgment"
        : "review-before-acknowledgment",
    nextAction: blockingChecks[0]?.nextAction
      ?? reviewChecks[0]?.nextAction
      ?? "persist-claim-acknowledgment",
    acceptanceToken,
    canAcknowledge: readyForRuntime,
    preview: {
      title: "Mailchimp claim gate preview",
      requestId: ast.clientRuntime.requestId,
      workflowId: ast.clientRuntime.workflowId,
      tenantId: ast.clientRuntime.tenantId,
      workspaceId: ast.clientRuntime.workspaceId,
      stateKey: requestState.key,
      stateVersion: requestState.version,
      resumeCursor: requestState.resumeCursor,
      verifiedFacts: requestState.verifiedFacts,
      pendingFacts,
      blockedRuleIds: blockedRules.map((rule) => rule.id),
      tenantBoundary,
    },
    validationSummary: {
      valid: errorIssues.length === 0,
      readyForRuntime,
      issueCounts: reporting.byIssueSeverity,
      issueCodes: issues.map((issue) => issue.code),
      pendingFacts,
      blockedRuleIds: blockedRules.map((rule) => rule.id),
      verifiedFacts: requestState.verifiedFacts,
      requiredInputNames: requiredInputs.filter((input) => input.required).map((input) => input.name),
    },
    acknowledgement: {
      canAcknowledge: readyForRuntime,
      acknowledgeAction: readyForRuntime
        ? "acknowledge-mailchimp-claim-preview"
        : "review-claim-preview-checks",
      requiredInputs,
      command: acknowledgementCommand,
      checks: validationChecks,
    },
  };
}

function buildClaimRouteDecisionSeed(ast, compiledRules, issues, requestState, clientResumeContract, reporting, claimAcceptance, tenantAuditHandoff = null) {
  const tenantBoundary = buildTenantBoundaryReport(ast);
  const pendingFacts = requestState.pendingFacts;
  const blockedRules = compiledRules.filter((rule) => rule.status === "blocked");
  const errorIssues = issues.filter((issue) => issue.severity === "error");
  const warningIssues = issues.filter((issue) => issue.severity === "warning");
  const checks = [
    {
      id: "claim-evidence",
      label: "Claim Evidence",
      state: pendingFacts.length > 0 ? "blocked" : "ready",
      ready: pendingFacts.length === 0,
      nextAction: pendingFacts.length > 0 ? "collect-missing-evidence" : "acknowledge-claim-preview",
      facts: pendingFacts,
    },
    {
      id: "tenant-boundary",
      label: "Tenant Boundary",
      state: tenantBoundary.actorCanExecute ? "ready" : "blocked",
      ready: tenantBoundary.actorCanExecute,
      nextAction: tenantBoundary.actorCanExecute ? "acknowledge-tenant-boundary" : "repair-tenant-permission",
      boundaryId: tenantBoundary.id,
    },
    {
      id: "tenant-audit",
      label: "Tenant Audit",
      state: tenantAuditHandoff?.state ?? "unknown",
      ready: tenantAuditHandoff?.ready === true,
      nextAction: tenantAuditHandoff?.nextAction ?? "review-tenant-audit-handoff",
      auditDigest: tenantAuditHandoff?.auditDigest ?? null,
    },
    {
      id: "request-state",
      label: "Request State",
      state: requestState.restartSafe ? requestState.status : "blocked",
      ready: requestState.restartSafe && requestState.status === "ready-for-runtime",
      nextAction: requestState.restartSafe ? "persist-claim-acknowledgment" : "repair-request-state",
      stateVersion: requestState.version,
    },
    {
      id: "client-resume",
      label: "Client Resume",
      state: clientResumeContract.screenState,
      ready: clientResumeContract.screenState === "ready",
      nextAction: clientResumeContract.primaryAction,
      contractId: clientResumeContract.id,
    },
    {
      id: "claim-acceptance",
      label: "Claim Acceptance",
      state: claimAcceptance.status,
      ready: claimAcceptance.canAcknowledge === true,
      nextAction: claimAcceptance.nextAction,
      acceptanceToken: claimAcceptance.acceptanceToken,
    },
  ];
  const blockers = [
    ...pendingFacts.map((fact) => `missing_fact:${fact}`),
    ...blockedRules
      .filter((rule) => rule.operator === "blocks")
      .map((rule) => `blocked_rule:${rule.id}`),
    ...(!tenantBoundary.actorCanExecute ? ["tenant_boundary_not_executable"] : []),
    ...((tenantAuditHandoff?.blockers ?? []).map((blocker) => `tenant_audit:${blocker}`)),
    ...(!requestState.restartSafe ? ["request_state_not_restart_safe"] : []),
    ...errorIssues.map((issue) => issue.code),
  ].sort();
  const warnings = [
    ...warningIssues.map((issue) => issue.code),
    ...(tenantBoundary.auditRequired ? ["tenant_audit_required"] : []),
    ...((tenantAuditHandoff?.warnings ?? []).map((warning) => `tenant_audit:${warning}`)),
    ...(pendingFacts.length > 0 ? ["evidence_collection_required"] : []),
  ].sort();
  const firstUnready = checks.find((check) => check.ready !== true);
  const state = blockers.length
    ? "blocked"
    : checks.every((check) => check.ready)
      ? "ready"
      : warnings.length
        ? "review"
        : "waiting";
  const decisionShape = {
    gateId: ast.id,
    requestId: ast.clientRuntime.requestId,
    workflowId: ast.clientRuntime.workflowId,
    tenantId: tenantBoundary.tenantId,
    workspaceId: tenantBoundary.workspaceId,
    state,
    requestStateVersion: requestState.version,
    acceptanceToken: claimAcceptance.acceptanceToken,
    resumeCursor: requestState.resumeCursor,
    tenantAuditDigest: tenantAuditHandoff?.auditDigest ?? null,
    blockers,
  };
  return {
    id: stableId("claimroute", [
      ast.id,
      requestState.version,
      claimAcceptance.acceptanceToken,
      state,
      blockers.join(","),
    ]),
    format: "aios.mailchimp.claim-route-decision-seed.v1",
    product: "mailchimp",
    state,
    ready: state === "ready",
    presentationMode: state === "ready"
      ? "confirm"
      : state === "review"
        ? "review"
        : "repair",
    requestId: ast.clientRuntime.requestId,
    workflowId: ast.clientRuntime.workflowId,
    tenantId: tenantBoundary.tenantId,
    workspaceId: tenantBoundary.workspaceId,
    routeStateKey: requestState.key,
    routeStateVersion: requestState.version,
    continuationToken: ast.clientRuntime.continuationToken,
    resumeCursor: requestState.resumeCursor,
    acceptanceToken: claimAcceptance.acceptanceToken,
    canAcknowledge: claimAcceptance.canAcknowledge === true,
    userVisibleStatus: {
      current: state === "ready"
        ? "ready-for-confirmation"
        : state === "review"
          ? "ready-for-review"
          : state === "blocked"
            ? "needs-attention"
            : "waiting-for-claim-gate",
      completion: "claim-gate-accepted",
      failure: "claim-gate-needs-review",
    },
    validationSummary: {
      readyCheckCount: checks.filter((check) => check.ready).length,
      totalCheckCount: checks.length,
      firstUnreadyCheck: firstUnready?.id ?? null,
      issueCounts: reporting.byIssueSeverity,
      tenantAudit: {
        state: tenantAuditHandoff?.state ?? "unknown",
        ready: tenantAuditHandoff?.ready === true,
        auditDigest: tenantAuditHandoff?.auditDigest ?? null,
        commandCount: tenantAuditHandoff?.commands?.length ?? 0,
      },
      pendingFacts,
      blockedRuleIds: blockedRules.map((rule) => rule.id),
      checks,
    },
    acceptCommand: {
      ...claimAcceptance.acknowledgement.command,
      requiredInputs: claimAcceptance.acknowledgement.requiredInputs
        .filter((input) => input.required)
        .map((input) => input.name),
      statusAfterReplay: state === "ready" ? "claim-route-preview-accepted" : "claim-route-preview-recorded",
    },
    recovery: {
      restartSafe: requestState.restartSafe,
      onRestart: firstUnready ? "resume-client-actions" : "continue-runtime-handoff",
      onDuplicateCommand: "return-existing-request-state",
      resumeContractId: clientResumeContract.id,
      resumeActionCount: clientResumeContract.actions.length,
    },
    blockers,
    warnings,
    nextAction: state === "blocked"
      ? claimRouteDecisionAction(blockers[0])
      : state === "ready"
        ? "present-claim-route-confirmation"
        : firstUnready?.nextAction ?? "review-claim-route-decision",
    digest: stableId("claimroutedigest", [
      decisionShape.gateId,
      decisionShape.requestStateVersion,
      decisionShape.acceptanceToken,
      decisionShape.state,
      decisionShape.blockers.join(","),
    ]),
  };
}

function buildClaimReplayManifest(ast, requestState, clientResumeContract, reporting, claimAcceptance, routeDecisionSeed) {
  const tenantBoundary = buildTenantBoundaryReport(ast);
  const routeCommand = routeDecisionSeed.acceptCommand
    && routeDecisionSeed.acceptCommand.id !== claimAcceptance.acknowledgement.command.id
    ? {
        phase: "route-acceptance",
        type: routeDecisionSeed.acceptCommand.type,
        commandId: routeDecisionSeed.acceptCommand.id,
        idempotencyKey: routeDecisionSeed.acceptCommand.idempotencyKey,
        statusAfterReplay: routeDecisionSeed.acceptCommand.statusAfterReplay,
        conflict: routeDecisionSeed.acceptCommand.conflict ?? "return-existing",
        digest: stableId("cmdhash", [
          routeDecisionSeed.acceptCommand.id,
          routeDecisionSeed.acceptCommand.idempotencyKey,
          routeDecisionSeed.acceptCommand.statusAfterReplay,
        ]),
      }
    : null;
  const commands = [
    ...requestState.commands.map((command) => ({
      phase: command.type === "await-evidence" ? "evidence" : "request-state",
      type: command.type,
      commandId: command.id,
      idempotencyKey: command.idempotencyKey,
      statusAfterReplay: command.statusAfterReplay,
      conflict: command.conflict,
      digest: stableId("cmdhash", [
        command.id,
        command.idempotencyKey,
        command.statusAfterReplay,
        command.fact,
      ]),
    })),
    {
      phase: "claim-acceptance",
      type: claimAcceptance.acknowledgement.command.type,
      commandId: claimAcceptance.acknowledgement.command.id,
      idempotencyKey: claimAcceptance.acknowledgement.command.idempotencyKey,
      statusAfterReplay: claimAcceptance.acknowledgement.command.statusAfterReplay,
      conflict: claimAcceptance.acknowledgement.command.conflict,
      digest: stableId("cmdhash", [
        claimAcceptance.acknowledgement.command.id,
        claimAcceptance.acknowledgement.command.idempotencyKey,
        claimAcceptance.acknowledgement.command.statusAfterReplay,
      ]),
    },
    ...(routeCommand ? [routeCommand] : []),
  ].map((command, index) => ({ index, ...command }));
  const duplicateCommandKeys = commands
    .map((command) => command.idempotencyKey)
    .filter((key, index, keys) => keys.indexOf(key) !== index);
  const blockers = [
    ...(!requestState.restartSafe ? ["request-state-not-restart-safe"] : []),
    ...(!requestState.resumeCursor ? ["missing-resume-cursor"] : []),
    ...(!requestState.version ? ["missing-state-version"] : []),
    ...(!clientResumeContract.id ? ["missing-client-resume-contract"] : []),
    ...(!routeDecisionSeed.digest ? ["missing-route-decision-digest"] : []),
    ...(!commands.length ? ["missing-replay-commands"] : []),
    ...commands.filter((command) => !command.idempotencyKey).map((command) => `missing-idempotency:${command.type}`),
    ...duplicateCommandKeys.map((key) => `duplicate-idempotency:${key}`),
  ].sort();
  const state = blockers.length
    ? "blocked"
    : routeDecisionSeed.ready
      ? "ready"
      : routeDecisionSeed.state === "review"
        ? "review"
        : requestState.pendingFacts.length > 0
          ? "waiting-for-evidence"
          : "waiting";
  const replayCursor = stableId("replay", [
    requestState.key,
    requestState.version,
    requestState.resumeCursor,
    routeDecisionSeed.digest,
    commands.map((command) => `${command.commandId}:${command.digest}`).join(","),
  ]);
  const restartSafe = blockers.length === 0
    && requestState.restartSafe === true
    && commands.every((command) => command.idempotencyKey && command.conflict === "return-existing");
  return {
    format: "aios.mailchimp.claim-gate-replay.v1",
    product: "mailchimp",
    gateId: ast.id,
    tenantId: tenantBoundary.tenantId,
    workspaceId: tenantBoundary.workspaceId,
    requestId: ast.clientRuntime.requestId,
    workflowId: ast.clientRuntime.workflowId,
    state,
    ready: state === "ready",
    restartSafe,
    replayCursor,
    stateKey: requestState.key,
    stateVersion: requestState.version,
    resumeCursor: requestState.resumeCursor,
    continuationToken: ast.clientRuntime.continuationToken,
    routeDecisionDigest: routeDecisionSeed.digest,
    clientResumeContractId: clientResumeContract.id,
    commandCount: commands.length,
    commands,
    statusShape: {
      current: routeDecisionSeed.userVisibleStatus.current,
      afterReplay: routeDecisionSeed.ready ? "ready-for-confirmation" : requestState.status,
      completion: routeDecisionSeed.userVisibleStatus.completion,
      failure: routeDecisionSeed.userVisibleStatus.failure,
      terminal: routeDecisionSeed.ready,
    },
    restartSemantics: {
      onRestart: restartSafe ? "load-claim-replay-manifest" : "resume-client-actions",
      onDuplicateCommand: "return-existing-request-state",
      onStaleStateVersion: "reload-latest-claim-state",
      onEvidenceMutation: "recompute-claim-state-version",
      onTenantBoundaryChange: "rebuild-route-decision",
    },
    reporting: {
      historySnapshotIds: reporting.snapshots.map((snapshot) => snapshot.id),
      latestTimelineEvent: reporting.timeline.at(-1)?.event ?? null,
      pendingFacts: requestState.pendingFacts,
      blockedRuleIds: requestState.blockedRuleIds,
    },
    blockers,
    nextAction: state === "blocked"
      ? claimReplayAction(blockers[0])
      : state === "review"
        ? routeDecisionSeed.nextAction
        : state === "waiting-for-evidence"
          ? "collect-missing-evidence"
          : state === "ready"
            ? "persist-claim-gate-replay-manifest"
            : "wait-for-claim-gate",
    digest: stableId("claimreplaydigest", [
      ast.id,
      requestState.version,
      replayCursor,
      state,
      blockers.join(","),
    ]),
  };
}

function buildClaimRouteClientHandoff({
  ast,
  requestState,
  tenantAuditHandoff,
  clientResumeContract,
  claimAcceptance,
  routeDecisionSeed,
  replayManifest,
  operationalHealth,
  analyticsExport,
}) {
  const tenantBoundary = buildTenantBoundaryReport(ast);
  const checks = [
    {
      id: "route-decision",
      state: routeDecisionSeed.state,
      ready: routeDecisionSeed.ready === true,
      digest: routeDecisionSeed.digest,
      nextAction: routeDecisionSeed.nextAction,
    },
    {
      id: "claim-acceptance",
      state: claimAcceptance.status,
      ready: claimAcceptance.canAcknowledge === true,
      digest: claimAcceptance.acceptanceToken,
      nextAction: claimAcceptance.nextAction,
    },
    {
      id: "client-resume",
      state: clientResumeContract.screenState,
      ready: clientResumeContract.screenState === "ready",
      digest: clientResumeContract.id,
      nextAction: clientResumeContract.primaryAction,
    },
    {
      id: "tenant-audit",
      state: tenantAuditHandoff.state,
      ready: tenantAuditHandoff.ready === true,
      digest: tenantAuditHandoff.auditDigest,
      nextAction: tenantAuditHandoff.nextAction,
    },
    {
      id: "replay-manifest",
      state: replayManifest.state,
      ready: replayManifest.restartSafe === true,
      digest: replayManifest.digest,
      nextAction: replayManifest.nextAction,
    },
    {
      id: "operational-health",
      state: operationalHealth.state,
      ready: operationalHealth.ready === true,
      digest: operationalHealth.digest,
      nextAction: operationalHealth.nextAction,
    },
  ];
  const blockers = [
    ...(routeDecisionSeed.blockers ?? []).map((blocker) => `route:${blocker}`),
    ...(replayManifest.blockers ?? []).map((blocker) => `replay:${blocker}`),
    ...(tenantAuditHandoff.blockers ?? []).map((blocker) => `tenant_audit:${blocker}`),
    ...(operationalHealth.actionableErrors ?? [])
      .filter((error) => error.retryable === false)
      .map((error) => `health:${error.code}`),
    ...(!requestState.restartSafe ? ["request-state-not-restart-safe"] : []),
    ...(!routeDecisionSeed.acceptCommand?.id && routeDecisionSeed.ready ? ["missing-route-accept-command"] : []),
  ].sort();
  const warnings = [
    ...(routeDecisionSeed.warnings ?? []).map((warning) => `route:${warning}`),
    ...(tenantAuditHandoff.warnings ?? []).map((warning) => `tenant_audit:${warning}`),
    ...(operationalHealth.warnings ?? []).map((warning) => `health:${warning.code}`),
    ...(analyticsExport.state === "review" ? ["analytics-export-review"] : []),
  ].sort();
  const firstUnready = checks.find((check) => check.ready !== true);
  const state = blockers.length
    ? "blocked"
    : routeDecisionSeed.state === "review" || warnings.length
      ? "review"
      : checks.every((check) => check.ready)
        ? "ready"
        : requestState.pendingFacts.length > 0
          ? "waiting-for-evidence"
          : "waiting";
  const handoffCommand = {
    id: state === "ready"
      ? stableId("cmd", [
          ast.clientRuntime.tenantId,
          ast.clientRuntime.workflowId,
          ast.clientRuntime.requestId,
          routeDecisionSeed.digest,
          "persist-route-client-handoff",
        ])
      : null,
    type: "persist-route-client-handoff",
    idempotencyKey: state === "ready"
      ? stableId("idem", [
          ast.clientRuntime.clientStateKey,
          routeDecisionSeed.digest,
          replayManifest.replayCursor,
          "persist-route-client-handoff",
        ])
      : null,
    statusAfterReplay: state === "ready" ? "route-client-handoff-ready" : "route-client-handoff-waiting",
    conflict: "return-existing",
    requiredInputs: ["routeDecisionDigest", "stateVersion", "resumeCursor", "replayCursor"],
  };
  const digest = stableId("routehandoff", [
    ast.id,
    requestState.version,
    routeDecisionSeed.digest,
    replayManifest.digest,
    operationalHealth.digest,
    state,
    blockers.join(","),
  ]);
  return {
    format: "aios.mailchimp.claim-route-client-handoff.v1",
    product: "mailchimp",
    gateId: ast.id,
    requestId: ast.clientRuntime.requestId,
    workflowId: ast.clientRuntime.workflowId,
    tenantId: tenantBoundary.tenantId,
    workspaceId: tenantBoundary.workspaceId,
    state,
    ready: state === "ready",
    presentationMode: state === "ready"
      ? "confirm"
      : state === "review"
        ? "review"
        : "repair",
    userVisibleStatus: {
      current: state === "ready"
        ? "ready-for-confirmation"
        : state === "review"
          ? "ready-for-review"
          : state === "waiting-for-evidence"
            ? "needs-mailchimp-evidence"
            : "needs-attention",
      completion: "claim-route-client-handoff-accepted",
      failure: "claim-route-client-handoff-needs-review",
    },
    preview: {
      routeDecisionId: routeDecisionSeed.id,
      routeDecisionDigest: routeDecisionSeed.digest,
      acceptanceToken: claimAcceptance.acceptanceToken,
      resumeCursor: requestState.resumeCursor,
      replayCursor: replayManifest.replayCursor,
      pendingFacts: requestState.pendingFacts,
      tenantAuditDigest: tenantAuditHandoff.auditDigest,
    },
    validationSummary: {
      readyCheckCount: checks.filter((check) => check.ready).length,
      totalCheckCount: checks.length,
      firstUnreadyCheck: firstUnready?.id ?? null,
      blockers,
      warnings,
      checks,
    },
    command: handoffCommand,
    restartSemantics: {
      restartSafe: replayManifest.restartSafe === true && requestState.restartSafe === true,
      onRestart: state === "ready" ? "load-route-client-handoff" : replayManifest.restartSemantics.onRestart,
      onDuplicateCommand: "return-existing-request-state",
      onStaleStateVersion: "reload-latest-claim-state",
    },
    analytics: {
      exportDigest: analyticsExport.digest,
      operationalHealthDigest: operationalHealth.digest,
      latestSnapshotId: analyticsExport.reporting.latestSnapshotId,
    },
    blockers,
    warnings,
    nextAction: state === "blocked"
      ? claimRouteClientHandoffAction(blockers[0])
      : state === "review"
        ? routeDecisionSeed.nextAction
        : state === "ready"
          ? "present-route-client-confirmation"
          : firstUnready?.nextAction ?? "wait-for-claim-route-client-handoff",
    digest,
  };
}

function collectClaimRouteClientHandoffIssues(routeClientHandoff) {
  const issues = [];
  if (routeClientHandoff.state === "blocked") {
    issues.push({
      code: "claim-gate.route-client-handoff-blocked",
      severity: "error",
      message: "Claim route client handoff cannot be presented until blockers are repaired.",
      blockers: routeClientHandoff.blockers,
      digest: routeClientHandoff.digest,
    });
  }
  if (routeClientHandoff.ready && !routeClientHandoff.command.idempotencyKey) {
    issues.push({
      code: "claim-gate.route-client-handoff-idempotency-missing",
      severity: "error",
      message: "Ready route client handoff must include an idempotent persist command.",
      digest: routeClientHandoff.digest,
    });
  }
  if (routeClientHandoff.state === "review") {
    issues.push({
      code: "claim-gate.route-client-handoff-review",
      severity: "warning",
      message: "Claim route client handoff is presentable with review warnings.",
      warnings: routeClientHandoff.warnings,
      digest: routeClientHandoff.digest,
    });
  }
  return issues;
}

function buildClaimRuntimeAdoptionPacket({
  ast,
  requestState,
  tenantAuditHandoff,
  clientResumeContract,
  claimAcceptance,
  routeDecisionSeed,
  replayManifest,
  routeClientHandoff,
  operationalHealth,
  analyticsExport,
}) {
  const tenantBoundary = buildTenantBoundaryReport(ast);
  const adoptionKey = stableId("adopt", [
    ast.clientRuntime.clientStateKey,
    requestState.version,
    routeClientHandoff.digest,
    replayManifest.replayCursor,
  ]);
  const checkpoints = [
    {
      id: "request-state",
      state: requestState.status,
      ready: requestState.status === "ready-for-runtime" && requestState.restartSafe === true,
      digest: requestState.version,
      nextAction: requestState.pendingFacts.length ? "collect-missing-evidence" : "continue-runtime-handoff",
    },
    {
      id: "tenant-audit",
      state: tenantAuditHandoff.state,
      ready: tenantAuditHandoff.ready === true,
      digest: tenantAuditHandoff.auditDigest,
      nextAction: tenantAuditHandoff.nextAction,
    },
    {
      id: "claim-acceptance",
      state: claimAcceptance.status,
      ready: claimAcceptance.canAcknowledge === true,
      digest: claimAcceptance.acceptanceToken,
      nextAction: claimAcceptance.nextAction,
    },
    {
      id: "route-decision",
      state: routeDecisionSeed.state,
      ready: routeDecisionSeed.ready === true,
      digest: routeDecisionSeed.digest,
      nextAction: routeDecisionSeed.nextAction,
    },
    {
      id: "route-client-handoff",
      state: routeClientHandoff.state,
      ready: routeClientHandoff.ready === true,
      digest: routeClientHandoff.digest,
      nextAction: routeClientHandoff.nextAction,
    },
    {
      id: "replay-manifest",
      state: replayManifest.state,
      ready: replayManifest.restartSafe === true,
      digest: replayManifest.digest,
      nextAction: replayManifest.nextAction,
    },
    {
      id: "operational-health",
      state: operationalHealth.state,
      ready: operationalHealth.ready === true,
      digest: operationalHealth.digest,
      nextAction: operationalHealth.nextAction,
    },
  ];
  const blockers = [
    ...requestState.pendingFacts.map((fact) => `pending_fact:${fact}`),
    ...(!tenantBoundary.actorCanExecute ? ["tenant_boundary_not_executable"] : []),
    ...(tenantAuditHandoff.blockers ?? []).map((blocker) => `tenant_audit:${blocker}`),
    ...(routeDecisionSeed.blockers ?? []).map((blocker) => `route:${blocker}`),
    ...(routeClientHandoff.blockers ?? []).map((blocker) => `client_handoff:${blocker}`),
    ...(replayManifest.blockers ?? []).map((blocker) => `replay:${blocker}`),
    ...(operationalHealth.actionableErrors ?? [])
      .filter((error) => error.retryable === false)
      .map((error) => `health:${error.code}`),
    ...(!requestState.restartSafe ? ["request_state_not_restart_safe"] : []),
    ...(!replayManifest.restartSafe ? ["replay_manifest_not_restart_safe"] : []),
    ...(!routeClientHandoff.digest ? ["missing_route_client_handoff_digest"] : []),
  ].sort();
  const warnings = [
    ...(tenantAuditHandoff.warnings ?? []).map((warning) => `tenant_audit:${warning}`),
    ...(routeDecisionSeed.warnings ?? []).map((warning) => `route:${warning}`),
    ...(routeClientHandoff.warnings ?? []).map((warning) => `client_handoff:${warning}`),
    ...(operationalHealth.warnings ?? []).map((warning) => `health:${warning.code}`),
    ...(analyticsExport.state === "review" ? ["analytics_export_review"] : []),
  ].sort();
  const firstUnready = checkpoints.find((checkpoint) => checkpoint.ready !== true);
  const state = blockers.length
    ? "blocked"
    : routeClientHandoff.state === "review" || warnings.length
      ? "review"
      : checkpoints.every((checkpoint) => checkpoint.ready)
        ? "adoptable"
        : requestState.pendingFacts.length
          ? "waiting-for-evidence"
          : "waiting";
  const ready = state === "adoptable";
  const command = {
    id: ready
      ? stableId("cmd", [
          adoptionKey,
          routeClientHandoff.digest,
          replayManifest.replayCursor,
          "persist-runtime-adoption",
        ])
      : null,
    type: "persist-runtime-adoption",
    idempotencyKey: ready
      ? stableId("idem", [
          adoptionKey,
          routeClientHandoff.command?.idempotencyKey,
          routeDecisionSeed.acceptanceToken,
          "persist-runtime-adoption",
        ])
      : null,
    statusAfterReplay: ready ? "runtime-adoption-ready" : "runtime-adoption-waiting",
    conflict: "return-existing",
    writes: ["adoptionKey", "routeDecisionDigest", "clientHandoffDigest", "replayCursor", "visibleStatus"],
  };
  const digest = stableId("adoptdigest", [
    adoptionKey,
    state,
    checkpoints.map((checkpoint) => `${checkpoint.id}:${checkpoint.state}:${checkpoint.digest}`).join(","),
    blockers.join(","),
  ]);
  return {
    format: "aios.mailchimp.claim-runtime-adoption.v1",
    product: "mailchimp",
    gateId: ast.id,
    requestId: ast.clientRuntime.requestId,
    workflowId: ast.clientRuntime.workflowId,
    tenantId: tenantBoundary.tenantId,
    workspaceId: tenantBoundary.workspaceId,
    adoptionKey,
    state,
    ready,
    handoffMode: ast.clientRuntime.handoffMode,
    userVisibleStatus: {
      current: ready
        ? "ready-for-runtime-adoption"
        : state === "review"
          ? "runtime-adoption-needs-review"
          : state === "waiting-for-evidence"
            ? "runtime-adoption-needs-evidence"
            : "runtime-adoption-blocked",
      completion: "runtime-adoption-complete",
      failure: "runtime-adoption-needs-review",
    },
    command,
    runtimeInputs: {
      clientStateKey: ast.clientRuntime.clientStateKey,
      stateVersion: requestState.version,
      routeDecisionDigest: routeDecisionSeed.digest,
      clientHandoffDigest: routeClientHandoff.digest,
      acceptanceToken: claimAcceptance.acceptanceToken,
      continuationToken: ast.clientRuntime.continuationToken,
      resumeCursor: requestState.resumeCursor,
      replayCursor: replayManifest.replayCursor,
    },
    checkpoints,
    restartSemantics: {
      restartSafe: requestState.restartSafe === true && replayManifest.restartSafe === true,
      onRestart: ready ? "load-runtime-adoption-packet" : firstUnready?.nextAction ?? "resume-claim-gate",
      onDuplicateCommand: "return-existing-runtime-adoption",
      onStaleStateVersion: "reload-latest-claim-state",
      onEvidenceMutation: "recompute-runtime-adoption-packet",
    },
    reporting: {
      analyticsDigest: analyticsExport.digest,
      operationalHealthDigest: operationalHealth.digest,
      latestSnapshotId: analyticsExport.reporting.latestSnapshotId,
      routeClientHandoffDigest: routeClientHandoff.digest,
      replayDigest: replayManifest.digest,
    },
    blockers,
    warnings,
    nextAction: state === "blocked"
      ? claimRuntimeAdoptionAction(blockers[0])
      : state === "review"
        ? routeClientHandoff.nextAction
        : ready
          ? "persist-runtime-adoption-packet"
          : firstUnready?.nextAction ?? "wait-for-runtime-adoption",
    digest,
  };
}

function collectClaimRuntimeAdoptionIssues(packet) {
  const issues = [];
  if (packet.state === "blocked") {
    issues.push({
      code: "claim-gate.runtime-adoption-blocked",
      severity: "error",
      message: "Claim gate runtime adoption cannot proceed until blockers are repaired.",
      blockers: packet.blockers,
      digest: packet.digest,
    });
  }
  if (packet.ready && !packet.command.idempotencyKey) {
    issues.push({
      code: "claim-gate.runtime-adoption-idempotency-missing",
      severity: "error",
      message: "Ready runtime adoption must include an idempotent persist command.",
      digest: packet.digest,
    });
  }
  if (packet.ready && packet.checkpoints.some((checkpoint) => checkpoint.ready !== true)) {
    issues.push({
      code: "claim-gate.runtime-adoption-unready-checkpoint",
      severity: "error",
      message: "Runtime adoption cannot be ready while a checkpoint is unready.",
      checkpoints: packet.checkpoints.filter((checkpoint) => checkpoint.ready !== true).map((checkpoint) => checkpoint.id),
      digest: packet.digest,
    });
  }
  if (packet.state === "review") {
    issues.push({
      code: "claim-gate.runtime-adoption-review",
      severity: "warning",
      message: "Claim gate runtime adoption is available with review warnings.",
      warnings: packet.warnings,
      digest: packet.digest,
    });
  }
  return issues;
}

function claimRuntimeAdoptionAction(blocker) {
  if (String(blocker).includes("pending_fact")) return "collect-missing-evidence";
  if (String(blocker).includes("tenant")) return "repair-tenant-audit-handoff";
  if (String(blocker).includes("route")) return "repair-claim-route-decision";
  if (String(blocker).includes("client_handoff")) return "repair-route-client-handoff";
  if (String(blocker).includes("replay")) return "repair-claim-gate-replay-manifest";
  if (String(blocker).includes("restart")) return "repair-request-state";
  if (String(blocker).includes("health")) return "repair-claim-gate";
  return "repair-runtime-adoption-packet";
}

function claimRouteClientHandoffAction(blocker) {
  if (String(blocker).includes("route:missing_fact")) return "collect-missing-evidence";
  if (String(blocker).includes("tenant")) return "repair-tenant-audit-handoff";
  if (String(blocker).includes("replay")) return "repair-claim-gate-replay-manifest";
  if (String(blocker).includes("idempotency")) return "persist-idempotent-claim-command";
  if (String(blocker).includes("request-state")) return "repair-request-state";
  if (String(blocker).includes("health")) return "repair-claim-gate";
  return "repair-route-client-handoff";
}

function claimReplayAction(blocker) {
  if (String(blocker).includes("idempotency")) return "repair-idempotent-claim-command";
  if (String(blocker).includes("resume")) return "repair-client-resume-contract";
  if (String(blocker).includes("state-version")) return "reload-latest-claim-state";
  if (String(blocker).includes("route-decision")) return "rebuild-route-decision";
  if (String(blocker).includes("tenant-boundary")) return "repair-tenant-permission";
  if (String(blocker).includes("claim-evidence")) return "collect-missing-evidence";
  if (String(blocker).includes("claim-acceptance")) return "review-claim-preview-checks";
  return "repair-claim-replay-manifest";
}

function tenantAuditAction(blocker) {
  if (String(blocker).includes("tenant")) return "repair-tenant-policy-scope";
  if (String(blocker).includes("actor")) return "repair-tenant-role-permission";
  if (String(blocker).includes("restart")) return "repair-request-state";
  if (String(blocker).includes("audit")) return "provide-audit-request-identity";
  return "review-tenant-audit-handoff";
}

function claimRouteDecisionAction(blocker) {
  if (String(blocker).startsWith("missing_fact:")) return "collect-missing-evidence";
  if (String(blocker).startsWith("blocked_rule:")) return "remove-blocking-claim-rule";
  if (String(blocker).includes("tenant")) return "repair-tenant-permission";
  if (String(blocker).includes("restart")) return "repair-request-state";
  if (String(blocker).includes("mailchimp-fact")) return "collect-mailchimp-evidence";
  return "repair-claim-route-decision";
}

function compileRule(rule, evidenceFacts) {
  const missing = rule.values.filter((value) => rule.operator === "requires" && !evidenceFacts.has(value));
  const observed = rule.values.filter((value) => evidenceFacts.has(value));
  const status = rule.operator === "blocks"
    ? "blocked"
    : missing.length > 0
      ? "blocked"
      : "satisfied";
  return {
    ...rule,
    status,
    missing,
    observed,
    truthBoundary: {
      subject: rule.subject,
      claimFacts: rule.values,
      observedFacts: observed,
      unverifiedFacts: missing,
      mode: missing.length > 0 ? "requires-evidence" : "evidence-bound",
    },
  };
}

function collectGateIssues(compiledRules, ast) {
  const issues = [];
  const tenantBoundary = buildTenantBoundaryReport(ast);
  const missingMailchimpFacts = [...REQUIRED_MAILCHIMP_FACTS].filter(
    (fact) => ast.requiredFacts.includes(fact) && !ast.evidence.some((entry) => entry.fact === fact),
  );
  for (const fact of missingMailchimpFacts) {
    issues.push({
      code: "claim-gate.mailchimp-fact-missing",
      severity: "error",
      message: `Missing Mailchimp evidence fact: ${fact}.`,
      fact,
    });
  }
  for (const rule of compiledRules) {
    if (rule.status === "blocked") {
      issues.push({
        code: "claim-gate.rule-blocked",
        severity: rule.operator === "blocks" ? "error" : "warning",
        message: `Claim rule ${rule.id} is ${rule.operator === "blocks" ? "explicitly blocked" : "missing evidence"}.`,
        ruleId: rule.id,
      });
    }
  }
  if (!ast.clientRuntime.requestId || ast.clientRuntime.requestId === ast.name) {
    issues.push({
      code: "claim-gate.client-request-derived",
      severity: "warning",
      message: "Claim gate request id was derived from the gate name; pass an explicit client request id for resumable handoff.",
      requestId: ast.clientRuntime.requestId,
    });
  }
  if (ast.clientRuntime.tenantId !== ast.tenantPolicy.tenantId) {
    issues.push({
      code: "claim-gate.tenant-policy-mismatch",
      severity: "error",
      message: "Claim gate client runtime tenant must match the tenant permission policy.",
      tenantId: ast.clientRuntime.tenantId,
      policyTenantId: ast.tenantPolicy.tenantId,
    });
  }
  if (!tenantBoundary.roleAllowedInWorkspace) {
    issues.push({
      code: "claim-gate.workspace-role-denied",
      severity: "error",
      message: `Actor role ${tenantBoundary.actorRole} is not allowed in workspace ${tenantBoundary.workspaceId}.`,
      tenantId: tenantBoundary.tenantId,
      workspaceId: tenantBoundary.workspaceId,
      actorRole: tenantBoundary.actorRole,
    });
  }
  if (tenantBoundary.auditRequired && !ast.clientRuntime.requestId) {
    issues.push({
      code: "claim-gate.audit-request-missing",
      severity: "error",
      message: "Tenant audit handoff requires an explicit request id.",
      tenantId: tenantBoundary.tenantId,
    });
  }
  return issues;
}

function collectReplayManifestIssues(replayManifest) {
  const issues = [];
  if (!replayManifest.restartSafe) {
    issues.push({
      code: "claim-gate.replay-not-restart-safe",
      severity: "error",
      message: "Claim gate replay manifest is not restart-safe.",
      blockers: replayManifest.blockers,
    });
  }
  if (!replayManifest.replayCursor) {
    issues.push({
      code: "claim-gate.replay-cursor-missing",
      severity: "error",
      message: "Claim gate replay manifest must include a replay cursor.",
    });
  }
  if (!replayManifest.commands.length) {
    issues.push({
      code: "claim-gate.replay-commands-missing",
      severity: "error",
      message: "Claim gate replay manifest must include idempotent commands.",
    });
  }
  const missingIdempotency = replayManifest.commands.filter((command) => !command.idempotencyKey);
  if (missingIdempotency.length) {
    issues.push({
      code: "claim-gate.replay-command-idempotency-missing",
      severity: "error",
      message: "Every claim gate replay command must include an idempotency key.",
      commandIds: missingIdempotency.map((command) => command.commandId),
    });
  }
  return issues;
}

function collectTenantAuditHandoffIssues(tenantAuditHandoff) {
  const issues = [];
  if (tenantAuditHandoff.state === "blocked") {
    issues.push({
      code: "claim-gate.tenant-audit-blocked",
      severity: "error",
      message: "Tenant audit handoff blocks Mailchimp claim gate admission.",
      blockers: tenantAuditHandoff.blockers,
      auditDigest: tenantAuditHandoff.auditDigest,
    });
  }
  if (tenantAuditHandoff.state === "review") {
    issues.push({
      code: "claim-gate.tenant-audit-review",
      severity: "warning",
      message: "Tenant audit handoff requires review before runtime admission.",
      warnings: tenantAuditHandoff.warnings,
      requiredAcknowledgements: tenantAuditHandoff.requiredAcknowledgements,
    });
  }
  if (!tenantAuditHandoff.commands.length) {
    issues.push({
      code: "claim-gate.tenant-audit-command-missing",
      severity: "error",
      message: "Tenant audit handoff must produce an idempotent audit command.",
      auditDigest: tenantAuditHandoff.auditDigest,
    });
  }
  return issues;
}

function buildClaimGateOperationalHealth({
  ast,
  compiledRules,
  requestState,
  tenantAuditHandoff,
  clientResumeContract,
  reporting,
  claimAcceptance,
  routeDecisionSeed,
  replayManifest,
  issues,
  options,
}) {
  const errorIssues = issues.filter((issue) => issue.severity === "error");
  const warningIssues = issues.filter((issue) => issue.severity === "warning");
  const pendingFacts = requestState.pendingFacts;
  const blockedRules = compiledRules.filter((rule) => rule.status === "blocked");
  const retryAttempt = Math.max(0, Number(options.retryAttempt ?? 0));
  const maxAttempts = Math.max(1, Number(options.maxRetryAttempts ?? 3));
  const retryableErrors = errorIssues.map((issue, index) => ({
    index,
    code: issue.code,
    source: claimGateIssueSource(issue.code),
    retryable: claimGateIssueRetryable(issue.code),
    action: claimGateActionForIssue(issue.code),
    detail: issue.blockers ?? issue.commandIds ?? issue.auditDigest ?? null,
  }));
  const retryable = retryableErrors.every((issue) => issue.retryable !== false) && retryAttempt < maxAttempts;
  const degraded = warningIssues.length > 0
    || tenantAuditHandoff.state === "review"
    || routeDecisionSeed.state === "review"
    || claimAcceptance.status === "review";
  const failureState = errorIssues.length
    ? retryable
      ? "retryable_failure"
      : "failed"
    : degraded
      ? "degraded"
      : "healthy";
  const state = failureState === "failed"
    ? "blocked"
    : failureState === "retryable_failure"
      ? "retry_scheduled"
      : degraded
        ? "degraded"
        : requestState.status === "ready-for-runtime"
          ? "ready"
          : "waiting";
  const retryAfterMs = retryable && errorIssues.length
    ? Math.min(30000, 1000 * (2 ** Math.min(retryAttempt, 5)))
    : null;
  const dependencies = [
    {
      name: "request-state",
      state: requestState.status,
      ready: requestState.terminal,
      digest: requestState.version,
    },
    {
      name: "tenant-audit",
      state: tenantAuditHandoff.state,
      ready: tenantAuditHandoff.ready,
      digest: tenantAuditHandoff.auditDigest,
    },
    {
      name: "client-resume",
      state: clientResumeContract.screenState,
      ready: clientResumeContract.screenState === "ready",
      digest: clientResumeContract.id,
    },
    {
      name: "claim-acceptance",
      state: claimAcceptance.status,
      ready: claimAcceptance.canAcknowledge === true,
      digest: claimAcceptance.acceptanceToken,
    },
    {
      name: "route-decision",
      state: routeDecisionSeed.state,
      ready: routeDecisionSeed.ready,
      digest: routeDecisionSeed.digest,
    },
    {
      name: "replay-manifest",
      state: replayManifest.restartSafe ? "restart-safe" : "blocked",
      ready: replayManifest.restartSafe,
      digest: replayManifest.digest,
    },
  ];
  const digest = stableId("gatehealth", [
    ast.id,
    requestState.version,
    state,
    failureState,
    retryAttempt,
    dependencies.map((dependency) => `${dependency.name}:${dependency.state}:${dependency.digest}`).join(","),
    retryableErrors.map((issue) => `${issue.code}:${issue.retryable}`).join(","),
  ]);
  return {
    contractVersion: "aios.mailchimp.claim-gate.operational-health.v1",
    product: "mailchimp",
    gateId: ast.id,
    requestId: ast.clientRuntime.requestId,
    workflowId: ast.clientRuntime.workflowId,
    tenantId: ast.clientRuntime.tenantId,
    workspaceId: ast.clientRuntime.workspaceId,
    state,
    ready: state === "ready",
    failureState,
    degraded,
    retry: {
      retryable,
      scheduled: retryable && errorIssues.length > 0,
      attempt: retryAttempt,
      maxAttempts,
      retryAfterMs,
      backoffPolicy: retryable ? "exponential" : "none",
      exhausted: retryAttempt >= maxAttempts,
    },
    degradedMode: degraded ? {
      mode: tenantAuditHandoff.state === "review"
        ? "tenant_audit_review"
        : routeDecisionSeed.state === "review"
          ? "route_acceptance_review"
          : "claim_acceptance_review",
      allowAdmission: errorIssues.length === 0 && pendingFacts.length === 0,
      requiresAcknowledgement: true,
    } : null,
    counters: {
      rulesTotal: compiledRules.length,
      blockedRules: blockedRules.length,
      pendingFacts: pendingFacts.length,
      issueErrors: errorIssues.length,
      issueWarnings: warningIssues.length,
      replayCommands: replayManifest.commands.length,
      tenantAuditCommands: tenantAuditHandoff.commands.length,
      historySnapshots: reporting.snapshots.length,
    },
    dependencies,
    actionableErrors: retryableErrors,
    warnings: warningIssues.map((issue, index) => ({
      index,
      code: issue.code,
      source: claimGateIssueSource(issue.code),
      action: claimGateActionForIssue(issue.code),
    })),
    nextAction: retryableErrors[0]?.action
      ?? (pendingFacts.length ? "collect-missing-evidence" : null)
      ?? (degraded ? claimGateActionForIssue(warningIssues[0]?.code) : null)
      ?? "handoff-to-runtime-adapter",
    digest,
  };
}

function buildClaimGateAnalyticsExport({
  ast,
  compiledRules,
  requestState,
  tenantAuditHandoff,
  clientResumeContract,
  reporting,
  claimAcceptance,
  routeDecisionSeed,
  replayManifest,
  operationalHealth,
  issues,
}) {
  const errorIssues = issues.filter((issue) => issue.severity === "error");
  const warningIssues = issues.filter((issue) => issue.severity === "warning");
  const blockedRules = compiledRules.filter((rule) => rule.status === "blocked");
  const satisfiedRules = compiledRules.filter((rule) => rule.status === "satisfied");
  const checkpoints = [
    claimAnalyticsCheckpoint("rules", requestState.status, blockedRules.length === 0, blockedRules.map((rule) => rule.id), [], requestState.version),
    claimAnalyticsCheckpoint("tenant_audit", tenantAuditHandoff.state, tenantAuditHandoff.ready, tenantAuditHandoff.blockers, tenantAuditHandoff.warnings, tenantAuditHandoff.auditDigest),
    claimAnalyticsCheckpoint("client_resume", clientResumeContract.screenState, clientResumeContract.screenState === "ready", clientResumeContract.blockedRuleSummaries?.map((rule) => rule.ruleId), [], clientResumeContract.id),
    claimAnalyticsCheckpoint(
      "acceptance",
      claimAcceptance.status,
      claimAcceptance.canAcknowledge === true,
      claimAcceptance.acknowledgement?.checks?.filter((check) => check.status === "blocked").map((check) => check.name),
      claimAcceptance.acknowledgement?.checks?.filter((check) => check.status === "review").map((check) => check.name),
      claimAcceptance.acceptanceToken,
    ),
    claimAnalyticsCheckpoint("route_acceptance", routeDecisionSeed.state, routeDecisionSeed.ready, routeDecisionSeed.validationSummary?.blockers, routeDecisionSeed.validationSummary?.warnings, routeDecisionSeed.digest),
    claimAnalyticsCheckpoint("replay_manifest", replayManifest.state, replayManifest.ready, replayManifest.blockers, [], replayManifest.digest),
    claimAnalyticsCheckpoint("operational_health", operationalHealth.state, operationalHealth.ready, operationalHealth.actionableErrors?.map((error) => error.code), operationalHealth.warnings?.map((warning) => warning.code), operationalHealth.digest),
  ];
  const failedCheckpoints = checkpoints.filter((checkpoint) => checkpoint.outcome === "failed");
  const reviewCheckpoints = checkpoints.filter((checkpoint) => checkpoint.outcome === "review");
  const timeline = [
    ...reporting.timeline.map((event, index) => ({
      sequence: index + 1,
      event: event.event,
      status: event.status,
      outcome: event.status === "blocked" ? "failed" : event.status === "needs-evidence" ? "review" : "ready",
      commandId: event.commandId ?? null,
      restartSafe: event.restartSafe === true,
    })),
    ...checkpoints.map((checkpoint, index) => ({
      sequence: reporting.timeline.length + index + 1,
      event: `analytics:${checkpoint.name}`,
      status: checkpoint.status,
      outcome: checkpoint.outcome,
      digest: checkpoint.digest,
      blockerCount: checkpoint.blockers.length,
      warningCount: checkpoint.warnings.length,
    })),
  ];
  const historySnapshots = [
    ...reporting.snapshots,
    {
      id: stableId("gatehist", [ast.id, requestState.version, "analytics-export", operationalHealth.digest]),
      sequence: reporting.snapshots.length + 1,
      type: "claim-gate-analytics-export",
      status: failedCheckpoints.length ? "blocked" : reviewCheckpoints.length ? "review" : "ready",
      requestId: ast.clientRuntime.requestId,
      workflowId: ast.clientRuntime.workflowId,
      gateId: ast.id,
      operationalHealthDigest: operationalHealth.digest,
      replayDigest: replayManifest.digest,
      routeDecisionDigest: routeDecisionSeed.digest,
    },
  ];
  const counters = {
    rulesTotal: compiledRules.length,
    rulesSatisfied: satisfiedRules.length,
    rulesBlocked: blockedRules.length,
    evidenceDeclared: ast.evidence.length,
    verifiedFacts: requestState.verifiedFacts.length,
    pendingFacts: requestState.pendingFacts.length,
    errorIssueCount: errorIssues.length,
    warningIssueCount: warningIssues.length,
    checkpointCount: checkpoints.length,
    failedCheckpointCount: failedCheckpoints.length,
    reviewCheckpointCount: reviewCheckpoints.length,
    historySnapshotCount: historySnapshots.length,
    timelineEventCount: timeline.length,
    replayCommandCount: replayManifest.commands.length,
    tenantAuditCommandCount: tenantAuditHandoff.commands.length,
    clientActionCount: clientResumeContract.actions.length,
  };
  const state = failedCheckpoints.length
    ? "blocked"
    : reviewCheckpoints.length
      ? "review"
      : "ready";
  const blockers = [...new Set(failedCheckpoints.flatMap((checkpoint) => [
    `claim_analytics_checkpoint_failed:${checkpoint.name}`,
    ...checkpoint.blockers,
  ]))].sort();
  const warnings = [...new Set(reviewCheckpoints.flatMap((checkpoint) => [
    `claim_analytics_checkpoint_review:${checkpoint.name}`,
    ...checkpoint.warnings,
  ]))].sort();
  const digest = stableId("gateanalytics", [
    ast.id,
    requestState.version,
    state,
    JSON.stringify(counters),
    checkpoints.map((checkpoint) => `${checkpoint.name}:${checkpoint.outcome}:${checkpoint.digest}`).join("|"),
  ]);
  return {
    contractVersion: "aios.mailchimp.claim-gate.analytics-export.v1",
    product: "mailchimp",
    gateId: ast.id,
    requestId: ast.clientRuntime.requestId,
    workflowId: ast.clientRuntime.workflowId,
    tenantId: ast.clientRuntime.tenantId,
    workspaceId: ast.clientRuntime.workspaceId,
    state,
    ready: state === "ready",
    counters,
    historySnapshots,
    timeline,
    exportSummary: {
      format: "aios.mailchimp.claim-gate.analytics.v1",
      gateId: ast.id,
      status: state,
      exportReady: state === "ready",
      digest,
      requestStateVersion: requestState.version,
      resumeCursor: requestState.resumeCursor,
      routeDecisionDigest: routeDecisionSeed.digest,
      replayDigest: replayManifest.digest,
      operationalHealthDigest: operationalHealth.digest,
      failedCheckpoints: failedCheckpoints.map((checkpoint) => checkpoint.name),
      reviewCheckpoints: reviewCheckpoints.map((checkpoint) => checkpoint.name),
      historySnapshotIds: historySnapshots.map((snapshot) => snapshot.id),
      counters,
    },
    reporting: {
      channel: "kernel.analytics.mailchimp.claim_gate",
      retention: requestState.pendingFacts.length || blockedRules.length ? "durable_review" : "durable_audit",
      latestSnapshotId: historySnapshots[historySnapshots.length - 1]?.id ?? null,
      latestTimelineEvent: timeline[timeline.length - 1]?.event ?? null,
    },
    blockers,
    warnings,
    nextAction: blockers.length
      ? claimGateActionForIssue(blockers[0])
      : warnings.length
        ? "review-claim-gate-analytics-export"
        : "publish-claim-gate-analytics-export",
    digest,
  };
}

function buildClaimGateExportPacket({
  ast,
  requestState,
  tenantAuditHandoff,
  clientResumeContract,
  reporting,
  claimAcceptance,
  routeDecisionSeed,
  replayManifest,
  operationalHealth,
  analyticsExport,
  routeClientHandoff,
  runtimeAdoptionPacket,
  issues,
}) {
  const errorIssues = issues.filter((issue) => issue.severity === "error");
  const warningIssues = issues.filter((issue) => issue.severity === "warning");
  const requiredArtifacts = [
    {
      name: "request-state",
      artifactId: requestState.version,
      state: requestState.status,
      ready: requestState.restartSafe === true && requestState.status === "ready-for-runtime",
      exportClass: "state",
      nextAction: requestState.pendingFacts.length ? "collect-missing-evidence" : "persist-claim-state",
    },
    {
      name: "tenant-audit",
      artifactId: tenantAuditHandoff.id,
      state: tenantAuditHandoff.state,
      ready: tenantAuditHandoff.ready === true,
      exportClass: "audit",
      nextAction: tenantAuditHandoff.nextAction,
    },
    {
      name: "client-resume",
      artifactId: clientResumeContract.id,
      state: clientResumeContract.screenState,
      ready: clientResumeContract.screenState === "ready",
      exportClass: "client",
      nextAction: clientResumeContract.primaryAction,
    },
    {
      name: "claim-acceptance",
      artifactId: claimAcceptance.id,
      state: claimAcceptance.status,
      ready: claimAcceptance.canAcknowledge === true,
      exportClass: "client",
      nextAction: claimAcceptance.nextAction,
    },
    {
      name: "route-decision",
      artifactId: routeDecisionSeed.id,
      state: routeDecisionSeed.state,
      ready: routeDecisionSeed.ready === true,
      exportClass: "routing",
      nextAction: routeDecisionSeed.nextAction,
    },
    {
      name: "replay-manifest",
      artifactId: replayManifest.digest,
      state: replayManifest.state,
      ready: replayManifest.restartSafe === true,
      exportClass: "recovery",
      nextAction: replayManifest.nextAction,
    },
    {
      name: "route-client-handoff",
      artifactId: routeClientHandoff.digest,
      state: routeClientHandoff.state,
      ready: routeClientHandoff.ready === true,
      exportClass: "client",
      nextAction: routeClientHandoff.nextAction,
    },
    {
      name: "runtime-adoption",
      artifactId: runtimeAdoptionPacket.digest,
      state: runtimeAdoptionPacket.state,
      ready: runtimeAdoptionPacket.ready === true,
      exportClass: "runtime",
      nextAction: runtimeAdoptionPacket.nextAction,
    },
    {
      name: "analytics",
      artifactId: analyticsExport.digest,
      state: analyticsExport.state,
      ready: analyticsExport.ready === true,
      exportClass: "analytics",
      nextAction: analyticsExport.nextAction,
    },
  ];
  const blockedArtifacts = requiredArtifacts.filter((artifact) => artifact.ready !== true);
  const classCounts = requiredArtifacts.reduce((counts, artifact) => {
    counts[artifact.exportClass] = (counts[artifact.exportClass] ?? 0) + 1;
    return counts;
  }, {});
  const stateCounts = requiredArtifacts.reduce((counts, artifact) => {
    counts[artifact.state] = (counts[artifact.state] ?? 0) + 1;
    return counts;
  }, {});
  const exportState = errorIssues.length > 0 || blockedArtifacts.some((artifact) => artifact.state === "blocked")
    ? "blocked"
    : blockedArtifacts.length > 0 || warningIssues.length > 0
      ? "review"
      : "ready";
  const exportDigest = stableId("claimexport", [
    ast.id,
    requestState.version,
    exportState,
    requiredArtifacts.map((artifact) => `${artifact.name}:${artifact.state}:${artifact.artifactId}`).join("|"),
    analyticsExport.digest,
  ]);
  return {
    protocol: "aios.mailchimp.claim-gate.export-packet.v1",
    product: "mailchimp",
    gateId: ast.id,
    requestId: ast.clientRuntime.requestId,
    workflowId: ast.clientRuntime.workflowId,
    tenantId: ast.clientRuntime.tenantId,
    workspaceId: ast.clientRuntime.workspaceId,
    state: exportState,
    exportReady: exportState === "ready",
    digest: exportDigest,
    manifest: {
      claimStateVersion: requestState.version,
      resumeCursor: requestState.resumeCursor,
      continuationToken: ast.clientRuntime.continuationToken,
      analyticsDigest: analyticsExport.digest,
      operationalHealthDigest: operationalHealth.digest,
      routeDecisionDigest: routeDecisionSeed.digest,
      replayDigest: replayManifest.digest,
      runtimeAdoptionDigest: runtimeAdoptionPacket.digest,
      latestSnapshotId: analyticsExport.reporting.latestSnapshotId,
      historySnapshotIds: analyticsExport.exportSummary.historySnapshotIds,
    },
    counters: {
      artifacts: requiredArtifacts.length,
      readyArtifacts: requiredArtifacts.filter((artifact) => artifact.ready).length,
      blockedArtifacts: blockedArtifacts.length,
      issueErrors: errorIssues.length,
      issueWarnings: warningIssues.length,
      pendingFacts: requestState.pendingFacts.length,
      historySnapshots: analyticsExport.exportSummary.historySnapshotIds.length,
      timelineEvents: analyticsExport.timeline.length,
    },
    byExportClass: classCounts,
    byArtifactState: stateCounts,
    artifacts: requiredArtifacts.map((artifact, index) => ({
      sequence: index + 1,
      ...artifact,
      exportKey: stableId("exportrow", [exportDigest, artifact.name, artifact.artifactId]),
    })),
    publishCommands: exportState === "ready"
      ? [
          {
            id: stableId("cmd", [exportDigest, "publish-claim-export-packet"]),
            type: "publish-claim-export-packet",
            idempotencyKey: stableId("idem", [exportDigest, "publish-claim-export-packet"]),
            statusAfterReplay: "claim-export-published",
            writes: ["claimExportDigest", "artifactManifest", "historySnapshotIds"],
            conflict: "return-existing",
          },
        ]
      : [],
    exportSummary: {
      format: "aios.mailchimp.claim-gate.export-summary.v1",
      status: exportState,
      exportReady: exportState === "ready",
      digest: exportDigest,
      blockerArtifactNames: blockedArtifacts.map((artifact) => artifact.name),
      issueCodes: issues.map((issue) => issue.code),
      historySnapshotIds: analyticsExport.exportSummary.historySnapshotIds,
      nextAction: exportState === "ready"
        ? "publish-claim-export-packet"
        : blockedArtifacts[0]?.nextAction ?? analyticsExport.nextAction,
    },
    clientPatch: {
      claimExportDigest: exportDigest,
      claimExportStatus: exportState,
      claimExportReady: exportState === "ready",
      claimExportNextAction: exportState === "ready"
        ? "publish-claim-export-packet"
        : blockedArtifacts[0]?.nextAction ?? analyticsExport.nextAction,
      claimExportBlockedArtifacts: blockedArtifacts.map((artifact) => artifact.name),
      claimExportLatestSnapshotId: analyticsExport.reporting.latestSnapshotId,
    },
    restartSemantics: {
      replaySafe: replayManifest.restartSafe === true,
      duplicateCommandPolicy: "dedupe-by-claim-export-digest",
      resumeFromDigest: exportDigest,
      externalWritesPerformed: false,
    },
  };
}

function claimAnalyticsCheckpoint(name, status, ready, blockers = [], warnings = [], digest = null) {
  const normalizedBlockers = asArray(blockers).map((entry) => typeof entry === "string" ? entry : entry?.code).filter(Boolean).sort();
  const normalizedWarnings = asArray(warnings).map((entry) => typeof entry === "string" ? entry : entry?.code).filter(Boolean).sort();
  const normalizedStatus = status ?? "unknown";
  const outcome = normalizedBlockers.length || normalizedStatus === "blocked" || normalizedStatus === "failed"
    ? "failed"
    : normalizedWarnings.length || normalizedStatus === "review" || normalizedStatus === "needs-evidence" || normalizedStatus === "degraded"
      ? "review"
      : ready === false
        ? "pending"
        : "ready";
  return {
    name,
    status: normalizedStatus,
    ready: ready === true,
    outcome,
    blockers: [...new Set(normalizedBlockers)],
    warnings: [...new Set(normalizedWarnings)],
    digest: digest ?? null,
  };
}

function claimGateIssueSource(code) {
  if (String(code).includes("tenant")) return "tenant-audit";
  if (String(code).includes("replay")) return "replay-manifest";
  if (String(code).includes("permission")) return "tenant-policy";
  if (String(code).includes("evidence") || String(code).includes("fact")) return "claim-evidence";
  return "claim-gate";
}

function claimGateIssueRetryable(code) {
  if (String(code).includes("permission") || String(code).includes("tenant-audit-blocked")) return false;
  if (String(code).includes("command-idempotency-missing")) return false;
  return true;
}

function claimGateActionForIssue(code) {
  if (String(code).includes("tenant-audit")) return "repair-tenant-audit-handoff";
  if (String(code).includes("permission")) return "repair-tenant-permission";
  if (String(code).includes("replay")) return "repair-claim-gate-replay-manifest";
  if (String(code).includes("idempotency")) return "persist-idempotent-claim-command";
  if (String(code).includes("evidence") || String(code).includes("fact")) return "collect-missing-evidence";
  if (String(code).includes("review")) return "review-claim-gate-preview";
  return "repair-claim-gate";
}

export function parseClaimGate(source) {
  const manifest = parseClaimSource(source);
  const name = normalizeIdentifier(manifest.name ?? manifest.gate, "mailchimp-claim-gate");
  const evidence = asArray(manifest.evidence ?? manifest.observes).map(normalizeEvidence);
  const rules = asArray(manifest.rules ?? manifest.rule ?? [
    { subject: "mailchimp.audience", operator: "requires", values: ["audience_id"] },
  ]).map(normalizeRule);
  const requiredFacts = [...new Set(rules.flatMap((rule) => (rule.operator === "requires" ? rule.values : [])))];
  const clientRuntime = normalizeClientRuntime(manifest.clientRuntime ?? manifest.client ?? manifest.runtimeClient, name);
  const tenantPolicy = normalizeTenantPermissionPolicy(
    manifest.tenantPolicy ?? manifest.permissions ?? manifest.permissionPolicy,
    clientRuntime,
  );
  return {
    kind: "AiosClaimGateAst",
    id: stableId("gate", [name, rules.map((rule) => rule.id).join(",")]),
    name,
    product: "mailchimp",
    clientRuntime,
    tenantPolicy,
    evidence,
    rules,
    requiredFacts,
  };
}

export function compileClaimGate(source, options = {}) {
  const ast = parseClaimGate(source);
  const evidenceFacts = new Set(ast.evidence.map((entry) => entry.fact));
  const compiledRules = ast.rules.map((rule) => compileRule(rule, evidenceFacts));
  const issues = collectGateIssues(compiledRules, ast);
  const requestState = buildRequestStateSnapshot(ast, compiledRules, evidenceFacts);
  const tenantAuditHandoff = buildTenantAuditHandoffContract(ast, compiledRules, requestState);
  const clientResumeContract = buildClientResumeContract(ast, compiledRules, requestState);
  const reporting = buildClaimGateReporting(ast, compiledRules, issues, requestState, tenantAuditHandoff);
  const claimAcceptance = buildClaimAcceptanceContract(ast, compiledRules, issues, requestState, reporting);
  const routeDecisionSeed = buildClaimRouteDecisionSeed(
    ast,
    compiledRules,
    issues,
    requestState,
    clientResumeContract,
    reporting,
    claimAcceptance,
    tenantAuditHandoff,
  );
  const replayManifest = buildClaimReplayManifest(
    ast,
    requestState,
    clientResumeContract,
    reporting,
    claimAcceptance,
    routeDecisionSeed,
  );
  const allIssues = [
    ...issues,
    ...collectTenantAuditHandoffIssues(tenantAuditHandoff),
    ...collectReplayManifestIssues(replayManifest),
  ];
  const operationalHealth = buildClaimGateOperationalHealth({
    ast,
    compiledRules,
    requestState,
    tenantAuditHandoff,
    clientResumeContract,
    reporting,
    claimAcceptance,
    routeDecisionSeed,
    replayManifest,
    issues: allIssues,
    options,
  });
  const analyticsExport = buildClaimGateAnalyticsExport({
    ast,
    compiledRules,
    requestState,
    tenantAuditHandoff,
    clientResumeContract,
    reporting,
    claimAcceptance,
    routeDecisionSeed,
    replayManifest,
    operationalHealth,
    issues: allIssues,
  });
  const routeClientHandoff = buildClaimRouteClientHandoff({
    ast,
    requestState,
    tenantAuditHandoff,
    clientResumeContract,
    claimAcceptance,
    routeDecisionSeed,
    replayManifest,
    operationalHealth,
    analyticsExport,
  });
  const runtimeAdoptionPacket = buildClaimRuntimeAdoptionPacket({
    ast,
    requestState,
    tenantAuditHandoff,
    clientResumeContract,
    claimAcceptance,
    routeDecisionSeed,
    replayManifest,
    routeClientHandoff,
    operationalHealth,
    analyticsExport,
  });
  const exportPacket = buildClaimGateExportPacket({
    ast,
    requestState,
    tenantAuditHandoff,
    clientResumeContract,
    reporting,
    claimAcceptance,
    routeDecisionSeed,
    replayManifest,
    operationalHealth,
    analyticsExport,
    routeClientHandoff,
    runtimeAdoptionPacket,
    issues: [
      ...allIssues,
      ...collectClaimRouteClientHandoffIssues(routeClientHandoff),
      ...collectClaimRuntimeAdoptionIssues(runtimeAdoptionPacket),
    ],
  });
  const finalIssues = [
    ...allIssues,
    ...collectClaimRouteClientHandoffIssues(routeClientHandoff),
    ...collectClaimRuntimeAdoptionIssues(runtimeAdoptionPacket),
  ];
  return {
    ast,
    descriptor: {
      kind: "AiosClaimGateDescriptor",
      id: ast.id,
      name: ast.name,
      product: ast.product,
      admission: issues.some((issue) => issue.severity === "error") ? "blocked" : "reviewable",
      clientRuntime: {
        ...ast.clientRuntime,
        contractId: stableId("client", [
          ast.id,
          ast.clientRuntime.tenantId,
          ast.clientRuntime.workflowId,
          ast.clientRuntime.requestId,
        ]),
        stateShape: {
          requestId: "string",
          workflowId: "string",
          tenantId: "string",
          workspaceId: "string",
          status: "waiting-for-claim-gate|needs-evidence|ready-for-runtime|blocked",
          continuationToken: "string",
          evidenceFacts: "string[]",
        },
        persistedState: {
          key: requestState.key,
          version: requestState.version,
          resumeCursor: requestState.resumeCursor,
          restartSafe: requestState.restartSafe,
          commandIds: requestState.commands.map((command) => command.id),
          clientResumeContractId: clientResumeContract.id,
          replayCursor: replayManifest.replayCursor,
          replayDigest: replayManifest.digest,
          runtimeAdoptionKey: runtimeAdoptionPacket.adoptionKey,
          runtimeAdoptionDigest: runtimeAdoptionPacket.digest,
          runtimeAdoptionState: runtimeAdoptionPacket.state,
        },
      },
      tenantPolicy: {
        ...ast.tenantPolicy,
        activeBoundary: buildTenantBoundaryReport(ast),
        auditHandoff: {
          id: tenantAuditHandoff.id,
          state: tenantAuditHandoff.state,
          ready: tenantAuditHandoff.ready,
          auditDigest: tenantAuditHandoff.auditDigest,
          commandIds: tenantAuditHandoff.commands.map((command) => command.id),
          nextAction: tenantAuditHandoff.nextAction,
        },
      },
      rules: compiledRules,
      verifierContract: {
        id: stableId("verifier", [ast.id, ast.requiredFacts.join(",")]),
        requiredFacts: ast.requiredFacts,
        evidenceFacts: [...evidenceFacts].sort(),
        mode: options.mode ?? "truth-boundary",
      },
      recovery: {
        onBlocked: options.onBlocked ?? "hold-job",
        rollback: options.rollback ?? "release-capabilities",
        resumeFrom: ast.clientRuntime.continuationToken,
        clientStateKey: ast.clientRuntime.clientStateKey,
        resumeCursor: requestState.resumeCursor,
        replayCursor: replayManifest.replayCursor,
        replayDigest: replayManifest.digest,
        restartSafe: replayManifest.restartSafe,
        idempotentCommands: requestState.commands.map((command) => ({
          id: command.id,
          type: command.type,
          idempotencyKey: command.idempotencyKey,
          conflict: command.conflict,
        })),
        recoveryPaths: requestState.recoveryPaths,
        restartSemantics: replayManifest.restartSemantics,
        statusStates: ["waiting-for-claim-gate", "needs-evidence", "reviewable", "blocked", "admitted"],
      },
      workflowHandoff: buildWorkflowHandoff(ast, compiledRules),
      tenantAuditHandoff,
      requestState,
      clientResumeContract,
      reporting,
      claimAcceptance,
      routeDecisionSeed,
      replayManifest,
      operationalHealth,
      analyticsExport,
      routeClientHandoff,
      runtimeAdoptionPacket,
      exportPacket,
      claimExportPacket: exportPacket,
      userVisiblePreview: claimAcceptance.preview,
      acceptance: claimAcceptance.acknowledgement,
      routeAcceptance: {
        decisionId: routeDecisionSeed.id,
        state: routeDecisionSeed.state,
        ready: routeDecisionSeed.ready,
        presentationMode: routeDecisionSeed.presentationMode,
        userVisibleStatus: routeDecisionSeed.userVisibleStatus,
        acceptCommand: routeDecisionSeed.acceptCommand,
        validationSummary: routeDecisionSeed.validationSummary,
        nextAction: routeDecisionSeed.nextAction,
        digest: routeDecisionSeed.digest,
        replayCursor: replayManifest.replayCursor,
        replayDigest: replayManifest.digest,
        clientHandoffDigest: routeClientHandoff.digest,
        clientHandoffState: routeClientHandoff.state,
        clientHandoffNextAction: routeClientHandoff.nextAction,
        runtimeAdoptionDigest: runtimeAdoptionPacket.digest,
        runtimeAdoptionState: runtimeAdoptionPacket.state,
        runtimeAdoptionNextAction: runtimeAdoptionPacket.nextAction,
      },
      clientRouteHandoff: {
        state: routeClientHandoff.state,
        ready: routeClientHandoff.ready,
        presentationMode: routeClientHandoff.presentationMode,
        userVisibleStatus: routeClientHandoff.userVisibleStatus,
        validationSummary: routeClientHandoff.validationSummary,
        command: routeClientHandoff.command,
        restartSemantics: routeClientHandoff.restartSemantics,
        nextAction: routeClientHandoff.nextAction,
        digest: routeClientHandoff.digest,
      },
      clientRuntimeAdoption: {
        state: runtimeAdoptionPacket.state,
        ready: runtimeAdoptionPacket.ready,
        adoptionKey: runtimeAdoptionPacket.adoptionKey,
        userVisibleStatus: runtimeAdoptionPacket.userVisibleStatus,
        command: runtimeAdoptionPacket.command,
        restartSemantics: runtimeAdoptionPacket.restartSemantics,
        nextAction: runtimeAdoptionPacket.nextAction,
        digest: runtimeAdoptionPacket.digest,
      },
      exportContract: {
        state: exportPacket.state,
        ready: exportPacket.exportReady,
        digest: exportPacket.digest,
        summary: exportPacket.exportSummary,
        counters: exportPacket.counters,
        clientPatch: exportPacket.clientPatch,
        publishCommandIds: exportPacket.publishCommands.map((command) => command.id),
      },
      truthBoundary: {
        generatedBy: "claim-gate-compiler",
        verifiedFacts: [...evidenceFacts].sort(),
        unverifiedFacts: [...new Set(compiledRules.flatMap((rule) => rule.missing))].sort(),
      },
    },
    valid: operationalHealth.ready && routeClientHandoff.ready && !finalIssues.some((issue) => issue.severity === "error"),
    issues: finalIssues,
  };
}
