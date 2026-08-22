export const surfaceId = "aios_kernel-lifecycle_exit-contract_008";
export const surfaceGroup = "kernel-lifecycle";
export const surfaceName = "exit-contract";

const EXIT_STATES = new Set(['preview', 'accepted', 'ready', 'blocked', 'done', 'killed', 'quarantined', 'claim-submitted']);
const PROCESS_EXIT_OUTCOMES = new Set(['done', 'blocked', 'killed', 'quarantined', 'claim-submitted']);
const PROCESS_EXIT_SCHEMA_VERSION = 2;
const TERMINAL_PROCESS_EXIT_OUTCOMES = new Set(['done', 'blocked', 'killed', 'quarantined', 'claim-submitted']);
const PROCESS_EXIT_ALIASES = {
  accepted: 'done',
  complete: 'done',
  completed: 'done',
  failed: 'blocked',
  cancelled: 'killed',
  canceled: 'killed',
  terminated: 'killed',
  quarantine: 'quarantined',
  submitted: 'claim-submitted',
  claim: 'claim-submitted'
};
const REQUIRED_ACCEPTANCE_SIGNALS = [
  'hostedKernelBooted',
  'routeMounted',
  'previewRendered',
  'proofCaptured'
];
const DEFAULT_ROUTE_MOUNT = '/kernel/lifecycle/exit-contract';
const EVENT_NAMESPACE = 'kernel.lifecycle.exit';
const PERSISTED_STATE_VERSION = 2;
const PROVIDER_SERVICE_SCHEMA_VERSION = 1;
const PROVIDER_EVENT_STREAM_SCHEMA_VERSION = 1;
const AUDIT_PROOF_SCHEMA_VERSION = 1;
const CLIENT_RUNTIME_STATE_SCHEMA_VERSION = 1;
const TENANT_BOUNDARY_SCHEMA_VERSION = 2;
const ANALYTICS_EXPORT_SCHEMA_VERSION = 2;
const ROUTE_PREVIEW_DECISION_SCHEMA_VERSION = 1;
const HEALTH_COMPONENTS = [
  'hosted-kernel',
  'route-mount',
  'preview-renderer',
  'proof-sink',
  'persistence',
  'session-binding',
  'command-bus',
  'handoff-gateway'
];
const RETRY_BACKOFF_MS = [1000, 2500, 5000, 10000, 20000, 30000];
const FAILURE_STATE_SCHEMA_VERSION = 1;
const DEGRADED_COMPONENT_CAPABILITIES = {
  'hosted-kernel': ['audit-readonly'],
  'route-mount': ['proof-review', 'state-review'],
  'preview-renderer': ['text-summary', 'proof-review'],
  'proof-sink': ['preview-readonly', 'local-proof-buffer'],
  persistence: ['preview-readonly', 'command-dry-run'],
  'session-binding': ['preview-readonly', 'new-session-handoff'],
  'command-bus': ['state-review', 'manual-remediation'],
  'handoff-gateway': ['preview-readonly', 'accept-without-handoff']
};
const CLIENT_RUNTIME_FIELDS = [
  'requestId',
  'sessionId',
  'route',
  'handoffTarget',
  'resumeToken'
];
const CLIENT_HANDOFF_CHANNELS = new Set(['same-tab', 'new-tab', 'embedded-panel', 'external-app']);
const LIFECYCLE_CONTROL_KEYS = ['preview', 'proof', 'accept', 'handoff'];
const CONTROL_COMMANDS = {
  preview: 'kernel.lifecycle.exit.preview',
  proof: 'kernel.lifecycle.exit.proof',
  accept: 'kernel.lifecycle.exit.accept',
  handoff: 'kernel.lifecycle.exit.handoff.open'
};
const TERMINAL_COMMAND_RESULTS = new Set(['completed', 'skipped', 'deduped']);
const FAILED_COMMAND_RESULTS = new Set(['failed', 'error', 'timeout', 'rejected']);
const PERSISTED_STATE_FIELDS = [
  'version',
  'tenantId',
  'workspaceId',
  'requestId',
  'state',
  'acceptedAt',
  'lastKnownRoute',
  'resumeToken',
  'proofCount',
  'commandLedger'
];
const TENANT_PERMISSION_REQUIREMENTS = {
  preview: 'kernel.lifecycle.exit.preview',
  proof: 'kernel.lifecycle.exit.proof.write',
  accept: 'kernel.lifecycle.exit.accept',
  handoff: 'kernel.lifecycle.exit.handoff'
};
const CONTROL_SCOPE_REQUIREMENTS = {
  preview: {
    access: 'workspace-read',
    writes: ['routeState.preview'],
    requiresCleanSnapshot: false
  },
  proof: {
    access: 'audit-write',
    writes: ['proof.items', 'persistedState.proofCount', 'commandLedger.proof'],
    requiresCleanSnapshot: true
  },
  accept: {
    access: 'state-write',
    writes: ['persistedState.state', 'persistedState.acceptedAt', 'commandLedger.accept'],
    requiresCleanSnapshot: true
  },
  handoff: {
    access: 'handoff-export',
    writes: ['workflowHandoff.externalState', 'commandLedger.handoff'],
    requiresCleanSnapshot: true
  }
};
const PROCESS_EXIT_PERMISSION_REQUIREMENTS = {
  done: {
    controls: ['accept'],
    access: 'state-write',
    writes: ['persistedState.state', 'persistedState.acceptedAt', 'commandLedger.processExit'],
    requiresCleanSnapshot: true,
    requiresAuditHandoff: false
  },
  blocked: {
    controls: ['preview', 'accept'],
    access: 'state-write',
    writes: ['persistedState.state', 'commandLedger.processExit', 'analytics.exitOutcome'],
    requiresCleanSnapshot: true,
    requiresAuditHandoff: false
  },
  killed: {
    controls: ['proof', 'accept'],
    access: 'terminal-state-write',
    writes: ['persistedState.state', 'commandLedger.processExit', 'failureState.deadLetter'],
    requiresCleanSnapshot: true,
    requiresAuditHandoff: true
  },
  quarantined: {
    controls: ['proof', 'accept'],
    access: 'tenant-isolation-write',
    writes: ['persistedState.state', 'commandLedger.processExit', 'tenantBoundary.isolationActions'],
    requiresCleanSnapshot: false,
    requiresAuditHandoff: true
  },
  'claim-submitted': {
    controls: ['proof', 'accept'],
    access: 'audit-claim-write',
    writes: ['proof.items', 'commandLedger.processExit', 'analytics.exitOutcome'],
    requiresCleanSnapshot: true,
    requiresAuditHandoff: true
  }
};
const PROCESS_EXIT_OPERATIONAL_POLICIES = {
  done: {
    healthComponents: ['hosted-kernel', 'route-mount', 'preview-renderer', 'proof-sink', 'persistence', 'command-bus', 'handoff-gateway'],
    retryableChecks: ['accepted', 'proof-ready', 'state-writable', 'handoff-safe'],
    terminalCheckIds: ['no-quarantine', 'no-kill-signal'],
    degradedComponents: ['proof-sink', 'handoff-gateway'],
    proofRequired: true,
    failureState: 'accepted-exit-write'
  },
  blocked: {
    healthComponents: ['hosted-kernel', 'route-mount', 'preview-renderer', 'command-bus'],
    retryableChecks: ['has-blocker', 'operator-action'],
    terminalCheckIds: ['not-terminal-fatal'],
    degradedComponents: ['preview-renderer', 'command-bus'],
    proofRequired: false,
    failureState: 'blocked-exit-observed'
  },
  killed: {
    healthComponents: ['hosted-kernel', 'command-bus', 'proof-sink'],
    retryableChecks: ['dead-letter', 'kill-actor'],
    terminalCheckIds: ['kill-signal', 'no-accept-after-kill'],
    degradedComponents: ['proof-sink', 'command-bus'],
    proofRequired: true,
    failureState: 'killed-exit-dead-letter'
  },
  quarantined: {
    healthComponents: ['hosted-kernel', 'route-mount', 'command-bus', 'persistence', 'proof-sink'],
    retryableChecks: ['release-trackable', 'cross-scope-events-accounted'],
    terminalCheckIds: ['quarantine-signal', 'write-isolated'],
    degradedComponents: ['proof-sink', 'persistence', 'command-bus'],
    proofRequired: true,
    failureState: 'quarantined-exit-isolation'
  },
  'claim-submitted': {
    healthComponents: ['hosted-kernel', 'proof-sink', 'command-bus'],
    retryableChecks: ['claim-id', 'claim-submitter', 'claim-time', 'claim-proof'],
    terminalCheckIds: ['claim-scope'],
    degradedComponents: ['proof-sink'],
    proofRequired: true,
    failureState: 'claim-submitted-exit-audit'
  }
};
const PROCESS_EXIT_HANDOFF_STRATEGIES = {
  done: {
    mode: 'resume-completed-workflow',
    label: 'Resume completed workflow',
    channel: 'same-tab',
    userVisibleStatus: 'completion-ready',
    clientPatchStrategy: 'persist-final-route-and-resume-token',
    requiresResume: true,
    requiresExternalHandoff: false
  },
  blocked: {
    mode: 'review-blocked-workflow',
    label: 'Review blocked workflow',
    channel: 'embedded-panel',
    userVisibleStatus: 'repair-needed',
    clientPatchStrategy: 'keep-preview-open-with-repair-queue',
    requiresResume: false,
    requiresExternalHandoff: false
  },
  killed: {
    mode: 'handoff-terminal-audit',
    label: 'Open terminal audit handoff',
    channel: 'external-app',
    userVisibleStatus: 'terminal-audit-required',
    clientPatchStrategy: 'freeze-route-and-export-dead-letter',
    requiresResume: false,
    requiresExternalHandoff: true
  },
  quarantined: {
    mode: 'handoff-isolated-review',
    label: 'Open isolated review handoff',
    channel: 'external-app',
    userVisibleStatus: 'isolation-review-required',
    clientPatchStrategy: 'fork-client-state-before-handoff',
    requiresResume: false,
    requiresExternalHandoff: true
  },
  'claim-submitted': {
    mode: 'handoff-claim-review',
    label: 'Open claim review handoff',
    channel: 'new-tab',
    userVisibleStatus: 'claim-review-submitted',
    clientPatchStrategy: 'bind-claim-to-request-runtime',
    requiresResume: false,
    requiresExternalHandoff: true
  }
};
const PROCESS_EXIT_PROVIDER_POLICIES = {
  done: {
    providers: ['hosted-kernel', 'proof-sink', 'persistence', 'command-bus', 'handoff-gateway'],
    capabilities: {
      'hosted-kernel': ['boot-proof', 'route-events'],
      'proof-sink': ['append-proof', 'read-proof-count'],
      persistence: ['write-state', 'idempotent-ledger'],
      'command-bus': ['dispatch-once', 'idempotency-key'],
      'handoff-gateway': ['resume-token']
    },
    publications: {
      'hosted-kernel': ['boot-proof', 'route-mounted', 'preview-rendered'],
      'proof-sink': ['proof-appended'],
      persistence: ['state-written'],
      'command-bus': ['command-completed'],
      'handoff-gateway': ['target-health']
    },
    handoffState: ['opened', 'ready', 'target-healthy'],
    externalHandoffRequired: false
  },
  blocked: {
    providers: ['hosted-kernel', 'persistence', 'command-bus'],
    capabilities: {
      'hosted-kernel': ['route-events'],
      persistence: ['read-state', 'idempotent-ledger'],
      'command-bus': ['dispatch-once']
    },
    publications: {
      'hosted-kernel': ['route-mounted'],
      persistence: ['ledger-written'],
      'command-bus': ['command-rejected']
    },
    handoffState: [],
    externalHandoffRequired: false
  },
  killed: {
    providers: ['proof-sink', 'persistence', 'command-bus'],
    capabilities: {
      'proof-sink': ['append-proof'],
      persistence: ['write-state', 'idempotent-ledger'],
      'command-bus': ['dispatch-once', 'dead-letter']
    },
    publications: {
      'proof-sink': ['proof-appended'],
      persistence: ['ledger-written'],
      'command-bus': ['command-completed']
    },
    handoffState: [],
    externalHandoffRequired: true
  },
  quarantined: {
    providers: ['proof-sink', 'persistence', 'command-bus'],
    capabilities: {
      'proof-sink': ['append-proof'],
      persistence: ['write-state', 'idempotent-ledger'],
      'command-bus': ['dispatch-once']
    },
    publications: {
      'proof-sink': ['proof-appended'],
      persistence: ['state-written', 'ledger-written'],
      'command-bus': ['command-completed']
    },
    handoffState: [],
    externalHandoffRequired: true
  },
  'claim-submitted': {
    providers: ['proof-sink', 'command-bus'],
    capabilities: {
      'proof-sink': ['append-proof', 'read-proof-count'],
      'command-bus': ['dispatch-once', 'idempotency-key']
    },
    publications: {
      'proof-sink': ['proof-appended', 'proof-count'],
      'command-bus': ['command-dispatched']
    },
    handoffState: [],
    externalHandoffRequired: true
  }
};
const TENANT_PRIVILEGED_ROLES = new Set(['owner', 'admin', 'kernel-operator', 'lifecycle-operator']);
const TENANT_READONLY_ROLES = new Set(['viewer', 'auditor', 'readonly']);
const PROVIDER_CONTRACTS = {
  'hosted-kernel': {
    requiredCapabilities: ['boot-proof', 'route-events', 'preview-frame'],
    optionalCapabilities: ['degraded-preview', 'restart-replay'],
    defaultEndpoint: 'kernel://hosted/lifecycle',
    syncDomain: 'hosted-kernel-runtime',
    consumes: ['preview', 'accept'],
    publishes: ['boot-proof', 'route-mounted', 'preview-rendered'],
    writes: ['runtime.bootProof', 'runtime.routeMount', 'runtime.previewFrame'],
    requiredBeforeAccept: ['boot-proof', 'route-events']
  },
  'proof-sink': {
    requiredCapabilities: ['append-proof', 'read-proof-count'],
    optionalCapabilities: ['artifact-link', 'proof-redaction'],
    defaultEndpoint: 'kernel://audit/proof-sink',
    syncDomain: 'audit-proof-ledger',
    consumes: ['proof'],
    publishes: ['proof-appended', 'proof-count'],
    writes: ['proof.items', 'persistedState.proofCount', 'commandLedger.proof'],
    requiredBeforeAccept: ['append-proof', 'read-proof-count']
  },
  persistence: {
    requiredCapabilities: ['read-state', 'write-state', 'idempotent-ledger'],
    optionalCapabilities: ['state-migration', 'cursor-sync'],
    defaultEndpoint: 'kernel://state/exit-contract',
    syncDomain: 'exit-contract-state',
    consumes: ['preview', 'proof', 'accept', 'handoff'],
    publishes: ['state-written', 'ledger-written', 'sync-cursor'],
    writes: ['persistedState.writeModel', 'commandLedger', 'routeState.patch'],
    requiredBeforeAccept: ['write-state', 'idempotent-ledger']
  },
  'command-bus': {
    requiredCapabilities: ['dispatch-once', 'idempotency-key'],
    optionalCapabilities: ['retry-after', 'dead-letter'],
    defaultEndpoint: 'kernel://commands/lifecycle',
    syncDomain: 'lifecycle-command-bus',
    consumes: ['control-selection'],
    publishes: ['command-dispatched', 'command-completed', 'command-rejected'],
    writes: ['commandLedger.*.result', 'commandLedger.*.completedAt'],
    requiredBeforeAccept: ['dispatch-once', 'idempotency-key']
  },
  'handoff-gateway': {
    requiredCapabilities: ['open-external-target', 'resume-token'],
    optionalCapabilities: ['handoff-expiry', 'target-health'],
    defaultEndpoint: 'kernel://handoff/gateway',
    syncDomain: 'external-handoff',
    consumes: ['handoff'],
    publishes: ['handoff-opened', 'handoff-expired', 'target-health'],
    writes: ['workflowHandoff.externalState', 'commandLedger.handoff'],
    requiredBeforeAccept: ['resume-token']
  }
};
const REQUIRED_PROVIDER_KEYS = Object.keys(PROVIDER_CONTRACTS);

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asBoolean(value) {
  return value === true || value === 'true' || value === 1;
}

function normalizeString(value, fallback = null) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function normalizeSignals(value = {}) {
  const source = asRecord(value);
  return REQUIRED_ACCEPTANCE_SIGNALS.reduce((signals, key) => {
    signals[key] = asBoolean(source[key]);
    return signals;
  }, {});
}

function normalizeEvidence(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry, index) => {
      const record = asRecord(entry);
      return {
        id: String(record.id || record.key || `evidence-${index + 1}`),
        kind: String(record.kind || record.type || 'runtime-proof'),
        label: String(record.label || record.summary || 'Runtime proof'),
        href: typeof record.href === 'string' ? record.href : null,
        capturedAt: typeof record.capturedAt === 'string' ? record.capturedAt : null
      };
    });
}

function stableSerialize(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableSerialize(entry)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function deriveFingerprint(value) {
  const serialized = stableSerialize(value);
  let hash = 2166136261;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function normalizeProofItem(record, runtime, now, index, tenantBoundary) {
  const capturedAt = normalizeString(record.capturedAt, now);
  const proofId = normalizeString(record.id, `proof-${index + 1}`);
  const href = normalizeString(record.href, null);
  const source = normalizeString(record.source || record.provider, href ? 'artifact-link' : 'inline-evidence');
  const subject = {
    tenantId: tenantBoundary.tenantId,
    workspaceId: tenantBoundary.workspaceId,
    principalId: tenantBoundary.principalId,
    requestId: runtime.requestId,
    sessionId: runtime.sessionId,
    route: runtime.route,
    scopeKey: tenantBoundary.scopeKey
  };
  const fingerprint = deriveFingerprint({
    id: proofId,
    kind: record.kind,
    label: record.label,
    href,
    capturedAt,
    subject
  });

  return {
    id: proofId,
    kind: record.kind,
    label: record.label,
    href,
    capturedAt,
    source,
    subject,
    fingerprint,
    ledgerKey: `${EVENT_NAMESPACE}:proof:${runtime.requestId}:${proofId}`,
    appendCommand: CONTROL_COMMANDS.proof,
    idempotencyKey: `${EVENT_NAMESPACE}:proof:${runtime.requestId}:${fingerprint}`,
    valid: Boolean(proofId && capturedAt && (href || record.label)),
    redaction: {
      allowed: true,
      policy: 'preserve-fingerprint-and-subject'
    }
  };
}

function buildAuditProofContract({ evidence, signals, runtime, persistedState, providerContracts, tenantBoundary, now }) {
  const items = evidence.map((record, index) => normalizeProofItem(record, runtime, now, index, tenantBoundary));
  const validItems = items.filter((item) => item.valid);
  const hasSignal = signals.proofCaptured || validItems.length > 0 || persistedState.proofCount > 0;
  const persistedAhead = persistedState.proofCount > validItems.length;
  const persistedBehind = persistedState.proofCount < validItems.length;
  const writeReady = providerContracts.auditProofWritable && providerContracts.syncReady;
  const gaps = [
    ...(hasSignal ? [] : ['No audit proof signal or proof evidence is attached.']),
    ...(writeReady ? [] : ['Proof sink provider is not ready for append-proof writes.']),
    ...(persistedAhead ? ['Persisted proof count is ahead of attached evidence; proof ledger should be re-read.'] : []),
    ...(persistedBehind ? ['Attached evidence has not been fully reflected in persisted proof count.'] : [])
  ];
  const bundleFingerprint = deriveFingerprint({
    requestId: runtime.requestId,
    route: runtime.route,
    proofIds: validItems.map((item) => item.id),
    fingerprints: validItems.map((item) => item.fingerprint),
    persistedProofCount: persistedState.proofCount
  });

  return {
    schema: `aios.kernel.lifecycle.exit.audit-proof.v${AUDIT_PROOF_SCHEMA_VERSION}`,
    generatedAt: now,
    requestId: runtime.requestId,
    sessionId: runtime.sessionId,
    tenantBoundary: tenantBoundary.auditSubject,
    requiredBeforeAccept: true,
    signalSatisfied: hasSignal,
    writeReady,
    ready: hasSignal && writeReady && !persistedAhead,
    proofCount: validItems.length,
    persistedProofCount: persistedState.proofCount,
    reconciliation: {
      status: persistedAhead ? 'ledger-ahead' : persistedBehind ? 'ledger-behind' : 'in-sync',
      persistedAhead,
      persistedBehind,
      repairCommand: persistedAhead || persistedBehind ? `${EVENT_NAMESPACE}.proof.reconcile` : null
    },
    bundleFingerprint,
    items,
    gaps,
    appendEnvelope: {
      provider: 'proof-sink',
      command: CONTROL_COMMANDS.proof,
      ledgerKey: `${EVENT_NAMESPACE}:proof-ledger:${runtime.requestId}`,
      idempotencyKey: `${EVENT_NAMESPACE}:proof-bundle:${tenantBoundary.scopeKey}:${runtime.requestId}:${bundleFingerprint}`,
      expectedWrites: ['proof.items', 'persistedState.proofCount', 'commandLedger.proof'],
      items: validItems.map((item) => ({
        id: item.id,
        fingerprint: item.fingerprint,
        ledgerKey: item.ledgerKey,
        idempotencyKey: item.idempotencyKey
      }))
    }
  };
}

function normalizeCommandLedger(value) {
  const source = asRecord(value);
  return Object.entries(source).reduce((ledger, [command, record]) => {
    const entry = asRecord(record);
    const completedAt = normalizeString(entry.completedAt || entry.at, null);
    const result = normalizeString(entry.result || entry.status, completedAt ? 'completed' : 'unknown');
    ledger[command] = {
      command,
      result,
      completedAt,
      idempotencyKey: normalizeString(entry.idempotencyKey, `${EVENT_NAMESPACE}:${command}`),
      attempt: Number.isInteger(entry.attempt) && entry.attempt > 0 ? entry.attempt : 1,
      replayable: entry.replayable !== false && !TERMINAL_COMMAND_RESULTS.has(result),
      failed: FAILED_COMMAND_RESULTS.has(result)
    };
    return ledger;
  }, {});
}

function normalizeStringList(value) {
  const entries = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  return [...new Set(entries
    .map((entry) => normalizeString(entry, null))
    .filter(Boolean))];
}

function normalizeProviderStatus(value) {
  const status = normalizeString(value, 'unknown');
  return ['ready', 'degraded', 'offline', 'unauthorized', 'unknown'].includes(status) ? status : 'unknown';
}

function normalizeProviderRecord(key, value, runtime, now) {
  const contract = PROVIDER_CONTRACTS[key];
  const source = asRecord(value);
  const capabilities = normalizeStringList(source.capabilities || source.supports || source.negotiatedCapabilities);
  const requiredCapabilities = normalizeStringList(source.requiredCapabilities).length > 0
    ? normalizeStringList(source.requiredCapabilities)
    : contract.requiredCapabilities;
  const missingCapabilities = requiredCapabilities.filter((capability) => !capabilities.includes(capability));
  const status = normalizeProviderStatus(source.status || source.health);
  const lastSyncedAt = normalizeString(source.lastSyncedAt || source.syncedAt || source.cursorAt, null);
  const lastSyncedMs = Number.isFinite(Date.parse(lastSyncedAt)) ? Date.parse(lastSyncedAt) : null;
  const nowMs = Number.isFinite(Date.parse(now)) ? Date.parse(now) : Date.now();
  const syncLagMs = lastSyncedMs ? Math.max(0, nowMs - lastSyncedMs) : null;
  const maxSyncLagMs = Number.isFinite(source.maxSyncLagMs) && source.maxSyncLagMs >= 0
    ? Math.floor(source.maxSyncLagMs)
    : 120000;
  const syncFresh = syncLagMs !== null && syncLagMs <= maxSyncLagMs;
  const endpoint = normalizeString(source.endpoint || source.url, contract.defaultEndpoint);
  const handoffState = asRecord(source.handoffState || source.externalHandoff);

  return {
    key,
    status,
    endpoint,
    version: normalizeString(source.version || source.contractVersion, 'v1'),
    requiredCapabilities,
    optionalCapabilities: contract.optionalCapabilities,
    capabilities,
    missingCapabilities,
    negotiated: status !== 'offline' && status !== 'unauthorized' && missingCapabilities.length === 0,
    sync: {
      cursor: normalizeString(source.cursor || source.syncCursor, null),
      lastSyncedAt,
      lagMs: syncLagMs,
      maxLagMs: maxSyncLagMs,
      fresh: syncFresh,
      required: source.syncRequired !== false
    },
    externalHandoff: {
      target: normalizeString(handoffState.target || source.handoffTarget, runtime.handoffTarget),
      state: normalizeString(handoffState.state || source.handoffStatus, 'not-opened'),
      resumeTokenRef: normalizeString(handoffState.resumeTokenRef || source.resumeTokenRef, runtime.resumeToken ? 'clientRuntime.resumeToken' : null),
      expiresAt: normalizeString(handoffState.expiresAt || source.handoffExpiresAt, null)
    }
  };
}

function buildProviderServiceContract(provider, runtime, tenantBoundary, now) {
  const contract = PROVIDER_CONTRACTS[provider.key];
  const blockingReasons = [
    ...(provider.status === 'offline' || provider.status === 'unauthorized'
      ? [`${provider.key} provider is ${provider.status}.`]
      : []),
    ...provider.missingCapabilities.map((capability) => `${provider.key} missing capability ${capability}.`),
    ...(provider.sync.required && !provider.sync.fresh
      ? [`${provider.key} sync cursor is missing or older than ${provider.sync.maxLagMs}ms.`]
      : [])
  ];
  const checkpointKey = `${EVENT_NAMESPACE}:provider:${provider.key}:${runtime.requestId}`;
  const commands = contract.consumes.map((control) => ({
    control,
    command: CONTROL_COMMANDS[control] || `${EVENT_NAMESPACE}.${control}`,
    idempotencyKey: `${checkpointKey}:${control}`
  }));

  return {
    schema: `aios.kernel.lifecycle.exit.provider.${provider.key}.v${PROVIDER_SERVICE_SCHEMA_VERSION}`,
    generatedAt: now,
    provider: provider.key,
    tenantBoundary: tenantBoundary.auditSubject,
    endpoint: provider.endpoint,
    status: provider.status,
    contractVersion: provider.version,
    negotiation: {
      accepted: provider.negotiated,
      mode: provider.negotiated ? 'accepted' : 'repair-required',
      requiredCapabilities: provider.requiredCapabilities,
      optionalCapabilities: provider.optionalCapabilities,
      suppliedCapabilities: provider.capabilities,
      missingCapabilities: provider.missingCapabilities,
      blockingReasons
    },
    sync: {
      domain: contract.syncDomain,
      checkpointKey,
      cursor: provider.sync.cursor,
      lastSyncedAt: provider.sync.lastSyncedAt,
      lagMs: provider.sync.lagMs,
      maxLagMs: provider.sync.maxLagMs,
      fresh: provider.sync.fresh,
      required: provider.sync.required,
      refreshCommand: `${EVENT_NAMESPACE}.provider.sync`
    },
    obligations: {
      consumes: contract.consumes,
      publishes: contract.publishes,
      writes: contract.writes,
      requiredBeforeAccept: contract.requiredBeforeAccept,
      commands
    },
    externalHandoff: provider.key === 'handoff-gateway'
      ? {
        state: provider.externalHandoff.state,
        target: provider.externalHandoff.target,
        resumeTokenRef: provider.externalHandoff.resumeTokenRef,
        expiresAt: provider.externalHandoff.expiresAt,
        exportKey: `${EVENT_NAMESPACE}:handoff:${tenantBoundary.scopeKey}:${runtime.requestId}:${provider.externalHandoff.target || runtime.handoffTarget}`,
        requiredScope: tenantBoundary.handoffScope
      }
      : null
  };
}

function normalizeProviderEventRecords(input, providers, runtime, tenantBoundary, now) {
  const rawSource = input.providerEvents || input.integrationEvents || asRecord(input.events).providers;
  const entries = Array.isArray(rawSource) ? rawSource : Object.values(asRecord(rawSource));
  const providerByKey = providers.reduce((acc, provider) => {
    acc[provider.key] = provider;
    return acc;
  }, {});
  const nowMs = Number.isFinite(Date.parse(now)) ? Date.parse(now) : Date.now();

  return entries
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry, index) => {
      const record = asRecord(entry);
      const provider = normalizeString(record.provider || record.service || record.source, 'hosted-kernel');
      const contract = PROVIDER_CONTRACTS[provider];
      const providerState = providerByKey[provider];
      const eventType = normalizeString(record.type || record.event || record.topic, 'provider-event');
      const observedAt = normalizeString(record.observedAt || record.publishedAt || record.at, now);
      const observedMs = Number.isFinite(Date.parse(observedAt)) ? Date.parse(observedAt) : null;
      const eventLagMs = observedMs === null ? null : Math.max(0, nowMs - observedMs);
      const maxLagMs = providerState?.sync?.maxLagMs ?? 120000;
      const eventRequestId = normalizeString(record.requestId || record.correlationId, runtime.requestId);
      const eventScopeKey = normalizeString(record.scopeKey || record.tenantScope, tenantBoundary.scopeKey);
      const eventId = normalizeString(record.id || record.eventId, `${provider}:${eventType}:${index + 1}`);
      const payloadRef = normalizeString(record.payloadRef || record.artifactRef || record.href, null);
      const cursor = normalizeString(record.cursor || record.syncCursor, providerState?.sync?.cursor || null);
      const allowedPublication = Boolean(contract?.publishes?.includes(eventType));
      const inScope = eventRequestId === runtime.requestId && eventScopeKey === tenantBoundary.scopeKey;
      const fresh = eventLagMs !== null && eventLagMs <= maxLagMs;
      const fingerprint = deriveFingerprint({
        provider,
        eventType,
        eventId,
        observedAt,
        eventRequestId,
        eventScopeKey,
        cursor,
        payloadRef
      });

      return {
        id: eventId,
        provider,
        eventType,
        observedAt,
        cursor,
        payloadRef,
        fingerprint,
        requestId: eventRequestId,
        scopeKey: eventScopeKey,
        knownProvider: Boolean(contract),
        allowedPublication,
        inScope,
        fresh,
        lagMs: eventLagMs,
        maxLagMs,
        externalState: asRecord(record.externalState || record.handoffState),
        proofRef: normalizeString(record.proofRef || record.ledgerKey || payloadRef, null),
        status: !contract
          ? 'unknown-provider'
          : !allowedPublication
            ? 'unexpected-publication'
            : !inScope
              ? 'cross-scope'
              : !fresh
                ? 'stale'
                : 'accepted'
      };
    });
}

function buildProviderEventStreamContract({ input, providers, serviceContracts, runtime, tenantBoundary, now }) {
  const events = normalizeProviderEventRecords(input, providers, runtime, tenantBoundary, now);
  const acceptedEvents = events.filter((event) => event.status === 'accepted');
  const rejectedEvents = events.filter((event) => event.status !== 'accepted');
  const providerEventIndex = REQUIRED_PROVIDER_KEYS.reduce((acc, key) => {
    const providerEvents = events.filter((event) => event.provider === key);
    const acceptedProviderEvents = providerEvents.filter((event) => event.status === 'accepted');
    const contract = PROVIDER_CONTRACTS[key];
    acc[key] = {
      provider: key,
      expectedPublications: contract.publishes,
      observedPublications: [...new Set(providerEvents.map((event) => event.eventType))].sort(),
      acceptedCount: acceptedProviderEvents.length,
      rejectedCount: providerEvents.length - acceptedProviderEvents.length,
      latestCursor: acceptedProviderEvents.find((event) => event.cursor)?.cursor || null,
      latestObservedAt: acceptedProviderEvents
        .map((event) => event.observedAt)
        .filter(Boolean)
        .sort()
        .at(-1) || null,
      missingPublications: contract.publishes.filter((publication) => (
        serviceContracts.find((service) => service.provider === key)?.negotiation.accepted
          && !acceptedProviderEvents.some((event) => event.eventType === publication)
      ))
    };
    return acc;
  }, {});
  const proofSignals = acceptedEvents
    .filter((event) => event.provider === 'proof-sink' && ['proof-appended', 'proof-count'].includes(event.eventType))
    .map((event) => ({
      eventId: event.id,
      proofRef: event.proofRef,
      cursor: event.cursor,
      fingerprint: event.fingerprint
    }));
  const handoffSignals = acceptedEvents
    .filter((event) => event.provider === 'handoff-gateway')
    .map((event) => ({
      eventId: event.id,
      eventType: event.eventType,
      state: normalizeString(event.externalState.state || event.eventType.replace('handoff-', ''), 'not-opened'),
      target: normalizeString(event.externalState.target, runtime.handoffTarget),
      resumeTokenRef: normalizeString(event.externalState.resumeTokenRef, runtime.hasResumeToken ? 'clientRuntime.resumeToken' : null),
      expiresAt: normalizeString(event.externalState.expiresAt, null),
      cursor: event.cursor,
      fingerprint: event.fingerprint
    }));
  const latestHandoffSignal = handoffSignals.at(-1) || null;
  const refreshActions = Object.values(providerEventIndex)
    .filter((entry) => entry.missingPublications.length > 0 || rejectedEvents.some((event) => event.provider === entry.provider && event.status === 'stale'))
    .map((entry) => ({
      provider: entry.provider,
      command: `${EVENT_NAMESPACE}.provider.events.sync`,
      idempotencyKey: `${EVENT_NAMESPACE}:provider-events:${tenantBoundary.scopeKey}:${runtime.requestId}:${entry.provider}`,
      cursor: entry.latestCursor,
      missingPublications: entry.missingPublications
    }));

  return {
    schema: `aios.kernel.lifecycle.exit.provider-events.v${PROVIDER_EVENT_STREAM_SCHEMA_VERSION}`,
    generatedAt: now,
    streamKey: `${EVENT_NAMESPACE}:provider-events:${tenantBoundary.scopeKey}:${runtime.requestId}`,
    requestId: runtime.requestId,
    tenantBoundary: tenantBoundary.auditSubject,
    ready: rejectedEvents.length === 0 && refreshActions.length === 0,
    acceptedCount: acceptedEvents.length,
    rejectedCount: rejectedEvents.length,
    providers: providerEventIndex,
    events,
    rejectedEvents: rejectedEvents.map((event) => ({
      id: event.id,
      provider: event.provider,
      eventType: event.eventType,
      status: event.status,
      requestId: event.requestId,
      scopeKey: event.scopeKey
    })),
    proofSignals,
    handoffSignals,
    latestHandoffSignal,
    refreshActions
  };
}

