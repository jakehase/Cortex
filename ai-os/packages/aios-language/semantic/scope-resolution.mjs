const DECLARATION_KINDS = new Set(["capability", "memory", "step", "verifier", "truthBoundary", "rollback"]);
const MAILCHIMP_ACTION_PATTERN = /^(campaign|audience|template|report)\./;
const WRITE_ACTION_PATTERN = /create|update|schedule|send|delete|archive/i;
const ROLE_PERMISSION_GRANTS = Object.freeze({
  "mailchimp.admin": Object.freeze(["mailchimp.*"]),
  "mailchimp.marketer": Object.freeze([
    "mailchimp.campaigns.read",
    "mailchimp.campaigns.write",
    "mailchimp.templates.read",
    "mailchimp.lists.read",
    "mailchimp.segments.read",
    "mailchimp.reports.read",
  ]),
  "mailchimp.viewer": Object.freeze([
    "mailchimp.campaigns.read",
    "mailchimp.templates.read",
    "mailchimp.lists.read",
    "mailchimp.segments.read",
    "mailchimp.reports.read",
  ]),
  "mailchimp.sender": Object.freeze(["mailchimp.campaigns.approve_send"]),
});

function compactString(value) {
  return String(value ?? "").trim();
}

function toArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function stableSortByName(left, right) {
  return left.name.localeCompare(right.name) || left.kind.localeCompare(right.kind);
}

function freezeArray(items) {
  return Object.freeze(items.map((item) => Object.freeze(item)));
}

function createDiagnostic(code, message, context = {}, level = "error") {
  return Object.freeze({
    level,
    code,
    message,
    ...context,
  });
}

function getJobs(input = {}) {
  if (Array.isArray(input.jobs)) return input.jobs;
  if (Array.isArray(input.ast?.jobs)) return input.ast.jobs;
  return [];
}

function firstString(...values) {
  for (const value of values) {
    const text = compactString(value);
    if (text) return text;
  }
  return "";
}

function stableToken(prefix, parts) {
  const body = parts.map(compactString).filter(Boolean).join(":");
  return `${prefix}:${body || "anonymous"}`;
}

function normalizeCommandName(value, fallback) {
  return compactString(value || fallback).replace(/[^a-z0-9_.:-]+/gi, "_").toLowerCase();
}

function normalizePermission(value) {
  return compactString(value).toLowerCase();
}

function inferCapabilityProvider(capability = {}) {
  const action = compactString(capability.name || capability.scope);
  const provider = compactString(capability.provider).toLowerCase();
  return provider || (MAILCHIMP_ACTION_PATTERN.test(action) ? "mailchimp" : "local");
}

function requiredMailchimpPermission(action) {
  if (action.startsWith("campaign.") && /schedule|send/.test(action)) return "mailchimp.campaigns.approve_send";
  if (action.startsWith("campaign.") && WRITE_ACTION_PATTERN.test(action)) return "mailchimp.campaigns.write";
  if (action.startsWith("campaign.")) return "mailchimp.campaigns.read";
  if (action.startsWith("audience.segment.")) return WRITE_ACTION_PATTERN.test(action) ? "mailchimp.segments.write" : "mailchimp.segments.read";
  if (action.startsWith("audience.")) return WRITE_ACTION_PATTERN.test(action) ? "mailchimp.lists.write" : "mailchimp.lists.read";
  if (action.startsWith("template.")) return WRITE_ACTION_PATTERN.test(action) ? "mailchimp.templates.write" : "mailchimp.templates.read";
  if (action.startsWith("report.")) return "mailchimp.reports.read";
  return "";
}

function expandRolePermissions(roles = []) {
  return roles.flatMap((role) => ROLE_PERMISSION_GRANTS[role] || []);
}

function hasMailchimpRuntimeBoundary(job = {}) {
  return toArray(job.capabilities).some((capability) => {
    const name = compactString(capability.name || capability.scope);
    const provider = compactString(capability.provider);
    const boundary = compactString(capability.boundary);
    return provider === "mailchimp" || MAILCHIMP_ACTION_PATTERN.test(name) || boundary === "external";
  });
}

function collectActorBoundaryState(job = {}, requestState = {}) {
  const clientState = job.clientState || job.requestState || {};
  const actor = job.actor || {};
  const roles = [
    ...toArray(requestState.roles),
    ...toArray(clientState.roles),
    ...toArray(job.roles),
    ...toArray(actor.roles),
  ].map(normalizePermission).filter(Boolean).sort();
  const permissions = [
    ...toArray(requestState.permissions),
    ...toArray(clientState.permissions),
    ...toArray(job.permissions),
    ...toArray(actor.permissions),
    ...expandRolePermissions(roles),
  ].map(normalizePermission).filter(Boolean).sort();

  return Object.freeze({
    tenantId: firstString(clientState.tenantId, job.tenantId, requestState.tenantId),
    workspaceId: firstString(clientState.workspaceId, job.workspaceId, requestState.workspaceId),
    actorId: firstString(clientState.userId, clientState.actorId, actor.id, job.userId, requestState.userId),
    roles: freezeArray([...new Set(roles)]),
    permissions: freezeArray([...new Set(permissions)]),
  });
}

function createPermissionBoundaryMatrix(job = {}, requestState = normalizeRequestState(), runtimeScope = {}) {
  const actor = collectActorBoundaryState(job, requestState);
  const available = new Set(actor.permissions);
  const capabilities = toArray(job.capabilities)
    .map((capability, index) => {
      const action = compactString(capability.name || capability.scope || `capability:${index + 1}`);
      const provider = inferCapabilityProvider(capability);
      const capabilityTenant = firstString(capability.tenantId, actor.tenantId);
      const capabilityWorkspace = firstString(capability.workspaceId, actor.workspaceId);
      const requiredPermission = provider === "mailchimp"
        ? normalizePermission(capability.permission || capability.requiredPermission || requiredMailchimpPermission(action))
        : "";
      const explicitGrants = toArray(capability.grants || capability.permissions).map(normalizePermission).filter(Boolean);
      const grantSet = new Set([...available, ...explicitGrants]);
      const sameTenant = provider !== "mailchimp" || (Boolean(actor.tenantId) && capabilityTenant === actor.tenantId);
      const sameWorkspace = provider !== "mailchimp" || (Boolean(actor.workspaceId) && capabilityWorkspace === actor.workspaceId);
      const permissionGranted = !requiredPermission
        || grantSet.has(requiredPermission)
        || grantSet.has("mailchimp.*")
        || grantSet.has("admin")
        || grantSet.has("role:admin");
      const writeBoundary = provider === "mailchimp" && WRITE_ACTION_PATTERN.test(action);
      const reasons = [
        provider === "mailchimp" && !actor.tenantId && "missing-tenant",
        provider === "mailchimp" && !actor.workspaceId && "missing-workspace",
        provider === "mailchimp" && !actor.actorId && "missing-actor",
        !sameTenant && "tenant-mismatch",
        !sameWorkspace && "workspace-mismatch",
        requiredPermission && !permissionGranted && `missing-permission:${requiredPermission}`,
        writeBoundary && !runtimeScope.idempotencyKey && "missing-idempotency-key",
        writeBoundary && !runtimeScope.statusChannel && "missing-status-channel",
      ].filter(Boolean);

      return Object.freeze({
        action,
        provider,
        boundary: compactString(capability.boundary || (provider === "mailchimp" ? "external" : "internal")),
        tenantId: capabilityTenant,
        workspaceId: capabilityWorkspace,
        actorId: actor.actorId,
        requiredPermission,
        explicitGrants: freezeArray(explicitGrants),
        writeBoundary,
        statusChannel: runtimeScope.statusChannel,
        idempotencyKey: runtimeScope.idempotencyKey,
        decision: reasons.length === 0 ? "allow" : "hold",
        reasons: freezeArray(reasons),
      });
    })
    .filter((entry) => entry.provider === "mailchimp")
    .sort((left, right) => left.action.localeCompare(right.action));
  const held = capabilities.filter((capability) => capability.decision === "hold");

  return Object.freeze({
    protocol: "aios.scope.mailchimp-permission-boundary.v1",
    tenantId: actor.tenantId,
    workspaceId: actor.workspaceId,
    actorId: actor.actorId,
    roles: actor.roles,
    permissions: actor.permissions,
    status: held.length > 0 ? "held" : capabilities.length > 0 ? "allow" : "not-applicable",
    capabilities: freezeArray(capabilities),
    heldCapabilities: freezeArray(held.map((capability) => ({
      action: capability.action,
      requiredPermission: capability.requiredPermission,
      reasons: capability.reasons,
    }))),
    auditHandoff: Object.freeze({
      event: "mailchimp.scope.permission_boundary",
      statusChannel: runtimeScope.statusChannel,
      restartToken: runtimeScope.restartToken,
      acceptedForAdapter: held.length === 0,
      heldActions: freezeArray(held.map((capability) => capability.action)),
    }),
  });
}

function hasExternalWriteBoundary(job = {}) {
  return toArray(job.capabilities).some((capability) => {
    const name = compactString(capability.name || capability.scope);
    const boundary = compactString(capability.boundary);
    return boundary === "external" || WRITE_ACTION_PATTERN.test(name);
  });
}

function normalizeRequestState(input = {}) {
  const request = input.request || input.clientRequest || input.runtimeRequest || {};
  const client = input.client || request.client || {};
  const runtime = input.runtime || request.runtime || {};
  const tenantId = firstString(request.tenantId, request.tenant, client.tenantId, input.tenantId, runtime.tenantId);
  const workspaceId = firstString(request.workspaceId, request.workspace, client.workspaceId, input.workspaceId, runtime.workspaceId);
  const userId = firstString(request.userId, request.actorId, client.userId, input.userId);
  const requestId = firstString(request.requestId, request.id, runtime.requestId, input.requestId);
  const statusChannel = firstString(
    request.statusChannel,
    request.statusTopic,
    runtime.statusChannel,
    tenantId && workspaceId ? `tenant:${tenantId}:workspace:${workspaceId}:aios-status` : ""
  );
  const idempotencyKey = firstString(
    request.idempotencyKey,
    runtime.idempotencyKey,
    requestId && tenantId && workspaceId ? `aios:${tenantId}:${workspaceId}:${requestId}` : ""
  );

  return Object.freeze({
    tenantId,
    workspaceId,
    userId,
    requestId,
    roles: freezeArray(toArray(request.roles || client.roles || input.roles).map(normalizePermission).filter(Boolean).sort()),
    permissions: freezeArray(toArray(request.permissions || client.permissions || input.permissions).map(normalizePermission).filter(Boolean).sort()),
    statusChannel,
    idempotencyKey,
    origin: compactString(request.origin || client.origin || "client-runtime"),
    restartToken: stableToken("restart", [tenantId, workspaceId, requestId || idempotencyKey]),
  });
}

