import {
  planMailchimpArtifactWriteSet,
  recoverMailchimpArtifactWriteSet,
  summarizeMailchimpArtifactWriteSet,
} from '../stdlib/artifact-fs.mjs';
import {
  buildMailchimpArtifactWriteSyscalls,
  createMailchimpSyscallManifest,
} from '../stdlib/syscalls.mjs';

function compactString(value) {
  return String(value ?? '').trim();
}

function stableList(value) {
  if (value == null) return [];
  const list = Array.isArray(value) ? value : String(value).split(',');
  return [...new Set(list.map(compactString).filter(Boolean))].sort();
}

function stableObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.keys(value).sort().reduce((next, key) => {
    const normalizedKey = compactString(key);
    if (!normalizedKey || value[key] === undefined) return next;
    const raw = value[key];
    next[normalizedKey] = Array.isArray(raw)
      ? raw.map((item) => (item && typeof item === 'object' ? stableObject(item) : item))
      : raw && typeof raw === 'object'
        ? stableObject(raw)
        : raw;
    return next;
  }, {});
}

function stableHash(value) {
  const source = JSON.stringify(stableObject(value));
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function parsePrimitive(value) {
  const text = compactString(value);
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (text === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  return text;
}

function parseKeyValueTokens(tokens) {
  return tokens.reduce((next, token) => {
    const separator = token.indexOf('=');
    if (separator === -1) return next;
    const key = compactString(token.slice(0, separator));
    const value = compactString(token.slice(separator + 1));
    if (key) next[key] = parsePrimitive(value);
    return next;
  }, {});
}

function normalizeMemberRow(row = {}) {
  const mergeFields = row.merge_fields && typeof row.merge_fields === 'object'
    ? stableObject(row.merge_fields)
    : {};
  return {
    email_address: compactString(row.email_address || row.email || row.member),
    status_if_new: compactString(row.status_if_new || row.status || 'subscribed') || 'subscribed',
    merge_fields: mergeFields,
    tags: stableList(row.tags || row.tag),
  };
}

function parseArtifactBindingSource(source = '') {
  const parsed = {
    boundaryId: '',
    members: [],
    acceptedKeys: [],
    persistedArtifactState: {},
    metadata: {},
    diagnostics: [],
  };

  for (const [lineIndex, rawLine] of compactString(source).split(/\r?\n/).entries()) {
    const line = rawLine.replace(/#.*/, '').trim();
    if (!line) continue;
    const tokens = line.split(/\s+/);
    const directive = compactString(tokens.shift()).toLowerCase();
    const values = parseKeyValueTokens(tokens);
    const bare = tokens.filter((token) => !token.includes('=')).map(compactString).filter(Boolean);

    if (directive === 'boundary' || directive === 'boundaryid') {
      parsed.boundaryId = compactString(values.id || values.boundaryId || bare[0]);
    } else if (directive === 'member') {
      parsed.members.push(normalizeMemberRow({ ...values, email_address: values.email || values.email_address || bare[0] }));
    } else if (directive === 'accept' || directive === 'accepted') {
      parsed.acceptedKeys.push(...stableList(bare.length ? bare : values.key || values.keys));
    } else if (directive === 'persisted') {
      parsed.persistedArtifactState = {
        ...parsed.persistedArtifactState,
        writeSetId: compactString(values.writeSetId || parsed.persistedArtifactState.writeSetId),
        entries: [
          ...(Array.isArray(parsed.persistedArtifactState.entries) ? parsed.persistedArtifactState.entries : []),
          ...(values.path ? [{
            path: compactString(values.path),
            logicalName: compactString(values.logicalName || values.name),
            digest: compactString(values.digest),
            status: compactString(values.status || 'written'),
          }] : []),
        ],
      };
    } else if (directive === 'meta' || directive === 'metadata') {
      parsed.metadata = { ...parsed.metadata, ...values };
    } else {
      parsed.diagnostics.push({
        code: 'mailchimp.artifact_binding.unknown_directive',
        severity: 'warning',
        field: `source.line:${lineIndex + 1}`,
        message: `Unknown Mailchimp artifact binding directive "${directive}".`,
      });
    }
  }

  return parsed;
}

function normalizeArtifactBindingInput(input = {}) {
  const parsed = typeof input === 'string' ? parseArtifactBindingSource(input) : null;
  const raw = parsed || (input && typeof input === 'object' ? input : {});
  return {
    ...raw,
    boundaryId: compactString(raw.boundaryId || raw.id),
    members: Array.isArray(raw.members) ? raw.members.map(normalizeMemberRow) : [],
    acceptedKeys: stableList(raw.acceptedKeys || raw.accepted || raw.acceptanceKeys),
    persistedArtifactState: raw.persistedArtifactState && typeof raw.persistedArtifactState === 'object'
      ? raw.persistedArtifactState
      : {},
    metadata: stableObject(raw.metadata),
    diagnostics: Array.isArray(raw.diagnostics) ? raw.diagnostics : [],
  };
}

function validateArtifactBinding(input, boundary, writeSet, syscalls) {
  const diagnostics = [...input.diagnostics];
  if (!boundary || boundary.kind !== 'aios.workspace.boundary_binding') {
    diagnostics.push({
      code: 'mailchimp.artifact_binding.boundary_required',
      severity: 'error',
      field: 'boundary.kind',
      message: 'Mailchimp artifact binding requires an aios.workspace.boundary_binding runtime boundary.',
    });
  }
  if (input.boundaryId && boundary?.boundaryId && input.boundaryId !== boundary.boundaryId) {
    diagnostics.push({
      code: 'mailchimp.artifact_binding.boundary_mismatch',
      severity: 'error',
      field: 'boundaryId',
      message: 'Mailchimp artifact binding source boundaryId does not match the runtime boundary.',
    });
  }
  if (!Array.isArray(boundary?.artifactPlan) || boundary.artifactPlan.length === 0) {
    diagnostics.push({
      code: 'mailchimp.artifact_binding.plan_missing',
      severity: 'error',
      field: 'boundary.artifactPlan',
      message: 'Mailchimp artifact binding requires a local artifact plan.',
    });
  }
  if (writeSet.status === 'blocked') {
    diagnostics.push(...(writeSet.issues || []).map((issue) => ({
      code: issue.code,
      severity: issue.severity,
      field: issue.path,
      message: issue.message,
    })));
  }
  const blockedSyscalls = syscalls.filter((syscall) => syscall.status === 'blocked');
  if (blockedSyscalls.length > 0) {
    diagnostics.push({
      code: 'mailchimp.artifact_binding.syscall_blocked',
      severity: 'warning',
      field: 'syscalls',
      message: 'One or more Mailchimp artifact syscalls require recovery or operator handoff before dispatch.',
    });
  }
  return diagnostics;
}

function statusFromDiagnostics(diagnostics) {
  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
  const warnings = diagnostics.filter((diagnostic) => diagnostic.severity === 'warning');
  return {
    errors,
    warnings,
    codes: [...new Set(diagnostics.map((diagnostic) => diagnostic.code).filter(Boolean))].sort(),
  };
}

function issueCodeList(issues = []) {
  return stableList(issues.map((issue) => issue.code || issue.reason || issue.message));
}

function buildAcceptanceGate(input, writeSet) {
  const accepted = stableList(input.acceptedKeys);
  const issueCodes = issueCodeList(writeSet.issues || []);
  const inferredRequired = stableList([
    ...(Array.isArray(writeSet.acceptance?.requiredKeys) ? writeSet.acceptance.requiredKeys : []),
    ...(Array.isArray(writeSet.requiredAcceptanceKeys) ? writeSet.requiredAcceptanceKeys : []),
    ...(writeSet.status === 'needs_acceptance' ? issueCodes : []),
  ]);
  const required = inferredRequired.length ? inferredRequired : issueCodes
    .filter((code) => code.includes('accept') || code.includes('consent'));
  const missing = required.filter((key) => !accepted.includes(key));
  const state = missing.length
    ? 'waiting_for_acceptance'
    : writeSet.status === 'needs_acceptance'
      ? 'accepted_without_declared_keys'
      : 'satisfied';

  return {
    protocol: 'aios.artifact-acceptance-gate.mailchimp.v1',
    state,
    satisfied: state === 'satisfied',
    requiredKeys: required,
    acceptedKeys: accepted,
    missingKeys: missing,
    nextAction: state === 'satisfied'
      ? 'continue_artifact_binding'
      : 'client.collect_acceptance',
  };
}

function buildSyscallGate(syscalls) {
  const blocked = syscalls.filter((syscall) => syscall.status === 'blocked');
  const ready = syscalls.filter((syscall) => syscall.status === 'ready');
  const pending = syscalls.filter((syscall) => !['ready', 'blocked'].includes(syscall.status));
  const blockedCommands = blocked.map((syscall) => syscall.command || syscall.name || syscall.kind).filter(Boolean).sort();

  return {
    protocol: 'aios.artifact-syscall-gate.mailchimp.v1',
    state: blocked.length
      ? 'blocked'
      : pending.length
        ? 'pending'
        : 'ready',
    ready: blocked.length === 0 && pending.length === 0,
    total: syscalls.length,
    readyCount: ready.length,
    blockedCount: blocked.length,
    pendingCount: pending.length,
    blockedCommands,
    nextAction: blocked.length
      ? 'repair_artifact_syscalls'
      : pending.length
        ? 'observe_artifact_syscalls'
        : 'dispatch_artifact_write_syscalls',
  };
}

function buildRecoveryGate(recovery, writeSet) {
  const status = compactString(recovery.status || writeSet.status || 'unknown');
  const resumable = ['recovered', 'resume_writes', 'ready'].includes(status);
  const blocked = ['blocked', 'failed'].includes(status) || writeSet.status === 'blocked';

  return {
    protocol: 'aios.artifact-recovery-gate.mailchimp.v1',
    state: blocked
      ? 'blocked'
      : resumable
        ? 'resumable'
        : status === 'needs_acceptance'
          ? 'waiting_for_acceptance'
          : 'observing',
    resumable,
    restartSafe: blocked === false,
    recoveryStatus: status,
    writeSetStatus: compactString(writeSet.status || 'unknown'),
    nextAction: blocked
      ? 'repair_artifact_binding'
      : resumable
        ? 'resume_artifact_writes'
        : status === 'needs_acceptance'
          ? 'client.collect_acceptance'
          : 'observe_persisted_artifacts',
  };
}

function buildArtifactGateHandoff(input, writeSet, syscalls, recovery, diagnostics) {
  const diagnosticStatus = statusFromDiagnostics(diagnostics);
  const acceptance = buildAcceptanceGate(input, writeSet);
  const syscall = buildSyscallGate(syscalls);
  const recoveryGate = buildRecoveryGate(recovery, writeSet);
  const blockedReasons = stableList([
    ...diagnosticStatus.errors.map((diagnostic) => diagnostic.code),
    ...(acceptance.satisfied ? [] : acceptance.missingKeys.map((key) => `acceptance.missing:${key}`)),
    ...(syscall.ready ? [] : syscall.blockedCommands.map((command) => `syscall.blocked:${command}`)),
    ...(recoveryGate.restartSafe ? [] : [`recovery.${recoveryGate.state}`]),
  ]);
  const ready = blockedReasons.length === 0
    && acceptance.satisfied
    && syscall.ready
    && recoveryGate.restartSafe
    && writeSet.status === 'ready';

  return {
    protocol: 'aios.artifact-gate-handoff.mailchimp.v1',
    ready,
    state: ready
      ? 'ready'
      : diagnosticStatus.errors.length
        ? 'blocked'
        : acceptance.satisfied === false
          ? 'waiting_for_acceptance'
          : syscall.ready === false
            ? syscall.state
            : recoveryGate.state,
    blockedReasons,
    acceptance,
    syscall,
    recovery: recoveryGate,
    diagnostics: {
      errors: diagnosticStatus.errors.length,
      warnings: diagnosticStatus.warnings.length,
      codes: diagnosticStatus.codes,
    },
    nextAction: ready
      ? 'dispatch_artifact_write_syscalls'
      : diagnosticStatus.errors.length
        ? 'repair_artifact_binding'
        : acceptance.satisfied === false
          ? acceptance.nextAction
          : syscall.ready === false
            ? syscall.nextAction
            : recoveryGate.nextAction,
  };
}

function buildArtifactStatus(writeSet, recovery, diagnostics) {
  const { errors, warnings, codes } = statusFromDiagnostics(diagnostics);
  const ready = errors.length === 0 && writeSet.status === 'ready';
  return {
    protocol: 'aios.artifact-binding-status.mailchimp.v1',
    state: errors.length
      ? 'blocked'
      : writeSet.status === 'needs_acceptance'
        ? 'waiting_for_acceptance'
        : ready
          ? 'ready'
          : 'recovering',
    ready,
    nextAction: ready
      ? 'dispatch_artifact_write_syscalls'
      : writeSet.status === 'needs_acceptance'
        ? 'client.collect_acceptance'
        : recovery.status === 'recovered'
          ? 'observe_persisted_artifacts'
          : recovery.status === 'resume_writes'
            ? 'resume_artifact_writes'
            : 'repair_artifact_binding',
    diagnostics: {
      errors: errors.length,
      warnings: warnings.length,
      codes,
    },
  };
}

function workspaceScopeFromBoundary(boundary = {}) {
  const providerJob = boundary.providerJob && typeof boundary.providerJob === 'object' ? boundary.providerJob : {};
  const adapterHandoff = providerJob.adapterHandoff && typeof providerJob.adapterHandoff === 'object'
    ? providerJob.adapterHandoff
    : {};
  const runtimeBoundary = adapterHandoff.runtimeBoundary && typeof adapterHandoff.runtimeBoundary === 'object'
    ? adapterHandoff.runtimeBoundary
    : {};

  return {
    tenant: compactString(
      boundary.tenant
        || boundary.tenantId
        || providerJob.tenant
        || providerJob.tenantId
        || adapterHandoff.tenant
        || runtimeBoundary.tenant,
    ),
    workspace: compactString(
      boundary.workspace
        || boundary.workspaceId
        || providerJob.workspace
        || providerJob.workspaceId
        || adapterHandoff.workspace
        || runtimeBoundary.workspace,
    ),
    actor: compactString(
      boundary.actor
        || boundary.actorId
        || providerJob.actor
        || providerJob.actorId
        || adapterHandoff.actor
        || runtimeBoundary.actorId,
    ),
    auditSink: compactString(
      boundary.auditSink
        || adapterHandoff.auditSink
        || runtimeBoundary.auditSink
        || 'local-runtime-audit',
    ),
  };
}

function normalizeArtifactClientState(input = {}, runtime = {}) {
  const source = input.clientRuntimeHandoff && typeof input.clientRuntimeHandoff === 'object'
    ? input.clientRuntimeHandoff
    : input.clientHandoff && typeof input.clientHandoff === 'object'
      ? input.clientHandoff
      : runtime.clientRuntimeHandoff && typeof runtime.clientRuntimeHandoff === 'object'
        ? runtime.clientRuntimeHandoff
        : {};
  const requestState = source.requestState && typeof source.requestState === 'object' ? source.requestState : {};
  const workflowHandoff = source.workflowHandoff && typeof source.workflowHandoff === 'object' ? source.workflowHandoff : {};

  return {
    requestId: compactString(requestState.requestId || source.requestId || runtime.requestId),
    workflowId: compactString(requestState.workflowId || source.workflowId || runtime.workflowId),
    workflowStep: compactString(requestState.workflowStep || source.workflowStep || runtime.workflowStep),
    clientVisibleStatus: compactString(
      requestState.clientVisibleStatus
        || source.clientVisibleStatus
        || 'artifact_binding_review',
    ),
    adapterRunId: compactString(workflowHandoff.adapterRunId || source.adapterRunId || runtime.adapterRunId),
    continuationKey: compactString(workflowHandoff.continuationKey || source.continuationKey || runtime.continuationKey),
    resumeToken: compactString(workflowHandoff.resumeToken || source.resumeToken || runtime.resumeToken),
    priorCommands: Array.isArray(source.commandReceipts)
      ? source.commandReceipts
      : Array.isArray(runtime.commandReceipts)
        ? runtime.commandReceipts
        : [],
  };
}

function buildArtifactClientHandoff(input, runtime, boundary, writeSet, summary, gateHandoff, status) {
  const scope = workspaceScopeFromBoundary(boundary);
  const clientState = normalizeArtifactClientState(input, runtime);
  const missingClientState = stableList([
    clientState.requestId ? '' : 'requestId',
    clientState.workflowId ? '' : 'workflowId',
    clientState.workflowStep ? '' : 'workflowStep',
  ]);
  const writeSetId = compactString(summary.writeSetId || writeSet.writeSetId || writeSet.id);
  const handoffKey = `mailchimp:artifact-client-handoff:${stableHash({
    boundaryId: boundary?.boundaryId ?? input.boundaryId ?? '',
    writeSetId,
    requestId: clientState.requestId,
    workflowId: clientState.workflowId,
    gateState: gateHandoff.state,
    nextAction: gateHandoff.nextAction,
  })}`;
  const blockedReasons = stableList([
    ...gateHandoff.blockedReasons,
    ...missingClientState.map((field) => `client_state.missing:${field}`),
    scope.tenant ? '' : 'scope.missing_tenant',
    scope.workspace ? '' : 'scope.missing_workspace',
  ]);
  const ready = blockedReasons.length === 0 && status.ready && gateHandoff.ready;
  const priorReceiptIds = new Set(clientState.priorCommands
    .map((receipt) => compactString(receipt?.idempotencyKey || receipt?.command || receipt?.id))
    .filter(Boolean));
  const commandSources = ready
    ? [
      {
        command: 'artifact.write-set.record',
        reason: 'persist restart-safe artifact write set before syscall dispatch',
        state: 'ready',
        writes: [writeSetId || `${handoffKey}:write-set`],
      },
      {
        command: 'artifact.syscalls.dispatch',
        reason: 'artifact gates, acceptance, and recovery state are ready',
        state: 'ready',
        writes: [],
      },
    ]
    : blockedReasons.map((reason) => ({
      command: reason.startsWith('client_state')
        ? 'artifact.client-state.bind'
        : reason.startsWith('scope.')
          ? 'artifact.scope.bind'
          : gateHandoff.nextAction,
      reason,
      state: 'blocked',
      writes: [],
    }));
  const commands = commandSources.map((command, index) => {
    const idempotencyKey = `${handoffKey}:command:${index + 1}:${command.command}`;
    return {
      index: index + 1,
      command: command.command,
      reason: command.reason,
      state: priorReceiptIds.has(idempotencyKey) ? 'applied' : command.state,
      idempotencyKey,
      restartSafe: command.state === 'ready' && gateHandoff.recovery.restartSafe === true,
      writes: command.writes,
    };
  });

  return {
    protocol: 'aios.artifact-client-handoff.mailchimp.v1',
    handoffKey,
    ready,
    restartSafe: gateHandoff.recovery.restartSafe === true && blockedReasons.every((reason) => !reason.startsWith('scope.')),
    canResume: Boolean(clientState.resumeToken || writeSetId || gateHandoff.recovery.resumable),
    nextAction: ready
      ? 'artifact.syscalls.dispatch'
      : commands[0]?.command || gateHandoff.nextAction,
    requestState: {
      requestId: clientState.requestId,
      workflowId: clientState.workflowId,
      workflowStep: clientState.workflowStep,
      clientVisibleStatus: ready ? 'artifact_binding_ready' : clientState.clientVisibleStatus,
      missingFields: missingClientState,
    },
    workflowHandoff: {
      adapterRunId: clientState.adapterRunId,
      continuationKey: clientState.continuationKey,
      resumeToken: clientState.resumeToken,
      status: ready ? 'ready_for_artifact_dispatch' : 'artifact_handoff_blocked',
    },
    scope,
    blockedReasons,
    commands,
    auditEvent: {
      type: 'mailchimp.artifact.client_handoff.checked',
      tenant: scope.tenant,
      workspace: scope.workspace,
      boundaryId: boundary?.boundaryId ?? input.boundaryId ?? null,
      writeSetId,
      ready,
      restartSafe: gateHandoff.recovery.restartSafe === true,
      auditSink: scope.auditSink,
    },
  };
}

function normalizeArtifactCommandReceipts(runtime = {}) {
  const source = runtime.priorCommandReceipts
    || runtime.commandReceipts
    || runtime.artifactCommandReceipts
    || runtime.persistedArtifactLedger?.receipts
    || [];
  const rows = Array.isArray(source) ? source : Object.values(source);
  return new Map(rows.map((entry) => {
    const id = compactString(entry?.id || entry?.command || entry?.idempotencyKey);
    return [id, {
      status: compactString(entry?.status || 'applied') || 'applied',
      receipt: compactString(entry?.receipt || entry?.resultReceipt),
      appliedAt: compactString(entry?.appliedAt || entry?.at),
      cursor: compactString(entry?.cursor || entry?.resumeCursor),
    }];
  }).filter(([id]) => Boolean(id)));
}

function buildArtifactPersistedStateLedger(writeSet, summary, gateHandoff, clientHandoff, status, runtime = {}) {
  const receipts = normalizeArtifactCommandReceipts(runtime);
  const writeSetId = compactString(summary.writeSetId || writeSet.writeSetId || writeSet.id);
  const persistedStateKey = [
    'mailchimp',
    clientHandoff.scope.tenant || 'unknown-tenant',
    clientHandoff.scope.workspace || 'all-workspaces',
    'artifact',
    writeSetId || clientHandoff.handoffKey,
  ].join(':');
  const blockedReasons = stableList([
    ...gateHandoff.blockedReasons,
    ...clientHandoff.blockedReasons,
    ...(status.ready ? [] : [`status.${status.state}`]),
  ]);
  const ready = blockedReasons.length === 0 && gateHandoff.ready && clientHandoff.ready && status.ready;
  const commandSources = [
    {
      command: 'artifact.write-set.persist',
      reason: 'persist local artifact write-set before any syscall dispatch',
      writes: [persistedStateKey],
      restartSafe: Boolean(writeSetId || clientHandoff.handoffKey),
      blocker: writeSetId || clientHandoff.handoffKey ? '' : 'artifact.write_set_missing',
    },
    {
      command: 'artifact.gate-state.persist',
      reason: 'persist gate decisions for restart-safe acceptance and syscall replay',
      writes: [`${persistedStateKey}:gates`],
      restartSafe: gateHandoff.recovery.restartSafe === true,
      blocker: gateHandoff.recovery.restartSafe === true ? '' : 'artifact.recovery_not_restart_safe',
    },
    {
      command: 'artifact.client-handoff.persist',
      reason: 'persist client handoff state and audit route for recovery',
      writes: [`${persistedStateKey}:client-handoff`],
      restartSafe: clientHandoff.restartSafe === true,
      blocker: clientHandoff.restartSafe === true ? '' : 'artifact.client_handoff_not_restart_safe',
    },
    {
      command: 'artifact.syscalls.dispatch',
      reason: 'dispatch artifact syscalls only after persisted write-set and gates are replayable',
      writes: [],
      restartSafe: ready,
      blocker: ready ? '' : blockedReasons[0] || 'artifact.binding_not_ready',
    },
  ];
  const ledgerKey = `${persistedStateKey}:command-ledger:${stableHash({
    writeSetId,
    handoffKey: clientHandoff.handoffKey,
    gateState: gateHandoff.state,
  })}`;
  const rows = commandSources.map((source, index) => {
    const idempotencyKey = `${clientHandoff.handoffKey}:ledger:${index + 1}:${source.command}`;
    const prior = receipts.get(source.command) || receipts.get(idempotencyKey) || null;
    const commandBlocked = Boolean(source.blocker) || (source.command === 'artifact.syscalls.dispatch' && blockedReasons.length > 0);
    const state = commandBlocked
      ? 'blocked'
      : prior?.status === 'applied'
        ? 'applied'
        : ready
          ? 'pending-replay'
          : 'pending';

    return {
      index: index + 1,
      command: source.command,
      reason: source.reason,
      state,
      idempotencyKey,
      ledgerEntryKey: `${ledgerKey}:entry:${index + 1}`,
      writes: source.writes,
      receipt: prior?.receipt || null,
      appliedAt: prior?.appliedAt || null,
      resumeCursor: prior?.cursor || `${writeSetId || clientHandoff.handoffKey}:artifact-ledger:${index + 1}`,
      restartSafe: source.restartSafe === true && commandBlocked === false,
      blocker: source.blocker || null,
    };
  });
  const replayable = ready && rows.every((row) => row.restartSafe || row.state === 'applied');

  return {
    protocol: 'aios.artifact-persisted-state-ledger.mailchimp.v1',
    ledgerKey,
    persistedStateKey,
    ready: replayable,
    status: blockedReasons.length
      ? 'ledger-blocked'
      : rows.every((row) => row.state === 'applied')
        ? 'ledger-complete'
        : ready
          ? 'ledger-replay-ready'
          : 'ledger-pending',
    restartSafe: replayable,
    replayToken: replayable ? `artifact-ledger:${stableHash({
      ledgerKey,
      rows: rows.map((row) => `${row.command}:${row.state}:${row.receipt || ''}`),
    })}` : null,
    summary: {
      totalCommands: rows.length,
      appliedCommands: rows.filter((row) => row.state === 'applied').length,
      replayableCommands: rows.filter((row) => row.state === 'pending-replay').length,
      blockedCommands: rows.filter((row) => row.state === 'blocked').length,
      blockedReasons,
    },
    rows,
  };
}

function normalizeArtifactExportHistory(runtime = {}) {
  const source = runtime.artifactExportHistory
    || runtime.exportHistory
    || runtime.persistedArtifactLedger?.exportHistory
    || runtime.persistedArtifactState?.exportHistory
    || [];
  const rows = Array.isArray(source) ? source : Object.values(source);
  return rows.map((entry, index) => ({
    index,
    exportId: compactString(entry?.exportId || entry?.id || entry?.artifactHash || `artifact-export:${index + 1}`),
    state: compactString(entry?.state || entry?.status || 'observed').toLowerCase().replaceAll('-', '_'),
    artifactHash: compactString(entry?.artifactHash || entry?.hash),
    writeSetId: compactString(entry?.writeSetId || entry?.writeSet),
    ledgerKey: compactString(entry?.ledgerKey || entry?.commandLedgerKey),
    replayToken: compactString(entry?.replayToken || entry?.resumeToken),
    nextAction: compactString(entry?.nextAction || entry?.action),
    blockedReasons: stableList(entry?.blockedReasons || entry?.issues),
    ready: entry?.ready === true || entry?.state === 'ready' || entry?.status === 'ready',
    restartSafe: entry?.restartSafe === true,
    observedAt: compactString(entry?.observedAt || entry?.at || entry?.timestamp),
  })).filter((entry) => entry.exportId || entry.artifactHash || entry.ledgerKey);
}

function buildArtifactExportHistoryReport(
  writeSet,
  summary,
  gateHandoff,
  clientHandoff,
  persistedStateLedger,
  status,
  diagnostics,
  artifactHash,
  runtime = {},
) {
  const previous = normalizeArtifactExportHistory(runtime);
  const diagnosticStatus = statusFromDiagnostics(diagnostics);
  const writeSetId = compactString(summary.writeSetId || writeSet.writeSetId || writeSet.id);
  const blockedReasons = stableList([
    ...gateHandoff.blockedReasons,
    ...clientHandoff.blockedReasons,
    ...persistedStateLedger.summary.blockedReasons,
    ...diagnosticStatus.errors.map((diagnostic) => diagnostic.code),
  ]);
  const ready = status.ready
    && gateHandoff.ready
    && clientHandoff.ready
    && persistedStateLedger.ready
    && blockedReasons.length === 0;
  const current = {
    index: previous.length,
    exportId: `mailchimp:artifact-export:${artifactHash}`,
    state: ready
      ? 'ready'
      : status.state === 'waiting_for_acceptance'
        ? 'waiting_for_acceptance'
        : blockedReasons.length
          ? 'blocked'
          : 'pending',
    artifactHash,
    writeSetId,
    ledgerKey: persistedStateLedger.ledgerKey,
    replayToken: persistedStateLedger.replayToken || '',
    nextAction: ready
      ? 'artifact.export.ready'
      : clientHandoff.ready === false
        ? clientHandoff.nextAction
        : gateHandoff.ready === false
          ? gateHandoff.nextAction
          : persistedStateLedger.status === 'ledger-blocked'
            ? 'artifact.persisted-state.replay-or-repair'
            : status.nextAction,
    blockedReasons,
    ready,
    restartSafe: persistedStateLedger.restartSafe && clientHandoff.restartSafe,
    observedAt: '',
  };
  const timeline = [...previous, current].map((entry, index) => ({
    index,
    state: entry.state,
    artifactHash: entry.artifactHash,
    writeSetId: entry.writeSetId,
    ledgerKey: entry.ledgerKey,
    replayTokenPresent: Boolean(entry.replayToken),
    nextAction: entry.nextAction,
    blockedReasons: entry.blockedReasons,
    ready: entry.ready,
    restartSafe: entry.restartSafe,
    digest: `fnv1a32:${stableHash({
      index,
      state: entry.state,
      artifactHash: entry.artifactHash,
      writeSetId: entry.writeSetId,
      ledgerKey: entry.ledgerKey,
      blockedReasons: entry.blockedReasons,
      nextAction: entry.nextAction,
    })}`,
  }));
  const counters = {
    priorExports: previous.length,
    totalExports: timeline.length,
    readyExports: timeline.filter((entry) => entry.ready).length,
    blockedExports: timeline.filter((entry) => entry.state === 'blocked').length,
    waitingForAcceptanceExports: timeline.filter((entry) => entry.state === 'waiting_for_acceptance').length,
    restartSafeExports: timeline.filter((entry) => entry.restartSafe).length,
    diagnosticErrors: diagnosticStatus.errors.length,
    diagnosticWarnings: diagnosticStatus.warnings.length,
    blockedReasons: blockedReasons.length,
    ledgerCommands: persistedStateLedger.summary.totalCommands,
    ledgerBlockedCommands: persistedStateLedger.summary.blockedCommands,
  };
  const reportDigest = `fnv1a32:${stableHash({
    current,
    counters,
    timeline: timeline.map((entry) => entry.digest),
  })}`;

  return {
    protocol: 'aios.artifact-export-history.mailchimp.v1',
    reportDigest,
    current,
    counters,
    timeline,
    exportReadySummary: {
      ready,
      state: current.state,
      artifactHash,
      writeSetId,
      ledgerKey: persistedStateLedger.ledgerKey,
      replayToken: persistedStateLedger.replayToken,
      handoffKey: clientHandoff.handoffKey,
      nextAction: current.nextAction,
      blockedReasons,
      acceptance: {
        state: gateHandoff.acceptance.state,
        missingKeys: gateHandoff.acceptance.missingKeys,
        requiredKeys: gateHandoff.acceptance.requiredKeys,
      },
      clientHandoff: {
        ready: clientHandoff.ready,
        restartSafe: clientHandoff.restartSafe,
        canResume: clientHandoff.canResume,
        missingFields: clientHandoff.requestState.missingFields,
      },
      persistedState: {
        status: persistedStateLedger.status,
        restartSafe: persistedStateLedger.restartSafe,
        replayableCommands: persistedStateLedger.summary.replayableCommands,
        blockedCommands: persistedStateLedger.summary.blockedCommands,
      },
    },
  };
}

export function compileMailchimpArtifactBinding(input = {}, runtime = {}) {
  const normalized = normalizeArtifactBindingInput(input);
  const boundary = runtime.boundary || runtime.workspaceBoundary || input.boundary || null;
  const writeSet = planMailchimpArtifactWriteSet(boundary, {
    members: normalized.members,
    acceptedKeys: normalized.acceptedKeys,
    persistedArtifactState: normalized.persistedArtifactState,
  });
  const syscalls = buildMailchimpArtifactWriteSyscalls(boundary, writeSet);
  const recovery = recoverMailchimpArtifactWriteSet(writeSet, normalized.persistedArtifactState);
  const diagnostics = validateArtifactBinding(normalized, boundary, writeSet, syscalls);
  const status = buildArtifactStatus(writeSet, recovery, diagnostics);
  const summary = summarizeMailchimpArtifactWriteSet(writeSet);
  const manifest = createMailchimpSyscallManifest(boundary);
  const gateHandoff = buildArtifactGateHandoff(normalized, writeSet, syscalls, recovery, diagnostics);
  const clientHandoff = buildArtifactClientHandoff(normalized, runtime, boundary, writeSet, summary, gateHandoff, status);
  const persistedStateLedger = buildArtifactPersistedStateLedger(
    writeSet,
    summary,
    gateHandoff,
    clientHandoff,
    status,
    runtime,
  );
  const artifactHash = stableHash({ summary, status, recovery, gateHandoff, clientHandoff, persistedStateLedger });
  const exportHistory = buildArtifactExportHistoryReport(
    writeSet,
    summary,
    gateHandoff,
    clientHandoff,
    persistedStateLedger,
    status,
    diagnostics,
    artifactHash,
    runtime,
  );

  return {
    protocol: 'aios.artifact-binding-compile.mailchimp.v1',
    provider: 'mailchimp',
    boundaryId: boundary?.boundaryId ?? normalized.boundaryId ?? null,
    writeSet,
    summary,
    syscalls,
    syscallManifest: manifest,
    recovery,
    gateHandoff,
    clientHandoff,
    persistedStateLedger,
    status,
    exportContract: {
      protocol: 'aios.artifact-binding-export.mailchimp.v1',
      artifactHash,
      ready: status.ready && gateHandoff.ready && clientHandoff.ready && persistedStateLedger.ready,
      nextAction: persistedStateLedger.ready === false
        ? 'artifact.persisted-state.replay-or-repair'
        : gateHandoff.ready && clientHandoff.ready
        ? status.nextAction
        : clientHandoff.ready
          ? gateHandoff.nextAction
          : clientHandoff.nextAction,
      localOnly: true,
      externalWrites: false,
      exportHistory: {
        protocol: exportHistory.protocol,
        reportDigest: exportHistory.reportDigest,
        current: exportHistory.current,
        counters: exportHistory.counters,
        timeline: exportHistory.timeline,
      },
      exportReadySummary: exportHistory.exportReadySummary,
      persistedState: {
        key: persistedStateLedger.persistedStateKey,
        ledgerKey: persistedStateLedger.ledgerKey,
        status: persistedStateLedger.status,
        restartSafe: persistedStateLedger.restartSafe,
        replayToken: persistedStateLedger.replayToken,
        blockedReasons: persistedStateLedger.summary.blockedReasons,
      },
      commandLedger: {
        protocol: persistedStateLedger.protocol,
        ledgerKey: persistedStateLedger.ledgerKey,
        ready: persistedStateLedger.ready,
        status: persistedStateLedger.status,
        replayToken: persistedStateLedger.replayToken,
        summary: persistedStateLedger.summary,
        rows: persistedStateLedger.rows.map((row) => ({
          command: row.command,
          state: row.state,
          idempotencyKey: row.idempotencyKey,
          ledgerEntryKey: row.ledgerEntryKey,
          restartSafe: row.restartSafe,
          blocker: row.blocker,
        })),
      },
      clientHandoff: {
        protocol: clientHandoff.protocol,
        handoffKey: clientHandoff.handoffKey,
        ready: clientHandoff.ready,
        restartSafe: clientHandoff.restartSafe,
        canResume: clientHandoff.canResume,
        nextAction: clientHandoff.nextAction,
        requestState: clientHandoff.requestState,
        workflowHandoff: clientHandoff.workflowHandoff,
        scope: clientHandoff.scope,
        blockedReasons: clientHandoff.blockedReasons,
        commands: clientHandoff.commands.map((command) => ({
          command: command.command,
          state: command.state,
          idempotencyKey: command.idempotencyKey,
          restartSafe: command.restartSafe,
        })),
        auditEvent: clientHandoff.auditEvent,
      },
      gates: {
        protocol: gateHandoff.protocol,
        ready: gateHandoff.ready,
        state: gateHandoff.state,
        blockedReasons: gateHandoff.blockedReasons,
        nextAction: gateHandoff.nextAction,
        acceptance: {
          state: gateHandoff.acceptance.state,
          requiredKeys: gateHandoff.acceptance.requiredKeys,
          missingKeys: gateHandoff.acceptance.missingKeys,
        },
        syscall: {
          state: gateHandoff.syscall.state,
          blockedCommands: gateHandoff.syscall.blockedCommands,
        },
        recovery: {
          state: gateHandoff.recovery.state,
          restartSafe: gateHandoff.recovery.restartSafe,
        },
      },
      contracts: {
        writeSet: writeSet.kind,
        syscallManifest: manifest.kind,
        recovery: recovery.recoveryVersion,
        status: status.protocol,
        clientHandoff: clientHandoff.protocol,
        persistedStateLedger: persistedStateLedger.protocol,
        exportHistory: exportHistory.protocol,
      },
    },
    metadata: normalized.metadata,
    diagnostics,
  };
}

export function validateMailchimpArtifactBinding(input = {}, runtime = {}) {
  const binding = input?.protocol === 'aios.artifact-binding-compile.mailchimp.v1'
    ? input
    : compileMailchimpArtifactBinding(input, runtime);
  const errors = binding.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
  return {
    protocol: 'aios.artifact-binding-validation.mailchimp.v1',
    ok: errors.length === 0,
    ready: binding.exportContract.ready,
    nextAction: binding.exportContract.nextAction,
    diagnostics: binding.diagnostics,
    artifactHash: binding.exportContract.artifactHash,
    exportReadySummary: binding.exportContract.exportReadySummary,
    exportHistory: binding.exportContract.exportHistory,
    gateHandoff: binding.gateHandoff,
    clientHandoff: binding.clientHandoff,
    persistedStateLedger: binding.persistedStateLedger,
  };
}

export function buildMailchimpArtifactBindingSelfCheck(input = {}, runtime = {}) {
  const first = compileMailchimpArtifactBinding(input, runtime);
  const second = compileMailchimpArtifactBinding(input, runtime);
  return {
    protocol: 'aios.artifact-binding-self-check.mailchimp.v1',
    deterministic: first.exportContract.artifactHash === second.exportContract.artifactHash,
    artifactHash: first.exportContract.artifactHash,
    ready: first.exportContract.ready,
    nextAction: first.exportContract.nextAction,
    gateReady: first.gateHandoff.ready,
    gateState: first.gateHandoff.state,
    clientHandoffReady: first.clientHandoff.ready,
    clientHandoffRestartSafe: first.clientHandoff.restartSafe,
    clientHandoffKey: first.clientHandoff.handoffKey,
    persistedStateKey: first.persistedStateLedger.persistedStateKey,
    commandLedgerKey: first.persistedStateLedger.ledgerKey,
    commandLedgerStatus: first.persistedStateLedger.status,
    commandLedgerReplayToken: first.persistedStateLedger.replayToken,
    exportHistoryDigest: first.exportContract.exportHistory.reportDigest,
    exportReadyState: first.exportContract.exportReadySummary.state,
    exportTimelineLength: first.exportContract.exportHistory.timeline.length,
    diagnostics: first.diagnostics,
  };
}

export {
  buildArtifactGateHandoff,
  buildArtifactClientHandoff,
  buildArtifactPersistedStateLedger,
  buildArtifactExportHistoryReport,
  normalizeArtifactBindingInput,
  parseArtifactBindingSource,
};