function buildProviderContracts(input = {}, runtime, tenantBoundary, now) {
  const supplied = asRecord(input.providers || input.providerContracts || input.integrationProviders || input.services);
  const providers = REQUIRED_PROVIDER_KEYS.map((key) => normalizeProviderRecord(key, supplied[key], runtime, now));
  const missingProviders = providers
    .filter((provider) => provider.status === 'unknown' && provider.capabilities.length === 0)
    .map((provider) => provider.key);
  const failedProviders = providers
    .filter((provider) => provider.status === 'offline' || provider.status === 'unauthorized' || provider.missingCapabilities.length > 0);
  const staleSyncProviders = providers
    .filter((provider) => provider.sync.required && !provider.sync.fresh)
    .map((provider) => provider.key);
  const negotiatedCapabilities = [...new Set(providers.flatMap((provider) => provider.capabilities))].sort();
  const handoffProvider = providers.find((provider) => provider.key === 'handoff-gateway');
  const proofProvider = providers.find((provider) => provider.key === 'proof-sink');
  const persistenceProvider = providers.find((provider) => provider.key === 'persistence');
  const serviceContracts = providers.map((provider) => buildProviderServiceContract(provider, runtime, tenantBoundary, now));
  const eventStream = buildProviderEventStreamContract({
    input,
    providers,
    serviceContracts,
    runtime,
    tenantBoundary,
    now
  });
  const requiredBeforeAccept = serviceContracts.flatMap((contract) => contract.obligations.requiredBeforeAccept.map((capability) => ({
    provider: contract.provider,
    capability,
    satisfied: contract.negotiation.suppliedCapabilities.includes(capability),
    command: 'kernel.lifecycle.exit.provider.negotiate'
  })));
  const syncEnvelope = {
    schema: `aios.kernel.lifecycle.exit.provider-sync.v${PROVIDER_SERVICE_SCHEMA_VERSION}`,
    generatedAt: now,
    requestId: runtime.requestId,
    tenantBoundary: tenantBoundary.auditSubject,
    ready: staleSyncProviders.length === 0,
    checkpoints: serviceContracts.map((contract) => ({
      provider: contract.provider,
      domain: contract.sync.domain,
      checkpointKey: contract.sync.checkpointKey,
      cursor: contract.sync.cursor,
      fresh: contract.sync.fresh,
      refreshCommand: contract.sync.refreshCommand
    }))
  };
  const handoffExport = serviceContracts.find((contract) => contract.provider === 'handoff-gateway')?.externalHandoff;

  return {
    ok: failedProviders.length === 0 && missingProviders.length === 0,
    syncReady: staleSyncProviders.length === 0,
    providers,
    serviceSchemaVersion: PROVIDER_SERVICE_SCHEMA_VERSION,
    serviceContracts,
    requiredBeforeAccept,
    syncEnvelope,
    missingProviders,
    failedProviders: failedProviders.map((provider) => ({
      key: provider.key,
      status: provider.status,
      missingCapabilities: provider.missingCapabilities
    })),
    staleSyncProviders,
    negotiatedCapabilities,
    auditProofWritable: Boolean(proofProvider?.negotiated && proofProvider.status === 'ready'),
    stateWritable: Boolean(persistenceProvider?.negotiated && persistenceProvider.status === 'ready'),
    eventStream,
    externalHandoff: {
      state: eventStream.latestHandoffSignal?.state || handoffProvider?.externalHandoff.state || 'not-opened',
      target: eventStream.latestHandoffSignal?.target || handoffProvider?.externalHandoff.target || runtime.handoffTarget,
      resumeTokenRef: eventStream.latestHandoffSignal?.resumeTokenRef || handoffProvider?.externalHandoff.resumeTokenRef || null,
      expiresAt: eventStream.latestHandoffSignal?.expiresAt || handoffProvider?.externalHandoff.expiresAt || null,
      ready: Boolean(handoffProvider?.negotiated && handoffProvider.status === 'ready' && runtime.hasResumeToken && eventStream.rejectedEvents.length === 0),
      exportKey: handoffExport?.exportKey || `${EVENT_NAMESPACE}:handoff:${tenantBoundary.scopeKey}:${runtime.requestId}:${runtime.handoffTarget}`,
      requiredScope: handoffExport?.requiredScope || tenantBoundary.handoffScope,
      syncDomain: PROVIDER_CONTRACTS['handoff-gateway'].syncDomain
    }
  };
}

function normalizeFailureEvents(value) {
  const entries = Array.isArray(value) ? value : Object.values(asRecord(value));
  return entries
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry, index) => {
      const record = asRecord(entry);
      const component = normalizeString(record.component || record.area, 'hosted-kernel');
      const severity = normalizeString(record.severity || record.level, 'error');
      return {
        id: normalizeString(record.id || record.code, `failure-${index + 1}`),
        component: HEALTH_COMPONENTS.includes(component) ? component : 'hosted-kernel',
        code: normalizeString(record.code || record.reason, 'kernel.lifecycle.exit.failure'),
        message: normalizeString(record.message || record.summary, 'Hosted-kernel exit contract reported a failure.'),
        severity: ['warning', 'error', 'critical'].includes(severity) ? severity : 'error',
        retryable: record.retryable !== false,
        attempt: Number.isInteger(record.attempt) && record.attempt > 0 ? record.attempt : 1,
        observedAt: normalizeString(record.observedAt || record.at || record.lastSeenAt, null)
      };
    });
}

function normalizeProcessExitOutcome(value, fallback = null) {
  const rawOutcome = normalizeString(value, fallback);
  if (!rawOutcome) return null;
  const outcome = rawOutcome.toLowerCase();
  const aliased = PROCESS_EXIT_ALIASES[outcome] || outcome;
  return PROCESS_EXIT_OUTCOMES.has(aliased) ? aliased : null;
}

function normalizeProcessExitEvidenceRefs(...values) {
  return [...new Set(values.flatMap((value) => normalizeStringList(value)))];
}

function normalizeProcessExitRequest(input = {}, state) {
  const exit = asRecord(input.processExit || input.exit || input.exitContract || input.lifecycleExit);
  const claim = asRecord(exit.claim || input.claim || input.submittedClaim);
  const kill = asRecord(exit.kill || input.kill || input.killSignal);
  const quarantine = asRecord(exit.quarantine || input.quarantine);
  const requestedOutcome = normalizeProcessExitOutcome(
    exit.outcome || exit.status || exit.state || input.exitOutcome || input.processExitOutcome,
    normalizeProcessExitOutcome(state)
  );
  const claimId = normalizeString(claim.id || claim.claimId || exit.claimId, null);
  const killReason = normalizeString(kill.reason || kill.code || exit.killReason, null);
  const quarantineReason = normalizeString(quarantine.reason || quarantine.code || exit.quarantineReason, null);
  const evidenceRefs = normalizeProcessExitEvidenceRefs(
    exit.evidenceRefs,
    exit.evidence,
    claim.evidenceRefs,
    claim.evidence,
    kill.evidenceRefs,
    quarantine.evidenceRefs
  );

  return {
    requested: Boolean(requestedOutcome),
    outcome: requestedOutcome,
    reason: normalizeString(exit.reason || exit.message || killReason || quarantineReason, null),
    requestedAt: normalizeString(exit.requestedAt || exit.at || exit.observedAt, null),
    actorId: normalizeString(exit.actorId || exit.principalId || kill.actorId || claim.claimantId, null),
    evidenceRefs,
    claim: {
      id: claimId,
      type: normalizeString(claim.type || claim.kind || exit.claimType, 'exit-claim'),
      submittedAt: normalizeString(claim.submittedAt || claim.at || exit.claimSubmittedAt, null),
      submittedBy: normalizeString(claim.submittedBy || claim.claimant || claim.claimantId || exit.claimantId, null),
      evidenceRefs: normalizeProcessExitEvidenceRefs(claim.evidenceRefs, claim.evidence, exit.claimEvidenceRefs, evidenceRefs)
    },
    kill: {
      reason: killReason,
      signal: normalizeString(kill.signal || kill.name || exit.killSignal, null),
      requestedBy: normalizeString(kill.requestedBy || kill.actorId || exit.killRequestedBy, null),
      evidenceRefs: normalizeProcessExitEvidenceRefs(kill.evidenceRefs, kill.evidence, evidenceRefs)
    },
    quarantine: {
      reason: quarantineReason,
      scope: normalizeString(quarantine.scope || exit.quarantineScope, null),
      releaseToken: normalizeString(quarantine.releaseToken || exit.quarantineReleaseToken, null),
      evidenceRefs: normalizeProcessExitEvidenceRefs(quarantine.evidenceRefs, quarantine.evidence, evidenceRefs)
    }
  };
}

function buildProcessExitRequestContract({ request, outcome, resolution, tenantBoundary, runtime, auditProof, now }) {
  const proofRefs = normalizeProcessExitEvidenceRefs(
    request.evidenceRefs,
    request.claim.evidenceRefs,
    request.kill.evidenceRefs,
    request.quarantine.evidenceRefs
  );
  const proofLinked = proofRefs.length > 0 || auditProof.signalSatisfied || auditProof.persistedProofCount > 0;
  const checks = [
    {
      id: 'request-outcome-known',
      label: 'Requested process exit outcome is supported',
      passed: !request.requested || Boolean(request.outcome),
      severity: 'error',
      command: `${EVENT_NAMESPACE}.process-exit.outcome.normalize`
    },
    {
      id: 'request-outcome-stable',
      label: 'Requested outcome matches runtime truth or explicit override policy',
      passed: !resolution.forcedOverride,
      severity: ['killed', 'quarantined'].includes(outcome) ? 'warning' : 'error',
      command: `${EVENT_NAMESPACE}.process-exit.truth.resolve`
    },
    {
      id: 'request-actor-attributed',
      label: 'Process exit request is attributable to an actor',
      passed: Boolean(request.actorId || tenantBoundary.principalId),
      severity: 'warning',
      command: `${EVENT_NAMESPACE}.process-exit.actor.capture`
    },
    {
      id: 'request-time-known',
      label: 'Process exit request has a timestamp or generated contract time',
      passed: Boolean(request.requestedAt || now),
      severity: 'warning',
      command: `${EVENT_NAMESPACE}.process-exit.timestamp.capture`
    },
    {
      id: 'request-scope-bound',
      label: 'Process exit request is bound to the active request and tenant scope',
      passed: tenantBoundary.isolated && runtime.hasStableRequest,
      severity: 'error',
      command: `${EVENT_NAMESPACE}.process-exit.scope.bind`
    },
    {
      id: 'claim-shape',
      label: 'Claim-submitted exit includes claim id, submitter, and submitted timestamp',
      passed: outcome !== 'claim-submitted' || Boolean(request.claim.id && request.claim.submittedBy && request.claim.submittedAt),
      severity: 'error',
      command: `${EVENT_NAMESPACE}.claim.capture`
    },
    {
      id: 'claim-proof-link',
      label: 'Claim-submitted exit is linked to audit proof or evidence refs',
      passed: outcome !== 'claim-submitted' || proofLinked || request.claim.evidenceRefs.length > 0,
      severity: 'warning',
      command: CONTROL_COMMANDS.proof
    },
    {
      id: 'kill-shape',
      label: 'Killed exit includes a kill signal, reason, terminal proof, or terminal actor',
      passed: outcome !== 'killed' || Boolean(request.kill.reason || request.kill.signal || request.reason || proofLinked),
      severity: 'error',
      command: `${EVENT_NAMESPACE}.kill.reason.capture`
    },
    {
      id: 'quarantine-shape',
      label: 'Quarantined exit includes an isolation reason or scope',
      passed: outcome !== 'quarantined' || Boolean(request.quarantine.reason || request.quarantine.scope || resolution.truthSignals.crossScopeEvents.length > 0),
      severity: 'error',
      command: 'kernel.lifecycle.exit.quarantine.record'
    },
    {
      id: 'done-shape',
      label: 'Done exit is not carrying terminal kill, quarantine, or claim payloads',
      passed: outcome !== 'done' || !request.kill.reason && !request.kill.signal && !request.quarantine.reason && !request.claim.id,
      severity: 'error',
      command: `${EVENT_NAMESPACE}.process-exit.payload.reconcile`
    }
  ];
  const failed = checks.filter((check) => !check.passed);
  const blocking = failed.filter((check) => check.severity === 'error');
  const requestFingerprint = deriveFingerprint({
    outcome,
    requestedOutcome: request.outcome,
    requestedAt: request.requestedAt,
    actorId: request.actorId || tenantBoundary.principalId,
    reason: request.reason,
    claimId: request.claim.id,
    killSignal: request.kill.signal,
    quarantineScope: request.quarantine.scope,
    proofRefs,
    scopeKey: tenantBoundary.scopeKey,
    requestId: runtime.requestId
  });

  return {
    schema: `aios.kernel.lifecycle.exit.process-exit-request.v${PROCESS_EXIT_SCHEMA_VERSION}`,
    generatedAt: now,
    outcome,
    requested: request.requested,
    requestedOutcome: request.outcome,
    source: resolution.source,
    forcedOverride: resolution.forcedOverride,
    requestFingerprint,
    attributedActor: request.actorId || tenantBoundary.principalId,
    requestedAt: request.requestedAt || now,
    proofLinked,
    evidenceRefs: proofRefs,
    valid: blocking.length === 0,
    status: blocking.length === 0 ? failed.length > 0 ? 'warning' : 'valid' : 'invalid',
    failedCheckIds: failed.map((check) => check.id),
    blockingReasons: blocking.map((check) => check.label),
    warningReasons: failed.filter((check) => check.severity === 'warning').map((check) => check.label),
    checks: checks.map((check) => ({
      id: check.id,
      label: check.label,
      passed: check.passed,
      severity: check.severity,
      command: check.command,
      remediationKey: `${EVENT_NAMESPACE}:exit-request-check:${outcome}:${check.id}`
    }))
  };
}

function buildProcessExitPermissionContract({ outcome, request, runtime, tenantBoundary, boundaryContract, providerContracts, now }) {
  const requirement = PROCESS_EXIT_PERMISSION_REQUIREMENTS[outcome] || PROCESS_EXIT_PERMISSION_REQUIREMENTS.blocked;
  const controls = requirement.controls.map((control) => {
    const access = tenantBoundary.commandAccess[control];
    const boundary = boundaryContract.controls[control];
    const dispatchable = Boolean(access?.allowed && boundary?.dispatchable);
    return {
      control,
      permission: access?.permission || null,
      allowed: dispatchable,
      deniedReasons: [
        ...(access?.deniedReasons || []),
        ...(boundary?.blockedReasons || [])
      ].filter((reason, index, reasons) => reason && reasons.indexOf(reason) === index)
    };
  });
  const cleanSnapshot = !boundaryContract.isolationRequired && !boundaryContract.forkRequired;
  const readOnlyBlocked = tenantBoundary.readOnly && requirement.access !== 'workspace-read';
  const providerStateWritable = providerContracts.stateWritable || outcome === 'claim-submitted';
  const providerAuditWritable = !requirement.requiresAuditHandoff || providerContracts.auditProofWritable || providerContracts.eventStream.acceptedCount > 0;
  const controlDeniedReasons = controls.flatMap((control) => control.deniedReasons);
  const boundaryDeniedReasons = [
    ...(tenantBoundary.isolated ? [] : ['Active tenant, workspace, and principal are required before recording a process exit.']),
    ...(readOnlyBlocked ? [`${outcome} process exit requires ${requirement.access}, but the principal is read-only for this workspace.`] : []),
    ...(requirement.requiresCleanSnapshot && !cleanSnapshot ? ['Recovered state must be isolated or forked before recording this process exit.'] : []),
    ...(providerStateWritable ? [] : ['Persistence provider must accept state writes before recording this process exit.']),
    ...(providerAuditWritable ? [] : ['Audit proof sink must be writable before recording this process exit handoff.'])
  ];
  const deniedReasons = [
    ...controlDeniedReasons,
    ...boundaryDeniedReasons
  ].filter((reason, index, reasons) => reason && reasons.indexOf(reason) === index);
  const allowed = controls.every((control) => control.allowed)
    && tenantBoundary.isolated
    && !readOnlyBlocked
    && (!requirement.requiresCleanSnapshot || cleanSnapshot)
    && providerStateWritable
    && providerAuditWritable;
  const permissionFingerprint = deriveFingerprint({
    outcome,
    requestOutcome: request.outcome,
    actorId: request.actorId,
    scopeKey: tenantBoundary.scopeKey,
    controls: controls.map((control) => [control.control, control.allowed, control.permission]),
    boundaryFingerprint: boundaryContract.boundaryFingerprint,
    providerStateWritable,
    providerAuditWritable,
    cleanSnapshot
  });

  return {
    schema: `aios.kernel.lifecycle.exit.process-exit-permission.v${TENANT_BOUNDARY_SCHEMA_VERSION}`,
    generatedAt: now,
    outcome,
    access: requirement.access,
    requiredControls: controls,
    requiredWrites: requirement.writes,
    requiresCleanSnapshot: requirement.requiresCleanSnapshot,
    requiresAuditHandoff: requirement.requiresAuditHandoff,
    allowed,
    status: allowed ? 'authorized' : 'denied',
    deniedReasons,
    requestCommand: allowed ? `${EVENT_NAMESPACE}.process-exit.record` : 'kernel.lifecycle.exit.permissions.request',
    writeScope: {
      tenantId: tenantBoundary.tenantId,
      workspaceId: tenantBoundary.workspaceId,
      principalId: tenantBoundary.principalId,
      requestId: runtime.requestId,
      scopeKey: tenantBoundary.scopeKey,
      writes: requirement.writes
    },
    auditHandoff: {
      subject: {
        ...tenantBoundary.auditSubject,
        requestId: runtime.requestId,
        requestedBy: request.actorId || tenantBoundary.principalId,
        requestedOutcome: request.outcome,
        effectiveOutcome: outcome
      },
      permissionFingerprint,
      boundaryFingerprint: boundaryContract.boundaryFingerprint,
      handoffScope: tenantBoundary.handoffScope,
      policy: allowed ? 'record-with-active-scope' : 'deny-process-exit-record',
      deniedReasons,
      providerEventStreamKey: providerContracts.eventStream.streamKey
    }
  };
}

function buildProcessExitOutcomeRequirements({
  outcome,
  state,
  request,
  requestContract,
  acceptance,
  acceptanceBlocked,
  auditProof,
  persistedState,
  workflowHandoff,
  boundaryContract,
  hasBlockingValidation,
  hasQuarantineSignal,
  hasKillSignal,
  operationalHealth,
  providerContracts,
  processExitProviderContract,
  tenantBoundary,
  exitPermission
}) {
  const proofLinked = auditProof.signalSatisfied || request.evidenceRefs.length > 0 || persistedState.proofCount > 0;
  const providerRejectedEvents = providerContracts.eventStream.rejectedEvents;
  const terminalFailures = operationalHealth.failureState.retryBudget.terminalComponents;
  const deadLettered = operationalHealth.failureState.deadLetter.length > 0;
  const permissionCheck = [
    'exit-permission',
    `${outcome} process exit can be recorded inside the active tenant boundary`,
    exitPermission.allowed,
    'error',
    exitPermission.requestCommand
  ];
  const requestShapeCheck = [
    'request-contract',
    'Process exit request shape satisfies outcome invariants',
    requestContract.valid,
    'error',
    requestContract.checks.find((check) => !check.passed && check.severity === 'error')?.command
      || `${EVENT_NAMESPACE}.process-exit.request.repair`
  ];
  const requestWarningChecks = requestContract.checks
    .filter((check) => !check.passed && check.severity !== 'error')
    .map((check) => [
      `request-${check.id}`,
      check.label,
      false,
      check.severity,
      check.command
    ]);
  const outcomeRequirements = {
    done: [
      requestShapeCheck,
      permissionCheck,
      ['provider-contract', 'Outcome-specific provider contracts are satisfied', processExitProviderContract.ready, 'error', processExitProviderContract.repairPlan[0]?.command || 'kernel.lifecycle.exit.provider.negotiate'],
      ['accepted', 'Exit acceptance is complete', acceptance.canAccept || persistedState.replayed.accept, 'error', CONTROL_COMMANDS.accept],
      ['proof-ready', 'Audit proof is durable', auditProof.ready || persistedState.proofCount > 0, 'error', auditProof.reconciliation.repairCommand || CONTROL_COMMANDS.proof],
      ['state-writable', 'Accepted state can be written durably', providerContracts.stateWritable && !persistedState.conflict.present, 'error', 'kernel.lifecycle.exit.state.reconcile'],
      ['handoff-safe', 'Handoff is ready or already replayed', workflowHandoff.status === 'ready' || persistedState.replayed.handoff, 'warning', CONTROL_COMMANDS.handoff],
      ['no-quarantine', 'No quarantine boundary is active', !hasQuarantineSignal, 'error', boundaryContract.isolationActions[0]?.command || 'kernel.lifecycle.exit.tenant.isolate'],
      ['no-kill-signal', 'No terminal kill signal is active', !hasKillSignal, 'error', `${EVENT_NAMESPACE}.health.inspect`]
    ],
    blocked: [
      requestShapeCheck,
      permissionCheck,
      ['provider-contract', 'Blocked outcome provider contracts are synced', processExitProviderContract.ready, 'warning', processExitProviderContract.repairPlan[0]?.command || 'kernel.lifecycle.exit.provider.sync'],
      ['has-blocker', 'A blocking reason is recorded', hasBlockingValidation || state === 'blocked', 'error', acceptanceBlocked[0]?.nextCommand || 'kernel.lifecycle.exit.inspect'],
      ['not-accepted', 'Blocked exit has not been accepted', !acceptance.canAccept || state === 'blocked', 'warning', CONTROL_COMMANDS.accept],
      ['operator-action', 'A next remediation action is available', operationalHealth.actionableErrors.length > 0 || acceptanceBlocked.length > 0, 'warning', acceptanceBlocked[0]?.nextCommand || operationalHealth.actionableErrors[0]?.nextCommand || `${EVENT_NAMESPACE}.health.inspect`],
      ['not-terminal-fatal', 'Blocked exit is not masking a kill or quarantine condition', !hasKillSignal && !hasQuarantineSignal, 'error', hasQuarantineSignal ? 'kernel.lifecycle.exit.quarantine.record' : 'kernel.lifecycle.exit.kill.record']
    ],
    killed: [
      requestShapeCheck,
      permissionCheck,
      ['provider-contract', 'Killed outcome provider handoff is durable', processExitProviderContract.ready, 'error', processExitProviderContract.repairPlan[0]?.command || 'kernel.lifecycle.exit.provider.negotiate'],
      ['kill-signal', 'Kill reason or terminal failure is present', hasKillSignal, 'error', `${EVENT_NAMESPACE}.kill.reason.capture`],
      ['no-accept-after-kill', 'Killed process will not accept after termination', !acceptance.canAccept, 'error', 'kernel.lifecycle.exit.accept.revoke'],
      ['dead-letter', 'Terminal side effects are dead-lettered or explicitly reasoned', deadLettered || Boolean(request.kill.reason), 'warning', `${EVENT_NAMESPACE}.health.dead-letter`],
      ['kill-actor', 'Kill exit is attributable to an actor or terminal component', Boolean(request.actorId || request.kill.requestedBy || terminalFailures.length > 0), 'warning', `${EVENT_NAMESPACE}.kill.actor.capture`]
    ],
    quarantined: [
      requestShapeCheck,
      permissionCheck,
      ['provider-contract', 'Quarantine provider writes are isolated and synced', processExitProviderContract.ready, 'error', processExitProviderContract.repairPlan[0]?.command || 'kernel.lifecycle.exit.provider.negotiate'],
      ['quarantine-signal', 'Quarantine boundary is present', hasQuarantineSignal || Boolean(request.quarantine.reason), 'error', 'kernel.lifecycle.exit.quarantine.record'],
      ['write-isolated', 'Tenant-scoped writes are isolated', !boundaryContract.safeToAccept || boundaryContract.isolationActions.length > 0, 'error', boundaryContract.isolationActions[0]?.command || 'kernel.lifecycle.exit.tenant.isolate'],
      ['release-trackable', 'Release path is trackable', Boolean(request.quarantine.releaseToken) || boundaryContract.isolationActions.length > 0, 'warning', `${EVENT_NAMESPACE}.quarantine.release.prepare`],
      ['cross-scope-events-accounted', 'Cross-scope provider events are accounted for', providerRejectedEvents.every((event) => event.status !== 'cross-scope') || hasQuarantineSignal, 'error', `${EVENT_NAMESPACE}.provider.events.sync`]
    ],
    'claim-submitted': [
      requestShapeCheck,
      permissionCheck,
      ['provider-contract', 'Claim submission provider contract accepts audit claim writes', processExitProviderContract.ready, 'error', processExitProviderContract.repairPlan[0]?.command || 'kernel.lifecycle.exit.provider.negotiate'],
      ['claim-id', 'Submitted claim has an id', Boolean(request.claim.id), 'error', `${EVENT_NAMESPACE}.claim.id.assign`],
      ['claim-submitter', 'Submitted claim has a submitter', Boolean(request.claim.submittedBy), 'error', `${EVENT_NAMESPACE}.claim.submitter.capture`],
      ['claim-time', 'Submitted claim has a timestamp', Boolean(request.claim.submittedAt), 'error', `${EVENT_NAMESPACE}.claim.timestamp.capture`],
      ['claim-proof', 'Submitted claim is linked to audit proof', proofLinked || request.claim.evidenceRefs.length > 0, 'warning', CONTROL_COMMANDS.proof],
      ['claim-scope', 'Submitted claim is bound to the active tenant scope', tenantBoundary.isolated && !boundaryContract.isolationRequired, 'error', 'kernel.lifecycle.exit.claim.scope.bind']
    ]
  };

  return [
    ...(outcomeRequirements[outcome] || outcomeRequirements.blocked),
    ...requestWarningChecks
  ].map(([id, label, passed, severity, command]) => ({
    id,
    label,
    passed: Boolean(passed),
    severity,
    command,
    remediationKey: `${EVENT_NAMESPACE}:exit-check:${outcome}:${id}`
  }));
}

function buildProcessExitProviderContract({ outcome, providerContracts, runtime, tenantBoundary, request, now }) {
  const policy = PROCESS_EXIT_PROVIDER_POLICIES[outcome] || PROCESS_EXIT_PROVIDER_POLICIES.blocked;
  const serviceByProvider = providerContracts.serviceContracts.reduce((acc, contract) => {
    acc[contract.provider] = contract;
    return acc;
  }, {});
  const eventIndex = providerContracts.eventStream.providers || {};
  const providerChecks = policy.providers.map((provider) => {
    const service = serviceByProvider[provider];
    const suppliedCapabilities = service?.negotiation?.suppliedCapabilities || [];
    const requiredCapabilities = policy.capabilities[provider] || [];
    const missingCapabilities = requiredCapabilities.filter((capability) => !suppliedCapabilities.includes(capability));
    const expectedPublications = policy.publications[provider] || [];
    const observedPublications = eventIndex[provider]?.observedPublications || [];
    const missingPublications = expectedPublications.filter((publication) => !observedPublications.includes(publication));
    const syncReady = Boolean(service && (!service.sync.required || service.sync.fresh));
    const negotiated = Boolean(service?.negotiation?.accepted && missingCapabilities.length === 0);
    const eventReady = missingPublications.length === 0 || expectedPublications.length === 0;
    const ready = negotiated && syncReady && eventReady;
    const refreshCommand = !syncReady
      ? service?.sync?.refreshCommand || `${EVENT_NAMESPACE}.provider.sync`
      : !eventReady
        ? `${EVENT_NAMESPACE}.provider.events.sync`
        : null;

    return {
      provider,
      status: service?.status || 'missing',
      endpoint: service?.endpoint || PROVIDER_CONTRACTS[provider]?.defaultEndpoint || null,
      ready,
      negotiated,
      syncReady,
      eventReady,
      requiredCapabilities,
      suppliedCapabilities,
      missingCapabilities,
      expectedPublications,
      observedPublications,
      missingPublications,
      sync: service?.sync || null,
      refreshCommand,
      blockedReasons: [
        ...(service ? [] : [`${provider} provider contract is missing.`]),
        ...(service?.negotiation?.accepted === false ? service.negotiation.blockingReasons : []),
        ...missingCapabilities.map((capability) => `${provider} must negotiate ${capability} for ${outcome} exits.`),
        ...(syncReady ? [] : [`${provider} sync metadata must be fresh before recording ${outcome}.`]),
        ...missingPublications.map((publication) => `${provider} must publish ${publication} before recording ${outcome}.`)
      ]
    };
  });
  const handoffState = providerContracts.externalHandoff;
  const handoffAllowedState = policy.handoffState.length === 0 || policy.handoffState.includes(handoffState.state);
  const externalHandoffReady = !policy.externalHandoffRequired
    || Boolean(handoffState.ready || handoffState.resumeTokenRef || request.evidenceRefs.length > 0);
  const handoffReady = externalHandoffReady && handoffAllowedState;
  const blockedProviders = providerChecks.filter((check) => !check.ready);
  const handoffBlockedReasons = [
    ...(policy.externalHandoffRequired && !externalHandoffReady
      ? [`${outcome} exits require an audit handoff, resume-token reference, or linked evidence before record.`]
      : []),
    ...(handoffAllowedState ? [] : [`handoff-gateway external state ${handoffState.state} is not valid for ${outcome} exits.`])
  ];
  const requiredSyncDomains = providerChecks
    .map((check) => check.sync?.domain)
    .filter(Boolean);
  const ready = blockedProviders.length === 0 && handoffReady;

  return {
    schema: `aios.kernel.lifecycle.exit.process-exit-provider-contract.v${PROCESS_EXIT_SCHEMA_VERSION}`,
    generatedAt: now,
    outcome,
    contractKey: `${EVENT_NAMESPACE}:process-exit-provider:${tenantBoundary.scopeKey}:${runtime.requestId}:${outcome}`,
    ready,
    requiredProviders: policy.providers,
    requiredSyncDomains,
    providerChecks,
    blockedProviders: blockedProviders.map((check) => check.provider),
    blockedReasons: [
      ...blockedProviders.flatMap((check) => check.blockedReasons),
      ...handoffBlockedReasons
    ].filter((reason, index, reasons) => reason && reasons.indexOf(reason) === index),
    capabilityNegotiation: providerChecks.map((check) => ({
      provider: check.provider,
      accepted: check.negotiated,
      requiredCapabilities: check.requiredCapabilities,
      suppliedCapabilities: check.suppliedCapabilities,
      missingCapabilities: check.missingCapabilities
    })),
    syncMetadata: providerChecks.map((check) => ({
      provider: check.provider,
      domain: check.sync?.domain || PROVIDER_CONTRACTS[check.provider]?.syncDomain || null,
      cursor: check.sync?.cursor || null,
      fresh: check.syncReady,
      lastSyncedAt: check.sync?.lastSyncedAt || null,
      refreshCommand: check.refreshCommand
    })),
    eventObligations: providerChecks.map((check) => ({
      provider: check.provider,
      expectedPublications: check.expectedPublications,
      observedPublications: check.observedPublications,
      missingPublications: check.missingPublications,
      acceptedCount: eventIndex[check.provider]?.acceptedCount || 0,
      latestCursor: eventIndex[check.provider]?.latestCursor || null
    })),
    externalHandoff: {
      required: policy.externalHandoffRequired,
      ready: handoffReady,
      state: handoffState.state,
      target: handoffState.target,
      resumeTokenRef: handoffState.resumeTokenRef,
      exportKey: handoffState.exportKey,
      requiredScope: handoffState.requiredScope,
      allowedStates: policy.handoffState,
      blockedReasons: handoffBlockedReasons
    },
    repairPlan: [
      ...providerChecks
        .filter((check) => !check.ready)
        .map((check, index) => ({
          id: `repair-provider-${check.provider}`,
          rank: index + 1,
          provider: check.provider,
          command: check.refreshCommand || 'kernel.lifecycle.exit.provider.negotiate',
          idempotencyKey: `${EVENT_NAMESPACE}:process-exit-provider-repair:${tenantBoundary.scopeKey}:${runtime.requestId}:${outcome}:${check.provider}`,
          reason: check.blockedReasons[0] || `${check.provider} provider contract is not ready.`
        })),
      ...handoffBlockedReasons.map((reason, index) => ({
        id: `repair-external-handoff-${index + 1}`,
        rank: providerChecks.length + index + 1,
        provider: 'handoff-gateway',
        command: CONTROL_COMMANDS.handoff,
        idempotencyKey: `${EVENT_NAMESPACE}:process-exit-handoff-repair:${tenantBoundary.scopeKey}:${runtime.requestId}:${outcome}:${index + 1}`,
        reason
      }))
    ]
  };
}

function buildProcessExitRemediation({ outcome, checks, runtime, tenantBoundary, request, resolution }) {
  const failed = checks.filter((check) => !check.passed);
  const blocking = failed.filter((check) => check.severity === 'error');
  const nextCheck = blocking[0] || failed[0] || null;

  return {
    required: failed.length > 0,
    outcome,
    mode: blocking.length > 0 ? 'blocking' : failed.length > 0 ? 'warning-only' : 'none',
    nextCheckId: nextCheck?.id || null,
    nextCommand: nextCheck?.command || null,
    actions: failed.map((check, index) => ({
      id: `repair-${check.id}`,
      rank: index + 1,
      checkId: check.id,
      severity: check.severity,
      command: check.command,
      idempotencyKey: `${check.remediationKey}:${tenantBoundary.scopeKey}:${runtime.requestId}`,
      reason: check.label
    })),
    auditSubject: {
      ...tenantBoundary.auditSubject,
      requestId: runtime.requestId,
      requestedBy: request.actorId || tenantBoundary.principalId,
      requestedOutcome: request.outcome,
      effectiveOutcome: outcome,
      source: resolution.source
    }
  };
}