function normalizeDeclaration(kind, value = {}, index, jobName) {
  const fallbackName = `${kind}:${index + 1}`;
  const name = compactString(value.name || value.id || value.scope || value.expression || fallbackName);
  return {
    kind,
    name,
    jobName,
    index,
    sourceRange: value.start != null || value.end != null
      ? Object.freeze({ start: value.start ?? null, end: value.end ?? null })
      : null,
    value,
  };
}

function collectJobDeclarations(job = {}) {
  const declarations = [
    ...toArray(job.capabilities).map((value, index) => normalizeDeclaration("capability", value, index, job.name)),
    ...toArray(job.memory).map((value, index) => normalizeDeclaration("memory", value, index, job.name)),
    ...toArray(job.steps).map((value, index) => normalizeDeclaration("step", value, index, job.name)),
    ...toArray(job.verifiers).map((value, index) => normalizeDeclaration("verifier", value, index, job.name)),
    ...toArray(job.truthBoundaries).map((value, index) => normalizeDeclaration("truthBoundary", value, index, job.name)),
  ];

  if (job.rollback) declarations.push(normalizeDeclaration("rollback", job.rollback, 0, job.name));
  return declarations;
}

function buildDeclarationIndex(declarations) {
  const byKind = Object.fromEntries([...DECLARATION_KINDS].map((kind) => [kind, new Map()]));
  const diagnostics = [];

  for (const declaration of declarations) {
    const bucket = byKind[declaration.kind];
    const existing = bucket.get(declaration.name);
    if (existing) {
      diagnostics.push(createDiagnostic(
        "aios.scope.duplicate_symbol",
        `Duplicate ${declaration.kind} symbol "${declaration.name}" in job "${declaration.jobName}".`,
        {
          jobName: declaration.jobName,
          kind: declaration.kind,
          symbol: declaration.name,
          firstIndex: existing.index,
          duplicateIndex: declaration.index,
        }
      ));
      continue;
    }
    bucket.set(declaration.name, declaration);
  }

  return { byKind, diagnostics };
}

function resolveMemoryReferences(job = {}, byKind, diagnostics) {
  const memoryNames = byKind.memory;
  const references = [];

  for (const step of toArray(job.steps)) {
    const stepName = compactString(step.name || step.id || "step");
    const reads = toArray(step.memoryReads || step.reads);
    const writes = toArray(step.memoryWrites || step.writes || step.output).filter(Boolean);

    for (const memoryName of reads) {
      const name = compactString(memoryName);
      const resolved = memoryNames.has(name);
      references.push(Object.freeze({ source: stepName, target: name, relation: "reads", resolved }));
      if (!resolved) {
        diagnostics.push(createDiagnostic(
          "aios.scope.unresolved_memory_read",
          `Step "${stepName}" reads undeclared memory "${name}".`,
          { jobName: job.name, stepName, memoryName: name }
        ));
      }
    }

    for (const memoryName of writes) {
      const name = compactString(memoryName);
      const resolved = memoryNames.has(name);
      references.push(Object.freeze({ source: stepName, target: name, relation: "writes", resolved }));
      if (!resolved) {
        diagnostics.push(createDiagnostic(
          "aios.scope.unresolved_memory_write",
          `Step "${stepName}" writes undeclared memory "${name}".`,
          { jobName: job.name, stepName, memoryName: name }
        ));
      }
    }
  }

  return references;
}

function resolveVerifierReferences(job = {}, byKind, diagnostics) {
  const truthNames = byKind.truthBoundary;
  const references = [];

  for (const boundary of toArray(job.truthBoundaries)) {
    const name = compactString(boundary.name || boundary.source);
    const source = compactString(boundary.source);
    references.push(Object.freeze({
      source: name,
      target: source,
      relation: "claims",
      resolved: Boolean(source),
    }));
  }

  for (const verifier of toArray(job.verifiers)) {
    const verifierName = compactString(verifier.name || verifier.expression || "verifier");
    const requiredTruth = toArray(verifier.truth || verifier.truthBoundaries || verifier.boundaries);
    for (const truthName of requiredTruth) {
      const name = compactString(truthName);
      const resolved = truthNames.has(name);
      references.push(Object.freeze({ source: verifierName, target: name, relation: "requiresTruth", resolved }));
      if (!resolved) {
        diagnostics.push(createDiagnostic(
          "aios.scope.unresolved_truth_boundary",
          `Verifier "${verifierName}" references undeclared truth boundary "${name}".`,
          { jobName: job.name, verifierName, truthBoundary: name }
        ));
      }
    }
  }

  return references;
}

function resolveCapabilityReferences(job = {}, byKind, diagnostics) {
  const capabilityNames = byKind.capability;
  const references = [];

  for (const step of toArray(job.steps)) {
    const stepName = compactString(step.name || step.id || "step");
    const requested = toArray(step.capability || step.capabilities || step.requiresCapability);
    for (const capabilityName of requested) {
      const name = compactString(capabilityName);
      const resolved = capabilityNames.has(name);
      references.push(Object.freeze({ source: stepName, target: name, relation: "requiresCapability", resolved }));
      if (!resolved) {
        diagnostics.push(createDiagnostic(
          "aios.scope.unresolved_capability",
          `Step "${stepName}" references undeclared capability "${name}".`,
          { jobName: job.name, stepName, capabilityName: name }
        ));
      }
    }
  }

  return references;
}

function createClientRuntimeScope(job = {}, requestState) {
  const jobName = compactString(job.name || "anonymous");
  const usesMailchimp = hasMailchimpRuntimeBoundary(job);
  const writesExternal = hasExternalWriteBoundary(job);
  const clientState = job.clientState || job.requestState || {};
  const tenantId = firstString(clientState.tenantId, job.tenantId, requestState.tenantId);
  const workspaceId = firstString(clientState.workspaceId, job.workspaceId, requestState.workspaceId);
  const requestId = firstString(clientState.requestId, job.requestId, requestState.requestId);
  const statusChannel = firstString(clientState.statusChannel, job.statusChannel, requestState.statusChannel);
  const idempotencyKey = firstString(
    clientState.idempotencyKey,
    job.idempotencyKey,
    requestState.idempotencyKey,
    writesExternal ? stableToken("aios", [tenantId, workspaceId, requestId, jobName]) : ""
  );
  const diagnostics = [];

  if (usesMailchimp && (!tenantId || !workspaceId)) {
    diagnostics.push(createDiagnostic(
      "aios.scope.client_boundary_missing",
      `Job "${jobName}" uses a Mailchimp runtime boundary without tenant and workspace state.`,
      { jobName, missing: freezeArray([!tenantId && "tenantId", !workspaceId && "workspaceId"].filter(Boolean)) }
    ));
  }

  if (writesExternal && !idempotencyKey) {
    diagnostics.push(createDiagnostic(
      "aios.scope.idempotency_key_missing",
      `Job "${jobName}" performs an external write without a deterministic idempotency key.`,
      { jobName }
    ));
  }

  if (usesMailchimp && !statusChannel) {
    diagnostics.push(createDiagnostic(
      "aios.scope.status_channel_missing",
      `Job "${jobName}" uses an adapter boundary without a status handoff channel.`,
      { jobName },
      "warning"
    ));
  }

  return Object.freeze({
    tenantId,
    workspaceId,
    requestId,
    statusChannel,
    idempotencyKey,
    origin: requestState.origin,
    restartToken: stableToken("restart", [tenantId, workspaceId, requestId || idempotencyKey, jobName]),
    requiresClientState: usesMailchimp,
    requiresIdempotency: writesExternal,
    diagnostics: freezeArray(diagnostics),
  });
}

function createRestartCommandLedger(job = {}, runtimeScope = {}) {
  const jobName = compactString(job.name || "anonymous");
  const restartToken = compactString(runtimeScope.restartToken);
  const statusChannel = compactString(runtimeScope.statusChannel);
  const commands = [];
  const appendCommand = (name, phase, reason, extra = {}) => {
    const command = normalizeCommandName(name, phase);
    commands.push(Object.freeze({
      command,
      commandId: stableToken("cmd", [restartToken, jobName, command]),
      jobName,
      phase,
      reason,
      restartToken,
      statusChannel,
      idempotencyKey: compactString(extra.idempotencyKey || runtimeScope.idempotencyKey),
      replayPolicy: extra.replayPolicy || "dedupe-by-command-id",
      required: extra.required !== false,
    }));
  };

  if (runtimeScope.requiresClientState) {
    appendCommand("restore_client_runtime_state", "restore", "Mailchimp adapter work needs tenant/workspace state before resume.");
  }

  if (runtimeScope.requiresIdempotency) {
    appendCommand("dedupe_external_write", "dedupe", "External writes must replay with the same idempotency identity.");
  }

  for (const step of toArray(job.steps)) {
    const stepName = compactString(step.name || step.id || "step");
    const capabilityRefs = toArray(step.capability || step.capabilities || step.requiresCapability)
      .map(compactString)
      .filter(Boolean);
    const writesExternal = capabilityRefs.some((capability) => WRITE_ACTION_PATTERN.test(capability));
    if (writesExternal || compactString(step.adapter).includes("mailchimp")) {
      appendCommand(
        step.resumeCommand || `resume_${stepName}`,
        "resume",
        `Resume adapter step "${stepName}" from persisted status before issuing provider calls.`,
        {
          idempotencyKey: firstString(step.idempotencyKey, runtimeScope.idempotencyKey),
          replayPolicy: "resume-before-retry",
        }
      );
    }
  }

  if (toArray(job.verifiers).length > 0) {
    appendCommand("replay_verifier_status", "verify", "Verifier status is replayed so approval evidence remains restart-safe.", {
      replayPolicy: "latest-status-wins",
      required: runtimeScope.requiresIdempotency,
    });
  }

  return freezeArray(commands.sort((left, right) => left.phase.localeCompare(right.phase) || left.command.localeCompare(right.command)));
}