function buildProcessExitOperationalReadiness({
  outcome,
  checks,
  remediation,
  operationalHealth,
  providerContracts,
  auditProof,
  runtime,
  tenantBoundary,
  request,
  now
}) {
  const policy = PROCESS_EXIT_OPERATIONAL_POLICIES[outcome] || PROCESS_EXIT_OPERATIONAL_POLICIES.blocked;
  const failedChecks = checks.filter((check) => !check.passed);
  const blockingChecks = failedChecks.filter((check) => check.severity === 'error');
  const failedCheckIds = new Set(failedChecks.map((check) => check.id));
  const terminalCheckFailures = failedChecks.filter((check) => policy.terminalCheckIds.includes(check.id));
  const exhaustedComponents = new Set(operationalHealth.failureState.retryBudget.exhaustedComponents);
  const terminalComponents = new Set(operationalHealth.failureState.retryBudget.terminalComponents);
  const relevantHealthErrors = operationalHealth.actionableErrors
    .filter((error) => policy.healthComponents.includes(error.component));
  const retryableChecks = failedChecks
    .filter((check) => policy.retryableChecks.includes(check.id))
    .map((check) => ({
      id: check.id,
      command: check.command,
      severity: check.severity,
      reason: check.label
    }));
  const retryableHealth = relevantHealthErrors
    .filter((error) => error.retryable && !error.retryExhausted && !terminalComponents.has(error.component))
    .map((error) => ({
      id: error.id,
      component: error.component,
      command: error.providerRefreshCommand || error.nextCommand,
      retryAfterMs: error.retryAfterMs,
      nextRetryAt: error.nextRetryAt,
      reason: error.message
    }));
  const retryAttempts = policy.healthComponents
    .map((component) => operationalHealth.failureState.components[component]?.attempt)
    .filter((attempt) => Number.isInteger(attempt) && attempt > 0);
  const nextAttempt = Math.max(1, ...retryAttempts, remediation.actions.length > 0 ? remediation.actions.length : 1);
  const backoffMs = RETRY_BACKOFF_MS[Math.min(nextAttempt - 1, RETRY_BACKOFF_MS.length - 1)];
  const nowMs = Number.isFinite(Date.parse(now)) ? Date.parse(now) : Date.now();
  const calculatedRetryAt = new Date(nowMs + backoffMs).toISOString();
  const nextRetryAt = retryableHealth.find((entry) => entry.nextRetryAt)?.nextRetryAt || calculatedRetryAt;
  const degradedComponents = policy.degradedComponents
    .map((component) => operationalHealth.failureState.components[component])
    .filter((componentState) => componentState && componentState.status === 'degraded');
  const degradedCapabilities = [...new Set([
    ...operationalHealth.failureState.degradedCapabilities,
    ...degradedComponents.flatMap((componentState) => DEGRADED_COMPONENT_CAPABILITIES[componentState.component] || [])
  ])].sort();
  const proofMissing = policy.proofRequired
    && !auditProof.signalSatisfied
    && request.evidenceRefs.length === 0
    && request.claim.evidenceRefs.length === 0
    && request.kill.evidenceRefs.length === 0
    && request.quarantine.evidenceRefs.length === 0;
  const terminalBlocked = terminalCheckFailures.length > 0
    || policy.healthComponents.some((component) => terminalComponents.has(component))
    || (outcome !== 'blocked' && policy.healthComponents.some((component) => exhaustedComponents.has(component)));
  const retryable = !terminalBlocked && (retryableChecks.length > 0 || retryableHealth.length > 0);
  const degradedRecordable = blockingChecks.length === 0
    && degradedCapabilities.length > 0
    && (outcome === 'blocked' || outcome === 'claim-submitted' || failedChecks.every((check) => check.severity === 'warning'));
  const recordable = blockingChecks.length === 0 && !terminalBlocked && !proofMissing;
  const status = recordable
    ? degradedRecordable ? 'recordable-degraded' : 'recordable'
    : terminalBlocked
      ? 'terminal-action-required'
      : retryable
        ? 'retry-scheduled'
        : 'action-required';

  return {
    schema: `aios.kernel.lifecycle.exit.process-exit-readiness.v${PROCESS_EXIT_SCHEMA_VERSION}`,
    generatedAt: now,
    outcome,
    failureState: policy.failureState,
    status,
    recordable,
    degradedRecordable,
    proofRequired: policy.proofRequired,
    proofMissing,
    terminalBlocked,
    retry: {
      retryable,
      nextAttempt,
      backoffMs: retryable ? backoffMs : null,
      nextRetryAt: retryable ? nextRetryAt : null,
      commands: [
        ...retryableChecks.map((check) => ({
          source: 'exit-check',
          id: check.id,
          command: check.command,
          reason: check.reason
        })),
        ...retryableHealth.map((error) => ({
          source: 'operational-health',
          id: error.id,
          component: error.component,
          command: error.command,
          reason: error.reason
        }))
      ]
    },
    degradedMode: {
      enabled: degradedRecordable || (degradedCapabilities.length > 0 && !terminalBlocked),
      components: degradedComponents.map((componentState) => componentState.component),
      capabilities: degradedCapabilities,
      acceptDisabled: operationalHealth.degradedMode.acceptDisabled || failedCheckIds.has('accepted'),
      handoffBlocked: failedCheckIds.has('handoff-safe') || operationalHealth.degradedMode.capabilities.includes('accept-without-handoff')
    },
    actionableErrors: [
      ...failedChecks.map((check) => ({
        source: 'exit-check',
        id: check.id,
        severity: check.severity,
        message: check.label,
        nextCommand: check.command,
        retryable: policy.retryableChecks.includes(check.id) && !terminalBlocked
      })),
      ...relevantHealthErrors.map((error) => ({
        source: 'operational-health',
        id: error.id,
        component: error.component,
        severity: error.severity,
        message: error.message,
        nextCommand: error.providerRefreshCommand || error.nextCommand,
        retryable: error.retryable && !error.retryExhausted,
        nextRetryAt: error.nextRetryAt,
        remediationRunbookId: error.remediationRunbookId
      }))
    ],
    providerEvents: {
      streamKey: providerContracts.eventStream.streamKey,
      rejectedCount: providerContracts.eventStream.rejectedCount,
      refreshActions: providerContracts.eventStream.refreshActions
        .filter((action) => policy.healthComponents.includes(action.provider))
    },
    audit: {
      subject: tenantBoundary.auditSubject,
      requestId: runtime.requestId,
      requestedOutcome: request.outcome,
      evidenceRefs: request.evidenceRefs,
      missingCheckIds: failedChecks.map((check) => check.id)
    }
  };
}

function buildProcessExitControlGate({
  outcome,
  request,
  readiness,
  exitPermission,
  remediation,
  lifecycleSettings,
  runtime,
  tenantBoundary,
  now
}) {
  const requiredControls = exitPermission.requiredControls.map((entry) => entry.control);
  const controlStates = requiredControls.reduce((acc, control) => {
    const setting = lifecycleSettings.controls[control];
    const permission = exitPermission.requiredControls.find((entry) => entry.control === control);
    const schedule = setting?.schedule || normalizeScheduleWindow(null, now);
    const disabled = !lifecycleSettings.enabled || !setting?.enabled;
    const scheduled = schedule.blockedByClock;
    const expired = schedule.expired;
    const settingUnavailable = !setting?.available;
    const blockedReasons = [
      ...(lifecycleSettings.enabled ? [] : ['Lifecycle controls are disabled by settings.']),
      ...(setting?.enabled ? [] : [`${control} control must be enabled before recording ${outcome}.`]),
      ...(expired ? [`${control} schedule window has expired.`] : []),
      ...(scheduled ? [`${control} is scheduled for ${schedule.readyAt}.`] : []),
      ...(settingUnavailable && !disabled && !expired && !scheduled ? setting?.disabledReasons || [] : []),
      ...(permission?.deniedReasons || [])
    ].filter((reason, index, reasons) => reason && reasons.indexOf(reason) === index);

    acc[control] = {
      control,
      command: CONTROL_COMMANDS[control],
      enabled: Boolean(setting?.enabled && lifecycleSettings.enabled),
      available: Boolean(setting?.available && permission?.allowed),
      schedule,
      blockedReasons,
      settingsPatch: setting?.enabled
        ? null
        : {
          command: 'kernel.lifecycle.exit.settings.enable',
          idempotencyKey: `${EVENT_NAMESPACE}:process-exit-enable:${tenantBoundary.scopeKey}:${runtime.requestId}:${outcome}:${control}`,
          patch: {
            settingsVersion: lifecycleSettings.settingsVersion + 1,
            path: `controls.${control}.enabled`,
            value: true
          }
        },
      schedulePatch: scheduled || expired
        ? {
          command: 'kernel.lifecycle.exit.schedule.update',
          idempotencyKey: `${EVENT_NAMESPACE}:process-exit-schedule:${tenantBoundary.scopeKey}:${runtime.requestId}:${outcome}:${control}`,
          patch: {
            settingsVersion: lifecycleSettings.settingsVersion + 1,
            path: `controls.${control}.schedule`,
            value: {
              mode: 'immediate',
              notBefore: null,
              expiresAt: null
            }
          }
        }
        : null
    };
    return acc;
  }, {});
  const blockedControls = Object.values(controlStates).filter((control) => !control.available);
  const scheduledControls = Object.values(controlStates).filter((control) => control.schedule.blockedByClock);
  const expiredControls = Object.values(controlStates).filter((control) => control.schedule.expired);
  const controlReady = blockedControls.length === 0;
  const readyAt = scheduledControls
    .map((control) => control.schedule.readyAt)
    .filter(Boolean)
    .sort()[0] || now;
  const recordEnabled = readiness.recordable && exitPermission.allowed && controlReady;
  const firstPatch = blockedControls
    .map((control) => control.settingsPatch || control.schedulePatch)
    .find(Boolean);
  const nextRemediation = remediation.actions[0] || null;
  const nextAction = recordEnabled
    ? {
      state: readiness.degradedRecordable ? 'record-degraded' : 'record-ready',
      label: `Record ${outcome} exit`,
      command: `${EVENT_NAMESPACE}.process-exit.record`,
      readyAt,
      reason: request.reason || `${outcome} process exit checks are satisfied.`
    }
    : scheduledControls.length > 0
      ? {
        state: 'scheduled',
        label: 'Waiting for process exit schedule',
        command: 'kernel.lifecycle.exit.schedule.wait',
        readyAt,
        reason: scheduledControls[0].blockedReasons[0]
      }
      : firstPatch
        ? {
          state: expiredControls.length > 0 ? 'schedule-repair' : 'settings-repair',
          label: expiredControls.length > 0 ? 'Update process exit schedule' : 'Enable process exit controls',
          command: firstPatch.command,
          readyAt: null,
          reason: blockedControls[0]?.blockedReasons[0] || `${outcome} process exit controls are unavailable.`
        }
        : {
          state: readiness.status,
          label: remediation.required ? 'Repair process exit checks' : 'Request process exit permission',
          command: nextRemediation?.command || exitPermission.requestCommand,
          readyAt: readiness.retry.nextRetryAt,
          reason: nextRemediation?.reason || exitPermission.deniedReasons[0] || `${outcome} process exit is not recordable.`
        };

  return {
    schema: `aios.kernel.lifecycle.exit.process-exit-controls.v${PROCESS_EXIT_SCHEMA_VERSION}`,
    generatedAt: now,
    outcome,
    enabled: recordEnabled,
    status: recordEnabled ? 'enabled' : scheduledControls.length > 0 ? 'scheduled' : 'disabled',
    requiredControls,
    controls: controlStates,
    blockedControls: blockedControls.map((control) => control.control),
    blockedReasons: blockedControls.flatMap((control) => control.blockedReasons),
    settingsUpdatePlan: blockedControls
      .map((control) => control.settingsPatch || control.schedulePatch)
      .filter(Boolean),
    schedule: {
      readyAt,
      blockedByClock: scheduledControls.length > 0,
      expired: expiredControls.length > 0
    },
    nextAction,
    dispatchEnvelope: {
      command: `${EVENT_NAMESPACE}.process-exit.record`,
      idempotencyKey: `${EVENT_NAMESPACE}:process-exit-dispatch:${tenantBoundary.scopeKey}:${runtime.requestId}:${outcome}`,
      tenantBoundary: tenantBoundary.auditSubject,
      requestId: runtime.requestId,
      outcome,
      dryRun: !recordEnabled,
      requiredControls,
      blockedReasons: [
        ...blockedControls.flatMap((control) => control.blockedReasons),
        ...(!readiness.recordable ? readiness.actionableErrors.map((error) => error.message) : []),
        ...(!exitPermission.allowed ? exitPermission.deniedReasons : [])
      ].filter((reason, index, reasons) => reason && reasons.indexOf(reason) === index)
    }
  };
}

function buildProcessExitUserDecisionContract({
  outcome,
  request,
  resolution,
  checks,
  readiness,
  controlGate,
  exitPermission,
  providerContract,
  remediation,
  blockingReasons,
  valid,
  runtime,
  tenantBoundary,
  now
}) {
  const failedChecks = checks.filter((check) => !check.passed);
  const blockingChecks = failedChecks.filter((check) => check.severity === 'error');
  const warningChecks = failedChecks.filter((check) => check.severity === 'warning');
  const providerRepairSteps = providerContract.repairPlan.map((step) => ({
    id: step.id,
    source: 'provider-contract',
    rank: step.rank,
    label: `Repair ${step.provider}`,
    reason: step.reason,
    command: step.command,
    provider: step.provider,
    readyAt: null,
    idempotencyKey: step.idempotencyKey
  }));
  const controlRepairSteps = controlGate.settingsUpdatePlan.map((patch, index) => ({
    id: `repair-control-${index + 1}`,
    source: 'control-gate',
    rank: providerRepairSteps.length + index + 1,
    label: patch.command.includes('.schedule.') ? 'Update process exit schedule' : 'Enable process exit control',
    reason: controlGate.blockedReasons[index] || `${outcome} process exit control is unavailable.`,
    command: patch.command,
    provider: null,
    readyAt: controlGate.schedule.readyAt,
    idempotencyKey: patch.idempotencyKey
  }));
  const remediationSteps = remediation.actions.map((action, index) => ({
    id: action.id,
    source: 'exit-check',
    rank: providerRepairSteps.length + controlRepairSteps.length + index + 1,
    label: action.reason,
    reason: action.reason,
    command: action.command,
    provider: null,
    readyAt: readiness.retry.nextRetryAt,
    idempotencyKey: action.idempotencyKey
  }));
  const recordStep = valid
    ? [{
      id: `record-${outcome}-process-exit`,
      source: 'record-intent',
      rank: 0,
      label: `Record ${outcome} exit`,
      reason: request.reason || `${outcome} process exit checks are satisfied.`,
      command: controlGate.dispatchEnvelope.command,
      provider: null,
      readyAt: controlGate.schedule.readyAt,
      idempotencyKey: controlGate.dispatchEnvelope.idempotencyKey
    }]
    : [];
  const nextStepQueue = [
    ...recordStep,
    ...providerRepairSteps,
    ...controlRepairSteps,
    ...remediationSteps
  ].sort((left, right) => left.rank - right.rank);
  const readinessTone = valid
    ? 'ready'
    : readiness.terminalBlocked || blockingChecks.length > 0
      ? 'blocked'
      : readiness.degradedRecordable || warningChecks.length > 0
        ? 'warning'
        : 'pending';

  return {
    schema: `aios.kernel.lifecycle.exit.process-exit-ui-decision.v${PROCESS_EXIT_SCHEMA_VERSION}`,
    generatedAt: now,
    decisionKey: `${EVENT_NAMESPACE}:process-exit-ui:${tenantBoundary.scopeKey}:${runtime.requestId}:${outcome}`,
    preview: {
      headline: valid ? `Ready to record ${outcome}` : `${outcome} exit needs attention`,
      summary: valid
        ? controlGate.nextAction.reason
        : blockingReasons[0] || readiness.actionableErrors[0]?.message || `${outcome} process exit is waiting on validation.`,
      tone: readinessTone,
      badges: [
        `outcome:${outcome}`,
        `readiness:${readiness.status}`,
        `permission:${exitPermission.status}`,
        providerContract.ready ? 'providers:ready' : 'providers:repair',
        controlGate.enabled ? 'controls:enabled' : `controls:${controlGate.status}`,
        resolution.forcedOverride ? 'outcome:overridden' : `outcome-source:${resolution.source}`
      ],
      requestedOutcome: request.outcome,
      effectiveOutcome: outcome,
      outcomeSource: resolution.source,
      forcedOverride: resolution.forcedOverride
    },
    acceptance: {
      canRecord: valid,
      dryRun: controlGate.dispatchEnvelope.dryRun,
      command: controlGate.dispatchEnvelope.command,
      idempotencyKey: controlGate.dispatchEnvelope.idempotencyKey,
      requiredControls: controlGate.requiredControls,
      permissionStatus: exitPermission.status,
      disabledReasons: controlGate.dispatchEnvelope.blockedReasons,
      auditHandoffRequired: exitPermission.requiresAuditHandoff
    },
    readiness: {
      status: readiness.status,
      recordable: readiness.recordable,
      degradedRecordable: readiness.degradedRecordable,
      terminalBlocked: readiness.terminalBlocked,
      retryable: readiness.retry.retryable,
      nextRetryAt: readiness.retry.nextRetryAt,
      providerReady: providerContract.ready,
      blockedProviders: providerContract.blockedProviders,
      controlGateStatus: controlGate.status
    },
    validationSummary: {
      total: checks.length,
      passed: checks.length - failedChecks.length,
      failed: failedChecks.length,
      blocking: blockingChecks.length,
      warnings: warningChecks.length,
      checks: checks.map((check) => ({
        id: check.id,
        label: check.label,
        status: check.passed ? 'passed' : check.severity,
        blocking: !check.passed && check.severity === 'error',
        command: check.command
      }))
    },
    nextStepDataContract: {
      queueKey: `${EVENT_NAMESPACE}:process-exit-next-step:${tenantBoundary.scopeKey}:${runtime.requestId}:${outcome}`,
      empty: nextStepQueue.length === 0,
      primary: nextStepQueue[0] || null,
      queue: nextStepQueue.slice(0, 8),
      publishEvent: `${EVENT_NAMESPACE}.process-exit.next-step.ready`,
      explainability: {
        selectedFact: resolution.selectedFact,
        auditReason: resolution.audit.reason,
        blockingReasons,
        warningReasons: warningChecks.map((check) => check.label)
      }
    }
  };
}

function buildProcessExitWorkflowHandoffContract({
  outcome,
  request,
  resolution,
  valid,
  runtime,
  tenantBoundary,
  providerContract,
  workflowHandoff,
  controlGate,
  userDecision,
  now
}) {
  const strategy = PROCESS_EXIT_HANDOFF_STRATEGIES[outcome] || PROCESS_EXIT_HANDOFF_STRATEGIES.blocked;
  const providerHandoff = providerContract.externalHandoff;
  const resumeReady = Boolean(runtime.hasResumeToken || providerHandoff.resumeTokenRef || request.evidenceRefs.length > 0);
  const externalReady = Boolean(!strategy.requiresExternalHandoff || providerHandoff.ready || providerHandoff.resumeTokenRef);
  const routeBound = runtime.route === DEFAULT_ROUTE_MOUNT || runtime.route.startsWith(`${DEFAULT_ROUTE_MOUNT}/`);
  const canOpen = Boolean(valid && routeBound && externalReady && (!strategy.requiresResume || resumeReady));
  const blockedReasons = [
    ...(valid ? [] : userDecision.acceptance.disabledReasons),
    ...(routeBound ? [] : ['Active route must be rebound to the hosted-kernel exit-contract mount before workflow handoff.']),
    ...(strategy.requiresResume && !resumeReady ? ['Resume token or provider resume reference is required for completed workflow handoff.'] : []),
    ...(externalReady ? [] : [`${outcome} exit requires an external audit handoff target before leaving the route.`]),
    ...(workflowHandoff.pendingReasons || [])
  ].filter((reason, index, reasons) => reason && reasons.indexOf(reason) === index);
  const patchFields = {
    requestId: runtime.requestId,
    sessionId: runtime.sessionId,
    route: runtime.route,
    handoffTarget: runtime.handoffTarget,
    resumeTokenRef: providerHandoff.resumeTokenRef || (runtime.hasResumeToken ? 'clientRuntime.resumeToken' : null),
    processExitOutcome: outcome,
    processExitStatus: valid ? 'recordable' : 'blocked',
    userVisibleStatus: strategy.userVisibleStatus,
    workflowMode: strategy.mode,
    outcomeSource: resolution.source,
    forcedOverride: resolution.forcedOverride
  };
  const primaryStep = userDecision.nextStepDataContract.primary;

  return {
    schema: `aios.kernel.lifecycle.exit.process-exit-workflow-handoff.v${PROCESS_EXIT_SCHEMA_VERSION}`,
    generatedAt: now,
    handoffKey: `${EVENT_NAMESPACE}:process-exit-workflow:${tenantBoundary.scopeKey}:${runtime.requestId}:${outcome}`,
    outcome,
    mode: strategy.mode,
    label: strategy.label,
    userVisibleStatus: strategy.userVisibleStatus,
    requestedChannel: strategy.channel,
    target: providerHandoff.target || runtime.handoffTarget,
    canOpen,
    command: canOpen ? CONTROL_COMMANDS.handoff : primaryStep?.command || controlGate.nextAction.command,
    idempotencyKey: `${EVENT_NAMESPACE}:process-exit-workflow-handoff:${tenantBoundary.scopeKey}:${runtime.requestId}:${outcome}:${deriveFingerprint(patchFields)}`,
    blockedReasons,
    clientPatch: {
      command: `${EVENT_NAMESPACE}.client.workflow.handoff.patch`,
      strategy: strategy.clientPatchStrategy,
      dryRun: !canOpen,
      fields: patchFields
    },
    providerExport: {
      required: strategy.requiresExternalHandoff,
      ready: providerHandoff.ready,
      state: providerHandoff.state,
      target: providerHandoff.target,
      exportKey: providerHandoff.exportKey,
      requiredScope: providerHandoff.requiredScope,
      resumeTokenRef: providerHandoff.resumeTokenRef
    },
    nextStep: {
      queueKey: userDecision.nextStepDataContract.queueKey,
      primary: canOpen
        ? {
          id: `open-${outcome}-workflow-handoff`,
          label: strategy.label,
          command: CONTROL_COMMANDS.handoff,
          reason: `${outcome} process exit is ready for ${strategy.mode}.`
        }
        : primaryStep
    }
  };
}

function buildProcessExitPersistenceContract({
  outcome,
  request,
  resolution,
  valid,
  checks,
  readiness,
  controlGate,
  exitPermission,
  providerContract,
  workflowHandoffContract,
  persistedState,
  auditProof,
  runtime,
  tenantBoundary,
  boundaryContract,
  now
}) {
  const priorProcessExit = asRecord(persistedState.commandLedger.processExit);
  const priorResult = normalizeString(priorProcessExit.result || priorProcessExit.status, null);
  const priorOutcome = normalizeProcessExitOutcome(priorProcessExit.outcome || priorProcessExit.state, null)
    || (PROCESS_EXIT_OUTCOMES.has(persistedState.state) ? persistedState.state : null);
  const priorTerminal = Boolean(priorResult && TERMINAL_COMMAND_RESULTS.has(priorResult));
  const sameOutcomeReplay = Boolean(priorTerminal && priorOutcome === outcome);
  const outcomeConflict = Boolean(priorTerminal && priorOutcome && priorOutcome !== outcome);
  const restartDecision = outcomeConflict
    ? 'recover-conflicting-terminal-outcome'
    : sameOutcomeReplay
      ? 'dedupe-recorded-outcome'
      : valid
        ? 'record-terminal-outcome'
        : readiness.retry.retryable
          ? 'defer-until-retry'
          : 'hold-unrecorded-outcome';
  const statusAfterRestart = sameOutcomeReplay
    ? `${outcome}-restored`
    : valid
      ? `${outcome}-write-pending`
      : outcomeConflict
        ? 'terminal-outcome-conflict'
        : readiness.terminalBlocked
          ? 'terminal-recovery-required'
          : 'process-exit-blocked';
  const passedCheckIds = checks.filter((check) => check.passed).map((check) => check.id);
  const failedCheckIds = checks.filter((check) => !check.passed).map((check) => check.id);
  const priorAttempt = Number.isInteger(priorProcessExit.attempt) && priorProcessExit.attempt > 0
    ? priorProcessExit.attempt
    : 0;
  const terminalSnapshot = {
    version: PROCESS_EXIT_SCHEMA_VERSION,
    outcome,
    requestedOutcome: request.outcome,
    outcomeSource: resolution.source,
    forcedOverride: resolution.forcedOverride,
    state: outcome,
    status: valid ? 'recorded' : 'pending',
    recordedAt: valid ? now : null,
    requestedAt: request.requestedAt || now,
    requestedBy: request.actorId || tenantBoundary.principalId,
    reason: request.reason || resolution.audit.reason,
    tenantId: tenantBoundary.tenantId,
    workspaceId: tenantBoundary.workspaceId,
    principalId: tenantBoundary.principalId,
    requestId: runtime.requestId,
    sessionId: runtime.sessionId,
    scopeKey: tenantBoundary.scopeKey,
    route: runtime.route,
    proofFingerprint: auditProof.bundleFingerprint,
    proofCount: Math.max(auditProof.proofCount, persistedState.proofCount),
    checkSummary: {
      total: checks.length,
      passed: passedCheckIds.length,
      failed: failedCheckIds.length,
      failedCheckIds
    },
    providerContractKey: providerContract.contractKey,
    workflowHandoffKey: workflowHandoffContract.handoffKey,
    boundaryFingerprint: boundaryContract.boundaryFingerprint
  };
  const snapshotFingerprint = deriveFingerprint(terminalSnapshot);
  const statePatch = {
    command: `${EVENT_NAMESPACE}.process-exit.persist`,
    idempotencyKey: `${EVENT_NAMESPACE}:process-exit-persist:${tenantBoundary.scopeKey}:${runtime.requestId}:${outcome}:${snapshotFingerprint}`,
    dryRun: !valid || outcomeConflict,
    mergeStrategy: outcomeConflict
      ? 'manual-terminal-outcome-reconciliation'
      : persistedState.conflict.policy,
    compareAndSwap: {
      previousRevision: persistedState.revision,
      writeEpoch: persistedState.writeEpoch + 1,
      nextRevision: deriveFingerprint({
        writeModel: persistedState.writeModel.key,
        terminalSnapshot,
        priorOutcome,
        priorResult
      })
    },
    fields: {
      ...persistedState.writeModel,
      state: outcome,
      acceptedAt: outcome === 'done' ? persistedState.acceptedAt || now : persistedState.acceptedAt,
      proofCount: terminalSnapshot.proofCount,
      commandLedger: {
        ...persistedState.commandLedger,
        processExit: {
          command: `${EVENT_NAMESPACE}.process-exit.record`,
          result: valid ? 'completed' : 'pending',
          completedAt: valid ? now : null,
          idempotencyKey: `${EVENT_NAMESPACE}:process-exit-record:${tenantBoundary.scopeKey}:${runtime.requestId}:${outcome}:${snapshotFingerprint}`,
          attempt: Math.max(1, priorAttempt + (sameOutcomeReplay ? 0 : 1)),
          replayable: !valid,
          outcome,
          snapshotFingerprint
        }
      },
      processExit: terminalSnapshot,
      restartSafeStatus: statusAfterRestart
    }
  };
  const recoveryCommands = [
    ...(outcomeConflict ? [{
      id: 'reconcile-terminal-outcome',
      command: `${EVENT_NAMESPACE}.process-exit.reconcile`,
      idempotencyKey: `${EVENT_NAMESPACE}:process-exit-reconcile:${tenantBoundary.scopeKey}:${runtime.requestId}:${priorOutcome}:${outcome}`,
      reason: `Recovered terminal outcome ${priorOutcome} conflicts with effective outcome ${outcome}.`
    }] : []),
    ...(!sameOutcomeReplay && !valid ? [{
      id: 'persist-blocked-outcome-intent',
      command: statePatch.command,
      idempotencyKey: statePatch.idempotencyKey,
      reason: controlGate.dispatchEnvelope.blockedReasons[0] || readiness.actionableErrors[0]?.message || `${outcome} outcome is not recordable yet.`
    }] : []),
    ...(sameOutcomeReplay ? [{
      id: 'replay-terminal-outcome',
      command: `${EVENT_NAMESPACE}.process-exit.replay`,
      idempotencyKey: priorProcessExit.idempotencyKey || statePatch.fields.commandLedger.processExit.idempotencyKey,
      reason: `${outcome} process exit was already recorded; replay persisted terminal status without dispatching side effects.`
    }] : [])
  ];

  return {
    schema: `aios.kernel.lifecycle.exit.process-exit-persistence.v${PROCESS_EXIT_SCHEMA_VERSION}`,
    generatedAt: now,
    stateKey: persistedState.writeModel.key,
    outcome,
    restartDecision,
    restartSafeStatus: statusAfterRestart,
    idempotent: {
      priorOutcome,
      priorResult,
      priorTerminal,
      sameOutcomeReplay,
      outcomeConflict,
      recordResult: sameOutcomeReplay ? 'deduped' : valid ? 'completed' : 'pending'
    },
    terminalSnapshot,
    snapshotFingerprint,
    statePatch,
    recoveryCommands,
    recordableAfterRestart: valid && !outcomeConflict,
    blockedReasons: [
      ...(outcomeConflict ? [`Recovered terminal outcome ${priorOutcome} conflicts with ${outcome}.`] : []),
      ...(!valid ? controlGate.dispatchEnvelope.blockedReasons : []),
      ...(!exitPermission.allowed ? exitPermission.deniedReasons : []),
      ...(!providerContract.ready ? providerContract.blockedReasons : [])
    ].filter((reason, index, reasons) => reason && reasons.indexOf(reason) === index)
  };
}

function deriveProcessExitResolution({
  request,
  fallbackOutcome,
  acceptance,
  hasBlockingValidation,
  hasQuarantineSignal,
  hasKillSignal,
  boundaryContract,
  tenantBoundary,
  providerContracts,
  operationalHealth
}) {
  const requestedOutcome = request.outcome;
  const terminalComponents = operationalHealth.failureState.retryBudget.terminalComponents;
  const deadLetterCount = operationalHealth.failureState.deadLetter.length;
  const crossScopeEvents = providerContracts.eventStream.rejectedEvents
    .filter((event) => event.status === 'cross-scope')
    .map((event) => `${event.provider}:${event.eventType}`);
  const runtimeFacts = [
    ...(request.kill.reason || request.kill.signal ? [{
      id: 'requested-kill-signal',
      outcome: 'killed',
      precedence: 10,
      reason: request.kill.reason || request.kill.signal,
      source: 'processExit.kill'
    }] : []),
    ...(request.quarantine.reason ? [{
      id: 'requested-quarantine',
      outcome: 'quarantined',
      precedence: 20,
      reason: request.quarantine.reason,
      source: 'processExit.quarantine'
    }] : []),
    ...(boundaryContract.isolationRequired ? [{
      id: 'tenant-isolation-required',
      outcome: 'quarantined',
      precedence: 30,
      reason: 'Recovered state crosses the active tenant or workspace boundary.',
      source: 'tenantBoundary'
    }] : []),
    ...(boundaryContract.forkRequired ? [{
      id: 'request-fork-required',
      outcome: 'quarantined',
      precedence: 31,
      reason: 'Recovered state belongs to a different request and must be forked before writes.',
      source: 'persistedState'
    }] : []),
    ...(tenantBoundary.scopeDenied ? [{
      id: 'tenant-scope-denied',
      outcome: 'quarantined',
      precedence: 32,
      reason: `${tenantBoundary.scopeKey} is denied by tenant policy.`,
      source: 'tenantBoundary'
    }] : []),
    ...(crossScopeEvents.length > 0 ? [{
      id: 'provider-cross-scope-event',
      outcome: 'quarantined',
      precedence: 33,
      reason: `Provider events crossed scope: ${crossScopeEvents.join(', ')}.`,
      source: 'providerEvents'
    }] : []),
    ...(terminalComponents.length > 0 ? [{
      id: 'terminal-health-component',
      outcome: 'killed',
      precedence: 40,
      reason: `Terminal hosted-kernel components: ${terminalComponents.join(', ')}.`,
      source: 'operationalHealth'
    }] : []),
    ...(deadLetterCount > 0 ? [{
      id: 'dead-lettered-side-effects',
      outcome: 'killed',
      precedence: 41,
      reason: `${deadLetterCount} terminal side effect${deadLetterCount === 1 ? '' : 's'} require dead-letter handling.`,
      source: 'failureState'
    }] : []),
    ...(requestedOutcome === 'claim-submitted' ? [{
      id: 'submitted-exit-claim',
      outcome: 'claim-submitted',
      precedence: 60,
      reason: request.claim.id
        ? `Exit claim ${request.claim.id} was submitted.`
        : 'Exit claim submission was requested.',
      source: 'processExit.claim'
    }] : []),
    ...(hasBlockingValidation ? [{
      id: 'blocking-validation',
      outcome: 'blocked',
      precedence: 80,
      reason: 'Acceptance has blocking validation, settings, provider, or permission gaps.',
      source: 'acceptance'
    }] : [])
  ];
  const runtimeWinner = runtimeFacts
    .slice()
    .sort((left, right) => left.precedence - right.precedence)[0] || null;
  const requestedAllowed = requestedOutcome
    && (!runtimeWinner || runtimeWinner.outcome === requestedOutcome || (
      requestedOutcome === 'blocked' && runtimeWinner.outcome !== 'killed' && runtimeWinner.outcome !== 'quarantined'
    ));
  const selectedOutcome = requestedAllowed
    ? requestedOutcome
    : runtimeWinner?.outcome || fallbackOutcome;
  const forcedOverride = Boolean(requestedOutcome && requestedOutcome !== selectedOutcome);
  const source = forcedOverride
    ? runtimeWinner?.source || 'runtime-truth'
    : requestedOutcome
      ? 'request'
      : acceptance.canAccept
        ? 'acceptance'
        : 'fallback';

  return {
    requestedOutcome,
    selectedOutcome,
    source,
    forcedOverride,
    fallbackOutcome,
    runtimeFacts,
    selectedFact: runtimeWinner,
    truthSignals: {
      hasBlockingValidation,
      hasQuarantineSignal,
      hasKillSignal,
      terminalComponents,
      deadLetterCount,
      crossScopeEvents
    },
    audit: {
      reason: forcedOverride
        ? `Requested ${requestedOutcome} was overridden by ${runtimeWinner?.id || 'runtime-truth'}.`
        : runtimeWinner?.reason || (acceptance.canAccept ? 'Acceptance gates are satisfied.' : 'Exit remains blocked until acceptance gates pass.'),
      precedence: runtimeWinner?.precedence || null
    }
  };
}