function createRestartReplaySegments(job = {}, runtimeScope = {}, ledger = [], externalSteps = [], memoryMounts = []) {
  const jobName = compactString(job.name || "anonymous");
  const restartToken = compactString(runtimeScope.restartToken);
  const statusChannel = compactString(runtimeScope.statusChannel);
  const commandByStep = new Map();
  for (const command of toArray(ledger)) {
    const normalized = normalizeCommandName(command.command);
    if (command.phase === "resume" && normalized.startsWith("resume_")) {
      commandByStep.set(normalized.replace(/^resume_/, ""), command);
    }
  }

  const durableMemorySegments = memoryMounts.map((memory, index) => {
    const name = compactString(memory.name || `memory:${index + 1}`);
    const key = restartToken ? `${restartToken}:memory:${name}` : "";
    return Object.freeze({
      segmentId: stableToken("segment", [restartToken, jobName, "memory", name]),
      kind: "memory",
      name,
      key,
      replayOrder: index,
      status: key ? "trackable" : "missing-restart-token",
      nextCommand: key ? "restore_memory_slot" : "repair_restart_command_ledger",
      blocking: !key,
      replayPolicy: memory.providerSync ? "restore-provider-snapshot" : "restore-runtime-snapshot",
      statusChannel,
      commandId: "",
    });
  });

  const adapterStepSegments = externalSteps.map((step, index) => {
    const stepName = compactString(step.name || step.id || `step:${index + 1}`);
    const command = commandByStep.get(normalizeCommandName(stepName)) || null;
    const capabilityRefs = toArray(step.capability || step.capabilities || step.requiresCapability)
      .map(compactString)
      .filter(Boolean)
      .sort();
    const idempotencyKey = firstString(step.idempotencyKey, command?.idempotencyKey, runtimeScope.idempotencyKey);
    const missing = [
      !restartToken && "restartToken",
      !statusChannel && "statusChannel",
      !idempotencyKey && "idempotencyKey",
      !command?.commandId && "restartCommand",
    ].filter(Boolean);

    return Object.freeze({
      segmentId: stableToken("segment", [restartToken, jobName, "adapter-step", stepName]),
      kind: "adapter-step",
      name: stepName,
      key: restartToken ? `${restartToken}:step:${stepName}` : "",
      replayOrder: durableMemorySegments.length + index,
      status: missing.length > 0 ? "blocked" : "replay-ready",
      nextCommand: missing.length > 0 ? "attach_recovery_status_handoff" : "resume_adapter_step",
      blocking: missing.length > 0,
      replayPolicy: command?.replayPolicy || "resume-before-retry",
      statusChannel,
      commandId: compactString(command?.commandId),
      idempotencyKey,
      capabilities: freezeArray(capabilityRefs),
      missing: freezeArray(missing),
    });
  });

  const verifierSegments = toArray(ledger)
    .filter((command) => command.phase === "verify")
    .map((command, index) => Object.freeze({
      segmentId: stableToken("segment", [restartToken, jobName, "verify", command.command]),
      kind: "verifier",
      name: command.command,
      key: restartToken ? `${restartToken}:verify:${command.command}` : "",
      replayOrder: durableMemorySegments.length + adapterStepSegments.length + index,
      status: command.required === false || restartToken ? "trackable" : "blocked",
      nextCommand: command.required === false || restartToken ? "replay_verifier_status" : "repair_restart_command_ledger",
      blocking: command.required !== false && !restartToken,
      replayPolicy: command.replayPolicy || "latest-status-wins",
      statusChannel,
      commandId: command.commandId,
      idempotencyKey: command.idempotencyKey,
      missing: freezeArray([command.required !== false && !restartToken && "restartToken"].filter(Boolean)),
    }));

  return freezeArray([...durableMemorySegments, ...adapterStepSegments, ...verifierSegments]
    .sort((left, right) => left.replayOrder - right.replayOrder || left.kind.localeCompare(right.kind) || left.name.localeCompare(right.name)));
}

function createRestartReplayReport(segments = [], runtimeScope = {}) {
  const blocked = toArray(segments).filter((segment) => segment.blocking);
  const adapter = toArray(segments).filter((segment) => segment.kind === "adapter-step");
  const memory = toArray(segments).filter((segment) => segment.kind === "memory");
  const verifier = toArray(segments).filter((segment) => segment.kind === "verifier");

  return Object.freeze({
    protocol: "aios.scope.restart-replay-report.v1",
    state: blocked.length > 0
      ? "blocked"
      : adapter.length > 0
        ? "adapter-replay-ready"
        : segments.length > 0
          ? "runtime-replay-ready"
          : "not-required",
    acceptedForReplay: blocked.length === 0,
    acceptedForAdapter: blocked.length === 0 && adapter.length > 0,
    restartToken: compactString(runtimeScope.restartToken),
    statusChannel: compactString(runtimeScope.statusChannel),
    counters: Object.freeze({
      segments: segments.length,
      adapterSteps: adapter.length,
      memorySlots: memory.length,
      verifierSegments: verifier.length,
      blocked: blocked.length,
      replayReady: toArray(segments).filter((segment) => segment.status === "replay-ready").length,
      trackable: toArray(segments).filter((segment) => segment.status === "trackable").length,
    }),
    blockedSegments: freezeArray(blocked.map((segment) => ({
      segmentId: segment.segmentId,
      kind: segment.kind,
      name: segment.name,
      missing: segment.missing || freezeArray([]),
      nextCommand: segment.nextCommand,
    }))),
    nextCommand: blocked[0]?.nextCommand
      || adapter[0]?.nextCommand
      || memory[0]?.nextCommand
      || verifier[0]?.nextCommand
      || "observe",
  });
}

function createPersistedRuntimeShape(job = {}, runtimeScope = {}) {
  const restartToken = compactString(runtimeScope.restartToken);
  const ledger = createRestartCommandLedger(job, runtimeScope);
  const externalSteps = toArray(job.steps).filter((step) => {
    const adapter = compactString(step.adapter);
    const capabilityRefs = toArray(step.capability || step.capabilities || step.requiresCapability).map(compactString);
    return adapter.includes("mailchimp") || capabilityRefs.some((capability) => WRITE_ACTION_PATTERN.test(capability));
  });
  const memoryMounts = toArray(job.memory)
    .map((memory) => ({
      name: compactString(memory.name || memory.id || "memory"),
      mode: compactString(memory.mode || "ephemeral"),
      providerSync: memory.providerSync === true || ["campaignDraft", "audienceSnapshot"].includes(compactString(memory.name)),
    }))
    .filter((memory) => memory.mode === "persistent" || memory.mode === "durable" || memory.providerSync);
  const replaySegments = createRestartReplaySegments(job, runtimeScope, ledger, externalSteps, memoryMounts);
  const replayReport = createRestartReplayReport(replaySegments, runtimeScope);

  return Object.freeze({
    protocol: "aios.scope.persisted-runtime-shape.v1",
    jobName: compactString(job.name || "anonymous"),
    restartToken,
    storageKey: restartToken ? `${restartToken}:state` : "",
    commandLedgerKey: restartToken ? `${restartToken}:commands` : "",
    statusSnapshotKey: restartToken ? `${restartToken}:status` : "",
    resumeCursorKey: restartToken && externalSteps.length > 0 ? `${restartToken}:cursor` : "",
    restartSafe: Boolean(restartToken)
      && ledger.every((command) => command.idempotencyKey || command.phase !== "dedupe")
      && replayReport.acceptedForReplay,
    commands: ledger,
    replaySegments,
    replayReport,
    stateSlots: freezeArray([
      ...memoryMounts.map((memory) => ({
        name: memory.name,
        mode: memory.mode,
        key: restartToken ? `${restartToken}:memory:${memory.name}` : "",
        providerSync: memory.providerSync,
      })),
      ...externalSteps.map((step) => {
        const stepName = compactString(step.name || step.id || "step");
        return {
          name: `step:${stepName}`,
          mode: "adapter-status",
          key: restartToken ? `${restartToken}:step:${stepName}` : "",
          providerSync: true,
        };
      }),
    ]),
  });
}

function normalizeAdapterStatusState(value) {
  const state = compactString(value).toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
  if (["ok", "done", "success", "succeeded", "complete", "completed"].includes(state)) return "succeeded";
  if (["fail", "failed", "error", "errored", "rejected"].includes(state)) return "failed";
  if (["timeout", "timed-out", "expired"].includes(state)) return "timed-out";
  if (["running", "processing", "queued", "pending", "in-flight"].includes(state)) return "pending";
  if (["cancel", "cancelled", "canceled"].includes(state)) return "cancelled";
  return state || "unknown";
}

function normalizeAdapterStatusEvent(event = {}, index = 0, runtimeScope = {}, persistedRuntime = {}) {
  const capability = compactString(event.capability || event.action || event.scope);
  const stepName = compactString(event.step || event.stepName || event.command || "");
  const idempotencyKey = firstString(event.idempotencyKey, runtimeScope.idempotencyKey);
  const statusSnapshotKey = firstString(event.statusSnapshotKey, persistedRuntime.statusSnapshotKey);
  const providerRequestId = firstString(event.providerRequestId, event.requestId, event.id);
  const observedAt = firstString(event.observedAt, event.updatedAt, event.createdAt, event.timestamp);
  const state = normalizeAdapterStatusState(event.state || event.status || event.phase);

  return Object.freeze({
    index,
    capability,
    stepName,
    provider: compactString(event.provider || (capability.match(MAILCHIMP_ACTION_PATTERN) ? "mailchimp" : "")),
    state,
    statusCode: compactString(event.statusCode || event.code),
    message: compactString(event.message || event.reason || event.error),
    idempotencyKey,
    providerRequestId,
    statusChannel: firstString(event.statusChannel, runtimeScope.statusChannel),
    statusSnapshotKey,
    resumeCursor: firstString(event.resumeCursor, event.cursor),
    retryAfterMs: Number.isFinite(Number(event.retryAfterMs)) ? Number(event.retryAfterMs) : 0,
    observedAt,
    terminal: ["succeeded", "failed", "timed-out", "cancelled"].includes(state),
  });
}

function collectAdapterStatusInput(job = {}) {
  const clientState = job.clientState || job.requestState || {};
  return [
    ...toArray(job.adapterStatus),
    ...toArray(job.adapterStatuses),
    ...toArray(job.statusEvents),
    ...toArray(job.providerStatus),
    ...toArray(clientState.adapterStatus),
    ...toArray(clientState.statusEvents),
  ];
}