function buildProcessExitContract({
  input,
  state,
  runtime,
  acceptance,
  validation,
  settingsValidation,
  operationalHealth,
  providerContracts,
  tenantBoundary,
  boundaryContract,
  lifecycleSettings,
  auditProof,
  persistedState,
  workflowHandoff,
  now
}) {
  const request = normalizeProcessExitRequest(input, state);
  const fallbackOutcome = acceptance.canAccept ? 'done' : 'blocked';
  const acceptanceBlocked = [
    ...acceptance.blockedByHealth,
    ...acceptance.blockedBySettings,
    ...acceptance.blockedByProviders,
    ...acceptance.blockedByPermissions
  ];
  const hasBlockingValidation = !validation.ok || !settingsValidation.ok || acceptanceBlocked.length > 0;
  const hasQuarantineSignal = boundaryContract.isolationRequired
    || boundaryContract.forkRequired
    || tenantBoundary.scopeDenied
    || providerContracts.eventStream.rejectedEvents.some((event) => event.status === 'cross-scope')
    || operationalHealth.failures.some((failure) => failure.severity === 'critical' && !failure.retryable);
  const hasKillSignal = Boolean(request.kill.reason || request.kill.signal)
    || operationalHealth.failureState.retryBudget.terminalComponents.length > 0
    || operationalHealth.failureState.deadLetter.length > 0;
  const resolution = deriveProcessExitResolution({
    request,
    fallbackOutcome,
    acceptance,
    hasBlockingValidation,
    hasQuarantineSignal,
    hasKillSignal,
    boundaryContract,
    tenantBoundary,
    providerContracts,
    operationalHealth
  });
  const outcome = resolution.selectedOutcome;
  const requestContract = buildProcessExitRequestContract({
    request,
    outcome,
    resolution,
    tenantBoundary,
    runtime,
    auditProof,
    now
  });
  const processExitProviderContract = buildProcessExitProviderContract({
    outcome,
    providerContracts,
    runtime,
    tenantBoundary,
    request,
    now
  });
  const exitPermission = buildProcessExitPermissionContract({
    outcome,
    request,
    runtime,
    tenantBoundary,
    boundaryContract,
    providerContracts,
    now
  });
  const checks = buildProcessExitOutcomeRequirements({
    outcome,
    state,
    request,
    requestContract,
    acceptance,
    acceptanceBlocked,
    auditProof,
    persistedState,
    workflowHandoff,
    boundaryContract,
    hasBlockingValidation,
    hasQuarantineSignal,
    hasKillSignal,
    operationalHealth,
    providerContracts,
    processExitProviderContract,
    tenantBoundary,
    exitPermission
  });
  const failed = checks.filter((check) => !check.passed);
  const blocking = failed.filter((check) => check.severity === 'error');
  const remediation = buildProcessExitRemediation({
    outcome,
    checks,
    runtime,
    tenantBoundary,
    request,
    resolution
  });
  const readiness = buildProcessExitOperationalReadiness({
    outcome,
    checks,
    remediation,
    operationalHealth,
    providerContracts,
    auditProof,
    runtime,
    tenantBoundary,
    request,
    now
  });
  const controlGate = buildProcessExitControlGate({
    outcome,
    request,
    readiness,
    exitPermission,
    remediation,
    lifecycleSettings,
    runtime,
    tenantBoundary,
    now
  });
  const exitKey = `${EVENT_NAMESPACE}:process-exit:${tenantBoundary.scopeKey}:${runtime.requestId}:${outcome}`;
  const valid = readiness.recordable && controlGate.enabled;
  const blockingReasons = [
    ...requestContract.blockingReasons,
    ...blocking.map((check) => check.label),
    ...processExitProviderContract.blockedReasons,
    ...(!controlGate.enabled ? controlGate.blockedReasons : [])
  ].filter((reason, index, reasons) => reason && reasons.indexOf(reason) === index);
  const userDecision = buildProcessExitUserDecisionContract({
    outcome,
    request,
    resolution,
    checks,
    readiness,
    controlGate,
    exitPermission,
    providerContract: processExitProviderContract,
    remediation,
    blockingReasons,
    valid,
    runtime,
    tenantBoundary,
    now
  });
  const workflowHandoffContract = buildProcessExitWorkflowHandoffContract({
    outcome,
    request,
    resolution,
    valid,
    runtime,
    tenantBoundary,
    providerContract: processExitProviderContract,
    workflowHandoff,
    controlGate,
    userDecision,
    now
  });
  const processExitPersistence = buildProcessExitPersistenceContract({
    outcome,
    request,
    resolution,
    valid,
    checks,
    readiness,
    controlGate,
    exitPermission,
    providerContract: processExitProviderContract,
    workflowHandoffContract,
    persistedState,
    auditProof,
    runtime,
    tenantBoundary,
    boundaryContract,
    now
  });

  return {
    schema: `aios.kernel.lifecycle.exit.process-exit.v${PROCESS_EXIT_SCHEMA_VERSION}`,
    generatedAt: now,
    exitKey,
    requested: request.requested,
    requestedOutcome: request.outcome,
    effectiveOutcome: resolution.selectedOutcome,
    outcomeSource: resolution.source,
    truthResolution: resolution,
    requestContract,
    outcome,
    terminal: TERMINAL_PROCESS_EXIT_OUTCOMES.has(outcome),
    valid,
    status: valid ? 'contract-satisfied' : 'contract-blocked',
    permission: exitPermission,
    providerContract: processExitProviderContract,
    checks,
    readiness,
    controlGate,
    userDecision,
    workflowHandoff: workflowHandoffContract,
    persistence: processExitPersistence,
    blockingReasons,
    warnings: failed.filter((check) => check.severity === 'warning').map((check) => check.label),
    remediation,
    ledgerEnvelope: {
      command: `${EVENT_NAMESPACE}.process-exit.record`,
      idempotencyKey: processExitPersistence.statePatch.fields.commandLedger.processExit.idempotencyKey,
      writes: [
        'persistedState.state',
        'persistedState.processExit',
        'persistedState.restartSafeStatus',
        'commandLedger.processExit',
        'analytics.exitOutcome'
      ],
      dryRun: processExitPersistence.statePatch.dryRun,
      subject: exitPermission.auditHandoff.subject,
      permissionFingerprint: exitPermission.auditHandoff.permissionFingerprint,
      auditHandoff: exitPermission.auditHandoff,
      restartDecision: processExitPersistence.restartDecision,
      restartSafeStatus: processExitPersistence.restartSafeStatus,
      statePatch: processExitPersistence.statePatch,
      recoveryCommands: processExitPersistence.recoveryCommands,
      providerContract: {
        contractKey: processExitProviderContract.contractKey,
        ready: processExitProviderContract.ready,
        requiredProviders: processExitProviderContract.requiredProviders,
        requiredSyncDomains: processExitProviderContract.requiredSyncDomains,
        externalHandoff: processExitProviderContract.externalHandoff
      },
      workflowHandoff: {
        handoffKey: workflowHandoffContract.handoffKey,
        mode: workflowHandoffContract.mode,
        canOpen: workflowHandoffContract.canOpen,
        command: workflowHandoffContract.command,
        clientPatchCommand: workflowHandoffContract.clientPatch.command,
        clientPatchStrategy: workflowHandoffContract.clientPatch.strategy
      },
      controlGate: controlGate.dispatchEnvelope,
      reason: request.reason || remediation.actions[0]?.reason || null
    },
    requestedBy: request.actorId || tenantBoundary.principalId,
    requestedAt: request.requestedAt,
    evidenceRefs: request.evidenceRefs,
    claim: outcome === 'claim-submitted' ? request.claim : null,
    kill: outcome === 'killed' ? request.kill : null,
    quarantine: outcome === 'quarantined' ? request.quarantine : null
  };
}

function normalizeScheduleWindow(value, now) {
  const source = asRecord(value);
  const mode = normalizeString(source.mode || source.strategy, 'manual');
  const allowedModes = ['manual', 'immediate', 'scheduled', 'disabled'];
  const runMode = allowedModes.includes(mode) ? mode : 'manual';
  const notBefore = normalizeString(source.notBefore || source.startAt || source.after, null);
  const expiresAt = normalizeString(source.expiresAt || source.deadline || source.until, null);
  const nowMs = Number.isFinite(Date.parse(now)) ? Date.parse(now) : Date.now();
  const notBeforeMs = Number.isFinite(Date.parse(notBefore)) ? Date.parse(notBefore) : null;
  const expiresAtMs = Number.isFinite(Date.parse(expiresAt)) ? Date.parse(expiresAt) : null;
  const blockedByClock = Boolean(notBeforeMs && nowMs < notBeforeMs);
  const expired = Boolean(expiresAtMs && nowMs > expiresAtMs);

  return {
    mode: runMode,
    notBefore,
    expiresAt,
    readyAt: blockedByClock ? notBefore : now,
    blockedByClock,
    expired,
    active: runMode !== 'disabled' && !expired && !blockedByClock
  };
}

function normalizeLifecycleSettings(input = {}, runtime, now) {
  const settings = asRecord(input.lifecycleSettings || input.settings || input.controls);
  const rawControls = asRecord(settings.controls || settings.commands || settings.lifecycleControls);
  const globalEnabled = settings.enabled !== false && settings.lifecycleEnabled !== false;
  const auditMode = normalizeString(settings.auditMode || settings.proofMode, 'required');
  const normalizedAuditMode = ['required', 'opportunistic', 'disabled'].includes(auditMode)
    ? auditMode
    : 'required';
  const safeMode = asBoolean(settings.safeMode || settings.requireValidation);
  const defaultSchedule = normalizeScheduleWindow(settings.schedule || settings.window, now);
  const controls = LIFECYCLE_CONTROL_KEYS.reduce((acc, key) => {
    const control = asRecord(rawControls[key]);
    const enabled = globalEnabled && control.enabled !== false;
    const schedule = normalizeScheduleWindow(control.schedule || control.window || settings[`${key}Schedule`], now);
    const effectiveSchedule = control.schedule || control.window || settings[`${key}Schedule`]
      ? schedule
      : defaultSchedule;
    const requiresProof = key === 'accept' && normalizedAuditMode === 'required';
    const requiresStableRequest = key === 'accept' || key === 'handoff';
    const disabledReasons = [
      ...(globalEnabled ? [] : ['Lifecycle controls are disabled by settings.']),
      ...(enabled ? [] : [`${key} control is disabled by settings.`]),
      ...(effectiveSchedule.expired ? [`${key} schedule window has expired.`] : []),
      ...(effectiveSchedule.blockedByClock ? [`${key} is scheduled for ${effectiveSchedule.readyAt}.`] : []),
      ...(requiresStableRequest && !runtime.hasStableRequest ? ['Stable request id is required.'] : [])
    ];

    acc[key] = {
      key,
      command: CONTROL_COMMANDS[key],
      enabled,
      schedule: effectiveSchedule,
      requiresProof,
      requiresStableRequest,
      available: enabled && effectiveSchedule.active && (!requiresStableRequest || runtime.hasStableRequest),
      disabledReasons
    };
    return acc;
  }, {});

  return {
    enabled: globalEnabled,
    auditMode: normalizedAuditMode,
    safeMode,
    schedule: defaultSchedule,
    controls,
    invalidControls: Object.keys(rawControls).filter((key) => !LIFECYCLE_CONTROL_KEYS.includes(key)),
    settingsVersion: Number.isInteger(settings.version) && settings.version > 0 ? settings.version : 1
  };
}

function validateLifecycleSettings({ lifecycleSettings, signals, evidence, validation }) {
  const checks = [
    {
      id: 'settings-enabled',
      label: 'Lifecycle controls enabled',
      passed: lifecycleSettings.enabled,
      severity: 'error'
    },
    {
      id: 'audit-mode-proof',
      label: 'Required audit mode has proof source',
      passed: lifecycleSettings.auditMode !== 'required' || signals.proofCaptured || evidence.length > 0,
      severity: 'warning'
    },
    {
      id: 'accept-control-ready',
      label: 'Accept control is enabled and inside schedule',
      passed: lifecycleSettings.controls.accept.available,
      severity: 'error'
    },
    {
      id: 'handoff-control-ready',
      label: 'Handoff control is enabled and inside schedule',
      passed: lifecycleSettings.controls.handoff.available,
      severity: 'warning'
    },
    {
      id: 'known-control-keys',
      label: 'Settings only contain supported lifecycle controls',
      passed: lifecycleSettings.invalidControls.length === 0,
      severity: 'warning'
    }
  ];
  const failed = checks.filter((check) => !check.passed);
  const blocking = failed.filter((check) => check.severity === 'error');

  return {
    ok: validation.ok && blocking.length === 0,
    checks,
    blockingReasons: blocking.map((check) => check.label),
    warnings: failed
      .filter((check) => check.severity === 'warning')
      .map((check) => check.label)
  };
}

function normalizeClientRuntime(input = {}) {
  const request = asRecord(input.request);
  const client = asRecord(input.client || input.clientRuntime);
  const workflow = asRecord(input.workflow || input.handoff);
  const route = normalizeString(
    client.route || client.path || request.route || request.path,
    DEFAULT_ROUTE_MOUNT
  );
  const handoffTarget = normalizeString(
    workflow.target || workflow.handoffTarget || client.handoffTarget,
    route
  );
  const runtime = {
    requestId: normalizeString(request.id || request.requestId || input.requestId, 'kernel-exit-preview'),
    sessionId: normalizeString(client.sessionId || request.sessionId || input.sessionId, null),
    route,
    handoffTarget,
    resumeToken: normalizeString(workflow.resumeToken || client.resumeToken || request.resumeToken, null)
  };

  return {
    ...runtime,
    hasStableRequest: runtime.requestId !== 'kernel-exit-preview',
    hasSessionBinding: Boolean(runtime.sessionId),
    hasResumeToken: Boolean(runtime.resumeToken),
    fieldCompleteness: CLIENT_RUNTIME_FIELDS.reduce((complete, field) => {
      complete[field] = Boolean(runtime[field]);
      return complete;
    }, {})
  };
}

function normalizeClientHandoffChannel(value) {
  const channel = normalizeString(value, 'same-tab');
  return CLIENT_HANDOFF_CHANNELS.has(channel) ? channel : 'same-tab';
}

function buildClientRuntimeStateContract({ input = {}, runtime, persistedState, tenantBoundary, providerContracts, now }) {
  const request = asRecord(input.request);
  const client = asRecord(input.client || input.clientRuntime);
  const router = asRecord(input.router || client.router || request.router);
  const workflow = asRecord(input.workflow || input.handoff);
  const navigation = asRecord(client.navigation || client.navigationState || request.navigationState || workflow.navigationState);
  const persistedResumeToken = normalizeString(persistedState.resumeToken, null);
  const activeResumeToken = runtime.resumeToken || persistedResumeToken;
  const routeFromClient = normalizeString(router.route || router.path || navigation.route || navigation.path, runtime.route);
  const routeMatchesRuntime = routeFromClient === runtime.route;
  const routeMatchesMount = runtime.route === DEFAULT_ROUTE_MOUNT || runtime.route.startsWith(`${DEFAULT_ROUTE_MOUNT}/`);
  const requestedChannel = normalizeClientHandoffChannel(workflow.channel || workflow.mode || client.handoffChannel);
  const missingFields = CLIENT_RUNTIME_FIELDS.filter((field) => !runtime.fieldCompleteness[field]);
  const recoverableFields = [
    ...(!runtime.resumeToken && persistedResumeToken ? ['resumeToken'] : []),
    ...(persistedState.lastKnownRoute && persistedState.lastKnownRoute !== runtime.route ? ['lastKnownRoute'] : [])
  ];
  const hydratedFields = CLIENT_RUNTIME_FIELDS.reduce((fields, field) => {
    fields[field] = runtime[field] || (field === 'resumeToken' ? persistedResumeToken : null);
    return fields;
  }, {});
  const stateKey = `${EVENT_NAMESPACE}:client-runtime:${tenantBoundary.scopeKey}:${runtime.requestId}`;
  const handoffExportKey = providerContracts.externalHandoff.exportKey
    || `${EVENT_NAMESPACE}:handoff:${tenantBoundary.scopeKey}:${runtime.requestId}:${runtime.handoffTarget}`;
  const routePatchRequired = !routeMatchesRuntime || persistedState.staleRoute || persistedState.conflict.present || recoverableFields.length > 0;
  const resumeRestorable = Boolean(activeResumeToken && runtime.hasSessionBinding && !persistedState.conflict.staleTenant && !persistedState.conflict.staleWorkspace);

  return {
    schema: `aios.kernel.lifecycle.exit.client-runtime-state.v${CLIENT_RUNTIME_STATE_SCHEMA_VERSION}`,
    generatedAt: now,
    stateKey,
    request: {
      requestId: runtime.requestId,
      stable: runtime.hasStableRequest,
      sessionId: runtime.sessionId,
      correlationKey: `${EVENT_NAMESPACE}:${runtime.requestId}:${runtime.sessionId || 'anonymous-session'}`,
      tenantBoundary: tenantBoundary.auditSubject,
      missingFields
    },
    route: {
      mount: DEFAULT_ROUTE_MOUNT,
      active: runtime.route,
      observedClientRoute: routeFromClient,
      matchesRuntime: routeMatchesRuntime,
      matchesMount: routeMatchesMount,
      lastKnownRoute: persistedState.lastKnownRoute,
      patchRequired: routePatchRequired,
      patchCommand: routePatchRequired ? `${EVENT_NAMESPACE}.client.runtime.patch` : null
    },
    resume: {
      tokenPresent: Boolean(runtime.resumeToken),
      persistedTokenPresent: Boolean(persistedResumeToken),
      activeTokenRef: activeResumeToken ? 'clientRuntime.resumeToken' : null,
      restorable: resumeRestorable,
      restoreCommand: !runtime.resumeToken && persistedResumeToken ? 'kernel.lifecycle.exit.resume.restore' : null,
      recoverableFields
    },
    hydrationPatch: {
      command: `${EVENT_NAMESPACE}.client.runtime.hydrate`,
      idempotencyKey: `${stateKey}:hydrate:${deriveFingerprint({ hydratedFields, routeFromClient })}`,
      dryRun: !routePatchRequired,
      fields: hydratedFields,
      mergeStrategy: persistedState.conflict.present
        ? persistedState.conflict.policy
        : routePatchRequired
          ? 'patch-client-runtime'
          : 'retain-client-runtime'
    },
    handoff: {
      requestedChannel,
      target: runtime.handoffTarget,
      exportKey: handoffExportKey,
      providerState: providerContracts.externalHandoff.state,
      providerReady: providerContracts.externalHandoff.ready,
      resumeTokenRef: providerContracts.externalHandoff.resumeTokenRef || (activeResumeToken ? 'clientRuntime.resumeToken' : null),
      userVisibleMode: resumeRestorable ? 'resume-existing-workflow' : 'open-new-workflow',
      blockedReasons: [
        ...(runtime.hasStableRequest ? [] : ['Stable request id is required before client handoff.']),
        ...(runtime.hasSessionBinding ? [] : ['Client session binding is missing.']),
        ...(activeResumeToken ? [] : ['Resume token is unavailable for workflow handoff.']),
        ...(routeMatchesMount ? [] : ['Active route is outside the hosted-kernel exit-contract mount.'])
      ]
    }
  };
}

function normalizeTenantBoundary(input = {}, runtime, now) {
  const tenant = asRecord(input.tenant || input.account || input.organization);
  const workspace = asRecord(input.workspace || input.project || input.scope);
  const actor = asRecord(input.actor || input.user || input.principal || input.identity);
  const policy = asRecord(input.policy || input.authorization || input.permissionsPolicy);
  const tenantId = normalizeString(tenant.id || tenant.tenantId || input.tenantId, null);
  const workspaceId = normalizeString(workspace.id || workspace.workspaceId || input.workspaceId, null);
  const principalId = normalizeString(actor.id || actor.userId || actor.principalId || input.principalId, null);
  const roles = normalizeStringList(actor.roles || actor.role || policy.roles || input.roles).map((role) => role.toLowerCase());
  const suppliedPermissions = normalizeStringList(
    actor.permissions || policy.permissions || input.permissions || input.grants
  );
  const roleGrantsAll = roles.some((role) => TENANT_PRIVILEGED_ROLES.has(role));
  const readonly = roles.some((role) => TENANT_READONLY_ROLES.has(role)) && !roleGrantsAll;
  const permissions = new Set([
    ...suppliedPermissions,
    ...(roleGrantsAll ? Object.values(TENANT_PERMISSION_REQUIREMENTS) : []),
    ...(readonly ? [TENANT_PERMISSION_REQUIREMENTS.preview] : [])
  ]);
  const scopeKey = `${tenantId || 'unscoped-tenant'}:${workspaceId || 'unscoped-workspace'}`;
  const allowedScopes = normalizeStringList(policy.allowedScopes || actor.allowedScopes || input.allowedScopes);
  const deniedScopes = normalizeStringList(policy.deniedScopes || actor.deniedScopes || input.deniedScopes);
  const scopeExplicitlyAllowed = allowedScopes.length === 0 || allowedScopes.includes(scopeKey) || allowedScopes.includes('*');
  const scopeDenied = deniedScopes.includes(scopeKey) || deniedScopes.includes('*');
  const commandAccess = Object.entries(TENANT_PERMISSION_REQUIREMENTS).reduce((acc, [control, permission]) => {
    const allowed = Boolean(tenantId && workspaceId && principalId && scopeExplicitlyAllowed && !scopeDenied && permissions.has(permission));
    acc[control] = {
      control,
      permission,
      allowed,
      deniedReasons: [
        ...(tenantId ? [] : ['Tenant id is required for hosted-kernel lifecycle controls.']),
        ...(workspaceId ? [] : ['Workspace id is required for hosted-kernel lifecycle controls.']),
        ...(principalId ? [] : ['Principal id is required for hosted-kernel lifecycle controls.']),
        ...(scopeExplicitlyAllowed ? [] : [`${scopeKey} is outside the principal scope grant.`]),
        ...(scopeDenied ? [`${scopeKey} is explicitly denied by tenant policy.`] : []),
        ...(permissions.has(permission) ? [] : [`Missing permission ${permission}.`])
      ]
    };
    return acc;
  }, {});
  const auditSubject = {
    tenantId,
    workspaceId,
    principalId,
    scopeKey,
    policyFingerprint: deriveFingerprint({
      tenantId,
      workspaceId,
      principalId,
      roles,
      permissions: [...permissions].sort(),
      allowedScopes,
      deniedScopes
    })
  };

  return {
    schema: 'aios.kernel.lifecycle.exit.tenant-boundary.v1',
    generatedAt: now,
    tenantId,
    workspaceId,
    principalId,
    roles,
    permissions: [...permissions].sort(),
    scopeKey,
    allowedScopes,
    deniedScopes,
    scopeExplicitlyAllowed,
    scopeDenied,
    isolated: Boolean(tenantId && workspaceId && principalId && scopeExplicitlyAllowed && !scopeDenied),
    readOnly: readonly,
    commandAccess,
    auditSubject,
    boundaryKey: `${EVENT_NAMESPACE}:tenant:${scopeKey}:${runtime.requestId}`,
    handoffScope: `${scopeKey}:${runtime.handoffTarget}`,
    violations: Object.values(commandAccess)
      .filter((entry) => !entry.allowed)
      .flatMap((entry) => entry.deniedReasons.map((reason) => ({
        control: entry.control,
        permission: entry.permission,
        reason
      })))
  };
}

function buildTenantBoundaryHandoffContract({ tenantBoundary, runtime, persistedState, now }) {
  const snapshotScopeKey = `${persistedState.tenantId || 'unscoped-tenant'}:${persistedState.workspaceId || 'unscoped-workspace'}`;
  const activeScopeKey = tenantBoundary.scopeKey;
  const sameTenant = persistedState.tenantId === tenantBoundary.tenantId;
  const sameWorkspace = persistedState.workspaceId === tenantBoundary.workspaceId;
  const sameRequest = persistedState.requestId === runtime.requestId;
  const cleanSnapshot = sameTenant && sameWorkspace && !persistedState.conflict.staleRequest;
  const isolationRequired = !sameTenant || !sameWorkspace;
  const forkRequired = sameTenant && sameWorkspace && !sameRequest;
  const boundaryFingerprint = deriveFingerprint({
    activeScopeKey,
    snapshotScopeKey,
    requestId: runtime.requestId,
    persistedRequestId: persistedState.requestId,
    permissions: tenantBoundary.permissions,
    policyFingerprint: tenantBoundary.auditSubject.policyFingerprint
  });
  const controls = LIFECYCLE_CONTROL_KEYS.reduce((acc, control) => {
    const access = tenantBoundary.commandAccess[control];
    const requirement = CONTROL_SCOPE_REQUIREMENTS[control];
    const snapshotSafe = !requirement.requiresCleanSnapshot || cleanSnapshot;
    const dispatchable = Boolean(access.allowed && tenantBoundary.isolated && snapshotSafe);
    const blockedReasons = [
      ...access.deniedReasons,
      ...(tenantBoundary.readOnly && requirement.access !== 'workspace-read'
        ? [`${control} requires ${requirement.access}, but the principal is read-only for this workspace.`]
        : []),
      ...(requirement.requiresCleanSnapshot && isolationRequired
        ? ['Recovered state must be isolated before this control can write tenant-scoped data.']
        : []),
      ...(requirement.requiresCleanSnapshot && forkRequired
        ? ['Recovered request must be forked before this control can write request-scoped data.']
        : [])
    ];

    acc[control] = {
      control,
      permission: access.permission,
      access: requirement.access,
      dispatchable,
      snapshotSafe,
      writeScope: {
        tenantId: tenantBoundary.tenantId,
        workspaceId: tenantBoundary.workspaceId,
        requestId: runtime.requestId,
        scopeKey: activeScopeKey,
        writes: requirement.writes
      },
      blockedReasons
    };
    return acc;
  }, {});
  const isolationActions = [
    ...(isolationRequired ? [{
      id: 'isolate-recovered-snapshot',
      command: 'kernel.lifecycle.exit.tenant.isolate',
      reason: 'Recovered snapshot is outside the active tenant/workspace boundary.',
      idempotencyKey: `${EVENT_NAMESPACE}:tenant-isolate:${activeScopeKey}:${snapshotScopeKey}:${runtime.requestId}`
    }] : []),
    ...(forkRequired ? [{
      id: 'fork-recovered-request',
      command: 'kernel.lifecycle.exit.state.fork',
      reason: 'Recovered snapshot is in scope but belongs to a different request.',
      idempotencyKey: `${EVENT_NAMESPACE}:tenant-fork:${activeScopeKey}:${persistedState.requestId}:${runtime.requestId}`
    }] : [])
  ];

  return {
    schema: `aios.kernel.lifecycle.exit.tenant-boundary.v${TENANT_BOUNDARY_SCHEMA_VERSION}`,
    generatedAt: now,
    boundaryKey: tenantBoundary.boundaryKey,
    boundaryFingerprint,
    mode: isolationRequired ? 'isolate-before-write' : forkRequired ? 'fork-before-write' : 'active-scope',
    activeScope: {
      tenantId: tenantBoundary.tenantId,
      workspaceId: tenantBoundary.workspaceId,
      principalId: tenantBoundary.principalId,
      scopeKey: activeScopeKey
    },
    recoveredScope: {
      tenantId: persistedState.tenantId,
      workspaceId: persistedState.workspaceId,
      requestId: persistedState.requestId,
      scopeKey: snapshotScopeKey
    },
    controls,
    safeToPreview: controls.preview.dispatchable,
    safeToWriteProof: controls.proof.dispatchable,
    safeToAccept: controls.accept.dispatchable,
    safeToHandoff: controls.handoff.dispatchable,
    isolationRequired,
    forkRequired,
    isolationActions,
    auditHandoffEnvelope: {
      subject: tenantBoundary.auditSubject,
      boundaryFingerprint,
      sourceScopeKey: snapshotScopeKey,
      targetScopeKey: activeScopeKey,
      requestId: runtime.requestId,
      sessionId: runtime.sessionId,
      handoffScope: tenantBoundary.handoffScope,
      policy: isolationRequired
        ? 'deny-cross-tenant-write'
        : forkRequired
          ? 'fork-before-write'
          : 'dispatch-with-active-scope',
      allowedControls: LIFECYCLE_CONTROL_KEYS.filter((control) => controls[control].dispatchable),
      blockedControls: LIFECYCLE_CONTROL_KEYS
        .filter((control) => !controls[control].dispatchable)
        .map((control) => ({
          control,
          reasons: controls[control].blockedReasons
        }))
    }
  };
}

function normalizePersistedExitState(input = {}, runtime, evidence, now, tenantBoundary) {
  const snapshot = asRecord(input.persistedState || input.snapshot || input.recoveredState);
  const persistedTenantId = normalizeString(snapshot.tenantId, tenantBoundary.tenantId);
  const persistedWorkspaceId = normalizeString(snapshot.workspaceId, tenantBoundary.workspaceId);
  const persistedRequestId = normalizeString(snapshot.requestId, runtime.requestId);
  const persistedState = normalizeString(snapshot.state, null);
  const state = EXIT_STATES.has(persistedState) ? persistedState : 'preview';
  const acceptedAt = normalizeString(snapshot.acceptedAt, null);
  const lastKnownRoute = normalizeString(snapshot.lastKnownRoute || snapshot.route, runtime.route);
  const resumeToken = normalizeString(snapshot.resumeToken, runtime.resumeToken);
  const proofCount = Number.isFinite(snapshot.proofCount) && snapshot.proofCount >= 0
    ? Math.floor(snapshot.proofCount)
    : evidence.length;
  const commandLedger = normalizeCommandLedger(snapshot.commandLedger || snapshot.commands);
  const version = Number.isInteger(snapshot.version) && snapshot.version > 0
    ? snapshot.version
    : 1;
  const staleRequest = Boolean(persistedRequestId && persistedRequestId !== runtime.requestId);
  const staleTenant = Boolean(persistedTenantId && persistedTenantId !== tenantBoundary.tenantId);
  const staleWorkspace = Boolean(persistedWorkspaceId && persistedWorkspaceId !== tenantBoundary.workspaceId);
  const staleRoute = Boolean(lastKnownRoute && lastKnownRoute !== runtime.route);
  const replayedAccept = commandLedger.accept?.result === 'completed' || Boolean(acceptedAt);
  const replayedProof = commandLedger.proof?.result === 'completed' || proofCount > 0;
  const revision = normalizeString(snapshot.revision || snapshot.etag || snapshot.cursor, null);
  const writeEpoch = Number.isInteger(snapshot.writeEpoch) && snapshot.writeEpoch >= 0
    ? snapshot.writeEpoch
    : 0;
  const recoveredAt = normalizeString(snapshot.recoveredAt || snapshot.loadedAt || snapshot.readAt, null);
  const dirtyFields = PERSISTED_STATE_FIELDS.filter((field) => {
    if (field === 'version') return version !== PERSISTED_STATE_VERSION;
    if (field === 'tenantId') return persistedTenantId !== tenantBoundary.tenantId;
    if (field === 'workspaceId') return persistedWorkspaceId !== tenantBoundary.workspaceId;
    if (field === 'requestId') return persistedRequestId !== runtime.requestId;
    if (field === 'lastKnownRoute') return lastKnownRoute !== runtime.route;
    if (field === 'resumeToken') return resumeToken !== runtime.resumeToken;
    if (field === 'proofCount') return proofCount !== evidence.length;
    return false;
  });

  return {
    version,
    targetVersion: PERSISTED_STATE_VERSION,
    migrationRequired: version < PERSISTED_STATE_VERSION,
    revision,
    writeEpoch,
    recoveredAt,
    tenantId: persistedTenantId,
    workspaceId: persistedWorkspaceId,
    requestId: persistedRequestId,
    state,
    acceptedAt,
    lastKnownRoute,
    resumeToken,
    proofCount,
    commandLedger,
    staleRequest,
    staleRoute,
    replayed: {
      accept: replayedAccept,
    proof: replayedProof,
      handoff: commandLedger.handoff?.result === 'completed'
    },
    dirtyFields,
    conflict: {
      present: staleTenant || staleWorkspace || staleRequest || staleRoute,
      staleTenant,
      staleWorkspace,
      staleRequest,
      staleRoute,
      policy: staleTenant || staleWorkspace
        ? 'isolate-tenant-workspace-before-write'
        : staleRequest
          ? 'fork-before-write'
          : staleRoute
            ? 'rebind-route-before-write'
            : 'upsert-active-request'
    },
    writeModel: {
      key: `${EVENT_NAMESPACE}:${tenantBoundary.scopeKey}:${runtime.requestId}`,
      version: PERSISTED_STATE_VERSION,
      previousRevision: revision,
      writeEpoch: writeEpoch + 1,
      fields: PERSISTED_STATE_FIELDS,
      updatedAt: now,
      tenantId: tenantBoundary.tenantId,
      workspaceId: tenantBoundary.workspaceId,
      requestId: runtime.requestId,
      state,
      lastKnownRoute: runtime.route,
      resumeToken: runtime.resumeToken,
      proofCount: evidence.length
    }
  };
}

function buildRestartPersistenceShape({
  persistedState,
  runtime,
  evidence,
  auditProof,
  providerContracts,
  tenantBoundary,
  boundaryContract,
  commands,
  recovery,
  restartSafeStatus,
  now
}) {
  const proofCommand = commands.find((command) => command.id === 'proof');
  const acceptCommand = commands.find((command) => command.id === 'accept');
  const handoffCommand = commands.find((command) => command.id === 'handoff');
  const snapshotMode = persistedState.conflict.staleTenant || persistedState.conflict.staleWorkspace
    ? 'isolate-snapshot'
    : persistedState.staleRequest
      ? 'fork-snapshot'
      : persistedState.migrationRequired
        ? 'migrate-snapshot'
        : persistedState.staleRoute
          ? 'rebind-route'
          : 'active-request';
  const fieldSources = PERSISTED_STATE_FIELDS.reduce((sources, field) => {
    const dirty = persistedState.dirtyFields.includes(field);
    sources[field] = {
      source: dirty ? 'runtime' : 'persisted',
      dirty,
      writable: providerContracts.stateWritable && !persistedState.conflict.staleTenant && !persistedState.conflict.staleWorkspace,
      valueRef: `persistedState.${field}`
    };
    return sources;
  }, {});
  const recoveryCheckpoints = [
    {
      id: 'snapshot-boundary',
      status: boundaryContract.isolationRequired
        ? 'isolate-required'
        : boundaryContract.forkRequired
          ? 'fork-required'
          : 'in-scope',
      command: boundaryContract.isolationActions[0]?.command || null,
      idempotencyKey: boundaryContract.isolationActions[0]?.idempotencyKey || null,
      blocking: boundaryContract.isolationRequired || boundaryContract.forkRequired
    },
    {
      id: 'state-version',
      status: persistedState.migrationRequired ? 'migration-required' : 'current',
      command: persistedState.migrationRequired ? 'kernel.lifecycle.exit.state.migrate' : null,
      idempotencyKey: persistedState.migrationRequired
        ? `${EVENT_NAMESPACE}:migrate:${tenantBoundary.scopeKey}:${runtime.requestId}:v${persistedState.targetVersion}`
        : null,
      blocking: persistedState.migrationRequired
    },
    {
      id: 'route-binding',
      status: persistedState.staleRoute ? 'patch-required' : 'bound',
      command: persistedState.staleRoute ? 'kernel.lifecycle.exit.route.rebind' : null,
      idempotencyKey: persistedState.staleRoute
        ? `${EVENT_NAMESPACE}:route:${tenantBoundary.scopeKey}:${runtime.requestId}:${runtime.route}`
        : null,
      blocking: false
    },
    {
      id: 'proof-ledger',
      status: auditProof.reconciliation.status,
      command: auditProof.reconciliation.repairCommand,
      idempotencyKey: `${EVENT_NAMESPACE}:proof-reconcile:${tenantBoundary.scopeKey}:${runtime.requestId}:${auditProof.bundleFingerprint}`,
      blocking: auditProof.reconciliation.persistedAhead
    },
    {
      id: 'acceptance-ledger',
      status: persistedState.replayed.accept
        ? 'already-accepted'
        : acceptCommand?.status === 'available'
          ? 'ready-to-commit'
          : acceptCommand?.status || 'blocked',
      command: acceptCommand?.command || CONTROL_COMMANDS.accept,
      idempotencyKey: acceptCommand?.idempotencyKey || `${EVENT_NAMESPACE}:accept:${tenantBoundary.scopeKey}:${runtime.requestId}`,
      blocking: acceptCommand?.status === 'blocked'
    },
    {
      id: 'handoff-ledger',
      status: persistedState.replayed.handoff
        ? 'already-opened'
        : handoffCommand?.status === 'available'
          ? 'ready-to-open'
          : handoffCommand?.status || 'blocked',
      command: handoffCommand?.command || CONTROL_COMMANDS.handoff,
      idempotencyKey: handoffCommand?.idempotencyKey || `${EVENT_NAMESPACE}:handoff:${tenantBoundary.scopeKey}:${runtime.requestId}:${runtime.handoffTarget}`,
      blocking: false
    }
  ];
  const commandReplay = commands.reduce((acc, command) => {
    const persisted = asRecord(persistedState.commandLedger[command.id]);
    const persistedResult = normalizeString(persisted.result || persisted.status, null);
    const terminal = persistedResult ? TERMINAL_COMMAND_RESULTS.has(persistedResult) : command.status === 'completed';
    acc[command.id] = {
      command: command.command,
      idempotencyKey: command.idempotencyKey,
      persistedResult,
      effectiveStatus: terminal ? 'deduped' : command.status,
      terminal,
      sideEffectPolicy: terminal
        ? 'return-persisted-result'
        : command.status === 'available'
          ? command.replayPolicy
          : 'do-not-dispatch',
      retryable: !terminal && command.status === 'available',
      writes: command.writes
    };
    return acc;
  }, {});
  const blockingCheckpoints = recoveryCheckpoints.filter((checkpoint) => checkpoint.blocking);
  const needsWrite = persistedState.dirtyFields.length > 0
    || recovery.actions.length > 0
    || Object.values(commandReplay).some((command) => command.effectiveStatus === 'available');
  const restartStatus = blockingCheckpoints.length > 0
    ? 'recovery-blocked'
    : recovery.mode === 'recovering'
      ? 'recovery-pending'
      : restartSafeStatus === 'accepted-after-restart'
        ? 'accepted-restored'
        : needsWrite
          ? 'write-pending'
          : 'stable';

  return {
    schema: `aios.kernel.lifecycle.exit.persistence-shape.v${PERSISTED_STATE_VERSION}`,
    generatedAt: now,
    stateKey: persistedState.writeModel.key,
    snapshotMode,
    restartStatus,
    restartSafeStatus,
    writeIntent: {
      required: needsWrite,
      providerWritable: providerContracts.stateWritable,
      compareAndSwapKey: `${persistedState.writeModel.key}:epoch:${persistedState.writeEpoch + 1}`,
      nextRevision: deriveFingerprint({
        key: persistedState.writeModel.key,
        fields: persistedState.writeModel,
        commandReplay,
        checkpoints: recoveryCheckpoints.map((checkpoint) => checkpoint.status)
      }),
      mergeStrategy: persistedState.conflict.policy
    },
    fieldSources,
    proofShape: {
      attachedEvidenceCount: evidence.length,
      persistedProofCount: persistedState.proofCount,
      status: auditProof.reconciliation.status,
      appendCommand: proofCommand?.command || CONTROL_COMMANDS.proof,
      appendIdempotencyKey: proofCommand?.idempotencyKey || auditProof.appendEnvelope.idempotencyKey
    },
    recoveryCheckpoints,
    commandReplay,
    userVisibleStatus: {
      label: restartStatus === 'accepted-restored'
        ? 'Accepted state restored'
        : restartStatus === 'recovery-blocked'
          ? 'Recovery blocked'
          : restartStatus === 'write-pending'
            ? 'Saving recovered state'
            : restartStatus === 'recovery-pending'
              ? 'Recovering hosted kernel state'
              : 'State is restart safe',
      blockingReasons: blockingCheckpoints.map((checkpoint) => `${checkpoint.id}: ${checkpoint.status}`),
      nextCommand: blockingCheckpoints[0]?.command || recovery.actions[0]?.command || null
    }
  };
}