function createAdapterStatusLedger(job = {}, runtimeScope = {}, persistedRuntime = {}) {
  const jobName = compactString(job.name || "anonymous");
  const externalSteps = toArray(job.steps).filter((step) => {
    const adapter = compactString(step.adapter);
    const capabilityRefs = toArray(step.capability || step.capabilities || step.requiresCapability).map(compactString);
    return adapter.includes("mailchimp") || capabilityRefs.some((capability) => WRITE_ACTION_PATTERN.test(capability));
  });
  const expected = externalSteps.flatMap((step) => {
    const stepName = compactString(step.name || step.id || "step");
    const capabilityRefs = toArray(step.capability || step.capabilities || step.requiresCapability).map(compactString).filter(Boolean);
    return (capabilityRefs.length > 0 ? capabilityRefs : [`step:${stepName}`]).map((capability) => Object.freeze({
      stepName,
      capability,
      idempotencyKey: firstString(step.idempotencyKey, runtimeScope.idempotencyKey),
      statusSnapshotKey: persistedRuntime.statusSnapshotKey || "",
    }));
  });
  const events = collectAdapterStatusInput(job)
    .map((event, index) => normalizeAdapterStatusEvent(event, index, runtimeScope, persistedRuntime))
    .filter((event) => event.capability || event.stepName || event.providerRequestId)
    .sort((left, right) => {
      return left.capability.localeCompare(right.capability)
        || left.stepName.localeCompare(right.stepName)
        || left.index - right.index;
    });
  const latestByCapability = new Map();
  for (const event of events) {
    const key = event.capability || `step:${event.stepName}`;
    latestByCapability.set(key, event);
  }
  const missing = expected.filter((row) => !latestByCapability.has(row.capability) && !latestByCapability.has(`step:${row.stepName}`));
  const failed = events.filter((event) => ["failed", "timed-out", "cancelled"].includes(event.state));
  const pending = events.filter((event) => event.state === "pending");
  const unknown = events.filter((event) => event.state === "unknown");

  return Object.freeze({
    protocol: "aios.scope.adapter-status-ledger.v1",
    jobName,
    statusChannel: runtimeScope.statusChannel,
    statusSnapshotKey: persistedRuntime.statusSnapshotKey || "",
    restartToken: runtimeScope.restartToken,
    expected: freezeArray(expected),
    events: freezeArray(events),
    latestByCapability: freezeArray([...latestByCapability.entries()].map(([capability, event]) => ({
      capability,
      state: event.state,
      stepName: event.stepName,
      providerRequestId: event.providerRequestId,
      idempotencyKey: event.idempotencyKey,
      statusSnapshotKey: event.statusSnapshotKey,
      retryAfterMs: event.retryAfterMs,
      message: event.message,
    }))),
    state: failed.length > 0
      ? "failed"
      : missing.length > 0 && expected.length > 0
        ? "missing-status"
        : pending.length > 0
          ? "pending"
          : unknown.length > 0
            ? "unknown"
            : events.length > 0
              ? "settled"
              : expected.length > 0
                ? "unobserved"
                : "not-required",
    counters: Object.freeze({
      expected: expected.length,
      events: events.length,
      missing: missing.length,
      failed: failed.length,
      pending: pending.length,
      unknown: unknown.length,
      succeeded: events.filter((event) => event.state === "succeeded").length,
    }),
    missing: freezeArray(missing),
    failures: freezeArray(failed.map((event) => ({
      capability: event.capability,
      stepName: event.stepName,
      state: event.state,
      statusCode: event.statusCode,
      message: event.message,
      nextCommand: event.state === "timed-out" ? "retry_same_idempotency_key" : "inspect_adapter_failure",
    }))),
    nextCommand: failed.length > 0
      ? failed[0].state === "timed-out" ? "retry_same_idempotency_key" : "inspect_adapter_failure"
      : missing.length > 0
        ? "load_adapter_status_snapshot"
        : pending.length > 0
          ? "poll_adapter_status_channel"
          : "observe",
  });
}

function createScopeActionableError(code, message, nextCommand, context = {}) {
  return Object.freeze({
    code,
    message,
    nextCommand,
    ...context,
  });
}

function createScopeRecoveryPlan(job = {}, runtimeScope = {}, permissionBoundary = {}, persistedRuntime = {}) {
  const jobName = compactString(job.name || "anonymous");
  const heldCapabilities = toArray(permissionBoundary.heldCapabilities);
  const runtimeDiagnostics = toArray(runtimeScope.diagnostics);
  const missingIdentity = heldCapabilities.filter((capability) => {
    const reasons = toArray(capability.reasons).map(compactString);
    return reasons.includes("missing-tenant") || reasons.includes("missing-workspace") || reasons.includes("missing-actor");
  });
  const missingPermissions = heldCapabilities.filter((capability) => {
    return toArray(capability.reasons).some((reason) => compactString(reason).startsWith("missing-permission:"));
  });
  const missingHandoff = heldCapabilities.filter((capability) => {
    const reasons = toArray(capability.reasons).map(compactString);
    return reasons.includes("missing-idempotency-key") || reasons.includes("missing-status-channel");
  });
  const restartBlocked = persistedRuntime.restartSafe === false;
  const blockedReplaySegments = toArray(persistedRuntime.replaySegments).filter((segment) => segment.blocking);
  const actionableErrors = [
    missingIdentity.length > 0 && createScopeActionableError(
      "aios.scope.mailchimp_identity_missing",
      `Job "${jobName}" needs tenant, workspace, and actor state before Mailchimp adapter handoff.`,
      "attach_client_runtime_request",
      {
        jobName,
        heldActions: freezeArray(missingIdentity.map((capability) => capability.action)),
      }
    ),
    missingPermissions.length > 0 && createScopeActionableError(
      "aios.scope.mailchimp_permission_missing",
      `Job "${jobName}" has Mailchimp capabilities held by missing permission grants.`,
      "grant_mailchimp_permission",
      {
        jobName,
        requiredPermissions: freezeArray([...new Set(missingPermissions.map((capability) => capability.requiredPermission).filter(Boolean))]),
        heldActions: freezeArray(missingPermissions.map((capability) => capability.action)),
      }
    ),
    missingHandoff.length > 0 && createScopeActionableError(
      "aios.scope.mailchimp_status_handoff_missing",
      `Job "${jobName}" needs idempotency and status-channel state for restart-safe Mailchimp writes.`,
      "attach_recovery_status_handoff",
      {
        jobName,
        heldActions: freezeArray(missingHandoff.map((capability) => capability.action)),
      }
    ),
    restartBlocked && createScopeActionableError(
      "aios.scope.restart_replay_blocked",
      `Job "${jobName}" cannot replay all external-write commands deterministically.`,
      "repair_restart_command_ledger",
      {
        jobName,
        commandLedgerKey: persistedRuntime.commandLedgerKey || "",
        blockedSegments: freezeArray(blockedReplaySegments.map((segment) => segment.segmentId)),
      }
    ),
  ].filter(Boolean);
  const warnings = runtimeDiagnostics.filter((diagnostic) => diagnostic.level === "warning");
  const externalCommands = toArray(persistedRuntime.commands)
    .filter((command) => ["dedupe", "resume", "verify"].includes(compactString(command.phase)));
  const degradedMode = actionableErrors.length > 0
    ? "blocked"
    : warnings.length > 0 || permissionBoundary.status === "held"
      ? "preview-only"
      : "none";

  return Object.freeze({
    protocol: "aios.scope.recovery-plan.v1",
    jobName,
    state: actionableErrors.length > 0
      ? "blocked"
      : degradedMode === "preview-only"
        ? "degraded"
        : runtimeScope.requiresClientState || runtimeScope.requiresIdempotency
          ? "handoff-ready"
          : "local",
    degradedMode,
    acceptedForAdapter: actionableErrors.length === 0 && permissionBoundary.auditHandoff?.acceptedForAdapter !== false,
    acceptedForPreview: true,
    statusChannel: runtimeScope.statusChannel,
    restartToken: runtimeScope.restartToken,
    statusSnapshotKey: persistedRuntime.statusSnapshotKey || "",
    actionableErrors: freezeArray(actionableErrors),
    retryBackoff: Object.freeze({
      strategy: externalCommands.length > 0 && actionableErrors.length === 0 ? "resume-before-retry" : "manual-resolution",
      baseDelayMs: externalCommands.some((command) => compactString(command.phase) === "resume") ? 5000 : 1000,
      maxDelayMs: externalCommands.length > 0 ? 30000 : 0,
      retryableCommands: freezeArray(externalCommands.map((command) => command.command)),
    }),
    nextCommand: actionableErrors[0]?.nextCommand
      || (degradedMode === "preview-only" ? "continue_preview_and_resolve_warnings" : "observe"),
    failureState: Object.freeze({
      missingIdentity: missingIdentity.length,
      missingPermissions: missingPermissions.length,
      missingHandoff: missingHandoff.length,
      restartBlocked,
      blockedReplaySegments: blockedReplaySegments.length,
      warnings: warnings.length,
    }),
  });
}

function createClientWorkflowHandoff(job = {}, runtimeScope = {}, permissionBoundary = {}, persistedRuntime = {}, adapterStatusLedger = {}, recoveryPlan = {}) {
  const jobName = compactString(job.name || "anonymous");
  const heldCapabilities = toArray(permissionBoundary.heldCapabilities);
  const statusFailures = toArray(adapterStatusLedger.failures);
  const statusMissing = toArray(adapterStatusLedger.missing);
  const commands = [];
  const pushCommand = (command, phase, state, reason, extra = {}) => {
    const normalized = normalizeCommandName(command, phase);
    const blocking = state === "blocked" || state === "needs-input";
    commands.push(Object.freeze({
      command: normalized,
      commandId: stableToken("workflow", [
        runtimeScope.restartToken,
        persistedRuntime.commandLedgerKey,
        phase,
        normalized,
        extra.capability || extra.stepName || jobName,
      ]),
      phase,
      state,
      reason,
      jobName,
      capability: compactString(extra.capability),
      stepName: compactString(extra.stepName),
      tenantId: runtimeScope.tenantId,
      workspaceId: runtimeScope.workspaceId,
      requestId: runtimeScope.requestId,
      statusChannel: runtimeScope.statusChannel,
      statusSnapshotKey: persistedRuntime.statusSnapshotKey || "",
      restartToken: runtimeScope.restartToken,
      idempotencyKey: compactString(extra.idempotencyKey || runtimeScope.idempotencyKey),
      nextCommand: compactString(extra.nextCommand || normalized),
      replayPolicy: compactString(extra.replayPolicy || "dedupe-by-command-id"),
      userVisible: Object.freeze({
        label: compactString(extra.label || normalized.replace(/_/g, " ")),
        blocking,
        handoff: compactString(extra.handoff || (phase === "adapter" ? "adapter" : "runtime")),
      }),
    }));
  };

  if (runtimeScope.requiresClientState && (!runtimeScope.tenantId || !runtimeScope.workspaceId || !permissionBoundary.actorId)) {
    pushCommand(
      "attach_client_runtime_request",
      "identity",
      "needs-input",
      "Tenant, workspace, and actor state are required before Mailchimp adapter handoff.",
      { label: "Attach runtime identity", replayPolicy: "replace-client-state" }
    );
  }

  for (const capability of heldCapabilities) {
    const reasons = toArray(capability.reasons).map(compactString);
    const missingPermission = reasons.find((reason) => reason.startsWith("missing-permission:"));
    pushCommand(
      missingPermission ? "grant_mailchimp_permission" : "resolve_boundary_hold",
      "boundary",
      "blocked",
      missingPermission || reasons[0] || "Mailchimp capability boundary is held.",
      {
        capability: capability.action,
        label: missingPermission ? `Grant ${capability.requiredPermission}` : `Resolve ${capability.action}`,
        nextCommand: missingPermission ? "grant_mailchimp_permission" : "resolve_boundary_hold",
        replayPolicy: "manual-resolution",
      }
    );
  }

  if (runtimeScope.requiresIdempotency && !runtimeScope.idempotencyKey) {
    pushCommand(
      "attach_recovery_status_handoff",
      "recovery",
      "blocked",
      "External Mailchimp writes require a stable idempotency key before replay.",
      { label: "Attach idempotency key", replayPolicy: "replace-client-state" }
    );
  }

  if (runtimeScope.requiresClientState && !runtimeScope.statusChannel) {
    pushCommand(
      "attach_recovery_status_handoff",
      "recovery",
      "blocked",
      "Mailchimp adapter handoff requires a client-visible status channel.",
      { label: "Attach status channel", replayPolicy: "replace-client-state" }
    );
  }

  for (const failure of statusFailures) {
    pushCommand(
      failure.nextCommand || "inspect_adapter_failure",
      "adapter-status",
      "blocked",
      failure.message || failure.state || "Adapter status is terminal.",
      {
        capability: failure.capability,
        stepName: failure.stepName,
        label: `Inspect ${failure.capability || failure.stepName}`,
        replayPolicy: failure.state === "timed-out" ? "retry-same-idempotency-key" : "manual-resolution",
      }
    );
  }

  for (const missing of statusMissing) {
    pushCommand(
      "load_adapter_status_snapshot",
      "adapter-status",
      "needs-input",
      "Adapter status snapshot must be loaded before replay-safe handoff.",
      {
        capability: missing.capability,
        stepName: missing.stepName,
        label: `Load status for ${missing.capability || missing.stepName}`,
        replayPolicy: "load-before-retry",
      }
    );
  }

  if (persistedRuntime.restartSafe === false) {
    pushCommand(
      "repair_restart_command_ledger",
      "restart",
      "blocked",
      "Restart command ledger is not replay-safe for all external writes.",
      { label: "Repair restart commands", replayPolicy: "manual-resolution" }
    );
  }

  const adapterReady = recoveryPlan.acceptedForAdapter === true
    && permissionBoundary.status !== "held"
    && persistedRuntime.restartSafe === true
    && statusFailures.length === 0
    && statusMissing.length === 0;
  if (adapterReady && runtimeScope.requiresClientState) {
    pushCommand(
      "queue_scope_runtime_handoff",
      "adapter",
      "ready",
      "Scope, identity, permissions, and restart metadata are ready for Mailchimp adapter handoff.",
      {
        label: "Queue Mailchimp handoff",
        handoff: "adapter",
        replayPolicy: "resume-before-retry",
      }
    );
  } else if (commands.length === 0) {
    pushCommand(
      "start_runtime",
      "runtime",
      "ready",
      "Scope contracts are ready for local runtime execution.",
      { label: "Start runtime", handoff: "runtime", replayPolicy: "not-required" }
    );
  }

  const sorted = commands.sort((left, right) => {
    return left.phase.localeCompare(right.phase)
      || left.state.localeCompare(right.state)
      || left.command.localeCompare(right.command)
      || left.capability.localeCompare(right.capability);
  });
  const blocked = sorted.filter((command) => command.userVisible.blocking);
  const ready = sorted.filter((command) => command.state === "ready");

  return Object.freeze({
    protocol: "aios.scope.client-workflow-handoff.v1",
    jobName,
    state: blocked.length > 0 ? "blocked" : ready.some((command) => command.phase === "adapter") ? "adapter-ready" : "runtime-ready",
    acceptedForPreview: true,
    acceptedForRuntime: blocked.length === 0,
    acceptedForAdapter: blocked.length === 0 && ready.some((command) => command.phase === "adapter"),
    commandKey: persistedRuntime.commandLedgerKey || "",
    statusChannel: runtimeScope.statusChannel,
    statusSnapshotKey: persistedRuntime.statusSnapshotKey || "",
    restartToken: runtimeScope.restartToken,
    commands: freezeArray(sorted),
    blockedCommands: freezeArray(blocked),
    readyCommands: freezeArray(ready),
    nextStep: Object.freeze({
      command: blocked[0]?.nextCommand || ready[0]?.nextCommand || recoveryPlan.nextCommand || "observe",
      reason: blocked[0]?.reason
        || ready[0]?.reason
        || "Client workflow handoff is waiting for semantic recovery state.",
    }),
  });
}

function createScopeHistorySnapshot(job = {}, declarations = [], references = [], runtimeScope = {}, permissionBoundary = {}, persistedRuntime = {}, recoveryPlan = {}, diagnostics = [], adapterStatusLedger = {}) {
  const jobName = compactString(job.name || "anonymous");
  const errors = toArray(diagnostics).filter((diagnostic) => diagnostic.level === "error");
  const warnings = toArray(diagnostics).filter((diagnostic) => diagnostic.level === "warning");
  const unresolved = references.filter((reference) => reference.resolved === false);
  const externalCommands = toArray(persistedRuntime.commands)
    .filter((command) => ["dedupe", "resume", "verify"].includes(compactString(command.phase)));
  const replaySegments = toArray(persistedRuntime.replaySegments);
  const blockedReplaySegments = replaySegments.filter((segment) => segment.blocking);
  const heldCapabilities = toArray(permissionBoundary.heldCapabilities);
  const state = errors.length > 0 || recoveryPlan.state === "blocked"
    ? "blocked"
    : recoveryPlan.state === "degraded" || warnings.length > 0
      ? "degraded"
      : runtimeScope.requiresClientState || runtimeScope.requiresIdempotency
        ? "handoff-ready"
        : "resolved";

  return Object.freeze({
    protocol: "aios.scope.history-snapshot.v1",
    jobName,
    state,
    exportReady: errors.length === 0,
    tenantId: runtimeScope.tenantId,
    workspaceId: runtimeScope.workspaceId,
    requestId: runtimeScope.requestId,
    statusChannel: runtimeScope.statusChannel,
    restartToken: runtimeScope.restartToken,
    statusSnapshotKey: persistedRuntime.statusSnapshotKey || "",
    counters: Object.freeze({
      declarations: declarations.length,
      capabilities: declarations.filter((declaration) => declaration.kind === "capability").length,
      memory: declarations.filter((declaration) => declaration.kind === "memory").length,
      steps: declarations.filter((declaration) => declaration.kind === "step").length,
      verifiers: declarations.filter((declaration) => declaration.kind === "verifier").length,
      references: references.length,
      unresolved: unresolved.length,
      mailchimpCapabilities: toArray(permissionBoundary.capabilities).length,
      heldCapabilities: heldCapabilities.length,
      restartCommands: toArray(persistedRuntime.commands).length,
      replaySegments: replaySegments.length,
      blockedReplaySegments: blockedReplaySegments.length,
      stateSlots: toArray(persistedRuntime.stateSlots).length,
      adapterStatusEvents: adapterStatusLedger.counters?.events ?? 0,
      adapterStatusMissing: adapterStatusLedger.counters?.missing ?? 0,
      adapterStatusFailures: adapterStatusLedger.counters?.failed ?? 0,
      actionableErrors: toArray(recoveryPlan.actionableErrors).length,
      diagnostics: diagnostics.length,
      errors: errors.length,
      warnings: warnings.length,
    }),
    timeline: freezeArray([
      ...heldCapabilities.map((capability, index) => ({
        index,
        event: "permission-boundary-hold",
        name: capability.action,
        state: "blocked",
        nextCommand: recoveryPlan.nextCommand || "resolve_boundary_hold",
        detail: capability.requiredPermission || capability.reasons?.[0] || "",
      })),
      ...externalCommands.map((command, index) => ({
        index: heldCapabilities.length + index,
        event: `restart-${command.phase}`,
        name: command.command,
        state: persistedRuntime.restartSafe ? "restart-safe" : "restart-blocked",
        nextCommand: persistedRuntime.restartSafe ? "observe" : "repair_restart_command_ledger",
        detail: command.replayPolicy || "",
      })),
      ...replaySegments.map((segment, index) => ({
        index: heldCapabilities.length + externalCommands.length + index,
        event: `replay-${segment.kind}`,
        name: segment.name,
        state: segment.status,
        nextCommand: segment.nextCommand,
        detail: segment.key || segment.segmentId,
      })),
      ...toArray(adapterStatusLedger.failures).map((failure, index) => ({
        index: heldCapabilities.length + externalCommands.length + replaySegments.length + index,
        event: "adapter-status-failure",
        name: failure.capability || failure.stepName,
        state: failure.state,
        nextCommand: failure.nextCommand,
        detail: failure.message || failure.statusCode || "",
      })),
      ...toArray(adapterStatusLedger.missing).map((missing, index) => ({
        index: heldCapabilities.length + externalCommands.length + replaySegments.length + toArray(adapterStatusLedger.failures).length + index,
        event: "adapter-status-missing",
        name: missing.capability || missing.stepName,
        state: "missing-status",
        nextCommand: "load_adapter_status_snapshot",
        detail: missing.statusSnapshotKey || "",
      })),
      ...unresolved.map((reference, index) => ({
        index: heldCapabilities.length
          + externalCommands.length
          + replaySegments.length
          + toArray(adapterStatusLedger.failures).length
          + toArray(adapterStatusLedger.missing).length
          + index,
        event: "unresolved-reference",
        name: reference.source,
        state: "blocked",
        nextCommand: "declare_missing_symbol",
        detail: `${reference.relation}:${reference.target}`,
      })),
    ]),
    report: Object.freeze({
      acceptedForPreview: true,
      acceptedForAdapter: recoveryPlan.acceptedForAdapter === true && errors.length === 0,
      nextCommand: recoveryPlan.nextCommand || (unresolved.length > 0 ? "declare_missing_symbol" : "observe"),
      restartSafe: persistedRuntime.restartSafe === true,
      replayReport: persistedRuntime.replayReport || createRestartReplayReport([], runtimeScope),
      adapterStatusState: adapterStatusLedger.state || "not-required",
      adapterStatusNextCommand: adapterStatusLedger.nextCommand || "observe",
      requiredStatusChannels: freezeArray(runtimeScope.statusChannel ? [runtimeScope.statusChannel] : []),
      requiredRestartTokens: freezeArray(runtimeScope.restartToken ? [runtimeScope.restartToken] : []),
      heldActions: freezeArray(heldCapabilities.map((capability) => capability.action)),
    }),
  });
}