function buildPersistedStateContract({
  persistedState,
  runtime,
  state,
  acceptance,
  auditProof,
  providerContracts,
  tenantBoundary,
  boundaryContract,
  commands,
  recovery,
  persistenceShape,
  restartSafeStatus,
  now
}) {
  const commandLedgerPatch = commands.reduce((ledger, command) => {
    const prior = asRecord(persistedState.commandLedger[command.id]);
    const completed = command.status === 'completed';
    ledger[command.id] = {
      command: command.command,
      idempotencyKey: command.idempotencyKey,
      desiredStatus: command.status,
      persistedResult: normalizeString(prior.result, null),
      terminal: completed || TERMINAL_COMMAND_RESULTS.has(normalizeString(prior.result, 'unknown')),
      replayPolicy: command.replayPolicy,
      writes: command.writes
    };
    return ledger;
  }, {});
  const desiredState = acceptance.canAccept || persistedState.replayed.accept ? 'accepted' : state;
  const proofCount = Math.max(auditProof.proofCount, persistedState.proofCount);
  const canWriteActiveState = providerContracts.stateWritable && !persistedState.conflict.present;
  const writeBlockedReasons = [
    ...(providerContracts.stateWritable ? [] : ['Persistence provider is not writable.']),
    ...(persistedState.conflict.staleTenant ? ['Recovered tenant differs from active tenant.'] : []),
    ...(persistedState.conflict.staleWorkspace ? ['Recovered workspace differs from active workspace.'] : []),
    ...(persistedState.staleRequest ? ['Recovered request differs from active request.'] : []),
    ...(persistedState.staleRoute ? ['Recovered route differs from active route.'] : []),
    ...(auditProof.reconciliation.persistedAhead ? ['Persisted proof ledger is ahead of attached evidence.'] : [])
  ];
  const safeToWrite = canWriteActiveState && writeBlockedReasons.length === 0;
  const durableState = {
    ...persistedState.writeModel,
    state: desiredState,
    acceptedAt: desiredState === 'accepted' ? persistedState.acceptedAt || now : null,
    proofCount,
    commandLedger: commandLedgerPatch,
    persistenceShape: {
      schema: persistenceShape.schema,
      snapshotMode: persistenceShape.snapshotMode,
      restartStatus: persistenceShape.restartStatus,
      writeIntent: persistenceShape.writeIntent
    },
    restartSafeStatus
  };
  const statePatch = {
    schema: `aios.kernel.lifecycle.exit.persisted-state.v${PERSISTED_STATE_VERSION}`,
    key: persistedState.writeModel.key,
    mergeStrategy: persistedState.conflict.policy,
    compareAndSwap: {
      previousRevision: persistedState.revision,
      nextRevision: deriveFingerprint(durableState),
      writeEpoch: persistedState.writeEpoch + 1
    },
    fields: durableState
  };
  const recoveryReplay = recovery.actions.map((action) => ({
    id: action.id,
    command: action.command,
    idempotencyKey: action.idempotencyKey,
    reason: action.reason,
    safeToRun: action.id !== 'fork-recovered-request' || persistedState.staleRequest
  }));

  return {
    schema: `aios.kernel.lifecycle.exit.persisted-recovery.v${PERSISTED_STATE_VERSION}`,
    generatedAt: now,
    requestId: runtime.requestId,
    status: safeToWrite
      ? (recovery.mode === 'recovering' ? 'write-after-recovery' : 'write-ready')
      : 'write-blocked',
    restartSafeStatus,
    sourceSnapshot: {
      tenantId: persistedState.tenantId,
      workspaceId: persistedState.workspaceId,
      requestId: persistedState.requestId,
      version: persistedState.version,
      revision: persistedState.revision,
      writeEpoch: persistedState.writeEpoch,
      recoveredAt: persistedState.recoveredAt,
      state: persistedState.state,
      route: persistedState.lastKnownRoute,
      proofCount: persistedState.proofCount
    },
    dirtyFields: persistedState.dirtyFields,
    conflict: persistedState.conflict,
    writeBlockedReasons,
    safeToWrite,
    durableState,
    statePatch,
    recoveryReplay,
    persistenceShape,
    idempotentLedger: {
      namespace: EVENT_NAMESPACE,
      commands: commandLedgerPatch,
      completedControls: Object.entries(commandLedgerPatch)
        .filter(([, entry]) => entry.terminal)
        .map(([id]) => id),
      replayableControls: Object.entries(commandLedgerPatch)
        .filter(([, entry]) => !entry.terminal)
        .map(([id]) => id)
    }
  };
}

function commandLedgerHasFailure(commandLedger) {
  return Object.values(asRecord(commandLedger)).some((entry) => {
    const result = normalizeString(asRecord(entry).result, 'unknown');
    return ['failed', 'error', 'timeout', 'rejected'].includes(result);
  });
}

function getCommandLedgerFailures(commandLedger, now) {
  return Object.values(asRecord(commandLedger))
    .map((entry, index) => asRecord(entry))
    .filter((entry) => FAILED_COMMAND_RESULTS.has(normalizeString(entry.result || entry.status, 'unknown')))
    .map((entry, index) => {
      const command = normalizeString(entry.command || entry.id || `ledger-command-${index + 1}`, `ledger-command-${index + 1}`);
      return {
        id: `ledger-${command}`,
        component: 'command-bus',
        code: `${EVENT_NAMESPACE}.command.${normalizeString(entry.result || entry.status, 'failed')}`,
        message: normalizeString(entry.message || entry.reason, `${command} failed in the persisted command ledger.`),
        severity: normalizeString(entry.result || entry.status, 'failed') === 'rejected' ? 'error' : 'warning',
        retryable: entry.replayable !== false && normalizeString(entry.result || entry.status, 'failed') !== 'rejected',
        attempt: Number.isInteger(entry.attempt) && entry.attempt > 0 ? entry.attempt : 1,
        observedAt: normalizeString(entry.completedAt || entry.at || entry.observedAt, now),
        idempotencyKey: normalizeString(entry.idempotencyKey, `${EVENT_NAMESPACE}:ledger:${command}`)
      };
    });
}

function buildValidationSummary({ signals, evidence, state, tenantBoundary, boundaryContract }) {
  const checks = [
    {
      id: 'hosted-kernel-boot',
      label: 'Hosted kernel boot proof',
      passed: signals.hostedKernelBooted,
      severity: 'error'
    },
    {
      id: 'route-mounted',
      label: 'Client route integration',
      passed: signals.routeMounted,
      severity: 'error'
    },
    {
      id: 'preview-rendered',
      label: 'User-visible preview contract',
      passed: signals.previewRendered,
      severity: 'warning'
    },
    {
      id: 'proof-captured',
      label: 'Audit proof attachment',
      passed: signals.proofCaptured || evidence.length > 0,
      severity: 'warning'
    },
    {
      id: 'tenant-boundary',
      label: 'Tenant and workspace boundary',
      passed: tenantBoundary.isolated,
      severity: 'error'
    },
    {
      id: 'tenant-preview-permission',
      label: 'Preview permission',
      passed: tenantBoundary.commandAccess.preview.allowed && boundaryContract.safeToPreview,
      severity: 'error'
    },
    {
      id: 'workspace-write-boundary',
      label: 'Workspace write boundary',
      passed: boundaryContract.safeToWriteProof,
      severity: 'error'
    },
    {
      id: 'accept-boundary',
      label: 'Accept writes stay inside tenant workspace',
      passed: boundaryContract.safeToAccept,
      severity: 'error'
    }
  ];
  const failed = checks.filter((check) => !check.passed);
  const blocking = failed.filter((check) => check.severity === 'error');
  return {
    ok: blocking.length === 0 && state !== 'blocked',
    passedCount: checks.length - failed.length,
    failedCount: failed.length,
    checks,
    blockingReasons: blocking.map((check) => check.label)
  };
}

function buildRetryAdvice(failures, now) {
  const retryableFailures = failures.filter((failure) => failure.retryable);
  if (retryableFailures.length === 0) {
    return {
      retryable: false,
      nextRetryAt: null,
      maxBackoffMs: 0,
      retryCommands: []
    };
  }

  const maxAttempt = retryableFailures.reduce((max, failure) => Math.max(max, failure.attempt), 1);
  const backoffMs = RETRY_BACKOFF_MS[Math.min(maxAttempt - 1, RETRY_BACKOFF_MS.length - 1)];
  const nowMs = Number.isFinite(Date.parse(now)) ? Date.parse(now) : Date.now();
  const nextRetryAt = new Date(nowMs + backoffMs).toISOString();
  return {
    retryable: true,
    nextRetryAt,
    maxBackoffMs: backoffMs,
    retryCommands: retryableFailures.map((failure) => ({
      id: `retry-${failure.id}`,
      command: `${EVENT_NAMESPACE}.health.retry`,
      component: failure.component,
      idempotencyKey: `${EVENT_NAMESPACE}:retry:${failure.component}:${failure.code}:${maxAttempt}`,
      afterMs: backoffMs
    }))
  };
}

function buildFailureStateContract({ failures, components, persistedState, providerContracts, now }) {
  const nowMs = Number.isFinite(Date.parse(now)) ? Date.parse(now) : Date.now();
  const ledgerFailures = getCommandLedgerFailures(persistedState.commandLedger, now);
  const knownFailureIds = new Set(failures.map((failure) => failure.id));
  const allFailures = [
    ...failures,
    ...ledgerFailures.filter((failure) => !knownFailureIds.has(failure.id))
  ];
  const byComponent = HEALTH_COMPONENTS.reduce((acc, component) => {
    const componentHealth = components.find((entry) => entry.component === component);
    const componentFailures = allFailures.filter((failure) => failure.component === component);
    const maxAttempt = componentFailures.reduce((max, failure) => Math.max(max, failure.attempt || 1), 1);
    const retryable = componentFailures.some((failure) => failure.retryable) || Boolean(componentHealth?.retryable && componentHealth.status !== 'healthy');
    const terminal = componentFailures.some((failure) => failure.severity === 'critical' && !failure.retryable);
    const exhausted = retryable && maxAttempt >= RETRY_BACKOFF_MS.length;
    const backoffMs = retryable && !terminal
      ? RETRY_BACKOFF_MS[Math.min(maxAttempt - 1, RETRY_BACKOFF_MS.length - 1)]
      : null;
    const status = terminal
      ? 'terminal'
      : exhausted
        ? 'retry-exhausted'
        : componentHealth?.status === 'failed'
          ? 'failed'
          : componentHealth?.status === 'degraded'
            ? 'degraded'
            : componentFailures.length > 0
              ? 'recovering'
              : 'healthy';

    acc[component] = {
      component,
      status,
      attempt: componentFailures.length > 0 ? maxAttempt : 0,
      retryable,
      retryExhausted: exhausted,
      nextRetryAt: backoffMs === null ? null : new Date(nowMs + backoffMs).toISOString(),
      backoffMs,
      degradedCapabilities: status === 'degraded' || status === 'recovering'
        ? DEGRADED_COMPONENT_CAPABILITIES[component] || []
        : [],
      failureIds: componentFailures.map((failure) => failure.id),
      providerSyncFresh: providerContracts.providers
        .filter((provider) => provider.key === component)
        .every((provider) => !provider.sync.required || provider.sync.fresh),
      ledgerBlocked: ledgerFailures.some((failure) => failure.component === component)
    };
    return acc;
  }, {});
  const degradedCapabilities = [...new Set(Object.values(byComponent).flatMap((entry) => entry.degradedCapabilities))].sort();
  const terminalComponents = Object.values(byComponent).filter((entry) => entry.status === 'terminal').map((entry) => entry.component);
  const exhaustedComponents = Object.values(byComponent).filter((entry) => entry.retryExhausted).map((entry) => entry.component);

  return {
    schema: `aios.kernel.lifecycle.exit.failure-state.v${FAILURE_STATE_SCHEMA_VERSION}`,
    generatedAt: now,
    retryBudget: {
      maxAttempts: RETRY_BACKOFF_MS.length,
      backoffMs: RETRY_BACKOFF_MS,
      exhaustedComponents,
      terminalComponents
    },
    components: byComponent,
    degradedCapabilities,
    deadLetter: allFailures
      .filter((failure) => {
        const componentState = byComponent[failure.component];
        return componentState?.retryExhausted || componentState?.status === 'terminal';
      })
      .map((failure) => ({
        id: `${EVENT_NAMESPACE}:dead-letter:${failure.component}:${failure.id}`,
        component: failure.component,
        code: failure.code,
        severity: failure.severity,
        reason: failure.message,
        command: `${EVENT_NAMESPACE}.health.dead-letter`,
        retryable: failure.retryable,
        idempotencyKey: failure.idempotencyKey || `${EVENT_NAMESPACE}:dead-letter:${failure.component}:${failure.code}`
      })),
    capabilities: {
      preview: !terminalComponents.includes('hosted-kernel') && !terminalComponents.includes('route-mount'),
      proofCapture: !terminalComponents.includes('proof-sink') && !exhaustedComponents.includes('proof-sink'),
      accept: terminalComponents.length === 0 && exhaustedComponents.length === 0 && providerContracts.stateWritable,
      handoff: terminalComponents.length === 0 && providerContracts.externalHandoff.ready
    }
  };
}

function buildHealthRemediationPlan({ failureState, failures, components, runtime, tenantBoundary, providerContracts, now }) {
  const componentByKey = components.reduce((acc, component) => {
    acc[component.component] = component;
    return acc;
  }, {});
  const providerByKey = providerContracts.providers.reduce((acc, provider) => {
    acc[provider.key] = provider;
    return acc;
  }, {});
  const remediationOrder = [
    'hosted-kernel',
    'route-mount',
    'session-binding',
    'proof-sink',
    'persistence',
    'command-bus',
    'handoff-gateway',
    'preview-renderer'
  ];
  const unhealthyComponents = remediationOrder
    .map((component) => failureState.components[component])
    .filter((component) => component && component.status !== 'healthy');
  const runbooks = unhealthyComponents.map((componentState, index) => {
    const component = componentState.component;
    const uiComponent = componentByKey[component];
    const provider = providerByKey[component] || null;
    const componentFailures = failures.filter((failure) => failure.component === component);
    const needsProviderSync = Boolean(provider?.sync?.required && !provider.sync.fresh);
    const canRetry = componentState.retryable && !componentState.retryExhausted && componentState.status !== 'terminal';
    const retryCommand = canRetry
      ? {
        command: `${EVENT_NAMESPACE}.health.retry`,
        idempotencyKey: `${EVENT_NAMESPACE}:remediate:${tenantBoundary.scopeKey}:${runtime.requestId}:${component}:${componentState.attempt + 1}`,
        notBefore: componentState.nextRetryAt,
        afterMs: componentState.backoffMs,
        attempt: componentState.attempt + 1
      }
      : null;
    const proofKey = `${EVENT_NAMESPACE}:health-proof:${tenantBoundary.scopeKey}:${runtime.requestId}:${component}`;
    const validationGates = [
      {
        id: `${component}-component-healthy`,
        label: `${component} reports healthy or degraded`,
        passed: componentState.status === 'healthy' || componentState.status === 'degraded'
      },
      {
        id: `${component}-retry-budget`,
        label: `${component} retry budget remains available`,
        passed: !componentState.retryExhausted && componentState.status !== 'terminal'
      },
      {
        id: `${component}-provider-sync`,
        label: `${component} provider sync cursor is fresh when required`,
        passed: !needsProviderSync
      }
    ];

    return {
      id: `remediate-${component}`,
      rank: index + 1,
      component,
      status: componentState.status,
      mode: componentState.status === 'terminal' || componentState.retryExhausted
        ? 'operator-intervention'
        : componentState.status === 'degraded'
          ? 'degraded-service'
          : 'automated-recovery',
      userVisibleLabel: componentState.status === 'degraded'
        ? `Continue with degraded ${component}`
        : `Repair ${component}`,
      primaryCommand: componentState.status === 'terminal' || componentState.retryExhausted
        ? `${EVENT_NAMESPACE}.health.dead-letter`
        : uiComponent?.remediationCommand || `${EVENT_NAMESPACE}.health.inspect`,
      retryCommand,
      providerRefreshCommand: needsProviderSync
        ? {
          command: `${EVENT_NAMESPACE}.provider.sync`,
          provider: component,
          checkpointKey: `${EVENT_NAMESPACE}:provider:${component}:${runtime.requestId}`,
          cursor: provider?.sync?.cursor || null,
          idempotencyKey: `${EVENT_NAMESPACE}:provider-sync:${tenantBoundary.scopeKey}:${runtime.requestId}:${component}`
        }
        : null,
      degradedCapabilities: componentState.degradedCapabilities,
      validationGates,
      failureIds: componentState.failureIds,
      failureCodes: componentFailures.map((failure) => failure.code),
      proofRequired: componentState.status !== 'healthy',
      proofEnvelope: {
        key: proofKey,
        command: `${EVENT_NAMESPACE}.health.proof.capture`,
        idempotencyKey: `${proofKey}:${deriveFingerprint({
          status: componentState.status,
          failures: componentState.failureIds,
          nextRetryAt: componentState.nextRetryAt
        })}`,
        subject: tenantBoundary.auditSubject,
        requestId: runtime.requestId,
        route: runtime.route
      },
      blockedReasons: [
        ...componentFailures.map((failure) => failure.message),
        ...(componentState.retryExhausted ? [`${component} retry budget is exhausted.`] : []),
        ...(componentState.status === 'terminal' ? [`${component} requires operator intervention.`] : []),
        ...(needsProviderSync ? [`${component} provider sync must be refreshed.`] : [])
      ]
    };
  });
  const nextRunbook = runbooks.find((runbook) => runbook.mode === 'automated-recovery')
    || runbooks.find((runbook) => runbook.mode === 'degraded-service')
    || runbooks[0]
    || null;

  return {
    schema: `aios.kernel.lifecycle.exit.health-remediation.v${FAILURE_STATE_SCHEMA_VERSION}`,
    generatedAt: now,
    requestId: runtime.requestId,
    tenantBoundary: tenantBoundary.auditSubject,
    mode: failureState.retryBudget.terminalComponents.length > 0
      ? 'terminal'
      : failureState.retryBudget.exhaustedComponents.length > 0
        ? 'retry-exhausted'
        : runbooks.some((runbook) => runbook.mode === 'degraded-service')
          ? 'degraded'
          : runbooks.length > 0
            ? 'recovering'
            : 'healthy',
    nextRunbookId: nextRunbook?.id || null,
    nextCommand: nextRunbook?.retryCommand?.command || nextRunbook?.providerRefreshCommand?.command || nextRunbook?.primaryCommand || null,
    runbooks,
    degradedModeContract: {
      enabled: runbooks.some((runbook) => runbook.mode === 'degraded-service'),
      capabilities: failureState.degradedCapabilities,
      acceptBlocked: !failureState.capabilities.accept,
      handoffBlocked: !failureState.capabilities.handoff
    },
    auditProofs: runbooks.map((runbook) => runbook.proofEnvelope)
  };
}

function buildOperationalHealth({ input, signals, evidence, runtime, persistedState, validation, providerContracts, tenantBoundary, now }) {
  const suppliedHealth = asRecord(input.health || input.operationalHealth || input.kernelHealth);
  const suppliedFailures = normalizeFailureEvents(input.failures || input.errors || suppliedHealth.failures);
  const ledgerFailed = commandLedgerHasFailure(persistedState.commandLedger);
  const routeIsExpected = runtime.route === DEFAULT_ROUTE_MOUNT || runtime.route.startsWith(`${DEFAULT_ROUTE_MOUNT}/`);
  const componentChecks = [
    {
      component: 'hosted-kernel',
      label: 'Hosted kernel process',
      ok: signals.hostedKernelBooted,
      degraded: false,
      action: 'kernel.lifecycle.exit.boot.verify',
      message: 'Hosted kernel boot proof is missing.'
    },
    {
      component: 'route-mount',
      label: 'Hosted route mount',
      ok: signals.routeMounted && routeIsExpected,
      degraded: signals.routeMounted && !routeIsExpected,
      action: 'kernel.lifecycle.exit.route.rebind',
      message: routeIsExpected
        ? 'Hosted route mount signal is missing.'
        : 'Hosted route is mounted outside the exit-contract route contract.'
    },
    {
      component: 'preview-renderer',
      label: 'Preview renderer',
      ok: signals.previewRendered,
      degraded: signals.routeMounted,
      action: 'kernel.lifecycle.exit.preview',
      message: 'Preview renderer has not confirmed a visible hosted-kernel frame.'
    },
    {
      component: 'proof-sink',
      label: 'Audit proof sink',
      ok: signals.proofCaptured || evidence.length > 0,
      degraded: validation.ok,
      action: 'kernel.lifecycle.exit.proof',
      message: 'Audit proof sink has no captured proof for this exit contract.'
    },
    {
      component: 'persistence',
      label: 'Persisted exit state',
      ok: !persistedState.migrationRequired && !persistedState.staleRequest,
      degraded: persistedState.migrationRequired || persistedState.staleRoute,
      action: persistedState.migrationRequired
        ? 'kernel.lifecycle.exit.state.migrate'
        : 'kernel.lifecycle.exit.state.fork',
      message: persistedState.staleRequest
        ? 'Recovered state belongs to another request and must be isolated before accepting.'
        : 'Persisted exit state requires reconciliation before restart-safe acceptance.'
    },
    {
      component: 'session-binding',
      label: 'Client session binding',
      ok: runtime.hasSessionBinding && runtime.hasResumeToken,
      degraded: true,
      action: 'kernel.lifecycle.exit.resume.restore',
      message: 'Client session or resume token is missing; handoff may reopen without in-progress state.'
    },
    {
      component: 'command-bus',
      label: 'Tenant permission boundary',
      ok: tenantBoundary.isolated && tenantBoundary.commandAccess.preview.allowed,
      degraded: tenantBoundary.isolated,
      action: 'kernel.lifecycle.exit.permissions.request',
      message: tenantBoundary.violations[0]?.reason || 'Tenant/workspace permission boundary is not satisfied.'
    },
    {
      component: 'command-bus',
      label: 'Idempotent command bus',
      ok: !ledgerFailed,
      degraded: false,
      action: 'kernel.lifecycle.exit.command.reconcile',
      message: 'Command ledger contains a failed hosted-kernel lifecycle command.'
    },
    {
      component: 'handoff-gateway',
      label: 'External handoff gateway',
      ok: providerContracts.externalHandoff.ready,
      degraded: providerContracts.ok && runtime.hasStableRequest,
      action: 'kernel.lifecycle.exit.handoff.provider.negotiate',
      message: 'External handoff gateway has not negotiated resume-token handoff capability.'
    }
  ];
  const suppliedStatus = normalizeString(suppliedHealth.status, null);
  const components = componentChecks.map((check) => {
    const matchingFailure = suppliedFailures.find((failure) => failure.component === check.component);
    const status = matchingFailure?.severity === 'critical'
      ? 'failed'
      : check.ok
        ? 'healthy'
        : check.degraded
          ? 'degraded'
          : 'failed';
    return {
      component: check.component,
      label: check.label,
      status,
      actionable: status !== 'healthy',
      retryable: Boolean(matchingFailure?.retryable ?? status !== 'healthy'),
      remediationCommand: check.action,
      message: matchingFailure?.message || check.message
    };
  });
  const failures = [
    ...suppliedFailures,
    ...getCommandLedgerFailures(persistedState.commandLedger, now),
    ...providerContracts.failedProviders.map((provider) => ({
      id: `${provider.key}-provider-contract`,
      component: HEALTH_COMPONENTS.includes(provider.key) ? provider.key : 'hosted-kernel',
      code: `${EVENT_NAMESPACE}.provider.contract`,
      message: provider.missingCapabilities.length > 0
        ? `${provider.key} provider is missing required capabilities: ${provider.missingCapabilities.join(', ')}.`
        : `${provider.key} provider is ${provider.status}.`,
      severity: provider.status === 'offline' || provider.status === 'unauthorized' ? 'critical' : 'error',
      retryable: provider.status !== 'unauthorized',
      attempt: 1,
      observedAt: now
    })),
    ...providerContracts.staleSyncProviders.map((key) => ({
      id: `${key}-provider-sync-stale`,
      component: HEALTH_COMPONENTS.includes(key) ? key : 'hosted-kernel',
      code: `${EVENT_NAMESPACE}.provider.sync.stale`,
      message: `${key} provider sync metadata is missing or stale.`,
      severity: key === 'persistence' ? 'error' : 'warning',
      retryable: true,
      attempt: 1,
      observedAt: now
    })),
    ...providerContracts.eventStream.rejectedEvents.map((event) => ({
      id: `${event.provider}-${event.id}-event-rejected`,
      component: HEALTH_COMPONENTS.includes(event.provider) ? event.provider : 'hosted-kernel',
      code: `${EVENT_NAMESPACE}.provider.event.${event.status}`,
      message: `${event.provider} published ${event.eventType} event with status ${event.status}.`,
      severity: event.status === 'cross-scope' || event.status === 'unknown-provider' ? 'error' : 'warning',
      retryable: event.status !== 'cross-scope',
      attempt: 1,
      observedAt: now
    })),
    ...components
      .filter((component) => component.status === 'failed')
      .map((component) => ({
        id: `${component.component}-unhealthy`,
        component: component.component,
        code: `${EVENT_NAMESPACE}.${component.component}.unhealthy`,
        message: component.message,
        severity: component.component === 'hosted-kernel' || component.component === 'route-mount'
          ? 'critical'
          : 'error',
        retryable: component.retryable,
        attempt: 1,
        observedAt: now
      }))
  ];
  const retry = buildRetryAdvice(failures, now);
  const failedComponents = components.filter((component) => component.status === 'failed');
  const degradedComponents = components.filter((component) => component.status === 'degraded');
  const criticalFailure = failures.some((failure) => failure.severity === 'critical');
  const failureState = buildFailureStateContract({
    failures,
    components,
    persistedState,
    providerContracts,
    now
  });
  const remediationPlan = buildHealthRemediationPlan({
    failureState,
    failures,
    components,
    runtime,
    tenantBoundary,
    providerContracts,
    now
  });
  const mode = failedComponents.length > 0 || suppliedStatus === 'failed'
    ? 'failed'
    : degradedComponents.length > 0 || suppliedStatus === 'degraded'
      ? 'degraded'
      : 'healthy';

  return {
    status: criticalFailure ? 'failed' : mode,
    components,
    degradedMode: {
      enabled: mode === 'degraded' && failureState.capabilities.preview && signals.hostedKernelBooted && signals.routeMounted,
      previewReadOnly: degradedComponents.some((component) => component.component === 'proof-sink' || component.component === 'persistence')
        || failureState.degradedCapabilities.includes('preview-readonly'),
      acceptDisabled: !validation.ok || !failureState.capabilities.accept || failedComponents.some((component) => component.component === 'persistence'),
      capabilities: failureState.degradedCapabilities,
      reason: degradedComponents.map((component) => component.message)
    },
    failures,
    failureState,
    remediationPlan,
    retry,
    actionableErrors: failures.map((failure) => ({
      id: failure.id,
      code: failure.code,
      component: failure.component,
      message: failure.message,
      severity: failure.severity,
      retryable: failure.retryable,
      nextCommand: components.find((component) => component.component === failure.component)?.remediationCommand || `${EVENT_NAMESPACE}.health.inspect`,
      retryAfterMs: failure.retryable ? failureState.components[failure.component]?.backoffMs ?? retry.maxBackoffMs : null,
      nextRetryAt: failure.retryable ? failureState.components[failure.component]?.nextRetryAt ?? retry.nextRetryAt : null,
      retryExhausted: Boolean(failureState.components[failure.component]?.retryExhausted),
      remediationRunbookId: remediationPlan.runbooks.find((runbook) => runbook.component === failure.component)?.id || null,
      proofCommand: remediationPlan.runbooks.find((runbook) => runbook.component === failure.component)?.proofEnvelope.command || null,
      providerRefreshCommand: remediationPlan.runbooks.find((runbook) => runbook.component === failure.component)?.providerRefreshCommand?.command || null,
      deadLetterCommand: failureState.components[failure.component]?.retryExhausted
        ? `${EVENT_NAMESPACE}.health.dead-letter`
        : null
    }))
  };
}

function buildAcceptance({ signals, validation, operationalHealth, lifecycleSettings, settingsValidation, providerContracts, auditProof, tenantBoundary, boundaryContract }) {
  const signalSatisfied = (key) => key === 'proofCaptured' ? auditProof.signalSatisfied : signals[key];
  const missingSignals = REQUIRED_ACCEPTANCE_SIGNALS.filter((key) => !signalSatisfied(key));
  const healthAllowsAccept = operationalHealth.status !== 'failed' && !operationalHealth.degradedMode.acceptDisabled;
  const settingsAllowAccept = settingsValidation.ok && lifecycleSettings.controls.accept.available;
  const auditAllowsAccept = lifecycleSettings.auditMode !== 'required' || auditProof.ready;
  const providerAllowsAccept = providerContracts.ok && providerContracts.syncReady && providerContracts.auditProofWritable && providerContracts.stateWritable;
  const permissionAllowsAccept = tenantBoundary.commandAccess.accept.allowed && boundaryContract.safeToAccept;
  return {
    status: validation.ok && missingSignals.length === 0 && healthAllowsAccept && settingsAllowAccept && auditAllowsAccept && providerAllowsAccept && permissionAllowsAccept
      ? 'accepted'
      : 'pending',
    requiredSignals: REQUIRED_ACCEPTANCE_SIGNALS,
    receivedSignals: Object.entries(signals)
      .filter(([, value]) => value)
      .map(([key]) => key)
      .concat(auditProof.signalSatisfied && !signals.proofCaptured ? ['proofCaptured'] : []),
    missingSignals,
    canAccept: validation.ok && missingSignals.length === 0 && healthAllowsAccept && settingsAllowAccept && auditAllowsAccept && providerAllowsAccept && permissionAllowsAccept,
    blockedByHealth: healthAllowsAccept
      ? []
      : operationalHealth.actionableErrors.map((error) => ({
        component: error.component,
        code: error.code,
        message: error.message,
        nextCommand: error.nextCommand
      })),
    blockedBySettings: settingsAllowAccept && auditAllowsAccept
      ? []
      : [
        ...settingsValidation.blockingReasons.map((reason) => ({
          control: 'accept',
          code: `${EVENT_NAMESPACE}.settings.blocked`,
          message: reason,
          nextCommand: 'kernel.lifecycle.exit.settings.update'
        })),
        ...lifecycleSettings.controls.accept.disabledReasons.map((reason) => ({
          control: 'accept',
          code: `${EVENT_NAMESPACE}.accept.disabled`,
          message: reason,
          nextCommand: 'kernel.lifecycle.exit.settings.enable'
        })),
        ...(auditAllowsAccept ? [] : [{
          control: 'proof',
          code: `${EVENT_NAMESPACE}.proof.required`,
          message: auditProof.gaps[0] || 'Required audit mode needs a captured proof signal before acceptance.',
          nextCommand: auditProof.reconciliation.repairCommand || CONTROL_COMMANDS.proof
        }])
      ],
    blockedByProviders: providerAllowsAccept
      ? []
      : [
        ...providerContracts.failedProviders.map((provider) => ({
          provider: provider.key,
          code: `${EVENT_NAMESPACE}.provider.blocked`,
          message: provider.missingCapabilities.length > 0
            ? `${provider.key} provider lacks ${provider.missingCapabilities.join(', ')}.`
            : `${provider.key} provider is ${provider.status}.`,
          nextCommand: 'kernel.lifecycle.exit.provider.negotiate'
        })),
        ...providerContracts.staleSyncProviders.map((provider) => ({
          provider,
          code: `${EVENT_NAMESPACE}.provider.sync.required`,
          message: `${provider} provider must publish fresh sync metadata before acceptance.`,
          nextCommand: 'kernel.lifecycle.exit.provider.sync'
        })),
        ...providerContracts.requiredBeforeAccept
          .filter((obligation) => !obligation.satisfied)
          .map((obligation) => ({
            provider: obligation.provider,
            code: `${EVENT_NAMESPACE}.provider.obligation.required`,
            message: `${obligation.provider} provider must satisfy ${obligation.capability} before acceptance.`,
            nextCommand: obligation.command
        })),
        ...(providerContracts.auditProofWritable ? [] : [{
          provider: 'proof-sink',
          code: `${EVENT_NAMESPACE}.provider.proof-sink.required`,
          message: 'Proof sink provider must accept audit proof writes before acceptance.',
          nextCommand: 'kernel.lifecycle.exit.provider.negotiate'
        }]),
        ...(providerContracts.stateWritable ? [] : [{
          provider: 'persistence',
          code: `${EVENT_NAMESPACE}.provider.persistence.required`,
          message: 'Persistence provider must accept state and command ledger writes before acceptance.',
          nextCommand: 'kernel.lifecycle.exit.provider.negotiate'
        }])
      ],
    blockedByPermissions: permissionAllowsAccept
      ? []
      : [
        ...tenantBoundary.commandAccess.accept.deniedReasons,
        ...boundaryContract.controls.accept.blockedReasons
      ].filter((reason, index, reasons) => reasons.indexOf(reason) === index).map((reason) => ({
        control: 'accept',
        permission: tenantBoundary.commandAccess.accept.permission,
        code: `${EVENT_NAMESPACE}.tenant.permission.blocked`,
        message: reason,
        nextCommand: 'kernel.lifecycle.exit.permissions.request'
      }))
  };
}