function createScopePreviewCard(declaration = {}, references = [], permissionBoundary = {}) {
  const unresolvedRefs = references
    .filter((reference) => reference.source === declaration.name && reference.resolved === false)
    .map((reference) => `${reference.relation}:${reference.target}`);
  const heldCapability = declaration.kind === "capability"
    ? toArray(permissionBoundary.heldCapabilities).find((capability) => capability.action === declaration.name)
    : null;

  return Object.freeze({
    kind: declaration.kind,
    name: declaration.name,
    index: declaration.index,
    previewState: unresolvedRefs.length > 0 || heldCapability
      ? "blocked"
      : declaration.kind === "capability" && toArray(permissionBoundary.capabilities).some((capability) => capability.action === declaration.name)
        ? "adapter-boundary"
        : "ready",
    sourceRange: declaration.sourceRange,
    unresolvedReferences: freezeArray(unresolvedRefs),
    boundaryHold: heldCapability ? Object.freeze({
      action: heldCapability.action,
      requiredPermission: heldCapability.requiredPermission,
      reasons: heldCapability.reasons,
    }) : null,
    nextCommand: unresolvedRefs.length > 0
      ? "declare_missing_symbol"
      : heldCapability
        ? "resolve_boundary_hold"
        : "observe",
  });
}

function createScopePreviewAcceptance(job = {}, declarations = [], references = [], runtimeScope = {}, permissionBoundary = {}, persistedRuntime = {}, recoveryPlan = {}, diagnostics = []) {
  const jobName = compactString(job.name || "anonymous");
  const errors = toArray(diagnostics).filter((diagnostic) => diagnostic.level === "error");
  const warnings = toArray(diagnostics).filter((diagnostic) => diagnostic.level === "warning");
  const cards = declarations
    .map((declaration) => createScopePreviewCard(declaration, references, permissionBoundary))
    .sort((left, right) => left.kind.localeCompare(right.kind) || left.index - right.index || left.name.localeCompare(right.name));
  const blockedCards = cards.filter((card) => card.previewState === "blocked");
  const adapterCards = cards.filter((card) => card.previewState === "adapter-boundary");
  const heldCapabilities = toArray(permissionBoundary.heldCapabilities);
  const recoveryErrors = toArray(recoveryPlan.actionableErrors);
  const state = errors.length > 0 || blockedCards.length > 0 || recoveryPlan.state === "blocked"
    ? "blocked"
    : warnings.length > 0 || recoveryPlan.state === "degraded"
      ? "preview-only"
      : adapterCards.length > 0 || runtimeScope.requiresClientState || runtimeScope.requiresIdempotency
        ? "handoff-ready"
        : "ready";
  const validationItems = [
    ...errors.map((diagnostic) => ({
      code: diagnostic.code,
      severity: "error",
      message: diagnostic.message,
      nextCommand: diagnostic.nextCommand || "resolve_scope_diagnostic",
    })),
    ...warnings.map((diagnostic) => ({
      code: diagnostic.code,
      severity: "warning",
      message: diagnostic.message,
      nextCommand: diagnostic.nextCommand || "continue_preview_and_resolve_warnings",
    })),
    ...recoveryErrors.map((error) => ({
      code: error.code,
      severity: "error",
      message: error.message,
      nextCommand: error.nextCommand,
    })),
  ];
  const clientStateRequirements = [
    runtimeScope.requiresClientState && !runtimeScope.tenantId && "tenantId",
    runtimeScope.requiresClientState && !runtimeScope.workspaceId && "workspaceId",
    runtimeScope.requiresClientState && !permissionBoundary.actorId && "actorId",
    runtimeScope.requiresIdempotency && !runtimeScope.idempotencyKey && "idempotencyKey",
    runtimeScope.requiresClientState && !runtimeScope.statusChannel && "statusChannel",
  ].filter(Boolean);
  const nextCommand = recoveryPlan.nextCommand
    || validationItems.find((item) => item.severity === "error")?.nextCommand
    || (clientStateRequirements.length > 0 ? "attach_client_runtime_request" : "")
    || (state === "handoff-ready" ? "queue_scope_runtime_handoff" : "observe");

  return Object.freeze({
    protocol: "aios.scope.preview-acceptance.v1",
    jobName,
    state,
    acceptedForPreview: true,
    acceptedForClientRuntime: state === "ready" || state === "handoff-ready",
    acceptedForAdapter: recoveryPlan.acceptedForAdapter === true && errors.length === 0 && heldCapabilities.length === 0,
    title: compactString(job.previewTitle || job.title || jobName),
    cards: freezeArray(cards),
    validationSummary: Object.freeze({
      errors: errors.length,
      warnings: warnings.length,
      blockedSymbols: blockedCards.length,
      adapterBoundarySymbols: adapterCards.length,
      heldCapabilities: heldCapabilities.length,
      recoveryErrors: recoveryErrors.length,
      clientStateRequirements: clientStateRequirements.length,
      restartSafe: persistedRuntime.restartSafe === true,
    }),
    clientRuntimeRequirements: Object.freeze({
      tenantId: runtimeScope.tenantId,
      workspaceId: runtimeScope.workspaceId,
      requestId: runtimeScope.requestId,
      statusChannel: runtimeScope.statusChannel,
      idempotencyKey: runtimeScope.idempotencyKey,
      restartToken: runtimeScope.restartToken,
      missing: freezeArray(clientStateRequirements),
      persistedKeys: Object.freeze({
        storageKey: persistedRuntime.storageKey || "",
        commandLedgerKey: persistedRuntime.commandLedgerKey || "",
        statusSnapshotKey: persistedRuntime.statusSnapshotKey || "",
        resumeCursorKey: persistedRuntime.resumeCursorKey || "",
      }),
    }),
    validationItems: freezeArray(validationItems),
    nextStep: Object.freeze({
      command: nextCommand,
      reason: state === "blocked"
        ? "Scope diagnostics or recovery holds must be resolved before runtime adoption."
        : state === "preview-only"
          ? "Preview can render while warnings or degraded recovery state are repaired."
          : state === "handoff-ready"
            ? "Scope is ready to hand client runtime state to downstream semantic passes."
            : "Scope is resolved for local runtime execution.",
    }),
    operatorReview: createScopeOperatorReviewPacket(
      job,
      cards,
      validationItems,
      clientStateRequirements,
      runtimeScope,
      permissionBoundary,
      persistedRuntime,
      recoveryPlan,
      state,
      nextCommand
    ),
  });
}

function createScopeOperatorReviewPacket(job = {}, cards = [], validationItems = [], clientStateRequirements = [], runtimeScope = {}, permissionBoundary = {}, persistedRuntime = {}, recoveryPlan = {}, state = "ready", nextCommand = "observe") {
  const jobName = compactString(job.name || "anonymous");
  const blockedCards = toArray(cards).filter((card) => card.previewState === "blocked");
  const adapterCards = toArray(cards).filter((card) => card.previewState === "adapter-boundary");
  const heldCapabilities = toArray(permissionBoundary.heldCapabilities);
  const actionableErrors = toArray(recoveryPlan.actionableErrors);
  const errorItems = toArray(validationItems).filter((item) => item.severity === "error");
  const warningItems = toArray(validationItems).filter((item) => item.severity === "warning");
  const lanes = [
    blockedCards.length > 0 && Object.freeze({
      lane: "symbols",
      state: "blocked",
      title: "Resolve symbols",
      count: blockedCards.length,
      nextCommand: "declare_missing_symbol",
      items: freezeArray(blockedCards.map((card) => ({
        name: card.name,
        kind: card.kind,
        detail: card.unresolvedReferences[0] || card.boundaryHold?.reasons?.[0] || "",
      }))),
    }),
    heldCapabilities.length > 0 && Object.freeze({
      lane: "permissions",
      state: "blocked",
      title: "Resolve Mailchimp permissions",
      count: heldCapabilities.length,
      nextCommand: "resolve_boundary_hold",
      items: freezeArray(heldCapabilities.map((capability) => ({
        name: capability.action,
        kind: "capability",
        detail: capability.requiredPermission || capability.reasons?.[0] || "",
      }))),
    }),
    clientStateRequirements.length > 0 && Object.freeze({
      lane: "client-runtime",
      state: "needs-input",
      title: "Attach runtime identity",
      count: clientStateRequirements.length,
      nextCommand: "attach_client_runtime_request",
      items: freezeArray(clientStateRequirements.map((field) => ({
        name: field,
        kind: "runtime-field",
        detail: `Missing ${field}`,
      }))),
    }),
    adapterCards.length > 0 && Object.freeze({
      lane: "adapter-handoff",
      state: recoveryPlan.acceptedForAdapter ? "ready" : "waiting",
      title: "Mailchimp adapter handoff",
      count: adapterCards.length,
      nextCommand: recoveryPlan.acceptedForAdapter ? "queue_scope_runtime_handoff" : recoveryPlan.nextCommand || "resolve_boundary_hold",
      items: freezeArray(adapterCards.map((card) => ({
        name: card.name,
        kind: card.kind,
        detail: runtimeScope.statusChannel || persistedRuntime.statusSnapshotKey || "adapter boundary",
      }))),
    }),
    warningItems.length > 0 && Object.freeze({
      lane: "warnings",
      state: "review",
      title: "Review warnings",
      count: warningItems.length,
      nextCommand: "continue_preview_and_resolve_warnings",
      items: freezeArray(warningItems.map((item) => ({
        name: item.code,
        kind: "diagnostic",
        detail: item.message,
      }))),
    }),
  ].filter(Boolean);
  const blockingLanes = lanes.filter((lane) => lane.state === "blocked");
  const readyLanes = lanes.filter((lane) => lane.state === "ready");
  const reviewState = blockingLanes.length > 0 || errorItems.length > 0
    ? "blocked"
    : state === "handoff-ready" || readyLanes.length > 0
      ? "ready-for-handoff"
      : lanes.length > 0
        ? "needs-review"
        : "ready";

  return Object.freeze({
    protocol: "aios.scope.operator-review-packet.v1",
    jobName,
    state: reviewState,
    acceptedForPreview: true,
    acceptedForClientRuntime: reviewState !== "blocked" && clientStateRequirements.length === 0,
    acceptedForAdapter: reviewState === "ready-for-handoff"
      && recoveryPlan.acceptedForAdapter === true
      && heldCapabilities.length === 0
      && persistedRuntime.restartSafe === true,
    statusChannel: runtimeScope.statusChannel,
    restartToken: runtimeScope.restartToken,
    statusSnapshotKey: persistedRuntime.statusSnapshotKey || "",
    lanes: freezeArray(lanes),
    validationSummary: Object.freeze({
      errors: errorItems.length,
      warnings: warningItems.length,
      blockedLanes: blockingLanes.length,
      actionableErrors: actionableErrors.length,
      missingClientState: clientStateRequirements.length,
      adapterSymbols: adapterCards.length,
      restartSafe: persistedRuntime.restartSafe === true,
    }),
    nextStep: Object.freeze({
      command: blockingLanes[0]?.nextCommand
        || actionableErrors[0]?.nextCommand
        || (clientStateRequirements.length > 0 ? "attach_client_runtime_request" : "")
        || nextCommand
        || "observe",
      reason: blockingLanes.length > 0
        ? "Preview contains blocking symbols or Mailchimp boundary holds."
        : clientStateRequirements.length > 0
          ? "Runtime identity fields are required before adapter handoff."
          : reviewState === "ready-for-handoff"
            ? "Scope preview can be accepted and handed to semantic runtime contracts."
            : "Scope preview can continue while non-blocking items are reviewed.",
    }),
  });
}