function buildWorkflowHandoff({ acceptance, runtime, validation, providerContracts, tenantBoundary, boundaryContract, clientRuntimeState }) {
  const blocked = !validation.ok;
  const handoffPermission = tenantBoundary.commandAccess.handoff;
  const canOpenHandoff = acceptance.canAccept && runtime.hasStableRequest && providerContracts.externalHandoff.ready && handoffPermission.allowed && boundaryContract.safeToHandoff;
  const pendingReasons = [
    ...(blocked ? validation.blockingReasons : []),
    ...(runtime.hasStableRequest ? [] : ['Stable request id is required for client handoff']),
    ...(runtime.hasSessionBinding ? [] : ['Session binding is missing; handoff will start a new client session']),
    ...(runtime.hasResumeToken ? [] : ['Resume token is missing; preview cannot restore in-progress client state']),
    ...(clientRuntimeState.route.matchesMount ? [] : ['Client route must be rebound to the exit-contract mount before handoff']),
    ...(clientRuntimeState.resume.restorable || runtime.hasResumeToken ? [] : ['Client runtime has no restorable resume state']),
    ...(providerContracts.externalHandoff.ready ? [] : ['External handoff gateway has not negotiated a resumable target']),
    ...boundaryContract.controls.handoff.blockedReasons,
    ...handoffPermission.deniedReasons
  ];
  const userVisibleMode = canOpenHandoff
    ? clientRuntimeState.handoff.userVisibleMode
    : clientRuntimeState.route.patchRequired
      ? 'repair-client-runtime'
      : 'prepare-client-handoff';

  return {
    status: canOpenHandoff ? 'ready' : blocked ? 'blocked' : 'pending',
    target: runtime.handoffTarget,
    requestId: runtime.requestId,
    sessionId: runtime.sessionId,
    resumeToken: runtime.resumeToken,
    tenantBoundary: tenantBoundary.auditSubject,
    userVisibleLabel: canOpenHandoff
      ? (userVisibleMode === 'resume-existing-workflow' ? 'Resume hosted kernel' : 'Continue in hosted kernel')
      : clientRuntimeState.route.patchRequired
        ? 'Repair client runtime'
        : 'Finish exit contract setup',
    userVisibleMode,
    nextAction: canOpenHandoff
      ? 'kernel.lifecycle.exit.handoff.open'
      : clientRuntimeState.route.patchRequired
        ? clientRuntimeState.route.patchCommand
        : 'kernel.lifecycle.exit.handoff.prepare',
    pendingReasons,
    clientEvents: {
      preview: `${EVENT_NAMESPACE}.preview`,
      accept: `${EVENT_NAMESPACE}.accept`,
      handoff: `${EVENT_NAMESPACE}.handoff`,
      proof: `${EVENT_NAMESPACE}.proof`,
      runtimeHydrate: `${EVENT_NAMESPACE}.client.runtime.hydrate`,
      runtimePatch: `${EVENT_NAMESPACE}.client.runtime.patch`
    },
    persistence: {
      key: clientRuntimeState.stateKey,
      fields: CLIENT_RUNTIME_FIELDS,
      requiredBeforeAccept: ['requestId', 'route'],
      hydrationPatch: clientRuntimeState.hydrationPatch,
      recoverableFields: clientRuntimeState.resume.recoverableFields
    },
    externalState: {
      provider: 'handoff-gateway',
      state: providerContracts.externalHandoff.state,
      target: providerContracts.externalHandoff.target,
      resumeTokenRef: providerContracts.externalHandoff.resumeTokenRef,
      expiresAt: providerContracts.externalHandoff.expiresAt,
      exportKey: providerContracts.externalHandoff.exportKey,
      requiredScope: providerContracts.externalHandoff.requiredScope,
      syncDomain: providerContracts.externalHandoff.syncDomain
    },
    clientRuntimeState: {
      schema: clientRuntimeState.schema,
      route: clientRuntimeState.route,
      resume: clientRuntimeState.resume,
      handoff: clientRuntimeState.handoff
    }
  };
}

function buildClientWorkflowContract({
  runtime,
  persistedState,
  acceptance,
  workflowHandoff,
  processExitContract,
  nextAction,
  commands,
  providerContracts,
  tenantBoundary,
  boundaryContract,
  lifecycleSettings,
  lifecycleControlPlane,
  clientRuntimeState,
  auditProof,
  persistedStateContract,
  persistenceShape,
  now
}) {
  const routeMatchesMount = runtime.route === DEFAULT_ROUTE_MOUNT || runtime.route.startsWith(`${DEFAULT_ROUTE_MOUNT}/`);
  const proofCommand = commands.find((command) => command.id === 'proof');
  const acceptCommand = commands.find((command) => command.id === 'accept');
  const handoffCommand = commands.find((command) => command.id === 'handoff');
  const controlStatuses = commands.reduce((acc, command) => {
    acc[command.id] = {
      status: command.status,
      command: command.command,
      idempotencyKey: command.idempotencyKey,
      available: command.status === 'available',
      completed: command.status === 'completed',
      blocked: command.status === 'blocked' || command.status === 'disabled' || command.status === 'expired',
      readyAt: command.schedule?.readyAt || null
    };
    return acc;
  }, {});

  const routeStatePatch = {
    type: 'kernel.lifecycle.exit.route-state',
    key: `${EVENT_NAMESPACE}:client:${tenantBoundary.scopeKey}:${runtime.requestId}`,
    mergeStrategy: persistedState.conflict.staleTenant || persistedState.conflict.staleWorkspace
      ? 'isolate-tenant-workspace-state'
      : persistedState.staleRequest
        ? 'fork-request-state'
        : 'upsert-active-request',
    fields: {
      tenantId: tenantBoundary.tenantId,
      workspaceId: tenantBoundary.workspaceId,
      principalId: tenantBoundary.principalId,
      requestId: runtime.requestId,
      sessionId: runtime.sessionId,
      route: runtime.route,
      lastKnownRoute: persistedState.lastKnownRoute,
      routeMatchesMount,
      resumeTokenPresent: runtime.hasResumeToken,
      accepted: acceptance.canAccept,
      acceptedAt: persistedState.acceptedAt,
      proofCount: persistedState.proofCount,
      generatedAt: now
    }
  };

  const handoffIntent = {
    type: 'kernel.lifecycle.exit.handoff-intent',
    mode: processExitContract.workflowHandoff.canOpen
      ? processExitContract.workflowHandoff.mode
      : workflowHandoff.status === 'ready' ? 'open' : 'prepare',
    enabled: workflowHandoff.status === 'ready' || processExitContract.workflowHandoff.canOpen,
    label: processExitContract.workflowHandoff.canOpen
      ? processExitContract.workflowHandoff.label
      : workflowHandoff.userVisibleLabel,
    target: processExitContract.workflowHandoff.target || workflowHandoff.target,
    command: processExitContract.workflowHandoff.canOpen
      ? processExitContract.workflowHandoff.command
      : workflowHandoff.nextAction,
    idempotencyKey: handoffCommand?.idempotencyKey || `${EVENT_NAMESPACE}:handoff:${tenantBoundary.scopeKey}:${runtime.requestId}:${runtime.handoffTarget}`,
    requiredScope: tenantBoundary.handoffScope,
    blockedReasons: processExitContract.workflowHandoff.canOpen
      ? []
      : processExitContract.workflowHandoff.blockedReasons.length > 0
        ? processExitContract.workflowHandoff.blockedReasons
        : workflowHandoff.pendingReasons,
    provider: {
      state: providerContracts.externalHandoff.state,
      target: providerContracts.externalHandoff.target,
      resumeTokenRef: providerContracts.externalHandoff.resumeTokenRef,
      expiresAt: providerContracts.externalHandoff.expiresAt,
      exportKey: providerContracts.externalHandoff.exportKey,
      requiredScope: providerContracts.externalHandoff.requiredScope,
      syncDomain: providerContracts.externalHandoff.syncDomain
    },
    processExitWorkflow: {
      schema: processExitContract.workflowHandoff.schema,
      handoffKey: processExitContract.workflowHandoff.handoffKey,
      outcome: processExitContract.workflowHandoff.outcome,
      userVisibleStatus: processExitContract.workflowHandoff.userVisibleStatus,
      requestedChannel: processExitContract.workflowHandoff.requestedChannel,
      clientPatch: processExitContract.workflowHandoff.clientPatch,
      providerExport: processExitContract.workflowHandoff.providerExport,
      nextStep: processExitContract.workflowHandoff.nextStep
    }
  };
  const providerServiceContracts = providerContracts.serviceContracts.map((contract) => ({
    provider: contract.provider,
    schema: contract.schema,
    status: contract.status,
    endpoint: contract.endpoint,
    negotiation: contract.negotiation,
    sync: contract.sync,
    obligations: contract.obligations
  }));

  return {
    schema: 'aios.kernel.lifecycle.exit.client-workflow.v1',
    generatedAt: now,
    requestEnvelope: {
      requestId: runtime.requestId,
      sessionId: runtime.sessionId,
      correlationKey: clientRuntimeState.request.correlationKey,
      route: runtime.route,
      handoffTarget: runtime.handoffTarget,
      hasStableRequest: runtime.hasStableRequest,
      fieldCompleteness: runtime.fieldCompleteness,
      tenantBoundary: tenantBoundary.auditSubject,
      boundaryFingerprint: boundaryContract.boundaryFingerprint,
      runtimeStateKey: clientRuntimeState.stateKey,
      missingRuntimeFields: clientRuntimeState.request.missingFields
    },
    routeState: {
      mount: DEFAULT_ROUTE_MOUNT,
      activeRoute: runtime.route,
      matchesMount: routeMatchesMount,
      staleRecoveredRoute: persistedState.staleRoute,
      lastKnownRoute: persistedState.lastKnownRoute,
      persistenceStatus: persistedStateContract.status,
      restartSafeStatus: persistedStateContract.restartSafeStatus,
      dirtyFields: persistedStateContract.dirtyFields,
      conflict: persistedStateContract.conflict,
      patch: routeStatePatch,
      runtimeHydrationPatch: clientRuntimeState.hydrationPatch
    },
    processExit: {
      schema: processExitContract.schema,
      outcome: processExitContract.outcome,
      requestedOutcome: processExitContract.requestedOutcome,
      effectiveOutcome: processExitContract.effectiveOutcome,
      outcomeSource: processExitContract.outcomeSource,
      forcedOverride: processExitContract.truthResolution.forcedOverride,
      truthResolution: processExitContract.truthResolution,
      requestContract: {
        schema: processExitContract.requestContract.schema,
        status: processExitContract.requestContract.status,
        valid: processExitContract.requestContract.valid,
        requestFingerprint: processExitContract.requestContract.requestFingerprint,
        failedCheckIds: processExitContract.requestContract.failedCheckIds,
        blockingReasons: processExitContract.requestContract.blockingReasons,
        warningReasons: processExitContract.requestContract.warningReasons
      },
      terminal: processExitContract.terminal,
      valid: processExitContract.valid,
      status: processExitContract.status,
      permission: processExitContract.permission,
      providerContract: {
        schema: processExitContract.providerContract.schema,
        ready: processExitContract.providerContract.ready,
        requiredProviders: processExitContract.providerContract.requiredProviders,
        blockedProviders: processExitContract.providerContract.blockedProviders,
        requiredSyncDomains: processExitContract.providerContract.requiredSyncDomains,
        externalHandoff: processExitContract.providerContract.externalHandoff
      },
      controlGate: processExitContract.controlGate,
      userDecision: processExitContract.userDecision,
      workflowHandoff: processExitContract.workflowHandoff,
      persistence: {
        schema: processExitContract.persistence.schema,
        restartDecision: processExitContract.persistence.restartDecision,
        restartSafeStatus: processExitContract.persistence.restartSafeStatus,
        recordableAfterRestart: processExitContract.persistence.recordableAfterRestart,
        idempotent: processExitContract.persistence.idempotent,
        statePatch: processExitContract.persistence.statePatch,
        recoveryCommands: processExitContract.persistence.recoveryCommands,
        blockedReasons: processExitContract.persistence.blockedReasons
      },
      blockingReasons: processExitContract.blockingReasons,
      warnings: processExitContract.warnings,
      remediation: processExitContract.remediation,
      evidenceRefs: processExitContract.evidenceRefs,
      ledgerEnvelope: processExitContract.ledgerEnvelope
    },
    persistence: {
      schema: persistedStateContract.schema,
      safeToWrite: persistedStateContract.safeToWrite,
      writeBlockedReasons: persistedStateContract.writeBlockedReasons,
      statePatch: persistedStateContract.statePatch,
      shape: {
        schema: persistenceShape.schema,
        snapshotMode: persistenceShape.snapshotMode,
        restartStatus: persistenceShape.restartStatus,
        writeIntent: persistenceShape.writeIntent,
        recoveryCheckpoints: persistenceShape.recoveryCheckpoints,
        userVisibleStatus: persistenceShape.userVisibleStatus
      },
      idempotentLedger: persistedStateContract.idempotentLedger,
      recoveryReplay: persistedStateContract.recoveryReplay
    },
    controlBar: {
      primary: {
        state: nextAction.state,
        label: nextAction.primaryLabel,
        command: nextAction.primaryCommand,
        control: nextAction.control,
        readyAt: nextAction.readyAt,
        reason: nextAction.reason
      },
      controls: controlStatuses,
      permissions: tenantBoundary.commandAccess,
      boundary: {
        schema: boundaryContract.schema,
        mode: boundaryContract.mode,
        safeToAccept: boundaryContract.safeToAccept,
        safeToHandoff: boundaryContract.safeToHandoff,
        isolationActions: boundaryContract.isolationActions,
        auditHandoffEnvelope: boundaryContract.auditHandoffEnvelope
      },
      controlPlane: {
        schema: lifecycleControlPlane.schema,
        enabled: lifecycleControlPlane.enabled,
        dispatchableControls: lifecycleControlPlane.dispatchableControls,
        repairControls: lifecycleControlPlane.repairControls,
        nextDispatch: lifecycleControlPlane.nextDispatch,
        settingsUpdatePlan: lifecycleControlPlane.settingsUpdatePlan
      },
      auditMode: lifecycleSettings.auditMode,
      disabled: !lifecycleSettings.enabled
    },
    auditProof: {
      requiredBeforeAccept: lifecycleSettings.auditMode === 'required',
      captured: auditProof.signalSatisfied || proofCommand?.status === 'completed',
      ready: auditProof.ready,
      proofCount: auditProof.proofCount,
      persistedProofCount: auditProof.persistedProofCount,
      bundleFingerprint: auditProof.bundleFingerprint,
      captureCommand: proofCommand?.command || CONTROL_COMMANDS.proof,
      reconcileCommand: auditProof.reconciliation.repairCommand,
      acceptCommand: acceptCommand?.command || CONTROL_COMMANDS.accept,
      acceptIdempotencyKey: acceptCommand?.idempotencyKey || `${EVENT_NAMESPACE}:accept:${tenantBoundary.scopeKey}:${runtime.requestId}`,
      appendEnvelope: auditProof.appendEnvelope,
      gaps: auditProof.gaps
    },
    providerServices: {
      schemaVersion: providerContracts.serviceSchemaVersion,
      syncEnvelope: providerContracts.syncEnvelope,
      eventStream: providerContracts.eventStream,
      contracts: providerServiceContracts,
      requiredBeforeAccept: providerContracts.requiredBeforeAccept
    },
    handoffIntent,
    clientRuntimeState,
    eventBindings: {
      namespace: EVENT_NAMESPACE,
      consume: {
        preview: workflowHandoff.clientEvents.preview,
        proof: workflowHandoff.clientEvents.proof,
        accept: workflowHandoff.clientEvents.accept,
        handoff: workflowHandoff.clientEvents.handoff,
        runtimeHydrate: workflowHandoff.clientEvents.runtimeHydrate,
        runtimePatch: workflowHandoff.clientEvents.runtimePatch
      },
      publish: {
        routeStatePatch: `${EVENT_NAMESPACE}.client.route-state.patch`,
        runtimeStatePatch: `${EVENT_NAMESPACE}.client.runtime.patch`,
        runtimeHydration: `${EVENT_NAMESPACE}.client.runtime.hydrate`,
        handoffIntent: `${EVENT_NAMESPACE}.client.handoff.intent`,
        providerEventAccepted: `${EVENT_NAMESPACE}.provider.event.accepted`,
        providerEventRejected: `${EVENT_NAMESPACE}.provider.event.rejected`,
        controlSelection: `${EVENT_NAMESPACE}.client.control.select`
      }
    }
  };
}

function buildRecoveryPlan({ persistedState, runtime, validation, acceptance, tenantBoundary }) {
  const actions = [];
  if (persistedState.conflict.staleTenant || persistedState.conflict.staleWorkspace) {
    actions.push({
      id: 'isolate-tenant-workspace',
      command: 'kernel.lifecycle.exit.tenant.isolate',
      reason: 'Recovered snapshot belongs to a different tenant or workspace and must not be merged into the active boundary.',
      idempotencyKey: `${EVENT_NAMESPACE}:tenant-isolate:${tenantBoundary.scopeKey}:${runtime.requestId}`
    });
  }
  if (persistedState.migrationRequired) {
    actions.push({
      id: 'migrate-exit-state',
      command: 'kernel.lifecycle.exit.state.migrate',
      reason: `Persisted exit state v${persistedState.version} must be upgraded to v${persistedState.targetVersion}.`,
      idempotencyKey: `${EVENT_NAMESPACE}:migrate:${runtime.requestId}:v${persistedState.targetVersion}`
    });
  }
  if (persistedState.staleRequest) {
    actions.push({
      id: 'fork-recovered-request',
      command: 'kernel.lifecycle.exit.state.fork',
      reason: 'Recovered snapshot belongs to a different request and must not overwrite the active hosted-kernel request.',
      idempotencyKey: `${EVENT_NAMESPACE}:fork:${persistedState.requestId}:${runtime.requestId}`
    });
  }
  if (persistedState.staleRoute) {
    actions.push({
      id: 'rebind-route',
      command: 'kernel.lifecycle.exit.route.rebind',
      reason: 'Recovered route differs from the mounted hosted-kernel route.',
      idempotencyKey: `${EVENT_NAMESPACE}:route:${runtime.requestId}:${runtime.route}`
    });
  }
  if (!runtime.hasResumeToken && persistedState.resumeToken) {
    actions.push({
      id: 'restore-resume-token',
      command: 'kernel.lifecycle.exit.resume.restore',
      reason: 'Persisted resume token can restore the client preview after restart.',
      idempotencyKey: `${EVENT_NAMESPACE}:resume:${runtime.requestId}`
    });
  }
  if (!validation.ok) {
    actions.push({
      id: 'hold-blocked-state',
      command: 'kernel.lifecycle.exit.state.hold',
      reason: 'Blocking validation failures prevent replaying acceptance commands.',
      idempotencyKey: `${EVENT_NAMESPACE}:hold:${runtime.requestId}`
    });
  } else if (acceptance.canAccept && persistedState.replayed.accept) {
    actions.push({
      id: 'replay-accepted-status',
      command: 'kernel.lifecycle.exit.accept.replay',
      reason: 'Prior acceptance is complete; restart should expose accepted status without duplicating side effects.',
      idempotencyKey: `${EVENT_NAMESPACE}:accept:${runtime.requestId}`
    });
  }

  return {
    mode: actions.length === 0 ? 'clean-start' : 'recovering',
    restartSafe: !persistedState.conflict.staleTenant && !persistedState.conflict.staleWorkspace && !persistedState.staleRequest && validation.ok,
    actions
  };
}

function buildIdempotentCommands({ acceptance, runtime, persistedState, recovery, lifecycleSettings, tenantBoundary, boundaryContract }) {
  const guarded = recovery.mode === 'recovering' || persistedState.replayed.accept;
  const commandStatus = (id, fallbackStatus) => {
    const control = lifecycleSettings.controls[id];
    const permission = tenantBoundary.commandAccess[id];
    const boundary = boundaryContract.controls[id];
    if (permission && !permission.allowed) return 'blocked';
    if (boundary && !boundary.dispatchable) return 'blocked';
    if (!control) return fallbackStatus;
    if (!control.enabled) return 'disabled';
    if (control.schedule.expired) return 'expired';
    if (control.schedule.blockedByClock) return 'scheduled';
    if (!control.available && fallbackStatus === 'available') return 'blocked';
    return fallbackStatus;
  };
  return [
    {
      id: 'preview',
      command: 'kernel.lifecycle.exit.preview',
      idempotencyKey: `${EVENT_NAMESPACE}:preview:${tenantBoundary.scopeKey}:${runtime.requestId}`,
      status: commandStatus('preview', 'available'),
      writes: ['state', 'lastKnownRoute', 'resumeToken'],
      schedule: lifecycleSettings.controls.preview.schedule,
      disabledReasons: lifecycleSettings.controls.preview.disabledReasons,
      permission: tenantBoundary.commandAccess.preview,
      boundary: boundaryContract.controls.preview,
      replayPolicy: 'replace-preview-snapshot'
    },
    {
      id: 'proof',
      command: 'kernel.lifecycle.exit.proof',
      idempotencyKey: `${EVENT_NAMESPACE}:proof:${tenantBoundary.scopeKey}:${runtime.requestId}`,
      status: persistedState.replayed.proof ? 'completed' : commandStatus('proof', 'available'),
      writes: ['proofCount', 'commandLedger.proof'],
      schedule: lifecycleSettings.controls.proof.schedule,
      disabledReasons: lifecycleSettings.controls.proof.disabledReasons,
      permission: tenantBoundary.commandAccess.proof,
      boundary: boundaryContract.controls.proof,
      replayPolicy: 'dedupe-by-idempotency-key'
    },
    {
      id: 'accept',
      command: 'kernel.lifecycle.exit.accept',
      idempotencyKey: `${EVENT_NAMESPACE}:accept:${tenantBoundary.scopeKey}:${runtime.requestId}`,
      status: acceptance.canAccept
        ? (persistedState.replayed.accept ? 'completed' : commandStatus('accept', 'available'))
        : commandStatus('accept', 'blocked'),
      writes: ['state', 'acceptedAt', 'commandLedger.accept'],
      schedule: lifecycleSettings.controls.accept.schedule,
      disabledReasons: [
        ...lifecycleSettings.controls.accept.disabledReasons,
        ...acceptance.blockedBySettings.map((item) => item.message),
        ...acceptance.blockedByPermissions.map((item) => item.message),
        ...boundaryContract.controls.accept.blockedReasons
      ],
      permission: tenantBoundary.commandAccess.accept,
      boundary: boundaryContract.controls.accept,
      replayPolicy: guarded ? 'return-existing-acceptance' : 'commit-once'
    },
    {
      id: 'handoff',
      command: 'kernel.lifecycle.exit.handoff.open',
      idempotencyKey: `${EVENT_NAMESPACE}:handoff:${tenantBoundary.scopeKey}:${runtime.requestId}:${runtime.handoffTarget}`,
      status: acceptance.canAccept && runtime.hasStableRequest
        ? commandStatus('handoff', 'available')
        : commandStatus('handoff', 'blocked'),
      writes: ['commandLedger.handoff'],
      schedule: lifecycleSettings.controls.handoff.schedule,
      disabledReasons: [
        ...lifecycleSettings.controls.handoff.disabledReasons,
        ...tenantBoundary.commandAccess.handoff.deniedReasons,
        ...boundaryContract.controls.handoff.blockedReasons
      ],
      permission: tenantBoundary.commandAccess.handoff,
      boundary: boundaryContract.controls.handoff,
      replayPolicy: 'open-once-per-target'
    }
  ];
}

function buildLifecycleControlPlane({
  commands,
  lifecycleSettings,
  tenantBoundary,
  boundaryContract,
  providerContracts,
  operationalHealth,
  auditProof,
  acceptance,
  runtime,
  now
}) {
  const providerRequirements = {
    preview: ['hosted-kernel', 'persistence', 'command-bus'],
    proof: ['proof-sink', 'persistence', 'command-bus'],
    accept: ['hosted-kernel', 'proof-sink', 'persistence', 'command-bus'],
    handoff: ['handoff-gateway', 'command-bus']
  };
  const providerByKey = providerContracts.providers.reduce((acc, provider) => {
    acc[provider.key] = provider;
    return acc;
  }, {});
  const healthByComponent = operationalHealth.components.reduce((acc, component) => {
    acc[component.component] = component;
    return acc;
  }, {});
  const controls = commands.reduce((acc, command) => {
    const setting = lifecycleSettings.controls[command.id];
    const permission = tenantBoundary.commandAccess[command.id];
    const boundary = boundaryContract.controls[command.id];
    const requiredProviders = providerRequirements[command.id] || [];
    const providerBlockers = requiredProviders.flatMap((key) => {
      const provider = providerByKey[key];
      if (!provider) return [`${key} provider contract is missing.`];
      return [
        ...(provider.negotiated ? [] : [`${key} provider negotiation is incomplete.`]),
        ...(provider.status === 'ready' || provider.status === 'degraded' ? [] : [`${key} provider is ${provider.status}.`]),
        ...(provider.sync.required && !provider.sync.fresh ? [`${key} provider sync is stale.`] : [])
      ];
    });
    const healthBlockers = requiredProviders
      .map((key) => healthByComponent[key])
      .filter((component) => component && component.status === 'failed')
      .map((component) => component.message);
    const proofBlockers = command.id === 'accept' && lifecycleSettings.auditMode === 'required' && !auditProof.ready
      ? auditProof.gaps
      : [];
    const acceptanceBlockers = command.id === 'handoff' && !acceptance.canAccept
      ? ['Exit contract must be accepted before opening handoff.']
      : [];
    const blockers = [
      ...command.disabledReasons,
      ...(permission?.deniedReasons || []),
      ...(boundary?.blockedReasons || []),
      ...providerBlockers,
      ...healthBlockers,
      ...proofBlockers,
      ...acceptanceBlockers
    ].filter(Boolean);
    const dispatchable = command.status === 'available' && blockers.length === 0;
    const enableCommand = setting?.enabled
      ? null
      : {
        command: 'kernel.lifecycle.exit.settings.enable',
        idempotencyKey: `${EVENT_NAMESPACE}:settings-enable:${tenantBoundary.scopeKey}:${runtime.requestId}:${command.id}`,
        patch: {
          settingsVersion: lifecycleSettings.settingsVersion + 1,
          path: `controls.${command.id}.enabled`,
          value: true
        }
      };
    const scheduleCommand = setting?.schedule?.blockedByClock || setting?.schedule?.expired
      ? {
        command: 'kernel.lifecycle.exit.schedule.update',
        idempotencyKey: `${EVENT_NAMESPACE}:schedule:${tenantBoundary.scopeKey}:${runtime.requestId}:${command.id}`,
        patch: {
          settingsVersion: lifecycleSettings.settingsVersion + 1,
          path: `controls.${command.id}.schedule`,
          value: {
            mode: 'immediate',
            notBefore: null,
            expiresAt: null
          }
        }
      }
      : null;

    acc[command.id] = {
      control: command.id,
      command: command.command,
      status: command.status,
      mode: dispatchable ? 'dispatch' : command.status === 'scheduled' ? 'wait' : command.status,
      dispatchable,
      idempotencyKey: command.idempotencyKey,
      requiredProviders,
      blockers,
      readyAt: command.schedule?.readyAt || now,
      settingsPatch: enableCommand,
      schedulePatch: scheduleCommand,
      dispatchEnvelope: {
        command: command.command,
        idempotencyKey: command.idempotencyKey,
        tenantBoundary: tenantBoundary.auditSubject,
        boundaryFingerprint: boundaryContract.boundaryFingerprint,
        boundaryMode: boundaryContract.mode,
        boundaryHandoff: boundaryContract.auditHandoffEnvelope,
        requestId: runtime.requestId,
        route: runtime.route,
        writes: command.writes,
        replayPolicy: command.replayPolicy,
        dryRun: !dispatchable,
        blockedReasons: blockers
      }
    };
    return acc;
  }, {});
  const dispatchOrder = ['handoff', 'accept', 'proof', 'preview'];
  const dispatchableControls = dispatchOrder.filter((control) => controls[control]?.dispatchable);
  const repairControls = dispatchOrder.filter((control) => controls[control] && !controls[control].dispatchable);

  return {
    schema: 'aios.kernel.lifecycle.exit.control-plane.v1',
    generatedAt: now,
    settingsVersion: lifecycleSettings.settingsVersion,
    enabled: lifecycleSettings.enabled,
    auditMode: lifecycleSettings.auditMode,
    controls,
    dispatchableControls,
    repairControls,
    nextDispatch: dispatchableControls[0]
      ? controls[dispatchableControls[0]].dispatchEnvelope
      : null,
    settingsUpdatePlan: repairControls
      .map((control) => controls[control].settingsPatch || controls[control].schedulePatch)
      .filter(Boolean)
  };
}

function deriveRestartSafeStatus({ readiness, acceptance, persistedState, recovery, commands }) {
  const acceptCommand = commands.find((command) => command.id === 'accept');
  if (persistedState.staleRequest) return 'isolated-recovery-required';
  if (!recovery.restartSafe) return 'restart-blocked';
  if (acceptCommand?.status === 'completed') return 'accepted-after-restart';
  if (acceptance.canAccept && readiness.handoffReady) return 'ready-after-restart';
  if (recovery.mode === 'recovering') return 'recovering';
  return readiness.status;
}

function buildLifecycleActionState({ commands, acceptance, lifecycleSettings, operationalHealth, validation, workflowHandoff, lifecycleControlPlane, processExitContract }) {
  const commandPriority = ['handoff', 'accept', 'proof', 'preview'];
  const dispatchableFromControlPlane = lifecycleControlPlane?.dispatchableControls?.[0];
  const availableCommand = dispatchableFromControlPlane
    ? commands.find((command) => command.id === dispatchableFromControlPlane && command.status === 'available')
    : commandPriority
      .map((id) => commands.find((command) => command.id === id && command.status === 'available'))
      .find(Boolean);
  const scheduledCommand = commands.find((command) => command.status === 'scheduled');
  const disabledCommand = commands.find((command) => command.status === 'disabled' || command.status === 'expired');
  const controlPlaneBlocker = lifecycleControlPlane?.repairControls
    ?.map((control) => lifecycleControlPlane.controls[control]?.blockers?.[0])
    ?.find(Boolean);
  const blockedReason = acceptance.blockedByHealth[0]?.message
    || acceptance.blockedBySettings[0]?.message
    || acceptance.blockedByProviders[0]?.message
    || acceptance.blockedByPermissions[0]?.message
    || validation.blockingReasons[0]
    || controlPlaneBlocker
    || operationalHealth.actionableErrors[0]?.message
    || null;

  if (processExitContract && !processExitContract.valid) {
    return {
      state: 'process-exit-blocked',
      primaryCommand: processExitContract.ledgerEnvelope.command,
      primaryLabel: 'Repair process exit contract',
      reason: processExitContract.blockingReasons[0] || `${processExitContract.outcome} process exit contract is not satisfied.`,
      control: 'process-exit',
      readyAt: null
    };
  }
  if (acceptance.canAccept && workflowHandoff.status === 'ready') {
    return {
      state: 'ready',
      primaryCommand: CONTROL_COMMANDS.handoff,
      primaryLabel: 'Continue in hosted kernel',
      reason: 'Exit contract is accepted and handoff control is ready.',
      control: 'handoff',
      readyAt: lifecycleSettings.controls.handoff.schedule.readyAt
    };
  }
  if (availableCommand) {
    return {
      state: availableCommand.id === 'accept' ? 'accept-ready' : 'work-ready',
      primaryCommand: availableCommand.command,
      primaryLabel: availableCommand.id === 'accept' ? 'Accept exit contract' : `Run ${availableCommand.id}`,
      reason: availableCommand.id === 'accept'
        ? 'Acceptance command is enabled and all blocking checks are satisfied.'
        : `${availableCommand.id} command can advance the hosted-kernel lifecycle.`,
      control: availableCommand.id,
      readyAt: availableCommand.schedule?.readyAt || null
    };
  }
  if (scheduledCommand) {
    return {
      state: 'scheduled',
      primaryCommand: 'kernel.lifecycle.exit.schedule.wait',
      primaryLabel: 'Waiting for schedule',
      reason: scheduledCommand.disabledReasons[0] || `${scheduledCommand.id} control is scheduled for later.`,
      control: scheduledCommand.id,
      readyAt: scheduledCommand.schedule?.readyAt || null
    };
  }
  return {
    state: disabledCommand ? 'disabled' : 'blocked',
    primaryCommand: disabledCommand ? 'kernel.lifecycle.exit.settings.enable' : 'kernel.lifecycle.exit.validate',
    primaryLabel: disabledCommand ? 'Enable lifecycle controls' : 'Resolve lifecycle blockers',
    reason: disabledCommand?.disabledReasons?.[0] || blockedReason || 'Lifecycle exit contract is not ready.',
    control: disabledCommand?.id || null,
    readyAt: disabledCommand?.schedule?.readyAt || null
  };
}

function buildNextSteps({ acceptance, validation, operationalHealth, lifecycleSettings, settingsValidation, providerContracts, processExitContract }) {
  if (processExitContract && !processExitContract.valid) {
    const providerRepair = processExitContract.providerContract?.repairPlan?.[0] || null;
    return [
      {
        id: `repair-process-exit-${processExitContract.outcome}`,
        label: 'Repair process exit contract',
        reason: providerRepair?.reason || processExitContract.blockingReasons[0] || `${processExitContract.outcome} exit contract is not satisfied.`,
        action: providerRepair?.command || processExitContract.ledgerEnvelope.command,
        control: 'process-exit',
        provider: providerRepair?.provider || null
      }
    ];
  }
  if (acceptance.canAccept) {
    return [
      {
        id: 'promote-exit-contract',
        label: 'Promote exit contract',
        reason: 'All acceptance signals and blocking validation checks are satisfied.',
        action: 'kernel.lifecycle.exit.accept'
      }
    ];
  }
  return [
    ...operationalHealth.actionableErrors.map((error) => ({
      id: `repair-${error.component}`,
      label: 'Repair hosted-kernel health',
      reason: error.message,
      action: error.nextCommand,
      retryable: error.retryable,
      retryAfterMs: error.retryAfterMs
    })),
    ...settingsValidation.blockingReasons.map((reason, index) => ({
      id: `repair-settings-${index + 1}`,
      label: 'Update lifecycle settings',
      reason,
      action: 'kernel.lifecycle.exit.settings.update'
    })),
    ...acceptance.blockedByProviders.map((item, index) => ({
      id: `repair-provider-${item.provider || index + 1}`,
      label: 'Negotiate provider contract',
      reason: item.message,
      action: item.nextCommand,
      provider: item.provider
    })),
    ...acceptance.blockedByPermissions.map((item, index) => ({
      id: `request-permission-${index + 1}`,
      label: 'Request lifecycle permission',
      reason: item.message,
      action: item.nextCommand,
      control: item.control
    })),
    ...providerContracts.providers
      .filter((provider) => provider.sync.required && !provider.sync.fresh)
      .map((provider) => ({
        id: `sync-provider-${provider.key}`,
        label: 'Refresh provider sync',
        reason: `${provider.key} sync cursor is not fresh for the hosted-kernel exit contract.`,
        action: 'kernel.lifecycle.exit.provider.sync',
        provider: provider.key,
        cursor: provider.sync.cursor,
        lastSyncedAt: provider.sync.lastSyncedAt
      })),
    ...providerContracts.eventStream.refreshActions.map((action) => ({
      id: `sync-provider-events-${action.provider}`,
      label: 'Refresh provider events',
      reason: `${action.provider} provider events are stale, rejected, or missing expected publications.`,
      action: action.command,
      provider: action.provider,
      cursor: action.cursor
    })),
    ...LIFECYCLE_CONTROL_KEYS
      .filter((key) => !lifecycleSettings.controls[key].available)
      .map((key) => ({
        id: `enable-${key}-control`,
        label: 'Enable lifecycle control',
        reason: lifecycleSettings.controls[key].disabledReasons[0] || `${key} control is not currently available.`,
        action: lifecycleSettings.controls[key].schedule.blockedByClock
          ? 'kernel.lifecycle.exit.schedule.wait'
          : 'kernel.lifecycle.exit.settings.enable',
        control: key,
        readyAt: lifecycleSettings.controls[key].schedule.readyAt
      })),
    ...validation.blockingReasons.map((reason, index) => ({
      id: `resolve-blocker-${index + 1}`,
      label: 'Resolve blocking validation',
      reason,
      action: 'kernel.lifecycle.exit.validate'
    })),
    ...acceptance.missingSignals.map((signal) => ({
      id: `capture-${signal}`,
      label: 'Capture missing acceptance signal',
      reason: signal,
      action: 'kernel.lifecycle.exit.preview'
    }))
  ];
}

function rankNextStep(step, index) {
  const action = normalizeString(step.action, '');
  if (action.includes('.health.') || action.includes('.provider.')) return 10 + index;
  if (action.includes('.settings.') || action.includes('.schedule.')) return 20 + index;
  if (action.includes('.proof')) return 30 + index;
  if (action.includes('.preview') || action.includes('.validate')) return 40 + index;
  if (action.includes('.accept')) return 50 + index;
  return 90 + index;
}

function categorizeNextStep(step) {
  const action = normalizeString(step.action, '');
  if (action.includes('.health.')) return 'health';
  if (action.includes('.provider.')) return 'provider';
  if (action.includes('.settings.') || action.includes('.schedule.')) return 'settings';
  if (action.includes('.permission')) return 'permission';
  if (action.includes('.proof')) return 'proof';
  if (action.includes('.accept')) return 'acceptance';
  if (action.includes('.handoff')) return 'handoff';
  if (action.includes('.preview')) return 'preview';
  if (action.includes('.validate')) return 'validation';
  return 'lifecycle';
}

function buildRoutePreviewDecisionContract({
  runtime,
  preview,
  acceptance,
  readiness,
  validation,
  settingsValidation,
  operationalHealth,
  nextAction,
  nextSteps,
  commands,
  workflowHandoff,
  providerContracts,
  lifecycleControlPlane,
  clientRuntimeState,
  tenantBoundary,
  boundaryContract,
  auditProof,
  processExitContract,
  persistenceShape,
  now
}) {
  const commandByControl = commands.reduce((acc, command) => {
    acc[command.id] = command;
    return acc;
  }, {});
  const validationTotals = {
    passed: validation.passedCount + settingsValidation.checks.filter((check) => check.passed).length,
    failed: validation.failedCount + settingsValidation.checks.filter((check) => !check.passed).length,
    blocking: validation.blockingReasons.length + settingsValidation.blockingReasons.length
  };
  const readinessGates = [
    {
      id: 'preview-route',
      label: 'Hosted route is mounted',
      status: clientRuntimeState.route.matchesMount && !clientRuntimeState.route.patchRequired ? 'ready' : 'repair',
      blocking: !clientRuntimeState.route.matchesMount,
      command: clientRuntimeState.route.patchCommand || CONTROL_COMMANDS.preview,
      evidenceRef: clientRuntimeState.stateKey
    },
    {
      id: 'audit-proof',
      label: 'Audit proof can be accepted',
      status: auditProof.ready ? 'ready' : auditProof.signalSatisfied ? 'reconcile' : 'missing',
      blocking: !auditProof.ready && acceptance.missingSignals.includes('proofCaptured'),
      command: auditProof.reconciliation.repairCommand || CONTROL_COMMANDS.proof,
      evidenceRef: auditProof.bundleFingerprint
    },
    {
      id: 'provider-contracts',
      label: 'Provider contracts are negotiated',
      status: providerContracts.ok ? 'ready' : 'repair',
      blocking: !providerContracts.ok,
      command: providerContracts.failedProviders[0] ? 'kernel.lifecycle.exit.provider.negotiate' : null,
      evidenceRef: providerContracts.syncEnvelope.schema
    },
    {
      id: 'provider-sync',
      label: 'Provider sync is fresh',
      status: providerContracts.syncReady && providerContracts.eventStream.ready ? 'ready' : 'sync',
      blocking: !providerContracts.syncReady,
      command: providerContracts.eventStream.refreshActions[0]?.command || (providerContracts.syncReady ? null : 'kernel.lifecycle.exit.provider.sync'),
      evidenceRef: providerContracts.eventStream.streamKey
    },
    {
      id: 'tenant-boundary',
      label: 'Tenant boundary allows writes',
      status: boundaryContract.safeToAccept ? 'ready' : boundaryContract.isolationRequired || boundaryContract.forkRequired ? 'isolate' : 'permission',
      blocking: !boundaryContract.safeToAccept,
      command: boundaryContract.isolationActions[0]?.command || 'kernel.lifecycle.exit.permissions.request',
      evidenceRef: boundaryContract.boundaryFingerprint
    },
    {
      id: 'client-handoff',
      label: 'Client handoff is explainable',
      status: processExitContract.workflowHandoff.canOpen
        ? processExitContract.workflowHandoff.userVisibleStatus
        : workflowHandoff.status,
      blocking: workflowHandoff.status === 'blocked' && !processExitContract.workflowHandoff.canOpen,
      command: processExitContract.workflowHandoff.command || workflowHandoff.nextAction,
      evidenceRef: processExitContract.workflowHandoff.handoffKey
    },
    {
      id: 'persistence-restart',
      label: 'Restart persistence is safe',
      status: persistenceShape.restartStatus,
      blocking: persistenceShape.recoveryCheckpoints.some((checkpoint) => checkpoint.blocking),
      command: persistenceShape.userVisibleStatus.nextCommand,
      evidenceRef: persistenceShape.writeIntent.compareAndSwapKey
    },
    {
      id: 'operational-health',
      label: 'Hosted kernel health permits acceptance',
      status: operationalHealth.status,
      blocking: operationalHealth.degradedMode.acceptDisabled || operationalHealth.status === 'failed',
      command: operationalHealth.actionableErrors[0]?.nextCommand || null,
      evidenceRef: operationalHealth.remediationPlan.nextRunbookId
    },
    {
      id: 'process-exit-contract',
      label: `${processExitContract.outcome} process exit contract`,
      status: processExitContract.valid ? 'ready' : 'blocked',
      blocking: !processExitContract.valid,
      command: processExitContract.ledgerEnvelope.command,
      evidenceRef: processExitContract.exitKey
    }
  ];
  const blockingGates = readinessGates.filter((gate) => gate.blocking);
  const primaryControl = nextAction.control || (acceptance.canAccept ? 'accept' : null);
  const primaryCommand = primaryControl ? commandByControl[primaryControl] : null;
  const commitCommand = primaryControl === 'process-exit'
    ? {
      command: processExitContract.ledgerEnvelope.command,
      idempotencyKey: processExitContract.ledgerEnvelope.idempotencyKey,
      writes: processExitContract.ledgerEnvelope.writes
    }
    : primaryCommand;
  const blockerExplanations = [
    ...acceptance.blockedByHealth.map((item) => ({ source: 'health', message: item.message, command: item.nextCommand })),
    ...acceptance.blockedBySettings.map((item) => ({ source: 'settings', message: item.message, command: item.nextCommand })),
    ...acceptance.blockedByProviders.map((item) => ({ source: 'provider', message: item.message, command: item.nextCommand })),
    ...acceptance.blockedByPermissions.map((item) => ({ source: 'permission', message: item.message, command: item.nextCommand })),
    ...blockingGates.map((gate) => ({ source: gate.id, message: gate.label, command: gate.command }))
  ].filter((entry, index, entries) => entries.findIndex((candidate) => (
    candidate.source === entry.source && candidate.message === entry.message && candidate.command === entry.command
  )) === index);
  const rankedNextSteps = nextSteps
    .map((step, index) => {
      const category = categorizeNextStep(step);
      const control = step.control || (category === 'acceptance' ? 'accept' : category === 'proof' ? 'proof' : category === 'handoff' ? 'handoff' : null);
      const controlEnvelope = control ? lifecycleControlPlane.controls[control]?.dispatchEnvelope || null : null;
      return {
        id: step.id,
        rank: rankNextStep(step, index),
        category,
        label: step.label,
        reason: step.reason,
        command: step.action,
        control,
        provider: step.provider || null,
        readyAt: step.readyAt || null,
        retryable: Boolean(step.retryable),
        retryAfterMs: step.retryAfterMs ?? null,
        dispatchEnvelope: controlEnvelope,
        dryRun: controlEnvelope ? controlEnvelope.dryRun : true,
        idempotencyKey: controlEnvelope?.idempotencyKey || null
      };
    })
    .sort((left, right) => left.rank - right.rank);

  return {
    schema: `aios.kernel.lifecycle.exit.route-preview-decision.v${ROUTE_PREVIEW_DECISION_SCHEMA_VERSION}`,
    generatedAt: now,
    previewPayload: {
      title: preview.title,
      summary: preview.summary,
      state: preview.state,
      route: runtime.route,
      requestId: runtime.requestId,
      sessionId: runtime.sessionId,
      badges: preview.badges,
      visibleActions: preview.visibleActions,
      readOnly: operationalHealth.degradedMode.previewReadOnly,
      fingerprint: deriveFingerprint({
        route: runtime.route,
        requestId: runtime.requestId,
        state: preview.state,
        badges: preview.badges,
        actions: preview.visibleActions,
        auditProof: auditProof.bundleFingerprint,
        readiness: readiness.status
      })
    },
    readinessGates,
    readinessSummary: {
      status: readiness.status,
      readyCount: readinessGates.filter((gate) => gate.status === 'ready').length,
      repairCount: readinessGates.filter((gate) => gate.status !== 'ready').length,
      blockingCount: blockingGates.length,
      firstBlockingGate: blockingGates[0]?.id || null,
      providerStatus: readiness.providerContracts,
      providerSync: readiness.providerSync,
      restartStatus: persistenceShape.restartStatus,
      processExit: processExitContract.status
    },
    acceptanceDecision: {
      status: acceptance.canAccept ? 'can-accept' : acceptance.status,
      canAccept: acceptance.canAccept,
      missingSignals: acceptance.missingSignals,
      explanation: acceptance.canAccept
        ? [{ source: 'acceptance', message: 'All acceptance gates are satisfied.', command: CONTROL_COMMANDS.accept }]
        : blockerExplanations,
      commitIntent: {
        command: commitCommand?.command || CONTROL_COMMANDS.accept,
        control: primaryControl || 'accept',
        idempotencyKey: commitCommand?.idempotencyKey || `${EVENT_NAMESPACE}:accept:${tenantBoundary.scopeKey}:${runtime.requestId}`,
        dryRun: primaryControl === 'process-exit' ? processExitContract.ledgerEnvelope.dryRun : !acceptance.canAccept,
        writes: commitCommand?.writes || ['state', 'acceptedAt', 'commandLedger.accept'],
        proofFingerprint: auditProof.bundleFingerprint,
        tenantBoundary: tenantBoundary.auditSubject,
        boundaryFingerprint: boundaryContract.boundaryFingerprint
      }
    },
    processExitDecision: {
      schema: processExitContract.schema,
      outcome: processExitContract.outcome,
      requestedOutcome: processExitContract.requestedOutcome,
      effectiveOutcome: processExitContract.effectiveOutcome,
      outcomeSource: processExitContract.outcomeSource,
      forcedOverride: processExitContract.truthResolution.forcedOverride,
      truthResolution: processExitContract.truthResolution,
      terminal: processExitContract.terminal,
      valid: processExitContract.valid,
      status: processExitContract.status,
      permission: processExitContract.permission,
      providerContract: {
        ready: processExitContract.providerContract.ready,
        blockedProviders: processExitContract.providerContract.blockedProviders,
        repairPlan: processExitContract.providerContract.repairPlan
      },
      controlGate: processExitContract.controlGate,
      userDecision: processExitContract.userDecision,
      workflowHandoff: processExitContract.workflowHandoff,
      persistence: {
        schema: processExitContract.persistence.schema,
        restartDecision: processExitContract.persistence.restartDecision,
        restartSafeStatus: processExitContract.persistence.restartSafeStatus,
        recordableAfterRestart: processExitContract.persistence.recordableAfterRestart,
        idempotent: processExitContract.persistence.idempotent,
        statePatchCommand: processExitContract.persistence.statePatch.command,
        statePatchDryRun: processExitContract.persistence.statePatch.dryRun,
        recoveryCommands: processExitContract.persistence.recoveryCommands
      },
      blockingReasons: processExitContract.blockingReasons,
      warnings: processExitContract.warnings,
      ledgerEnvelope: processExitContract.ledgerEnvelope
    },
    validationSummaryCard: {
      ok: validation.ok && settingsValidation.ok,
      headline: validationTotals.blocking === 0
        ? 'Validation passed'
        : `${validationTotals.blocking} blocking validation issue${validationTotals.blocking === 1 ? '' : 's'}`,
      totals: validationTotals,
      blockingReasons: [
        ...validation.blockingReasons,
        ...settingsValidation.blockingReasons
      ],
      warningReasons: settingsValidation.warnings
    },
    nextStepDataContract: {
      queueKey: `${EVENT_NAMESPACE}:next-step:${tenantBoundary.scopeKey}:${runtime.requestId}`,
      empty: rankedNextSteps.length === 0,
      primary: rankedNextSteps[0] || null,
      queue: rankedNextSteps.slice(0, 8),
      publishEvent: `${EVENT_NAMESPACE}.client.next-step.ready`
    }
  };
}

function buildRoutePreviewAcceptanceContract({
  runtime,
  preview,
  acceptance,
  readiness,
  validation,
  settingsValidation,
  operationalHealth,
  nextAction,
  nextSteps,
  commands,
  workflowHandoff,
  providerContracts,
  lifecycleControlPlane,
  clientRuntimeState,
  tenantBoundary,
  boundaryContract,
  auditProof,
  processExitContract,
  persistenceShape,
  now
}) {
  const commandById = commands.reduce((acc, command) => {
    acc[command.id] = command;
    return acc;
  }, {});
  const routeDecision = buildRoutePreviewDecisionContract({
    runtime,
    preview,
    acceptance,
    readiness,
    validation,
    settingsValidation,
    operationalHealth,
    nextAction,
    nextSteps,
    commands,
    workflowHandoff,
    providerContracts,
    lifecycleControlPlane,
    clientRuntimeState,
    tenantBoundary,
    boundaryContract,
    auditProof,
    processExitContract,
    persistenceShape,
    now
  });
  const validationSections = [
    {
      id: 'runtime',
      label: 'Runtime readiness',
      status: validation.ok ? 'passed' : 'blocked',
      checks: validation.checks.map((check) => ({
        id: check.id,
        label: check.label,
        status: check.passed ? 'passed' : check.severity,
        blocking: !check.passed && check.severity === 'error'
      }))
    },
    {
      id: 'settings',
      label: 'Lifecycle controls',
      status: settingsValidation.ok ? 'passed' : 'blocked',
      checks: settingsValidation.checks.map((check) => ({
        id: check.id,
        label: check.label,
        status: check.passed ? 'passed' : check.severity,
        blocking: !check.passed && check.severity === 'error'
      }))
    },
    {
      id: 'tenant-boundary',
      label: 'Tenant boundary',
      status: tenantBoundary.isolated && tenantBoundary.commandAccess.accept.allowed ? 'passed' : 'blocked',
      checks: Object.values(tenantBoundary.commandAccess).map((access) => ({
        id: `permission-${access.control}`,
        label: access.permission,
        status: access.allowed ? 'passed' : 'error',
        blocking: !access.allowed,
        deniedReasons: [
          ...access.deniedReasons,
          ...(boundaryContract.controls[access.control]?.blockedReasons || [])
        ].filter((reason, index, reasons) => reasons.indexOf(reason) === index)
      }))
    },
    {
      id: 'providers',
      label: 'Hosted-kernel providers',
      status: providerContracts.ok && providerContracts.syncReady && providerContracts.eventStream.ready ? 'passed' : 'blocked',
      checks: [
        ...providerContracts.serviceContracts.map((contract) => ({
          id: `provider-${contract.provider}`,
          label: contract.provider,
          status: contract.negotiation.accepted && contract.sync.fresh ? 'passed' : 'error',
          blocking: !contract.negotiation.accepted || !contract.sync.fresh,
          endpoint: contract.endpoint
        })),
        {
          id: 'provider-event-stream',
          label: 'Provider event stream',
          status: providerContracts.eventStream.ready ? 'passed' : 'warning',
          blocking: false,
          rejectedEvents: providerContracts.eventStream.rejectedCount,
          refreshActions: providerContracts.eventStream.refreshActions.length
        }
      ]
    }
  ];
  const acceptanceChecklist = REQUIRED_ACCEPTANCE_SIGNALS.map((signal) => ({
    id: signal,
    label: signal
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, (char) => char.toUpperCase()),
    status: signal === 'proofCaptured'
      ? (auditProof.ready ? 'received' : auditProof.signalSatisfied ? 'reconcile-required' : 'missing')
      : acceptance.receivedSignals.includes(signal) ? 'received' : 'missing',
    required: true,
    captureCommand: signal === 'proofCaptured' ? CONTROL_COMMANDS.proof : CONTROL_COMMANDS.preview,
    evidence: signal === 'proofCaptured'
      ? {
        proofCount: auditProof.proofCount,
        persistedProofCount: auditProof.persistedProofCount,
        bundleFingerprint: auditProof.bundleFingerprint,
        repairCommand: auditProof.reconciliation.repairCommand,
        gaps: auditProof.gaps
      }
      : null
  }));
  const nextStepQueue = nextSteps
    .map((step, index) => ({
      id: step.id,
      label: step.label,
      reason: step.reason,
      action: step.action,
      control: step.control || null,
      provider: step.provider || null,
      retryable: Boolean(step.retryable),
      retryAfterMs: step.retryAfterMs ?? null,
      readyAt: step.readyAt || null,
      rank: rankNextStep(step, index)
    }))
    .sort((left, right) => left.rank - right.rank)
    .slice(0, 6);
  const primaryCommand = commandById[nextAction.control] || commands.find((command) => command.command === nextAction.primaryCommand);

  return {
    schema: 'aios.kernel.lifecycle.exit.route-preview-acceptance.v1',
    generatedAt: now,
    route: {
      mount: DEFAULT_ROUTE_MOUNT,
      activeRoute: runtime.route,
      requestId: runtime.requestId,
      sessionId: runtime.sessionId,
      runtimeStateKey: clientRuntimeState.stateKey,
      routePatchRequired: clientRuntimeState.route.patchRequired,
      resumeRestorable: clientRuntimeState.resume.restorable,
      tenantBoundary: tenantBoundary.auditSubject,
      boundaryFingerprint: boundaryContract.boundaryFingerprint,
      eventNamespace: EVENT_NAMESPACE
    },
    previewPanel: {
      title: preview.title,
      summary: preview.summary,
      state: preview.state,
      badges: preview.badges,
      visibleActions: preview.visibleActions,
      readOnly: operationalHealth.degradedMode.previewReadOnly,
      healthStatus: operationalHealth.status,
      payloadFingerprint: routeDecision.previewPayload.fingerprint
    },
    routeDecision,
    readinessRibbon: {
      status: readiness.status,
      auditReady: readiness.auditReady,
      handoffReady: readiness.handoffReady,
      providerContracts: readiness.providerContracts,
      providerSync: readiness.providerSync,
      restartStatus: persistenceShape.restartStatus,
      degradedMode: readiness.degradedMode,
      processExit: processExitContract.status
    },
    primaryAction: {
      state: nextAction.state,
      label: nextAction.primaryLabel,
      command: nextAction.primaryCommand,
      control: nextAction.control,
      idempotencyKey: primaryCommand?.idempotencyKey || null,
      dispatchable: nextAction.control ? Boolean(lifecycleControlPlane.controls[nextAction.control]?.dispatchable) : false,
      dispatchEnvelope: nextAction.control ? lifecycleControlPlane.controls[nextAction.control]?.dispatchEnvelope || null : null,
      disabledReason: nextAction.state === 'ready' || nextAction.state === 'accept-ready' || nextAction.state === 'work-ready'
        ? null
        : nextAction.reason,
      readyAt: nextAction.readyAt
    },
    acceptanceChecklist,
    validationSections,
    validationSummary: {
      ok: validation.ok && settingsValidation.ok,
      passedCount: validation.passedCount + settingsValidation.checks.filter((check) => check.passed).length,
      failedCount: validation.failedCount + settingsValidation.checks.filter((check) => !check.passed).length,
      blockingReasons: [
        ...validation.blockingReasons,
        ...settingsValidation.blockingReasons,
        ...acceptance.blockedByProviders.map((item) => item.message),
        ...acceptance.blockedByPermissions.map((item) => item.message)
      ],
      warnings: settingsValidation.warnings
    },
    tenantBoundary: {
      schema: boundaryContract.schema,
      mode: boundaryContract.mode,
      safeToPreview: boundaryContract.safeToPreview,
      safeToWriteProof: boundaryContract.safeToWriteProof,
      safeToAccept: boundaryContract.safeToAccept,
      safeToHandoff: boundaryContract.safeToHandoff,
      isolationRequired: boundaryContract.isolationRequired,
      forkRequired: boundaryContract.forkRequired,
      isolationActions: boundaryContract.isolationActions,
      auditHandoffEnvelope: boundaryContract.auditHandoffEnvelope
    },
    nextStepQueue,
    lifecycleControlPlane: {
      schema: lifecycleControlPlane.schema,
      dispatchableControls: lifecycleControlPlane.dispatchableControls,
      repairControls: lifecycleControlPlane.repairControls,
      settingsUpdatePlan: lifecycleControlPlane.settingsUpdatePlan
    },
    handoff: {
      status: workflowHandoff.status,
      target: workflowHandoff.target,
      label: processExitContract.workflowHandoff.canOpen
        ? processExitContract.workflowHandoff.label
        : workflowHandoff.userVisibleLabel,
      mode: processExitContract.workflowHandoff.canOpen
        ? processExitContract.workflowHandoff.mode
        : workflowHandoff.userVisibleMode,
      command: processExitContract.workflowHandoff.command || workflowHandoff.nextAction,
      pendingReasons: processExitContract.workflowHandoff.canOpen
        ? []
        : processExitContract.workflowHandoff.blockedReasons.length > 0
          ? processExitContract.workflowHandoff.blockedReasons
          : workflowHandoff.pendingReasons,
      requestedChannel: clientRuntimeState.handoff.requestedChannel,
      hydrationRequired: clientRuntimeState.hydrationPatch.dryRun === false || processExitContract.workflowHandoff.clientPatch.dryRun === false,
      processExitWorkflow: processExitContract.workflowHandoff
    },
    clientRuntimeState: {
      schema: clientRuntimeState.schema,
      request: clientRuntimeState.request,
      route: clientRuntimeState.route,
      resume: clientRuntimeState.resume,
      hydrationPatch: clientRuntimeState.hydrationPatch,
      handoff: clientRuntimeState.handoff
    },
    persistenceRecovery: {
      schema: persistenceShape.schema,
      snapshotMode: persistenceShape.snapshotMode,
      restartStatus: persistenceShape.restartStatus,
      writeIntent: persistenceShape.writeIntent,
      recoveryCheckpoints: persistenceShape.recoveryCheckpoints,
      commandReplay: persistenceShape.commandReplay,
      userVisibleStatus: persistenceShape.userVisibleStatus
    },
    processExit: {
      schema: processExitContract.schema,
      outcome: processExitContract.outcome,
      requestedOutcome: processExitContract.requestedOutcome,
      effectiveOutcome: processExitContract.effectiveOutcome,
      outcomeSource: processExitContract.outcomeSource,
      forcedOverride: processExitContract.truthResolution.forcedOverride,
      truthResolution: processExitContract.truthResolution,
      terminal: processExitContract.terminal,
      valid: processExitContract.valid,
      status: processExitContract.status,
      permission: processExitContract.permission,
      providerContract: processExitContract.providerContract,
      controlGate: processExitContract.controlGate,
      userDecision: processExitContract.userDecision,
      workflowHandoff: processExitContract.workflowHandoff,
      checks: processExitContract.checks,
      blockingReasons: processExitContract.blockingReasons,
      ledgerEnvelope: processExitContract.ledgerEnvelope,
      claim: processExitContract.claim,
      kill: processExitContract.kill,
      quarantine: processExitContract.quarantine
    },
    auditProof: {
      schema: auditProof.schema,
      ready: auditProof.ready,
      signalSatisfied: auditProof.signalSatisfied,
      writeReady: auditProof.writeReady,
      bundleFingerprint: auditProof.bundleFingerprint,
      reconciliation: auditProof.reconciliation,
      appendEnvelope: auditProof.appendEnvelope,
      gaps: auditProof.gaps
    },
    providerEvents: {
      schema: providerContracts.eventStream.schema,
      ready: providerContracts.eventStream.ready,
      acceptedCount: providerContracts.eventStream.acceptedCount,
      rejectedCount: providerContracts.eventStream.rejectedCount,
      refreshActions: providerContracts.eventStream.refreshActions,
      latestHandoffSignal: providerContracts.eventStream.latestHandoffSignal
    }
  };
}

function normalizePositiveInteger(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? Math.floor(numeric) : fallback;
}

function normalizeAnalyticsExportCursor(value, runtime, now) {
  const source = asRecord(value);
  const watermarkAt = normalizeString(source.watermarkAt || source.lastExportedAt || source.cursorAt, null);
  const lastSnapshotId = normalizeString(source.lastSnapshotId || source.snapshotId, null);
  const sequence = normalizePositiveInteger(source.sequence || source.offset, 0);
  const scope = normalizeString(source.scope || source.scopeKey, null);

  return {
    cursorKey: normalizeString(source.cursorKey || source.key, `${EVENT_NAMESPACE}:analytics-cursor:${runtime.requestId}`),
    watermarkAt,
    lastSnapshotId,
    sequence,
    scope,
    generatedAt: now,
    stale: Boolean(watermarkAt && Number.isFinite(Date.parse(watermarkAt)) && Date.parse(watermarkAt) > Date.parse(now)),
    resumeToken: normalizeString(source.resumeToken || source.token, null)
  };
}

function normalizeAnalyticsHistory(value, now) {
  const entries = Array.isArray(value) ? value : Object.values(asRecord(value));
  return entries
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry, index) => {
      const record = asRecord(entry);
      const capturedAt = normalizeString(record.capturedAt || record.generatedAt || record.at, now);
      const counters = asRecord(record.counters || record.metrics);
      const processExit = asRecord(record.processExit || record.exit || record.exitOutcome);
      const outcome = normalizeProcessExitOutcome(
        record.processExitOutcome || record.outcome || processExit.outcome,
        null
      );
      return {
        id: normalizeString(record.id || record.snapshotId, `history-${index + 1}`),
        capturedAt,
        requestId: normalizeString(record.requestId, null),
        state: EXIT_STATES.has(record.state) ? record.state : normalizeString(record.state, 'preview'),
        readinessStatus: normalizeString(record.readinessStatus || record.readiness, 'unknown'),
        acceptanceStatus: normalizeString(record.acceptanceStatus || record.acceptance, 'unknown'),
        healthStatus: normalizeString(record.healthStatus || record.health, 'unknown'),
        processExitOutcome: outcome,
        processExitStatus: normalizeString(record.processExitStatus || processExit.status, outcome ? 'unknown' : null),
        processExitValid: asBoolean(record.processExitValid ?? processExit.valid),
        processExitBlockedCount: normalizePositiveInteger(record.processExitBlockedCount ?? counters.processExitBlockedCount, 0),
        processExitWarningCount: normalizePositiveInteger(record.processExitWarningCount ?? counters.processExitWarningCount, 0),
        proofCount: normalizePositiveInteger(record.proofCount ?? counters.proofCount, 0),
        persistedProofCount: normalizePositiveInteger(record.persistedProofCount ?? counters.persistedProofCount, 0),
        blockedCount: normalizePositiveInteger(record.blockedCount ?? counters.blockedCount, 0),
        commandAvailableCount: normalizePositiveInteger(record.commandAvailableCount ?? counters.commandAvailableCount, 0),
        providerStaleSyncCount: normalizePositiveInteger(record.providerStaleSyncCount ?? counters.providerStaleSyncCount, 0),
        healthFailureCount: normalizePositiveInteger(record.healthFailureCount ?? counters.healthFailureCount, 0),
        nextAction: normalizeString(record.nextAction || record.primaryCommand, null)
      };
    });
}

function deriveHistoryDeltas(history) {
  return history.map((snapshot, index) => {
    const previous = history[index - 1] || null;
    const delta = previous
      ? {
        proofCount: snapshot.proofCount - previous.proofCount,
        persistedProofCount: snapshot.persistedProofCount - previous.persistedProofCount,
        blockedCount: snapshot.blockedCount - previous.blockedCount,
        commandAvailableCount: snapshot.commandAvailableCount - previous.commandAvailableCount,
        providerStaleSyncCount: snapshot.providerStaleSyncCount - previous.providerStaleSyncCount,
        healthFailureCount: snapshot.healthFailureCount - previous.healthFailureCount,
        processExitBlockedCount: snapshot.processExitBlockedCount - previous.processExitBlockedCount,
        processExitWarningCount: snapshot.processExitWarningCount - previous.processExitWarningCount
      }
      : {
        proofCount: 0,
        persistedProofCount: 0,
        blockedCount: 0,
        commandAvailableCount: 0,
        providerStaleSyncCount: 0,
        healthFailureCount: 0,
        processExitBlockedCount: 0,
        processExitWarningCount: 0
      };

    return {
      snapshotId: snapshot.id,
      previousSnapshotId: previous?.id || null,
      capturedAt: snapshot.capturedAt,
      requestId: snapshot.requestId,
      readinessChanged: Boolean(previous && previous.readinessStatus !== snapshot.readinessStatus),
      acceptanceChanged: Boolean(previous && previous.acceptanceStatus !== snapshot.acceptanceStatus),
      healthChanged: Boolean(previous && previous.healthStatus !== snapshot.healthStatus),
      nextActionChanged: Boolean(previous && previous.nextAction !== snapshot.nextAction),
      processExitChanged: Boolean(previous && (
        previous.processExitOutcome !== snapshot.processExitOutcome
        || previous.processExitStatus !== snapshot.processExitStatus
        || previous.processExitValid !== snapshot.processExitValid
      )),
      delta
    };
  });
}

function countProcessExitOutcomes(history, processExitContract) {
  const initial = [...PROCESS_EXIT_OUTCOMES].reduce((acc, outcome) => {
    acc.byOutcome[outcome] = 0;
    return acc;
  }, {
    totalSnapshots: history.length,
    byOutcome: {},
    valid: 0,
    blocked: 0,
    warningCount: 0,
    forcedOverride: processExitContract.truthResolution.forcedOverride,
    currentOutcome: processExitContract.outcome,
    currentStatus: processExitContract.status
  });

  return history.reduce((acc, snapshot) => {
    if (snapshot.processExitOutcome) acc.byOutcome[snapshot.processExitOutcome] += 1;
    if (snapshot.processExitValid) acc.valid += 1;
    if (snapshot.processExitStatus === 'contract-blocked') acc.blocked += 1;
    acc.warningCount += snapshot.processExitWarningCount;
    return acc;
  }, initial);
}

function groupTimelineForReporting(timeline) {
  return timeline.reduce((acc, event) => {
    const bucket = event.kind || 'unknown';
    if (!acc[bucket]) {
      acc[bucket] = {
        kind: bucket,
        count: 0,
        firstAt: event.at || null,
        lastAt: event.at || null,
        statuses: {}
      };
    }
    acc[bucket].count += 1;
    if (event.at && (!acc[bucket].firstAt || event.at < acc[bucket].firstAt)) acc[bucket].firstAt = event.at;
    if (event.at && (!acc[bucket].lastAt || event.at > acc[bucket].lastAt)) acc[bucket].lastAt = event.at;
    acc[bucket].statuses[event.status || 'unknown'] = (acc[bucket].statuses[event.status || 'unknown'] || 0) + 1;
    return acc;
  }, {});
}

function countCommandStatuses(commands) {
  return commands.reduce((acc, command) => {
    acc.total += 1;
    acc[command.status] = (acc[command.status] || 0) + 1;
    if (command.status === 'available') acc.available += 1;
    if (command.status === 'blocked' || command.status === 'disabled' || command.status === 'expired') acc.blocked += 1;
    if (command.status === 'completed') acc.completed += 1;
    return acc;
  }, {
    total: 0,
    available: 0,
    blocked: 0,
    completed: 0
  });
}