function createScopeAnalyticsExport(jobScopes = [], diagnostics = []) {
  const scopes = toArray(jobScopes);
  const snapshots = scopes.map((scope) => scope.historySnapshot).filter(Boolean);
  const errors = toArray(diagnostics).filter((diagnostic) => diagnostic.level === "error");
  const warnings = toArray(diagnostics).filter((diagnostic) => diagnostic.level === "warning");
  const workflowHandoffs = scopes.map((scope) => scope.clientWorkflowHandoff).filter(Boolean);
  const counters = snapshots.reduce((totals, snapshot) => {
    totals.declarations += snapshot.counters?.declarations ?? 0;
    totals.references += snapshot.counters?.references ?? 0;
    totals.unresolved += snapshot.counters?.unresolved ?? 0;
    totals.mailchimpCapabilities += snapshot.counters?.mailchimpCapabilities ?? 0;
    totals.heldCapabilities += snapshot.counters?.heldCapabilities ?? 0;
    totals.restartCommands += snapshot.counters?.restartCommands ?? 0;
    totals.stateSlots += snapshot.counters?.stateSlots ?? 0;
    totals.adapterStatusEvents += snapshot.counters?.adapterStatusEvents ?? 0;
    totals.adapterStatusMissing += snapshot.counters?.adapterStatusMissing ?? 0;
    totals.adapterStatusFailures += snapshot.counters?.adapterStatusFailures ?? 0;
    totals.actionableErrors += snapshot.counters?.actionableErrors ?? 0;
    return totals;
  }, {
    jobs: snapshots.length,
    declarations: 0,
    references: 0,
    unresolved: 0,
    mailchimpCapabilities: 0,
    heldCapabilities: 0,
    restartCommands: 0,
    stateSlots: 0,
    adapterStatusEvents: 0,
    adapterStatusMissing: 0,
    adapterStatusFailures: 0,
    actionableErrors: 0,
  });

  return Object.freeze({
    protocol: "aios.scope.analytics-export.v1",
    state: errors.length > 0 || snapshots.some((snapshot) => snapshot.state === "blocked")
      ? "blocked"
      : snapshots.some((snapshot) => snapshot.state === "degraded")
        ? "degraded"
        : "ready",
    exportReady: errors.length === 0,
    counters: Object.freeze({
      ...counters,
      diagnostics: diagnostics.length,
      errors: errors.length,
      warnings: warnings.length,
    }),
    snapshots: freezeArray(snapshots),
    timeline: freezeArray(snapshots
      .flatMap((snapshot) => snapshot.timeline.map((event) => ({ ...event, jobName: snapshot.jobName })))
      .sort((left, right) => left.jobName.localeCompare(right.jobName) || left.index - right.index)),
    report: Object.freeze({
      statusChannels: freezeArray([...new Set(snapshots.flatMap((snapshot) => snapshot.report.requiredStatusChannels))]),
      restartTokens: freezeArray([...new Set(snapshots.flatMap((snapshot) => snapshot.report.requiredRestartTokens))]),
      adapterStatusStates: freezeArray([...new Set(snapshots.map((snapshot) => snapshot.report.adapterStatusState).filter(Boolean))]),
      adapterStatusNextCommands: freezeArray([...new Set(snapshots.map((snapshot) => snapshot.report.adapterStatusNextCommand).filter(Boolean))]),
      heldActions: freezeArray([...new Set(snapshots.flatMap((snapshot) => snapshot.report.heldActions))]),
      nextCommands: freezeArray([...new Set(snapshots.map((snapshot) => snapshot.report.nextCommand).filter(Boolean))]),
      adapterReadyJobs: snapshots.filter((snapshot) => snapshot.report.acceptedForAdapter).length,
      previewReadyJobs: snapshots.filter((snapshot) => snapshot.report.acceptedForPreview).length,
      clientRuntimeAcceptedJobs: scopes.filter((scope) => scope.previewAcceptance?.acceptedForClientRuntime).length,
      adapterAcceptedPreviewJobs: scopes.filter((scope) => scope.previewAcceptance?.acceptedForAdapter).length,
      operatorReviewStates: freezeArray([...new Set(scopes.map((scope) => scope.previewAcceptance?.operatorReview?.state).filter(Boolean))]),
      operatorReviewNextCommands: freezeArray([...new Set(scopes.map((scope) => scope.previewAcceptance?.operatorReview?.nextStep?.command).filter(Boolean))]),
      clientWorkflowStates: freezeArray([...new Set(workflowHandoffs.map((handoff) => handoff.state).filter(Boolean))]),
      clientWorkflowNextCommands: freezeArray([...new Set(workflowHandoffs.map((handoff) => handoff.nextStep?.command).filter(Boolean))]),
      blockedWorkflowCommands: workflowHandoffs.reduce((count, handoff) => count + (handoff.blockedCommands?.length ?? 0), 0),
    }),
  });
}

function createJobScope(job = {}, requestState = normalizeRequestState()) {
  const declarations = collectJobDeclarations(job);
  const { byKind, diagnostics } = buildDeclarationIndex(declarations);
  const references = [
    ...resolveCapabilityReferences(job, byKind, diagnostics),
    ...resolveMemoryReferences(job, byKind, diagnostics),
    ...resolveVerifierReferences(job, byKind, diagnostics),
  ];
  const runtimeScope = createClientRuntimeScope(job, requestState);
  const persistedRuntime = createPersistedRuntimeShape(job, runtimeScope);
  const adapterStatusLedger = createAdapterStatusLedger(job, runtimeScope, persistedRuntime);
  const permissionBoundary = createPermissionBoundaryMatrix(job, requestState, runtimeScope);
  const recoveryPlan = createScopeRecoveryPlan(job, runtimeScope, permissionBoundary, persistedRuntime);
  const clientWorkflowHandoff = createClientWorkflowHandoff(
    job,
    runtimeScope,
    permissionBoundary,
    persistedRuntime,
    adapterStatusLedger,
    recoveryPlan
  );
  diagnostics.push(...runtimeScope.diagnostics);
  for (const held of permissionBoundary.heldCapabilities) {
    diagnostics.push(createDiagnostic(
      "aios.scope.mailchimp_permission_boundary_hold",
      `Mailchimp capability "${held.action}" is held by scope permission boundaries.`,
      {
        jobName: job.name,
        capabilityName: held.action,
        requiredPermission: held.requiredPermission,
        reasons: held.reasons,
      }
    ));
  }
  const declarationsByKind = Object.fromEntries(
    [...DECLARATION_KINDS].map((kind) => [
      kind,
      freezeArray([...byKind[kind].values()].sort(stableSortByName).map((declaration) => ({
        kind: declaration.kind,
        name: declaration.name,
        index: declaration.index,
        sourceRange: declaration.sourceRange,
      }))),
    ])
  );
  const unresolved = references.filter((reference) => !reference.resolved);
  const historySnapshot = createScopeHistorySnapshot(
    job,
    declarations,
    references,
    runtimeScope,
    permissionBoundary,
    persistedRuntime,
    recoveryPlan,
    diagnostics,
    adapterStatusLedger
  );
  const previewAcceptance = createScopePreviewAcceptance(
    job,
    declarations,
    references,
    runtimeScope,
    permissionBoundary,
    persistedRuntime,
    recoveryPlan,
    diagnostics
  );

  return Object.freeze({
    jobName: compactString(job.name || "anonymous"),
    declarations: freezeArray(declarations.sort(stableSortByName).map((declaration) => ({
      kind: declaration.kind,
      name: declaration.name,
      index: declaration.index,
      sourceRange: declaration.sourceRange,
    }))),
    declarationsByKind: Object.freeze(declarationsByKind),
    references: freezeArray(references),
    runtimeScope,
    persistedRuntime,
    adapterStatusLedger,
    permissionBoundary,
    recoveryPlan,
    clientWorkflowHandoff,
    historySnapshot,
    previewAcceptance,
    diagnostics: freezeArray(diagnostics),
    status: diagnostics.some((diagnostic) => diagnostic.level === "error") ? "invalid" : "resolved",
    counts: Object.freeze({
      declarations: declarations.length,
      references: references.length,
      unresolved: unresolved.length,
    }),
  });
}

export function resolveAiosScopes(input = {}) {
  const jobs = getJobs(input);
  const requestState = normalizeRequestState(input);
  const jobScopes = jobs.map((job) => createJobScope(job, requestState));
  const diagnostics = jobScopes.flatMap((scope) => scope.diagnostics);
  const status = diagnostics.some((diagnostic) => diagnostic.level === "error") ? "blocked" : "resolved";

  return Object.freeze({
    protocol: "aios.semantic.scope-resolution.v1",
    status,
    requestState,
    jobs: freezeArray(jobScopes),
    diagnostics: freezeArray(diagnostics),
    runtimeHandoff: createScopeRuntimeHandoff(jobScopes, requestState, diagnostics),
    analyticsExport: createScopeAnalyticsExport(jobScopes, diagnostics),
    summary: summarizeScopeResolution(jobScopes, diagnostics),
  });
}

export function createScopeRuntimeHandoff(jobScopes = [], requestState = normalizeRequestState(), diagnostics = []) {
  const scopes = toArray(jobScopes);
  const clientBoundJobs = scopes.filter((scope) => scope.runtimeScope?.requiresClientState);
  const idempotentJobs = scopes.filter((scope) => scope.runtimeScope?.requiresIdempotency);
  const blockedRecovery = scopes.filter((scope) => scope.recoveryPlan?.state === "blocked");
  const degradedRecovery = scopes.filter((scope) => scope.recoveryPlan?.state === "degraded");
  const previews = scopes.map((scope) => scope.previewAcceptance).filter(Boolean);
  const blockedPreviews = previews.filter((preview) => preview.state === "blocked");
  const previewOnly = previews.filter((preview) => preview.state === "preview-only");
  const missingClientState = previews.flatMap((preview) => preview.clientRuntimeRequirements?.missing || []);
  const workflowHandoffs = scopes.map((scope) => scope.clientWorkflowHandoff).filter(Boolean);
  const workflowBlocked = workflowHandoffs.flatMap((handoff) => handoff.blockedCommands || []);
  const workflowReady = workflowHandoffs.flatMap((handoff) => handoff.readyCommands || []);
  return Object.freeze({
    stateContract: "aios.client-runtime.scope.v1",
    tenantId: requestState.tenantId,
    workspaceId: requestState.workspaceId,
    requestId: requestState.requestId,
    restartToken: requestState.restartToken,
    statusChannel: requestState.statusChannel,
    acceptedForClientRuntime: diagnostics.every((diagnostic) => diagnostic.level !== "error")
      && blockedRecovery.length === 0
      && blockedPreviews.length === 0,
    acceptedForPreview: true,
    state: blockedRecovery.length > 0
      || blockedPreviews.length > 0
      ? "blocked"
      : degradedRecovery.length > 0 || previewOnly.length > 0
        ? "degraded"
        : "ready",
    nextCommand: blockedRecovery[0]?.recoveryPlan?.nextCommand
      || workflowBlocked[0]?.nextCommand
      || blockedPreviews[0]?.nextStep?.command
      || degradedRecovery[0]?.recoveryPlan?.nextCommand
      || previewOnly[0]?.nextStep?.command
      || workflowReady[0]?.nextCommand
      || "observe",
    clientWorkflowHandoff: Object.freeze({
      protocol: "aios.client-runtime.workflow-handoff.v1",
      state: workflowBlocked.length > 0
        ? "blocked"
        : workflowReady.some((command) => command.phase === "adapter")
          ? "adapter-ready"
          : "runtime-ready",
      acceptedForRuntime: workflowBlocked.length === 0,
      acceptedForAdapter: workflowBlocked.length === 0 && workflowReady.some((command) => command.phase === "adapter"),
      commands: freezeArray(workflowHandoffs.flatMap((handoff) => handoff.commands || [])),
      blockedCommands: freezeArray(workflowBlocked),
      readyCommands: freezeArray(workflowReady),
      nextStep: Object.freeze({
        command: workflowBlocked[0]?.nextCommand || workflowReady[0]?.nextCommand || "observe",
        reason: workflowBlocked[0]?.reason || workflowReady[0]?.reason || "Client workflow handoff is reconciled.",
      }),
    }),
    previewAcceptance: Object.freeze({
      protocol: "aios.client-runtime.scope-preview-acceptance.v1",
      acceptedJobs: previews.filter((preview) => preview.acceptedForClientRuntime).length,
      adapterAcceptedJobs: previews.filter((preview) => preview.acceptedForAdapter).length,
      blockedJobs: blockedPreviews.length,
      previewOnlyJobs: previewOnly.length,
      missingClientState: freezeArray([...new Set(missingClientState)].sort()),
      nextSteps: freezeArray([...new Map(previews
        .map((preview) => preview.nextStep)
        .filter((nextStep) => nextStep?.command)
        .map((nextStep) => [nextStep.command, nextStep])).values()]),
    }),
    jobs: freezeArray(scopes.map((scope) => ({
      jobName: scope.jobName,
      tenantId: scope.runtimeScope?.tenantId || "",
      workspaceId: scope.runtimeScope?.workspaceId || "",
      requestId: scope.runtimeScope?.requestId || "",
      idempotencyKey: scope.runtimeScope?.idempotencyKey || "",
      statusChannel: scope.runtimeScope?.statusChannel || "",
      restartToken: scope.runtimeScope?.restartToken || "",
      requiresClientState: scope.runtimeScope?.requiresClientState === true,
      requiresIdempotency: scope.runtimeScope?.requiresIdempotency === true,
      permissionBoundary: scope.permissionBoundary || null,
      persistedRuntime: scope.persistedRuntime || null,
      adapterStatusLedger: scope.adapterStatusLedger || null,
      recoveryPlan: scope.recoveryPlan || null,
      clientWorkflowHandoff: scope.clientWorkflowHandoff || null,
      previewAcceptance: scope.previewAcceptance || null,
    }))),
    summary: Object.freeze({
      clientBoundJobs: clientBoundJobs.length,
      idempotentJobs: idempotentJobs.length,
      missingRuntimeState: scopes.filter((scope) => scope.runtimeScope?.diagnostics?.some((diagnostic) => diagnostic.level === "error")).length,
      restartSafeJobs: scopes.filter((scope) => scope.persistedRuntime?.restartSafe).length,
      persistedStateSlots: scopes.reduce((count, scope) => count + (scope.persistedRuntime?.stateSlots?.length ?? 0), 0),
      restartCommands: scopes.reduce((count, scope) => count + (scope.persistedRuntime?.commands?.length ?? 0), 0),
      adapterStatusEvents: scopes.reduce((count, scope) => count + (scope.adapterStatusLedger?.counters?.events ?? 0), 0),
      adapterStatusMissing: scopes.reduce((count, scope) => count + (scope.adapterStatusLedger?.counters?.missing ?? 0), 0),
      adapterStatusFailures: scopes.reduce((count, scope) => count + (scope.adapterStatusLedger?.counters?.failed ?? 0), 0),
      mailchimpBoundaryHolds: scopes.reduce((count, scope) => count + (scope.permissionBoundary?.heldCapabilities?.length ?? 0), 0),
      blockedRecoveryPlans: blockedRecovery.length,
      degradedRecoveryPlans: degradedRecovery.length,
      blockedPreviews: blockedPreviews.length,
      previewOnlyJobs: previewOnly.length,
      clientRuntimeAcceptedJobs: previews.filter((preview) => preview.acceptedForClientRuntime).length,
      adapterAcceptedPreviewJobs: previews.filter((preview) => preview.acceptedForAdapter).length,
      workflowBlockedCommands: workflowBlocked.length,
      workflowReadyCommands: workflowReady.length,
      actionableErrors: scopes.reduce((count, scope) => count + (scope.recoveryPlan?.actionableErrors?.length ?? 0), 0),
    }),
  });
}

export function summarizeScopeResolution(jobScopes = [], diagnostics = []) {
  const scopes = toArray(jobScopes);
  const errors = toArray(diagnostics).filter((diagnostic) => diagnostic.level === "error");
  return Object.freeze({
    jobs: scopes.length,
    declarations: scopes.reduce((count, scope) => count + (scope.counts?.declarations ?? 0), 0),
    references: scopes.reduce((count, scope) => count + (scope.counts?.references ?? 0), 0),
    unresolved: scopes.reduce((count, scope) => count + (scope.counts?.unresolved ?? 0), 0),
    clientBoundJobs: scopes.filter((scope) => scope.runtimeScope?.requiresClientState).length,
    idempotentJobs: scopes.filter((scope) => scope.runtimeScope?.requiresIdempotency).length,
    mailchimpPermissionBoundaries: scopes.filter((scope) => scope.permissionBoundary?.capabilities?.length > 0).length,
    mailchimpBoundaryHolds: scopes.reduce((count, scope) => count + (scope.permissionBoundary?.heldCapabilities?.length ?? 0), 0),
    adapterStatusEvents: scopes.reduce((count, scope) => count + (scope.adapterStatusLedger?.counters?.events ?? 0), 0),
    adapterStatusMissing: scopes.reduce((count, scope) => count + (scope.adapterStatusLedger?.counters?.missing ?? 0), 0),
    adapterStatusFailures: scopes.reduce((count, scope) => count + (scope.adapterStatusLedger?.counters?.failed ?? 0), 0),
    blockedRecoveryPlans: scopes.filter((scope) => scope.recoveryPlan?.state === "blocked").length,
    degradedRecoveryPlans: scopes.filter((scope) => scope.recoveryPlan?.state === "degraded").length,
    actionableErrors: scopes.reduce((count, scope) => count + (scope.recoveryPlan?.actionableErrors?.length ?? 0), 0),
    previewAcceptedJobs: scopes.filter((scope) => scope.previewAcceptance?.acceptedForPreview).length,
    clientRuntimeAcceptedJobs: scopes.filter((scope) => scope.previewAcceptance?.acceptedForClientRuntime).length,
    adapterAcceptedPreviewJobs: scopes.filter((scope) => scope.previewAcceptance?.acceptedForAdapter).length,
    workflowBlockedCommands: scopes.reduce((count, scope) => count + (scope.clientWorkflowHandoff?.blockedCommands?.length ?? 0), 0),
    workflowReadyCommands: scopes.reduce((count, scope) => count + (scope.clientWorkflowHandoff?.readyCommands?.length ?? 0), 0),
    workflowAdapterReadyJobs: scopes.filter((scope) => scope.clientWorkflowHandoff?.acceptedForAdapter).length,
    historySnapshots: scopes.filter((scope) => scope.historySnapshot).length,
    exportReady: errors.length === 0,
    errors: errors.length,
    readyForTypeHints: errors.length === 0,
  });
}

export function selfCheckScopeResolution() {
  const sample = {
    request: {
      tenantId: "tenant_123",
      workspaceId: "workspace_456",
      userId: "user_abc",
      requestId: "request_789",
      permissions: ["mailchimp.campaigns.write"],
      statusChannel: "tenant:tenant_123:workspace:workspace_456:aios-status",
    },
    jobs: [{
      name: "mailchimpCampaign",
      capabilities: [{ name: "campaign.update", boundary: "external" }],
      memory: [{ name: "campaignDraft", mode: "persistent" }],
      steps: [{ name: "patchCampaign", capability: "campaign.update", memoryReads: ["campaignDraft"], output: "campaignDraft" }],
      verifiers: [{ name: "approvalEvidence", truth: ["operatorApproval"] }],
      truthBoundaries: [{ name: "operatorApproval", source: "operator" }],
    }],
  };
  const resolved = resolveAiosScopes(sample);
  return Object.freeze({
    ok: resolved.status === "resolved" && resolved.summary.unresolved === 0,
    status: resolved.status,
    summary: resolved.summary,
  });
}