function buildExitAnalyticsExportReadiness({
  exportManifest,
  exportRow,
  timeline,
  history,
  validation,
  settingsValidation,
  operationalHealth,
  auditProof,
  providerContracts,
  processExitContract,
  runtime,
  tenantBoundary,
  now
}) {
  const staleCursor = exportManifest.cursor.staleCursor === true;
  const missingPartition = !tenantBoundary.tenantId || !tenantBoundary.workspaceId || !runtime.requestId;
  const providerRepairRequired = providerContracts.serviceContracts.some((contract) => (
    contract.negotiation.blockingReasons.length > 0 || (contract.sync.required && !contract.sync.fresh)
  ));
  const eventStreamBlocked = providerContracts.eventStream.rejectedEvents.some((event) => (
    event.status === 'cross-scope' || event.status === 'unknown-provider'
  ));
  const auditCsvSink = exportManifest.sinks.find((sink) => sink.id === 'audit-csv');
  const jsonlSink = exportManifest.sinks.find((sink) => sink.id === 'ops-jsonl');
  const blockers = [
    ...(!validation.ok ? [{
      code: 'runtime_validation_blocked',
      message: 'Exit-contract analytics export is blocked until runtime validation passes.',
      command: 'kernel.lifecycle.exit.preview'
    }] : []),
    ...(!settingsValidation.ok ? [{
      code: 'settings_validation_blocked',
      message: 'Lifecycle settings must be repaired before analytics export is considered route-ready.',
      command: 'kernel.lifecycle.exit.settings.validate'
    }] : []),
    ...(missingPartition ? [{
      code: 'analytics_partition_incomplete',
      message: 'Analytics export partition requires tenantId, workspaceId, and requestId.',
      command: 'kernel.lifecycle.exit.tenant.bind'
    }] : []),
    ...(staleCursor ? [{
      code: 'analytics_cursor_from_future',
      message: 'Analytics export cursor watermark is later than the current contract time.',
      command: 'kernel.lifecycle.exit.analytics.cursor.repair'
    }] : []),
    ...(processExitContract.terminal && !processExitContract.valid ? [{
      code: 'terminal_process_exit_not_recordable',
      message: `${processExitContract.outcome} process exit is terminal but not recordable.`,
      command: processExitContract.controlGate.nextAction.command
    }] : []),
    ...(eventStreamBlocked ? [{
      code: 'provider_event_stream_blocked',
      message: 'Provider event stream contains cross-scope or unknown-provider records.',
      command: `${EVENT_NAMESPACE}.provider.events.sync`
    }] : [])
  ];
  const warnings = [
    ...(operationalHealth.status !== 'healthy' ? [{
      code: 'operational_health_not_healthy',
      message: `Operational health is ${operationalHealth.status}; export remains visible for remediation.`,
      command: `${EVENT_NAMESPACE}.health.inspect`
    }] : []),
    ...(providerRepairRequired ? [{
      code: 'provider_contract_repair_required',
      message: 'One or more provider service contracts need negotiation or sync repair.',
      command: 'kernel.lifecycle.exit.provider.negotiate'
    }] : []),
    ...(!auditProof.ready ? [{
      code: 'audit_proof_not_ready',
      message: auditProof.gaps[0] || 'Audit proof is not ready for durable acceptance.',
      command: auditProof.reconciliation.repairCommand || CONTROL_COMMANDS.proof
    }] : []),
    ...(timeline.length === 0 ? [{
      code: 'empty_analytics_timeline',
      message: 'Analytics timeline is empty for this route preview.',
      command: `${EVENT_NAMESPACE}.analytics.timeline.refresh`
    }] : []),
    ...(auditCsvSink && !auditCsvSink.ready ? [{
      code: 'audit_csv_sink_not_ready',
      message: 'Audit CSV sink is not ready because validation and proof signals are incomplete.',
      command: CONTROL_COMMANDS.proof
    }] : [])
  ];
  const publishableSinks = exportManifest.sinks
    .filter((sink) => sink.ready)
    .map((sink) => sink.id);
  const blockedSinks = exportManifest.sinks
    .filter((sink) => !sink.ready)
    .map((sink) => sink.id);
  const requiredActions = [
    ...blockers.map((blocker, index) => ({
      id: `exit-export-blocker-${index + 1}`,
      severity: 'blocker',
      code: blocker.code,
      command: blocker.command,
      reason: blocker.message
    })),
    ...warnings.slice(0, 4).map((warning, index) => ({
      id: `exit-export-warning-${index + 1}`,
      severity: 'warning',
      code: warning.code,
      command: warning.command,
      reason: warning.message
    }))
  ];
  const status = blockers.length > 0
    ? 'blocked'
    : warnings.length > 0
      ? 'ready-with-warnings'
      : 'ready';

  return {
    schema: `aios.kernel.lifecycle.exit.analytics-export-readiness.v${ANALYTICS_EXPORT_SCHEMA_VERSION}`,
    generatedAt: now,
    status,
    ready: blockers.length === 0,
    exportable: blockers.length === 0 && (publishableSinks.length > 0 || Boolean(jsonlSink?.ready)),
    manifestKey: exportManifest.manifestKey,
    cursorKey: exportManifest.cursor.cursorKey,
    nextSequence: exportManifest.cursor.nextSequence,
    tenantBoundary: tenantBoundary.auditSubject,
    partition: exportManifest.partition,
    route: runtime.route,
    rowFingerprint: deriveFingerprint(exportRow),
    timelineEventCount: timeline.length,
    historySnapshotCount: history.length,
    publishableSinks,
    blockedSinks,
    blockers,
    warnings,
    requiredActions,
    nextAction: requiredActions[0]?.command || (status === 'ready' ? `${EVENT_NAMESPACE}.analytics.export.publish` : `${EVENT_NAMESPACE}.analytics.export.review`),
    routePreviewPatch: {
      analyticsExportStatus: status,
      analyticsExportReady: blockers.length === 0,
      analyticsExportManifestKey: exportManifest.manifestKey,
      analyticsExportNextSequence: exportManifest.cursor.nextSequence,
      analyticsExportBlockedSinkCount: blockedSinks.length
    }
  };
}

function buildAnalyticsExports({
  input,
  now,
  state,
  runtime,
  readiness,
  acceptance,
  operationalHealth,
  validation,
  settingsValidation,
  lifecycleSettings,
  persistedState,
  providerContracts,
  tenantBoundary,
  boundaryContract,
  commands,
  lifecycleControlPlane,
  evidence,
  auditProof,
  workflowHandoff,
  processExitContract,
  nextAction,
  recovery,
  persistenceShape
}) {
  const suppliedAnalytics = asRecord(input.analytics || input.reporting || input.telemetry);
  const suppliedHistory = suppliedAnalytics.history || suppliedAnalytics.snapshots || input.historySnapshots || input.analyticsHistory;
  const suppliedCursor = suppliedAnalytics.cursor || suppliedAnalytics.exportCursor || input.analyticsExportCursor;
  const exportCursor = normalizeAnalyticsExportCursor(suppliedCursor, runtime, now);
  const commandCounts = countCommandStatuses(commands);
  const providerCounts = providerContracts.providers.reduce((acc, provider) => {
    acc.total += 1;
    if (provider.negotiated) acc.negotiated += 1;
    if (provider.status === 'degraded') acc.degraded += 1;
    if (provider.status === 'offline' || provider.status === 'unauthorized') acc.failed += 1;
    if (provider.sync.required && !provider.sync.fresh) acc.staleSync += 1;
    return acc;
  }, {
    total: 0,
    negotiated: 0,
    degraded: 0,
    failed: 0,
    staleSync: 0
  });
  const providerServiceCounts = providerContracts.serviceContracts.reduce((acc, contract) => {
    acc.total += 1;
    if (contract.negotiation.accepted) acc.accepted += 1;
    if (contract.negotiation.blockingReasons.length > 0) acc.repairRequired += 1;
    if (contract.sync.fresh) acc.freshSync += 1;
    if (contract.externalHandoff?.state && contract.externalHandoff.state !== 'not-opened') acc.externalHandoffActive += 1;
    return acc;
  }, {
    total: 0,
    accepted: 0,
    repairRequired: 0,
    freshSync: 0,
    externalHandoffActive: 0
  });
  const providerEventCounts = providerContracts.eventStream.events.reduce((acc, event) => {
    acc.total += 1;
    if (event.status === 'accepted') acc.accepted += 1;
    if (event.status !== 'accepted') acc.rejected += 1;
    if (event.status === 'stale') acc.stale += 1;
    if (event.provider === 'handoff-gateway' && event.status === 'accepted') acc.handoff += 1;
    if (event.provider === 'proof-sink' && event.status === 'accepted') acc.proof += 1;
    return acc;
  }, {
    total: 0,
    accepted: 0,
    rejected: 0,
    stale: 0,
    handoff: 0,
    proof: 0
  });
  const signalCounters = REQUIRED_ACCEPTANCE_SIGNALS.reduce((acc, signal) => {
    if (acceptance.receivedSignals.includes(signal)) acc.received += 1;
    if (acceptance.missingSignals.includes(signal)) acc.missing += 1;
    return acc;
  }, {
    required: REQUIRED_ACCEPTANCE_SIGNALS.length,
    received: 0,
    missing: 0
  });
  const blockedCount = acceptance.blockedByHealth.length
    + acceptance.blockedBySettings.length
    + acceptance.blockedByProviders.length
    + acceptance.blockedByPermissions.length
    + validation.blockingReasons.length
    + settingsValidation.blockingReasons.length;
  const currentSnapshot = {
    id: `${EVENT_NAMESPACE}:snapshot:${runtime.requestId}:${now}`,
    capturedAt: now,
    requestId: runtime.requestId,
    tenantId: tenantBoundary.tenantId,
    workspaceId: tenantBoundary.workspaceId,
    state,
    readinessStatus: readiness.status,
    acceptanceStatus: acceptance.status,
    healthStatus: operationalHealth.status,
    processExitOutcome: processExitContract.outcome,
    processExitStatus: processExitContract.status,
    processExitValid: processExitContract.valid,
    processExitBlockedCount: processExitContract.blockingReasons.length,
    processExitWarningCount: processExitContract.warnings.length,
    proofCount: evidence.length,
    persistedProofCount: persistedState.proofCount,
    blockedCount,
    commandAvailableCount: commandCounts.available,
    providerStaleSyncCount: providerCounts.staleSync,
    healthFailureCount: operationalHealth.failures.length,
    nextAction: nextAction.primaryCommand
  };
  const history = [
    ...normalizeAnalyticsHistory(suppliedHistory, now).slice(-9),
    currentSnapshot
  ];
  const historyDeltas = deriveHistoryDeltas(history);
  const processExitCounts = countProcessExitOutcomes(history, processExitContract);
  const processExitTimeline = [
    ...history
      .filter((snapshot) => snapshot.processExitOutcome)
      .map((snapshot) => ({
        id: `process-exit-snapshot-${snapshot.id}`,
        at: snapshot.capturedAt,
        kind: 'process-exit',
        label: `${snapshot.processExitOutcome}:${snapshot.processExitStatus}`,
        status: snapshot.processExitValid ? 'valid' : 'blocked',
        outcome: snapshot.processExitOutcome,
        requestId: snapshot.requestId
      })),
    ...processExitContract.checks.map((check) => ({
      id: `process-exit-check-${check.id}`,
      at: now,
      kind: 'process-exit-check',
      label: check.label,
      status: check.passed ? 'passed' : check.severity,
      outcome: processExitContract.outcome,
      command: check.command,
      remediationKey: check.remediationKey
    }))
  ];
  const timeline = [
    ...history.map((snapshot) => ({
      id: `snapshot-${snapshot.id}`,
      at: snapshot.capturedAt,
      kind: 'history-snapshot',
      label: `${snapshot.readinessStatus} / ${snapshot.acceptanceStatus}`,
      status: snapshot.healthStatus,
      requestId: snapshot.requestId
    })),
    ...commands.map((command) => ({
      id: `command-${command.id}`,
      at: command.schedule?.readyAt || now,
      kind: 'command',
      label: command.command,
      status: command.status,
      idempotencyKey: command.idempotencyKey
    })),
    ...operationalHealth.failures.map((failure) => ({
      id: `failure-${failure.id}`,
      at: failure.observedAt || now,
      kind: 'health-failure',
      label: failure.code,
      status: failure.severity,
      component: failure.component
    })),
    ...providerContracts.staleSyncProviders.map((provider) => ({
      id: `provider-sync-${provider}`,
      at: now,
      kind: 'provider-sync',
      label: `${provider} sync stale`,
      status: 'stale',
      provider,
      command: 'kernel.lifecycle.exit.provider.sync'
    })),
    ...providerContracts.eventStream.events.map((event) => ({
      id: `provider-event-${event.id}`,
      at: event.observedAt || now,
      kind: 'provider-event',
      label: `${event.provider}:${event.eventType}`,
      status: event.status,
      provider: event.provider,
      cursor: event.cursor,
      fingerprint: event.fingerprint
    })),
    ...recovery.actions.map((action) => ({
      id: `recovery-${action.id}`,
      at: now,
      kind: 'recovery-action',
      label: action.command,
      status: recovery.mode,
      idempotencyKey: action.idempotencyKey
    })),
    ...processExitTimeline
  ].sort((left, right) => String(left.at || '').localeCompare(String(right.at || '')));
  const timelineBuckets = groupTimelineForReporting(timeline);
  const counters = {
    signals: signalCounters,
    proofCount: evidence.length,
    persistedProofCount: persistedState.proofCount,
    commands: commandCounts,
    providers: providerCounts,
    providerServices: providerServiceCounts,
    providerEvents: providerEventCounts,
    tenantBoundary: {
      isolated: tenantBoundary.isolated,
      readOnly: tenantBoundary.readOnly,
      violationCount: tenantBoundary.violations.length,
      permissionCount: tenantBoundary.permissions.length,
      safeToAccept: boundaryContract.safeToAccept,
      safeToHandoff: boundaryContract.safeToHandoff,
      isolationRequired: boundaryContract.isolationRequired,
      forkRequired: boundaryContract.forkRequired,
      blockedControlCount: Object.values(boundaryContract.controls)
        .filter((control) => !control.dispatchable).length
    },
    auditProof: {
      ready: auditProof.ready,
      signalSatisfied: auditProof.signalSatisfied,
      writeReady: auditProof.writeReady,
      proofCount: auditProof.proofCount,
      persistedProofCount: auditProof.persistedProofCount,
      gapCount: auditProof.gaps.length,
      reconciliationStatus: auditProof.reconciliation.status
    },
    processExit: {
      ...processExitCounts,
      terminal: processExitContract.terminal,
      permissionStatus: processExitContract.permission.status,
      remediationRequired: processExitContract.remediation.required,
      remediationActionCount: processExitContract.remediation.actions.length,
      blockingReasonCount: processExitContract.blockingReasons.length,
      warningCount: processExitContract.warnings.length,
      ledgerDryRun: processExitContract.ledgerEnvelope.dryRun,
      workflowHandoffMode: processExitContract.workflowHandoff.mode,
      workflowHandoffCanOpen: processExitContract.workflowHandoff.canOpen,
      workflowHandoffBlockedCount: processExitContract.workflowHandoff.blockedReasons.length,
      workflowHandoffStatus: processExitContract.workflowHandoff.userVisibleStatus
    },
    healthFailures: operationalHealth.failures.length,
    actionableErrorCount: operationalHealth.actionableErrors.length,
    retryExhaustedCount: Object.values(operationalHealth.failureState.components)
      .filter((component) => component.retryExhausted).length,
    deadLetterCount: operationalHealth.failureState.deadLetter.length,
    degradedCapabilityCount: operationalHealth.failureState.degradedCapabilities.length,
    blockedCount,
    recoveryActionCount: recovery.actions.length,
    dispatchableControlCount: lifecycleControlPlane.dispatchableControls.length,
    settingsUpdatePlanCount: lifecycleControlPlane.settingsUpdatePlan.length,
    historySnapshotCount: history.length
  };
  const latestDelta = historyDeltas[historyDeltas.length - 1] || null;
  const exportRow = {
    generatedAt: now,
    requestId: runtime.requestId,
    sessionId: runtime.sessionId,
    tenantId: tenantBoundary.tenantId,
    workspaceId: tenantBoundary.workspaceId,
    scopeKey: tenantBoundary.scopeKey,
    boundaryMode: boundaryContract.mode,
    boundaryFingerprint: boundaryContract.boundaryFingerprint,
    boundaryBlockedControls: Object.values(boundaryContract.controls)
      .filter((control) => !control.dispatchable)
      .map((control) => control.control)
      .join('|'),
    route: runtime.route,
    state,
    readinessStatus: readiness.status,
    acceptanceStatus: acceptance.status,
    healthStatus: operationalHealth.status,
    retryExhaustedCount: Object.values(operationalHealth.failureState.components)
      .filter((component) => component.retryExhausted).length,
    deadLetterCount: operationalHealth.failureState.deadLetter.length,
    handoffStatus: workflowHandoff.status,
    nextCommand: nextAction.primaryCommand,
    proofCount: evidence.length,
    auditProofReady: auditProof.ready,
    auditProofFingerprint: auditProof.bundleFingerprint,
    auditProofReconciliation: auditProof.reconciliation.status,
    processExitOutcome: processExitContract.outcome,
    processExitRequestedOutcome: processExitContract.requestedOutcome,
    processExitEffectiveOutcome: processExitContract.effectiveOutcome,
    processExitStatus: processExitContract.status,
    processExitValid: processExitContract.valid,
    processExitTerminal: processExitContract.terminal,
    processExitOutcomeSource: processExitContract.outcomeSource,
    processExitForcedOverride: processExitContract.truthResolution.forcedOverride,
    processExitPermissionStatus: processExitContract.permission.status,
    processExitBlockingCount: processExitContract.blockingReasons.length,
    processExitWarningCount: processExitContract.warnings.length,
    processExitLedgerDryRun: processExitContract.ledgerEnvelope.dryRun,
    processExitWorkflowHandoffMode: processExitContract.workflowHandoff.mode,
    processExitWorkflowHandoffCanOpen: processExitContract.workflowHandoff.canOpen,
    processExitWorkflowHandoffChannel: processExitContract.workflowHandoff.requestedChannel,
    processExitWorkflowHandoffStatus: processExitContract.workflowHandoff.userVisibleStatus,
    processExitHistoryValidCount: processExitCounts.valid,
    processExitHistoryBlockedCount: processExitCounts.blocked,
    missingSignals: acceptance.missingSignals.join('|'),
    blockedCount,
    providerStaleSyncCount: providerCounts.staleSync,
    providerServiceRepairCount: providerServiceCounts.repairRequired,
    providerEventRejectedCount: providerEventCounts.rejected,
    providerEventAcceptedCount: providerEventCounts.accepted,
    commandBlockedCount: commandCounts.blocked,
    dispatchableControls: lifecycleControlPlane.dispatchableControls.join('|'),
    settingsUpdatePlanCount: lifecycleControlPlane.settingsUpdatePlan.length,
    historySnapshotCount: history.length,
    timelineEventCount: timeline.length,
    timelineKinds: Object.keys(timelineBuckets).join('|'),
    latestBlockedDelta: latestDelta?.delta.blockedCount ?? 0,
    latestProofDelta: latestDelta?.delta.proofCount ?? 0,
    latestProcessExitBlockedDelta: latestDelta?.delta.processExitBlockedCount ?? 0,
    latestProcessExitWarningDelta: latestDelta?.delta.processExitWarningCount ?? 0,
    exportCursorSequence: exportCursor.sequence + 1
  };
  const exportManifest = {
    manifestKey: `${EVENT_NAMESPACE}:analytics-export:${tenantBoundary.scopeKey}:${runtime.requestId}`,
    schema: `aios.kernel.lifecycle.exit.analytics-export.v${ANALYTICS_EXPORT_SCHEMA_VERSION}`,
    cursor: {
      ...exportCursor,
      nextSequence: exportCursor.sequence + 1,
      nextWatermarkAt: now,
      nextSnapshotId: currentSnapshot.id,
      staleCursor: exportCursor.stale
    },
    partition: {
      tenantId: tenantBoundary.tenantId,
      workspaceId: tenantBoundary.workspaceId,
      requestId: runtime.requestId,
      route: runtime.route,
      day: now.slice(0, 10)
    },
    sinks: [
      {
        id: 'ops-jsonl',
        format: 'jsonl',
        topic: `${EVENT_NAMESPACE}.analytics.snapshots`,
        recordKey: currentSnapshot.id,
        ready: true
      },
      {
        id: 'audit-csv',
        format: 'csv',
        topic: `${EVENT_NAMESPACE}.analytics.audit-report`,
        recordKey: `${tenantBoundary.scopeKey}:${runtime.requestId}`,
        ready: validation.ok || auditProof.signalSatisfied
      }
    ],
    retention: {
      snapshotLimit: 10,
      timelineLimit: 100,
      proofFingerprint: auditProof.bundleFingerprint,
      persistenceRestartStatus: persistenceShape?.restartStatus || null
    }
  };
  const exportReadiness = buildExitAnalyticsExportReadiness({
    exportManifest,
    exportRow,
    timeline,
    history,
    validation,
    settingsValidation,
    operationalHealth,
    auditProof,
    providerContracts,
    processExitContract,
    runtime,
    tenantBoundary,
    now
  });
  const reportSections = [
    {
      id: 'exit-readiness',
      label: 'Exit readiness',
      status: readiness.status,
      counters: {
        blockedCount,
        missingSignals: signalCounters.missing,
        dispatchableControls: lifecycleControlPlane.dispatchableControls.length
      }
    },
    {
      id: 'audit-proof',
      label: 'Audit proof',
      status: auditProof.ready ? 'ready' : auditProof.reconciliation.status,
      counters: {
        proofCount: auditProof.proofCount,
        persistedProofCount: auditProof.persistedProofCount,
        gapCount: auditProof.gaps.length
      }
    },
    {
      id: 'provider-sync',
      label: 'Provider sync',
      status: providerContracts.syncReady && providerContracts.eventStream.ready ? 'fresh' : 'stale',
      counters: {
        total: providerCounts.total,
        staleSync: providerCounts.staleSync,
        repairRequired: providerServiceCounts.repairRequired,
        eventRejected: providerEventCounts.rejected
      }
    },
    {
      id: 'process-exit',
      label: 'Process exit',
      status: processExitContract.status,
      counters: {
        outcome: processExitContract.outcome,
        valid: processExitContract.valid,
        blocked: processExitContract.blockingReasons.length,
        warnings: processExitContract.warnings.length,
        forcedOverride: processExitContract.truthResolution.forcedOverride
      }
    },
    {
      id: 'timeline',
      label: 'Timeline',
      status: operationalHealth.status,
      counters: Object.fromEntries(Object.entries(timelineBuckets).map(([kind, bucket]) => [kind, bucket.count]))
    }
  ];

  return {
    schema: `aios.kernel.lifecycle.exit.analytics.v${ANALYTICS_EXPORT_SCHEMA_VERSION}`,
    generatedAt: now,
    counters,
    history,
    historyDeltas,
    timeline,
    timelineBuckets,
    reportSections,
    exportManifest: {
      ...exportManifest,
      readiness: {
        status: exportReadiness.status,
        ready: exportReadiness.ready,
        exportable: exportReadiness.exportable,
        blockedSinks: exportReadiness.blockedSinks,
        requiredActions: exportReadiness.requiredActions
      }
    },
    exportReadiness,
    exportSummary: {
      ready: exportReadiness.ready && operationalHealth.status !== 'failed',
      format: 'jsonl-or-csv-row',
      row: exportRow,
      columns: Object.keys(exportRow),
      manifestKey: exportManifest.manifestKey,
      cursorKey: exportManifest.cursor.cursorKey,
      nextSequence: exportManifest.cursor.nextSequence,
      readinessStatus: exportReadiness.status,
      exportable: exportReadiness.exportable,
      nextAction: exportReadiness.nextAction,
      blockedSinkCount: exportReadiness.blockedSinks.length,
      blockerCount: exportReadiness.blockers.length,
      warningCount: exportReadiness.warnings.length,
      routePreviewPatch: exportReadiness.routePreviewPatch,
      labels: {
        subject: 'hosted-kernel exit contract',
        route: DEFAULT_ROUTE_MOUNT,
        auditMode: lifecycleSettings.auditMode
      }
    }
  };
}

export function describeExitContractSurface(input = {}) {
  const now = input.now || new Date().toISOString();
  const requestedState = typeof input.state === 'string' ? input.state : 'preview';
  const state = EXIT_STATES.has(requestedState) ? requestedState : 'preview';
  const evidence = normalizeEvidence(input.evidence);
  const signals = normalizeSignals(input.signals || input.acceptanceSignals);
  const clientRuntime = normalizeClientRuntime(input);
  const tenantBoundary = normalizeTenantBoundary(input, clientRuntime, now);
  const providerContracts = buildProviderContracts(input, clientRuntime, tenantBoundary, now);
  const lifecycleSettings = normalizeLifecycleSettings(input, clientRuntime, now);
  const persistedState = normalizePersistedExitState(input, clientRuntime, evidence, now, tenantBoundary);
  const boundaryContract = buildTenantBoundaryHandoffContract({
    tenantBoundary,
    runtime: clientRuntime,
    persistedState,
    now
  });
  const auditProof = buildAuditProofContract({
    evidence,
    signals,
    runtime: clientRuntime,
    persistedState,
    providerContracts,
    tenantBoundary,
    now
  });
  const validation = buildValidationSummary({ signals, evidence, state, tenantBoundary, boundaryContract });
  const settingsValidation = validateLifecycleSettings({ lifecycleSettings, signals, evidence, validation });
  const operationalHealth = buildOperationalHealth({
    input,
    signals,
    evidence,
    runtime: clientRuntime,
    persistedState,
    validation,
    providerContracts,
    tenantBoundary,
    now
  });
  const acceptance = buildAcceptance({
    signals,
    validation,
    operationalHealth,
    lifecycleSettings,
    settingsValidation,
    providerContracts,
    auditProof,
    tenantBoundary,
    boundaryContract
  });
  const clientRuntimeState = buildClientRuntimeStateContract({
    input,
    runtime: clientRuntime,
    persistedState,
    tenantBoundary,
    providerContracts,
    now
  });
  const workflowHandoff = buildWorkflowHandoff({
    acceptance,
    runtime: clientRuntime,
    validation,
    providerContracts,
    tenantBoundary,
    boundaryContract,
    clientRuntimeState
  });
  const processExitContract = buildProcessExitContract({
    input,
    state,
    runtime: clientRuntime,
    acceptance,
    validation,
    settingsValidation,
    operationalHealth,
    providerContracts,
    tenantBoundary,
    boundaryContract,
    lifecycleSettings,
    auditProof,
    persistedState,
    workflowHandoff,
    now
  });
  const healthLimitedStatus = operationalHealth.status === 'failed'
    ? 'blocked'
    : operationalHealth.status === 'degraded'
      ? 'degraded'
      : null;
  const settingsLimitedStatus = settingsValidation.ok
    ? null
    : lifecycleSettings.enabled
      ? 'settings-blocked'
      : 'disabled';
  const processExitLimitedStatus = processExitContract.valid
    ? null
    : `${processExitContract.outcome}-exit-blocked`;
  const readiness = {
    status: processExitLimitedStatus || healthLimitedStatus || settingsLimitedStatus || (validation.ok ? (acceptance.canAccept ? 'ready' : 'needs-acceptance') : 'blocked'),
    previewAvailable: lifecycleSettings.controls.preview.available,
    routeContractVersion: 1,
    auditReady: evidence.length > 0 || signals.proofCaptured,
    handoffReady: workflowHandoff.status === 'ready' && lifecycleSettings.controls.handoff.available,
    operationalHealth: operationalHealth.status,
    degradedMode: operationalHealth.degradedMode.enabled,
    providerContracts: providerContracts.ok ? 'negotiated' : 'blocked',
    providerSync: providerContracts.syncReady ? 'fresh' : 'stale',
    lifecycleControls: {
      enabled: lifecycleSettings.enabled,
      auditMode: lifecycleSettings.auditMode,
      safeMode: lifecycleSettings.safeMode,
      invalidControls: lifecycleSettings.invalidControls
    },
    processExit: {
      outcome: processExitContract.outcome,
      requestedOutcome: processExitContract.requestedOutcome,
      effectiveOutcome: processExitContract.effectiveOutcome,
      outcomeSource: processExitContract.outcomeSource,
      forcedOverride: processExitContract.truthResolution.forcedOverride,
      terminal: processExitContract.terminal,
      valid: processExitContract.valid,
      status: processExitContract.status,
      permissionStatus: processExitContract.permission.status,
      permissionAccess: processExitContract.permission.access,
      controlGateStatus: processExitContract.controlGate.status,
      controlGateNextAction: processExitContract.controlGate.nextAction.command
    }
  };
  const recovery = buildRecoveryPlan({ persistedState, runtime: clientRuntime, validation, acceptance, tenantBoundary });
  const commands = buildIdempotentCommands({
    acceptance,
    runtime: clientRuntime,
    persistedState,
    recovery,
    lifecycleSettings,
    tenantBoundary,
    boundaryContract
  });
  const restartSafeStatus = deriveRestartSafeStatus({
    readiness,
    acceptance,
    persistedState,
    recovery,
    commands
  });
  const persistenceShape = buildRestartPersistenceShape({
    persistedState,
    runtime: clientRuntime,
    evidence,
    auditProof,
    providerContracts,
    tenantBoundary,
    boundaryContract,
    commands,
    recovery,
    restartSafeStatus,
    now
  });
  const lifecycleControlPlane = buildLifecycleControlPlane({
    commands,
    lifecycleSettings,
    tenantBoundary,
    boundaryContract,
    providerContracts,
    operationalHealth,
    auditProof,
    acceptance,
    runtime: clientRuntime,
    now
  });
  const persistedStateContract = buildPersistedStateContract({
    persistedState,
    runtime: clientRuntime,
    state,
    acceptance,
    auditProof,
    providerContracts,
    commands,
    recovery,
    persistenceShape,
    restartSafeStatus,
    now
  });
  const nextAction = buildLifecycleActionState({
    commands,
    acceptance,
    lifecycleSettings,
    operationalHealth,
    validation,
    workflowHandoff,
    lifecycleControlPlane,
    processExitContract
  });
  const clientWorkflowContract = buildClientWorkflowContract({
    runtime: clientRuntime,
    persistedState,
    acceptance,
    workflowHandoff,
    processExitContract,
    nextAction,
    commands,
    providerContracts,
    tenantBoundary,
    boundaryContract,
    lifecycleSettings,
    lifecycleControlPlane,
    clientRuntimeState,
    auditProof,
    persistedStateContract,
    persistenceShape,
    now
  });
  const analytics = buildAnalyticsExports({
    input,
    now,
    state,
    runtime: clientRuntime,
    readiness,
    acceptance,
    operationalHealth,
    validation,
    settingsValidation,
    lifecycleSettings,
    persistedState,
    providerContracts,
    tenantBoundary,
    boundaryContract,
    commands,
    lifecycleControlPlane,
    evidence,
    auditProof,
    workflowHandoff,
    processExitContract,
    nextAction,
    recovery,
    persistenceShape
  });
  const nextSteps = buildNextSteps({
    acceptance,
    validation,
    operationalHealth,
    lifecycleSettings,
    settingsValidation,
    providerContracts,
    processExitContract
  });
  const preview = {
    title: 'Hosted kernel exit contract',
    state,
    summary: validation.ok
      ? 'Kernel lifecycle exit can be previewed and accepted by the hosting route.'
      : 'Kernel lifecycle exit needs validation before acceptance.',
    visibleActions: acceptance.canAccept
      ? ['accept', 'continue-handoff', 'view-proof']
      : lifecycleSettings.enabled
        ? ['preview', 'resolve-validation', 'prepare-handoff']
        : ['enable-controls', 'view-proof'],
    badges: [
      readiness.status,
      workflowHandoff.status === 'ready' ? 'handoff-ready' : 'handoff-pending',
      readiness.auditReady ? 'audit-proof-ready' : 'audit-proof-missing',
      operationalHealth.status === 'healthy' ? 'health-ok' : `health-${operationalHealth.status}`,
      operationalHealth.degradedMode.enabled ? 'degraded-mode' : 'full-mode',
      lifecycleSettings.enabled ? 'controls-enabled' : 'controls-disabled',
      clientWorkflowContract.handoffIntent.enabled ? 'client-handoff-open' : 'client-handoff-prepare',
      clientRuntimeState.route.patchRequired ? 'client-runtime-hydration-required' : 'client-runtime-synced',
      clientRuntimeState.resume.restorable ? 'resume-state-restorable' : 'resume-state-missing',
      auditProof.ready ? 'audit-proof-contract-ready' : 'audit-proof-contract-blocked',
      analytics.exportSummary.ready ? 'analytics-export-ready' : 'analytics-export-blocked',
      `process-exit-${processExitContract.outcome}`,
      processExitContract.valid ? 'process-exit-contract-ready' : 'process-exit-contract-blocked',
      `process-exit-handoff-${processExitContract.workflowHandoff.userVisibleStatus}`,
      processExitContract.workflowHandoff.canOpen ? 'process-exit-handoff-open' : 'process-exit-handoff-repair'
    ]
  };
  const routePreviewAcceptance = buildRoutePreviewAcceptanceContract({
    runtime: clientRuntime,
    preview,
    acceptance,
    readiness,
    validation,
    operationalHealth,
    settingsValidation,
    nextAction,
    nextSteps,
    commands,
    workflowHandoff,
    providerContracts,
    lifecycleControlPlane,
    clientRuntimeState,
    tenantBoundary,
    boundaryContract,
    auditProof,
    processExitContract,
    persistenceShape,
    now
  });
  return {
    ok: validation.ok && processExitContract.valid,
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: 'hosted-kernel-lifecycle-exit-contract',
    state,
    preview,
    acceptance,
    readiness,
    operationalHealth,
    restartSafeStatus,
    validation,
    settingsValidation,
    lifecycleSettings,
    lifecycleControlPlane,
    processExitContract,
    nextAction,
    nextSteps,
    routePreviewAcceptance,
    clientRuntime,
    clientRuntimeState,
    tenantBoundary,
    boundaryContract,
    persistedState,
    providerContracts,
    providerSync: {
      ready: providerContracts.syncReady,
      staleProviders: providerContracts.staleSyncProviders,
      negotiatedCapabilities: providerContracts.negotiatedCapabilities,
      envelope: providerContracts.syncEnvelope,
      eventStream: providerContracts.eventStream
    },
    providerEvents: providerContracts.eventStream,
    externalHandoff: providerContracts.externalHandoff,
    recovery,
    persistenceShape,
    persistedStateContract,
    commands,
    workflowHandoff,
    clientWorkflowContract,
    analytics,
    proof: {
      count: evidence.length,
      items: evidence,
      contract: auditProof
    },
    routeIntegration: {
      mount: DEFAULT_ROUTE_MOUNT,
      activeRoute: clientRuntime.route,
      eventNamespace: EVENT_NAMESPACE,
      clientConsumes: [
        'preview',
        'acceptance',
        'readiness',
        'operationalHealth',
        'actionableErrors',
        'validation',
        'settingsValidation',
        'lifecycleSettings',
        'lifecycleControlPlane',
        'processExitContract',
        'processExitContract.workflowHandoff',
        'nextAction',
        'nextSteps',
        'routePreviewAcceptance',
        'proof',
        'proof.contract',
        'clientRuntime',
        'clientRuntimeState',
        'tenantBoundary',
        'boundaryContract',
        'workflowHandoff',
        'clientWorkflowContract',
        'persistenceShape',
        'persistedStateContract',
        'providerContracts',
        'providerContracts.serviceContracts',
        'providerSync',
        'providerSync.envelope',
        'providerSync.eventStream',
        'providerEvents',
        'externalHandoff',
        'analytics'
      ]
    },
    actionableErrors: operationalHealth.actionableErrors,
    evidence
  };
}

export default describeExitContractSurface;
