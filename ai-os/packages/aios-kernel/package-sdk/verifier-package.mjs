export const surfaceId = "aios_package-sdk_verifier-package_095";
export const surfaceGroup = "package-sdk";
export const surfaceName = "verifier-package";

const supportedCapabilities = Object.freeze([
  'hosted-kernel:package.verify',
  'hosted-kernel:package.proof.export',
  'hosted-kernel:provider.contract.sync',
  'hosted-kernel:handoff.prepare',
  'hosted-kernel:package.preview.accept'
]);

const requiredPackageFields = Object.freeze(['name', 'version', 'integrity']);
const supportedProofFormats = Object.freeze(['contract-v1', 'json-proof', 'audit-envelope']);
const supportedDeliveryChannels = Object.freeze(['client-state', 'handoff-envelope', 'download']);
const supportedRequestIntents = Object.freeze(['verify', 'preview', 'accept', 'export-proof', 'handoff']);
const supportedLifecycleCommands = Object.freeze(['verify-package', 'accept-preview', 'export-proof', 'return-to-client']);
const supportedScheduleCadences = Object.freeze(['manual', 'on-change', 'hourly', 'daily']);
const supportedProviderServiceOperations = Object.freeze([
  'resolve-package',
  'fetch-manifest',
  'verify-integrity',
  'sync-provider-state',
  'export-proof',
  'prepare-handoff'
]);
const supportedClientStateSlots = Object.freeze([
  'verifier.request',
  'verifier.preview',
  'verifier.readiness',
  'verifier.proof',
  'verifier.commands',
  'verifier.handoff'
]);
const supportedClientRuntimeEvents = Object.freeze([
  'verifier.preview.rendered',
  'verifier.acceptance.submitted',
  'verifier.proof.delivered',
  'verifier.workflow.returned'
]);
const requiredProviderContractClauses = Object.freeze([
  'package.identity',
  'package.integrity',
  'provider.sync',
  'tenant.boundary',
  'proof.export'
]);
const retryableOperationalFailures = Object.freeze([
  'provider-timeout',
  'provider-unavailable',
  'sync-conflict',
  'checkpoint-write-failed',
  'handoff-temporarily-unavailable'
]);
const degradedOperationalFailures = Object.freeze([
  'sync-stale',
  'audit-evidence-partial',
  'proof-delivery-delayed'
]);
const operationalFailureCatalog = Object.freeze({
  'provider-timeout': Object.freeze({
    category: 'provider',
    title: 'Provider verification request timed out',
    action: 'Retry the provider operation with the same idempotency key after backoff',
    blocks: ['verify-package', 'export-proof']
  }),
  'provider-unavailable': Object.freeze({
    category: 'provider',
    title: 'Provider verification service is unavailable',
    action: 'Wait for provider health to recover, then resume from the persisted checkpoint',
    blocks: ['verify-package', 'export-proof', 'return-to-client']
  }),
  'sync-conflict': Object.freeze({
    category: 'sync',
    title: 'Provider sync checkpoint has a conflict',
    action: 'Refresh provider sync metadata and reconcile the checkpoint cursor before accepting',
    blocks: ['accept-preview', 'export-proof']
  }),
  'checkpoint-write-failed': Object.freeze({
    category: 'persistence',
    title: 'Verifier checkpoint write failed',
    action: 'Retry checkpoint persistence before dispatching another lifecycle command',
    blocks: ['verify-package', 'accept-preview', 'export-proof', 'return-to-client']
  }),
  'handoff-temporarily-unavailable': Object.freeze({
    category: 'handoff',
    title: 'Client handoff route is temporarily unavailable',
    action: 'Keep proof state in client-state delivery and retry handoff when the route recovers',
    blocks: ['return-to-client']
  }),
  'sync-stale': Object.freeze({
    category: 'sync',
    title: 'Provider sync data is stale',
    action: 'Serve preview in degraded mode and refresh sync before final acceptance',
    blocks: ['accept-preview', 'export-proof']
  }),
  'audit-evidence-partial': Object.freeze({
    category: 'audit',
    title: 'Audit evidence is incomplete',
    action: 'Keep preview visible but collect missing evidence before proof export',
    blocks: ['export-proof']
  }),
  'proof-delivery-delayed': Object.freeze({
    category: 'delivery',
    title: 'Proof delivery is delayed',
    action: 'Leave proof export queued and notify the client runtime when delivery resumes',
    blocks: ['return-to-client']
  })
});
const acceptanceGateLabels = Object.freeze({
  packageFieldsPresent: 'Required package identity fields are present',
  capabilityContractSatisfied: 'Requested verifier capabilities are supported',
  syncMetadataPresent: 'Provider sync metadata can be traced',
  handoffReady: 'External handoff package is ready when requested',
  providerContractSatisfied: 'Provider contract clauses required for proof export are satisfied',
  tenantBoundarySatisfied: 'Tenant and workspace boundary checks pass',
  operationalHealthSatisfied: 'Verifier runtime health allows package actions'
});
const serviceOperationDefaults = Object.freeze({
  'resolve-package': Object.freeze({ capability: 'hosted-kernel:package.verify', method: 'GET', path: '/packages/{name}/{version}' }),
  'fetch-manifest': Object.freeze({ capability: 'hosted-kernel:package.verify', method: 'GET', path: '/packages/{name}/{version}/manifest' }),
  'verify-integrity': Object.freeze({ capability: 'hosted-kernel:package.verify', method: 'POST', path: '/packages/{name}/{version}/verify-integrity' }),
  'sync-provider-state': Object.freeze({ capability: 'hosted-kernel:provider.contract.sync', method: 'POST', path: '/providers/{provider}/sync' }),
  'export-proof': Object.freeze({ capability: 'hosted-kernel:package.proof.export', method: 'POST', path: '/packages/{name}/{version}/proof' }),
  'prepare-handoff': Object.freeze({ capability: 'hosted-kernel:handoff.prepare', method: 'POST', path: '/handoffs/package-verifier' })
});
const serviceOperationDependencies = Object.freeze({
  'resolve-package': Object.freeze([]),
  'fetch-manifest': Object.freeze(['resolve-package']),
  'verify-integrity': Object.freeze(['fetch-manifest']),
  'sync-provider-state': Object.freeze(['verify-integrity']),
  'export-proof': Object.freeze(['sync-provider-state']),
  'prepare-handoff': Object.freeze(['export-proof'])
});
const serviceOperationPhases = Object.freeze({
  'resolve-package': 'resolve',
  'fetch-manifest': 'resolve',
  'verify-integrity': 'verify',
  'sync-provider-state': 'sync',
  'export-proof': 'proof',
  'prepare-handoff': 'handoff'
});
const lifecycleCommandRecoveryPolicy = Object.freeze({
  'verify-package': Object.freeze({
    retryable: true,
    degradedAllowed: true,
    action: 'Re-run package verification from the persisted checkpoint after provider sync is available',
    blocks: ['accept-preview', 'export-proof']
  }),
  'accept-preview': Object.freeze({
    retryable: false,
    degradedAllowed: false,
    action: 'Refresh the preview contract and require a new acceptance submission',
    blocks: ['export-proof', 'return-to-client']
  }),
  'export-proof': Object.freeze({
    retryable: true,
    degradedAllowed: false,
    action: 'Retry proof export after evidence delivery dependencies recover',
    blocks: ['return-to-client']
  }),
  'return-to-client': Object.freeze({
    retryable: true,
    degradedAllowed: true,
    action: 'Retry client handoff with the same idempotency key once the return route is available',
    blocks: []
  })
});
const rolePermissionMap = Object.freeze({
  owner: ['package.verify', 'package.preview', 'package.accept', 'package.proof.export', 'package.handoff'],
  admin: ['package.verify', 'package.preview', 'package.accept', 'package.proof.export', 'package.handoff'],
  verifier: ['package.verify', 'package.preview', 'package.proof.export'],
  reviewer: ['package.verify', 'package.preview'],
  auditor: ['package.verify', 'package.proof.export'],
  viewer: ['package.preview']
});
const intentPermissionMap = Object.freeze({
  verify: 'package.verify',
  preview: 'package.preview',
  accept: 'package.accept',
  'export-proof': 'package.proof.export',
  handoff: 'package.handoff'
});
const privilegedAccessRoles = Object.freeze(['owner', 'admin']);

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function cleanString(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function cleanStringList(value) {
  return Array.isArray(value)
    ? [...new Set(value.map((item) => cleanString(item)).filter(Boolean))]
    : [];
}

function normalizeGrantList(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => asObject(entry));
  }

  return Object.entries(asObject(value)).map(([scopeKey, entry]) => {
    const source = asObject(entry);
    const [tenantId, workspaceId] = scopeKey.includes('/')
      ? scopeKey.split('/')
      : ['', scopeKey];

    return {
      ...source,
      tenantId: source.tenantId || tenantId,
      workspaceId: source.workspaceId || workspaceId
    };
  });
}

function scopeMatchesGrant(grantScope, activeScope) {
  const cleanedGrantScope = cleanString(grantScope);
  return !cleanedGrantScope || cleanedGrantScope === '*' || cleanedGrantScope === activeScope;
}

function permissionScopeLabel(grant) {
  const tenantId = grant.tenantId || '*';
  const workspaceId = grant.workspaceId || '*';
  return `${tenantId}/${workspaceId}`;
}

function normalizeScopedPermissionGrants(value, tenantId, workspaceId) {
  return normalizeGrantList(value).map((grant, index) => {
    const scope = asObject(grant.scope);
    const grantTenantId = cleanString(grant.tenantId || scope.tenantId);
    const grantWorkspaceId = cleanString(grant.workspaceId || scope.workspaceId);
    const roles = cleanStringList(grant.roles || [grant.role]);
    const rolePermissions = roles.flatMap((role) => rolePermissionMap[role] || []);
    const permissions = [...new Set([
      ...cleanStringList(grant.permissions),
      ...rolePermissions
    ])];
    const deniedPermissions = cleanStringList(
      grant.deniedPermissions || grant.denyPermissions || grant.revokedPermissions
    );
    const appliesToTenant = scopeMatchesGrant(grantTenantId, tenantId);
    const appliesToWorkspace = scopeMatchesGrant(grantWorkspaceId, workspaceId);
    const applies = appliesToTenant && appliesToWorkspace;

    return {
      id: cleanString(grant.id || grant.grantId, `access-grant-${index + 1}`),
      tenantId: grantTenantId || '*',
      workspaceId: grantWorkspaceId || '*',
      scopeLabel: permissionScopeLabel({ tenantId: grantTenantId, workspaceId: grantWorkspaceId }),
      roles,
      permissions,
      deniedPermissions,
      applies,
      appliesToTenant,
      appliesToWorkspace,
      source: cleanString(grant.source, 'scoped-access-grant')
    };
  });
}

function cleanPositiveInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

function cleanNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function addMilliseconds(isoTimestamp, milliseconds) {
  const parsed = Date.parse(isoTimestamp);
  return Number.isFinite(parsed) && milliseconds > 0
    ? new Date(parsed + milliseconds).toISOString()
    : null;
}

function timestampStatus(value, now) {
  const cleaned = cleanString(value);
  if (!cleaned) {
    return { value: null, valid: true, future: false, due: false, epochMs: null };
  }

  const epochMs = Date.parse(cleaned);
  const nowMs = Date.parse(now);
  const valid = Number.isFinite(epochMs) && Number.isFinite(nowMs);

  return {
    value: cleaned,
    valid,
    future: valid ? epochMs > nowMs : false,
    due: valid ? epochMs <= nowMs : false,
    epochMs: valid ? epochMs : null
  };
}

function cadenceMilliseconds(cadence, intervalMinutes) {
  if (cadence === 'hourly') {
    return 60 * 60 * 1000;
  }
  if (cadence === 'daily') {
    return 24 * 60 * 60 * 1000;
  }
  if (cadence === 'on-change') {
    return intervalMinutes > 0 ? intervalMinutes * 60 * 1000 : 0;
  }
  return intervalMinutes > 0 ? intervalMinutes * 60 * 1000 : 0;
}

function normalizeLifecycleCommandControlEntries(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => {
      const source = asObject(entry);
      return [cleanString(source.command || source.type || source.id), source];
    }).filter(([command]) => Boolean(command));
  }

  return Object.entries(asObject(value)).map(([command, source]) => [cleanString(command), asObject(source)]);
}

function classifyOperationalFailure(code) {
  const failureCode = cleanString(code);
  const catalog = operationalFailureCatalog[failureCode] || {};
  const retryable = retryableOperationalFailures.includes(failureCode);
  const degraded = degradedOperationalFailures.includes(failureCode);

  return {
    code: failureCode,
    category: cleanString(catalog.category, failureCode.includes(':') ? failureCode.split(':')[0] : 'runtime'),
    title: cleanString(catalog.title, `Verifier issue ${failureCode}`),
    retryable,
    degraded,
    blocks: Array.isArray(catalog.blocks) ? catalog.blocks : supportedLifecycleCommands,
    action: cleanString(
      catalog.action,
      retryable
        ? 'Retry verifier command after backoff or resume from the persisted checkpoint'
        : degraded
          ? 'Continue in degraded preview mode and refresh proof evidence before final acceptance'
          : 'Reconcile verifier state before continuing'
    )
  };
}

function normalizePackage(inputPackage) {
  const source = asObject(inputPackage);
  const normalized = {
    name: cleanString(source.name, 'unscoped-package'),
    version: cleanString(source.version, '0.0.0'),
    integrity: cleanString(source.integrity),
    manifestDigest: cleanString(source.manifestDigest || source.digest),
    provider: cleanString(source.provider, 'hosted-kernel'),
    route: cleanString(source.route, 'package-sdk/verifier-package'),
    tenantId: cleanString(source.tenantId || asObject(source.scope).tenantId),
    workspaceId: cleanString(source.workspaceId || asObject(source.scope).workspaceId)
  };

  const missing = requiredPackageFields.filter((field) => !cleanString(source[field]));
  return { normalized, missing };
}

function negotiateCapabilities(requestedCapabilities) {
  const requested = Array.isArray(requestedCapabilities)
    ? requestedCapabilities.map((capability) => cleanString(capability)).filter(Boolean)
    : [];
  const accepted = requested.filter((capability) => supportedCapabilities.includes(capability));
  const rejected = requested.filter((capability) => !supportedCapabilities.includes(capability));

  return {
    supported: [...supportedCapabilities],
    requested,
    accepted,
    rejected,
    mode: rejected.length ? 'partial' : 'full'
  };
}

function buildSyncMetadata(input, now) {
  const sync = asObject(input.sync);
  const upstreamCursor = cleanString(sync.upstreamCursor || sync.cursor);
  const providerRevision = cleanString(sync.providerRevision, 'unversioned');
  const observedAt = cleanString(sync.observedAt, now);

  return {
    providerRevision,
    upstreamCursor,
    observedAt,
    nextCursor: `${providerRevision}:${observedAt}`,
    stale: Boolean(sync.stale),
    conflicts: Array.isArray(sync.conflicts) ? sync.conflicts.filter(Boolean) : []
  };
}

function buildHandoffState(input, packageContract, capabilityContract, now) {
  const handoff = asObject(input.handoff);
  const requested = Boolean(handoff.requested || input.externalHandoff);
  const target = cleanString(handoff.target, requested ? 'external-verifier' : 'hosted-kernel');
  const ready = requested && packageContract.missing.length === 0 && capabilityContract.rejected.length === 0;

  return {
    requested,
    target,
    state: ready ? 'ready' : requested ? 'blocked' : 'local-only',
    preparedAt: requested ? now : null,
    blockingReasons: ready
      ? []
      : [
          ...packageContract.missing.map((field) => `missing-package-${field}`),
          ...capabilityContract.rejected.map((capability) => `unsupported-capability:${capability}`)
        ],
    exportRef: ready
      ? `${surfaceId}:${packageContract.normalized.name}@${packageContract.normalized.version}`
      : null
  };
}

function normalizeRouteClient(input) {
  const route = asObject(input.route);
  const client = asObject(input.client);

  return {
    routeId: cleanString(route.id || route.name || input.routeId, 'package-sdk/verifier-package'),
    previewTarget: cleanString(route.previewTarget || client.previewTarget, 'hosted-kernel-package-preview'),
    acceptAction: cleanString(route.acceptAction || client.acceptAction, 'accept-verifier-package'),
    clientSessionId: cleanString(client.sessionId || input.clientSessionId),
    responseFormat: cleanString(client.responseFormat, 'contract-v1')
  };
}

function normalizeClientAcknowledgementReceipts(value, now) {
  const source = asObject(value);
  const receipts = Array.isArray(source.receipts)
    ? source.receipts
    : Array.isArray(source.acks)
      ? source.acks
      : Array.isArray(value)
        ? value
        : Object.entries(asObject(source.receiptMap || source)).map(([id, receipt]) => ({
            ...asObject(receipt),
            id
          }));

  return receipts.map((receipt, index) => {
    const entry = asObject(receipt);
    const slot = cleanString(entry.slot || entry.stateSlot);
    const event = cleanString(entry.event || entry.runtimeEvent);
    const token = cleanString(entry.token || entry.ackToken || entry.receiptToken || entry.id);
    const stateVersion = cleanPositiveInteger(entry.stateVersion || entry.version, 0);

    return {
      id: cleanString(entry.id || token, `client-ack-${index + 1}`),
      slot: supportedClientStateSlots.includes(slot) ? slot : null,
      event: supportedClientRuntimeEvents.includes(event) ? event : null,
      token: token || null,
      stateVersion,
      receivedAt: cleanString(entry.receivedAt || entry.acknowledgedAt || entry.at, now)
    };
  }).filter((receipt) => receipt.slot || receipt.event || receipt.token);
}

function normalizeRequestState(input, routeClient) {
  const request = asObject(input.request);
  const client = asObject(input.client);
  const requestedIntent = cleanString(request.intent || input.intent, 'verify');
  const requestedProofFormat = cleanString(request.proofFormat || client.proofFormat || routeClient.responseFormat, 'contract-v1');
  const requestedDeliveryChannels = cleanStringList(
    request.deliveryChannels || client.deliveryChannels || input.deliveryChannels
  );
  const deliveryChannels = requestedDeliveryChannels.length
    ? requestedDeliveryChannels.filter((channel) => supportedDeliveryChannels.includes(channel))
    : ['client-state'];
  const rejectedDeliveryChannels = requestedDeliveryChannels.filter(
    (channel) => !supportedDeliveryChannels.includes(channel)
  );

  return {
    kind: 'hosted-kernel.package-verifier.request-state',
    version: 1,
    workflowId: cleanString(request.workflowId || client.workflowId || input.workflowId, `${surfaceId}:workflow`),
    requestId: cleanString(request.id || input.requestId),
    correlationId: cleanString(request.correlationId || client.correlationId || input.correlationId),
    actorRef: cleanString(request.actorRef || client.actorRef, 'hosted-kernel-client'),
    source: cleanString(request.source || client.source, 'package-sdk'),
    intent: supportedRequestIntents.includes(requestedIntent) ? requestedIntent : 'verify',
    requestedIntent,
    intentAccepted: supportedRequestIntents.includes(requestedIntent),
    proofFormat: supportedProofFormats.includes(requestedProofFormat) ? requestedProofFormat : 'contract-v1',
    requestedProofFormat,
    proofFormatAccepted: supportedProofFormats.includes(requestedProofFormat),
    deliveryChannels: deliveryChannels.length ? deliveryChannels : ['client-state'],
    rejectedDeliveryChannels,
    returnRouteId: cleanString(request.returnRouteId || client.returnRouteId || routeClient.routeId),
    returnUrl: cleanString(request.returnUrl || client.returnUrl),
    clientSessionId: routeClient.clientSessionId || null
  };
}

function normalizeClientRuntimeState(input, packageContract, requestState, routeClient, handoffState, now) {
  const client = asObject(input.client);
  const runtime = asObject(client.runtime || input.clientRuntime || input.runtimeClient);
  const state = asObject(client.state || input.clientState || runtime.state);
  const acknowledgement = asObject(
    runtime.acknowledgement || runtime.ack || client.acknowledgement || client.ack || state.acknowledgement
  );
  const requestedSlots = cleanStringList(state.slots || runtime.stateSlots || client.stateSlots);
  const stateSlots = requestedSlots.length
    ? requestedSlots.filter((slot) => supportedClientStateSlots.includes(slot))
    : ['verifier.request', 'verifier.preview', 'verifier.readiness', 'verifier.proof', 'verifier.handoff'];
  const rejectedSlots = requestedSlots.filter((slot) => !supportedClientStateSlots.includes(slot));
  const requestedEvents = cleanStringList(runtime.events || runtime.subscriptions || client.events);
  const eventSubscriptions = requestedEvents.length
    ? requestedEvents.filter((event) => supportedClientRuntimeEvents.includes(event))
    : ['verifier.preview.rendered', 'verifier.proof.delivered', 'verifier.workflow.returned'];
  const rejectedEvents = requestedEvents.filter((event) => !supportedClientRuntimeEvents.includes(event));
  const acknowledgementReceipts = normalizeClientAcknowledgementReceipts(
    acknowledgement.receipts || acknowledgement.acks || runtime.ackReceipts || client.ackReceipts,
    now
  );
  const packageRef = `${packageContract.normalized.name}@${packageContract.normalized.version}`;
  const stateKey = cleanString(
    state.key || state.stateKey || runtime.stateKey,
    `${surfaceId}:client-state:${requestState.workflowId}:${packageRef}`
  );
  const requestedStateVersion = cleanPositiveInteger(state.version || state.stateVersion || runtime.stateVersion, 0);
  const nextStateVersion = requestedStateVersion + 1;
  const sessionRequired = Boolean(state.requireSession || runtime.requireSession || client.requireSession);
  const wantsReturn = Boolean(requestState.returnUrl || requestState.returnRouteId || requestState.intent === 'handoff');
  const requireReturnAcknowledgement = Boolean(
    acknowledgement.required
      || acknowledgement.requireReturnAcknowledgement
      || runtime.requireReturnAcknowledgement
      || state.requireReturnAcknowledgement
  );
  const requiredAcknowledgementSlots = cleanStringList(
    acknowledgement.requiredSlots || runtime.requiredAckSlots || state.requiredAckSlots
  ).filter((slot) => supportedClientStateSlots.includes(slot) && stateSlots.includes(slot));
  const requiredAcknowledgementEvents = cleanStringList(
    acknowledgement.requiredEvents || runtime.requiredAckEvents
  ).filter((event) => supportedClientRuntimeEvents.includes(event) && eventSubscriptions.includes(event));
  const effectiveRequiredAckSlots = requireReturnAcknowledgement && requiredAcknowledgementSlots.length === 0
    ? stateSlots.filter((slot) => ['verifier.request', 'verifier.handoff'].includes(slot))
    : requiredAcknowledgementSlots;
  const effectiveRequiredAckEvents = requireReturnAcknowledgement && requiredAcknowledgementEvents.length === 0
    ? eventSubscriptions.filter((event) => event === 'verifier.workflow.returned')
    : requiredAcknowledgementEvents;
  const acknowledgedSlots = [...new Set(acknowledgementReceipts.map((receipt) => receipt.slot).filter(Boolean))];
  const acknowledgedEvents = [...new Set(acknowledgementReceipts.map((receipt) => receipt.event).filter(Boolean))];
  const acknowledgedStateVersion = acknowledgementReceipts.reduce(
    (maxVersion, receipt) => Math.max(maxVersion, receipt.stateVersion),
    cleanPositiveInteger(acknowledgement.stateVersion || acknowledgement.version, 0)
  );
  const stateVersionAcknowledged = !requireReturnAcknowledgement
    || acknowledgedStateVersion >= nextStateVersion;
  const missingAcknowledgements = [
    ...effectiveRequiredAckSlots
      .filter((slot) => !acknowledgedSlots.includes(slot))
      .map((slot) => `slot:${slot}`),
    ...effectiveRequiredAckEvents
      .filter((event) => !acknowledgedEvents.includes(event))
      .map((event) => `event:${event}`),
    ...(!stateVersionAcknowledged ? [`state-version:${nextStateVersion}`] : [])
  ];
  const missingBindings = [
    ...(!requestState.workflowId ? ['workflowId'] : []),
    ...(!routeClient.routeId ? ['routeId'] : []),
    ...(sessionRequired && !requestState.clientSessionId ? ['clientSessionId'] : []),
    ...(wantsReturn && !requestState.returnRouteId && !requestState.returnUrl ? ['returnTarget'] : []),
    ...(handoffState.requested && handoffState.state !== 'ready' ? ['handoffReady'] : [])
  ];
  const blockedBy = [
    ...missingBindings.map((binding) => `missing-client-binding:${binding}`),
    ...rejectedSlots.map((slot) => `unsupported-client-state-slot:${slot}`),
    ...rejectedEvents.map((event) => `unsupported-client-runtime-event:${event}`)
  ];
  const returnBlockedBy = [
    ...blockedBy,
    ...(wantsReturn && requireReturnAcknowledgement
      ? missingAcknowledgements.map((receipt) => `missing-client-acknowledgement:${receipt}`)
      : [])
  ];
  const canHydrate = blockedBy.length === 0 || blockedBy.every((reason) => reason.includes('returnTarget'));

  return {
    kind: 'hosted-kernel.package-verifier.client-runtime-state',
    version: 1,
    generatedAt: now,
    stateKey,
    stateVersion: nextStateVersion,
    mode: state.readOnly || runtime.readOnly ? 'read-only' : 'read-write',
    canHydrate,
    canReturnToClient: wantsReturn && returnBlockedBy.length === 0,
    blockedBy,
    returnBlockedBy,
    bindings: {
      workflowId: requestState.workflowId,
      requestId: requestState.requestId || null,
      correlationId: requestState.correlationId || null,
      actorRef: requestState.actorRef,
      clientSessionId: requestState.clientSessionId || null,
      routeId: routeClient.routeId,
      returnRouteId: requestState.returnRouteId || null,
      returnUrl: requestState.returnUrl || null,
      packageRef,
      handoffTarget: handoffState.target,
      handoffExportRef: handoffState.exportRef
    },
    slots: {
      requested: requestedSlots,
      accepted: stateSlots,
      rejected: rejectedSlots
    },
    events: {
      requested: requestedEvents,
      subscribed: eventSubscriptions,
      rejected: rejectedEvents
    },
    acknowledgements: {
      requiredBeforeReturn: wantsReturn && requireReturnAcknowledgement,
      requiredSlots: effectiveRequiredAckSlots,
      requiredEvents: effectiveRequiredAckEvents,
      acknowledgedSlots,
      acknowledgedEvents,
      acknowledgedStateVersion,
      missing: missingAcknowledgements,
      receipts: acknowledgementReceipts,
      returnAckToken: `${stateKey}:ack:${nextStateVersion}`
    },
    statePatch: {
      op: requestedStateVersion ? 'merge' : 'create',
      key: stateKey,
      version: nextStateVersion,
      slots: stateSlots.reduce((patch, slot) => {
        patch[slot] = {
          workflowId: requestState.workflowId,
          packageRef,
          intent: requestState.intent,
          proofFormat: requestState.proofFormat,
          handoffState: handoffState.state,
          acknowledgementRequired: wantsReturn && requireReturnAcknowledgement,
          returnAckToken: `${stateKey}:ack:${nextStateVersion}`,
          updatedAt: now
        };
        return patch;
      }, {})
    }
  };
}

function normalizeLifecycleSettings(input, requestState, now) {
  const settings = asObject(input.settings || input.lifecycleSettings || input.controls);
  const lifecycle = asObject(settings.lifecycle || input.lifecycle);
  const schedule = asObject(settings.schedule || lifecycle.schedule || input.schedule);
  const commandControlEntries = normalizeLifecycleCommandControlEntries(
    lifecycle.commands || settings.commands || lifecycle.commandControls || settings.commandControls
  );
  const commandControlMap = new Map(commandControlEntries);
  const disabledCommands = cleanStringList(lifecycle.disabledCommands || settings.disabledCommands);
  const requestedRequiredApprovals = cleanStringList(
    lifecycle.requiredApprovals || settings.requiredApprovals || settings.approvals
  );
  const cadence = cleanString(schedule.cadence || lifecycle.cadence, 'manual');
  const cadenceAccepted = supportedScheduleCadences.includes(cadence);
  const intervalMinutes = cleanPositiveInteger(schedule.intervalMinutes || schedule.everyMinutes, 0);
  const automatic = Boolean(schedule.automatic || lifecycle.automatic);
  const scheduleEnabled = Boolean(schedule.enabled || automatic || cadence !== 'manual');
  const nextRunStatus = timestampStatus(schedule.nextRunAt || schedule.nextAt, now);
  const pauseStatus = timestampStatus(schedule.pauseUntil || lifecycle.pauseUntil, now);
  const lastRunStatus = timestampStatus(schedule.lastRunAt || lifecycle.lastRunAt, now);
  const changeToken = cleanString(schedule.changeToken || schedule.changeId || lifecycle.changeToken);
  const lastProcessedChangeToken = cleanString(schedule.lastProcessedChangeToken || lifecycle.lastProcessedChangeToken);
  const changePending = cadence === 'on-change' && Boolean(changeToken && changeToken !== lastProcessedChangeToken);
  const waitingForChange = cadence === 'on-change' && scheduleEnabled && !changePending;
  const cadenceIntervalMs = cadenceMilliseconds(cadenceAccepted ? cadence : 'manual', intervalMinutes);
  const computedNextRunAt = scheduleEnabled && !nextRunStatus.value && cadenceIntervalMs > 0
    ? addMilliseconds(lastRunStatus.valid && lastRunStatus.value ? lastRunStatus.value : now, cadenceIntervalMs)
    : null;
  const effectiveNextRunAt = nextRunStatus.value || computedNextRunAt;
  const effectiveNextRunStatus = timestampStatus(effectiveNextRunAt, now);
  const pauseActive = pauseStatus.valid && pauseStatus.future;
  const scheduleDue = scheduleEnabled
    && cadenceAccepted
    && !pauseActive
    && (
      effectiveNextRunStatus.due
      || (cadence === 'on-change' && changePending)
      || (cadence !== 'manual' && cadence !== 'on-change' && !effectiveNextRunAt)
    );
  const disabled = settings.enabled === false || lifecycle.enabled === false;
  const locked = Boolean(settings.locked || lifecycle.locked);
  const maintenanceMode = Boolean(settings.maintenanceMode || lifecycle.maintenanceMode);
  const allowDegradedAccept = settings.allowDegradedAccept !== false && lifecycle.allowDegradedAccept !== false;
  const allowAutoExport = Boolean(settings.allowAutoExport || lifecycle.allowAutoExport);
  const allowHandoff = settings.allowHandoff !== false && lifecycle.allowHandoff !== false;
  const strictSettings = settings.strict === true || lifecycle.strict === true;
  const approvalMode = cleanString(lifecycle.approvalMode || settings.approvalMode, 'required-for-accept');
  const requiredApprovals = requestedRequiredApprovals.length
    ? requestedRequiredApprovals
    : approvalMode === 'none'
      ? []
      : ['package-owner'];
  const suppliedApprovals = cleanStringList(input.approvals || settings.suppliedApprovals || lifecycle.suppliedApprovals);
  const missingApprovals = requiredApprovals.filter((approval) => !suppliedApprovals.includes(approval));
  const unknownDisabledCommands = disabledCommands.filter((command) => !supportedLifecycleCommands.includes(command));
  const disabledSupportedCommands = disabledCommands.filter((command) => supportedLifecycleCommands.includes(command));
  const unknownCommandControls = [...commandControlMap.keys()]
    .filter((command) => !supportedLifecycleCommands.includes(command));
  const scheduleBlockingReasons = [
    ...(!cadenceAccepted ? [`unsupported-cadence:${cadence}`] : []),
    ...(scheduleEnabled && cadence === 'manual' && !intervalMinutes && !nextRunStatus.value ? ['schedule-missing-trigger'] : []),
    ...(nextRunStatus.valid ? [] : [`invalid-next-run-at:${nextRunStatus.value}`]),
    ...(pauseStatus.valid ? [] : [`invalid-pause-until:${pauseStatus.value}`]),
    ...(lastRunStatus.valid ? [] : [`invalid-last-run-at:${lastRunStatus.value}`])
  ];
  const scheduleAction = !scheduleEnabled
    ? 'manual-only'
    : pauseActive
      ? 'paused'
      : scheduleBlockingReasons.some((reason) => reason.startsWith('invalid-') || reason.startsWith('unsupported-'))
        ? 'fix-schedule'
        : scheduleDue
          ? 'run-due-command'
          : waitingForChange
            ? 'wait-for-change'
          : effectiveNextRunStatus.future
            ? 'wait-until-next-run'
            : cadence === 'manual'
              ? 'needs-trigger'
              : 'schedule-next-run';
  const commandSettings = supportedLifecycleCommands.map((command) => {
    const commandControl = asObject(commandControlMap.get(command));
    const commandPauseStatus = timestampStatus(commandControl.pauseUntil || commandControl.pausedUntil, now);
    const commandPauseActive = commandPauseStatus.valid && commandPauseStatus.future;
    const requestedMode = cleanString(
      commandControl.mode || commandControl.state,
      commandControl.enabled === false ? 'disabled' : 'enabled'
    );
    const modeAccepted = ['enabled', 'disabled', 'paused', 'dry-run'].includes(requestedMode);
    const commandDisabled = disabled
      || disabledSupportedCommands.includes(command)
      || commandControl.enabled === false
      || requestedMode === 'disabled';
    const approvalBlocked = command === 'accept-preview' && missingApprovals.length > 0;
    const degradedBlocked = command === 'accept-preview' && !allowDegradedAccept;
    const handoffBlocked = command === 'return-to-client' && !allowHandoff;
    const exportBlocked = command === 'export-proof' && requestState.intent === 'handoff' && !allowAutoExport;
    const commandScheduleManaged = command === 'verify-package' || commandControl.scheduled === true;
    const scheduleBlocked = commandScheduleManaged && scheduleAction === 'fix-schedule';
    const waitingForSchedule = commandScheduleManaged
      && scheduleEnabled
      && !scheduleDue
      && !scheduleBlocked
      && !commandDisabled
      && !pauseActive
      && !commandPauseActive;
    const blockedBy = [
      ...(disabled ? ['verifier-disabled'] : []),
      ...(locked ? ['settings-locked'] : []),
      ...(maintenanceMode ? ['maintenance-mode'] : []),
      ...(commandDisabled && !disabled ? [`command-disabled:${command}`] : []),
      ...(!modeAccepted ? [`unsupported-command-mode:${command}:${requestedMode}`] : []),
      ...(commandPauseStatus.valid ? [] : [`invalid-command-pause-until:${command}`]),
      ...(commandPauseActive || requestedMode === 'paused' ? [`command-paused:${command}`] : []),
      ...(scheduleBlocked ? scheduleBlockingReasons.map((reason) => `schedule:${reason}`) : []),
      ...(approvalBlocked ? missingApprovals.map((approval) => `missing-approval:${approval}`) : []),
      ...(degradedBlocked ? ['degraded-accept-disabled'] : []),
      ...(handoffBlocked ? ['handoff-disabled'] : []),
      ...(exportBlocked ? ['automatic-export-disabled'] : [])
    ];
    const enabled = blockedBy.length === 0;

    return {
      command,
      enabled,
      blockedBy,
      controlRef: cleanString(commandControl.controlRef, `${surfaceId}:lifecycle-command:${requestState.workflowId}:${command}`),
      requestedMode,
      modeAccepted,
      dryRun: requestedMode === 'dry-run' || commandControl.dryRun === true,
      scheduleManaged: commandScheduleManaged,
      waitingForSchedule,
      autoRunnable: enabled && commandScheduleManaged && scheduleDue,
      nextEligibleAt: enabled
        ? commandPauseActive
          ? commandPauseStatus.value
          : commandScheduleManaged
            ? effectiveNextRunAt
            : null
        : null,
      auditReason: enabled
        ? waitingForSchedule
          ? 'enabled-waiting-for-schedule'
          : commandScheduleManaged && scheduleDue
            ? 'enabled-schedule-due'
            : 'enabled-manual-command'
        : blockedBy[0] || 'blocked'
    };
  });
  const nextCommand = commandSettings.find((command) => command.autoRunnable)
    || commandSettings.find((command) => command.enabled && !command.waitingForSchedule)
    || null;
  const blockingReasons = [
    ...(disabled ? ['verifier-disabled'] : []),
    ...(locked ? ['settings-locked'] : []),
    ...(maintenanceMode ? ['maintenance-mode'] : []),
    ...unknownDisabledCommands.map((command) => `unknown-disabled-command:${command}`),
    ...unknownCommandControls.map((command) => `unknown-command-control:${command}`),
    ...scheduleBlockingReasons,
    ...(strictSettings && missingApprovals.length ? missingApprovals.map((approval) => `missing-approval:${approval}`) : [])
  ];

  return {
    kind: 'hosted-kernel.package-verifier.lifecycle-settings',
    version: 1,
    generatedAt: now,
    enabled: !disabled,
    locked,
    maintenanceMode,
    strict: strictSettings,
    allowDegradedAccept,
    allowAutoExport,
    allowHandoff,
    approvalMode,
    requiredApprovals,
    suppliedApprovals,
    missingApprovals,
    commandSettings,
    schedule: {
      enabled: scheduleEnabled,
      cadence: cadenceAccepted ? cadence : 'manual',
      requestedCadence: cadence,
      cadenceAccepted,
      intervalMinutes,
      lastRunAt: lastRunStatus.value,
      nextRunAt: nextRunStatus.value,
      computedNextRunAt,
      effectiveNextRunAt,
      pauseUntil: pauseStatus.value,
      timezone: cleanString(schedule.timezone || settings.timezone, 'UTC'),
      changeToken: changeToken || null,
      lastProcessedChangeToken: lastProcessedChangeToken || null,
      changePending,
      waitingForChange,
      due: scheduleDue,
      paused: pauseActive,
      validation: {
        valid: scheduleBlockingReasons.length === 0,
        blockingReasons: scheduleBlockingReasons
      },
      nextAction: scheduleAction,
      nextCommand: nextCommand
        ? {
            command: nextCommand.command,
            controlRef: nextCommand.controlRef,
            autoRunnable: nextCommand.autoRunnable,
            nextEligibleAt: nextCommand.nextEligibleAt,
            auditReason: nextCommand.auditReason
          }
        : null
    },
    blockingReasons,
    status: blockingReasons.length
      ? strictSettings || disabled || locked || maintenanceMode || !cadenceAccepted
        ? 'blocked'
        : 'review'
      : scheduleEnabled
        ? 'scheduled'
        : 'enabled'
  };
}

function normalizeAccessContext(input, packageContract, requestState) {
  const tenant = asObject(input.tenant);
  const workspace = asObject(input.workspace);
  const actor = asObject(input.actor || input.principal);
  const policy = asObject(input.policy || input.accessPolicy);
  const packageScope = asObject(input.package?.scope);
  const allowedTenantIds = cleanStringList(
    actor.allowedTenantIds || policy.allowedTenantIds || policy.tenants
  );
  const allowedWorkspaceIds = cleanStringList(
    actor.allowedWorkspaceIds || policy.allowedWorkspaceIds || policy.workspaces
  );
  const tenantId = cleanString(
    tenant.id || workspace.tenantId || packageScope.tenantId || input.tenantId,
    'default-tenant'
  );
  const workspaceId = cleanString(
    workspace.id || packageScope.workspaceId || input.workspaceId,
    'default-workspace'
  );
  const packageTenantId = cleanString(packageScope.tenantId || packageContract.normalized.tenantId, tenantId);
  const packageWorkspaceId = cleanString(packageScope.workspaceId || packageContract.normalized.workspaceId, workspaceId);
  const requiredPermission = intentPermissionMap[requestState.intent] || 'package.verify';
  const actorRoles = cleanStringList(actor.roles || input.roles || [actor.role || input.role]);
  const explicitPermissions = cleanStringList(actor.permissions || input.permissions);
  const rolePermissions = actorRoles.flatMap((role) => rolePermissionMap[role] || []);
  const tenantRoleGrants = Object.entries(asObject(actor.tenantRoles || policy.tenantRoles))
    .map(([grantTenantId, roles]) => ({
      tenantId: grantTenantId,
      roles: cleanStringList(Array.isArray(roles) ? roles : [roles])
    }));
  const workspaceRoleGrants = Object.entries(asObject(actor.workspaceRoles || policy.workspaceRoles))
    .map(([grantWorkspaceId, roles]) => ({
      tenantId,
      workspaceId: grantWorkspaceId,
      roles: cleanStringList(Array.isArray(roles) ? roles : [roles])
    }));
  const scopedGrants = normalizeScopedPermissionGrants([
    ...normalizeGrantList(actor.grants || actor.accessGrants),
    ...normalizeGrantList(policy.grants || policy.accessGrants),
    ...normalizeGrantList(workspace.grants || workspace.accessGrants),
    ...tenantRoleGrants,
    ...workspaceRoleGrants
  ], tenantId, workspaceId);
  const appliedScopedGrants = scopedGrants.filter((grant) => grant.applies);
  const outOfScopeGrants = scopedGrants.filter((grant) => !grant.applies);
  const scopedPermissions = appliedScopedGrants.flatMap((grant) => grant.permissions);
  const deniedPermissions = [...new Set([
    ...cleanStringList(actor.deniedPermissions || actor.denyPermissions || input.deniedPermissions),
    ...cleanStringList(policy.deniedPermissions || policy.denyPermissions),
    ...appliedScopedGrants.flatMap((grant) => grant.deniedPermissions)
  ])];
  const unfilteredPermissions = [...new Set([...explicitPermissions, ...rolePermissions, ...scopedPermissions])];
  const permissions = unfilteredPermissions.filter((permission) => !deniedPermissions.includes(permission));
  const permissionDenied = deniedPermissions.includes(requiredPermission);
  const hasPrivilegedRole = actorRoles.some((role) => privilegedAccessRoles.includes(role))
    || appliedScopedGrants.some((grant) => grant.roles.some((role) => privilegedAccessRoles.includes(role)));
  const tenantAllowed = allowedTenantIds.length === 0 || allowedTenantIds.includes(tenantId);
  const workspaceAllowed = allowedWorkspaceIds.length === 0 || allowedWorkspaceIds.includes(workspaceId);
  const packageInTenant = packageTenantId === tenantId;
  const packageInWorkspace = packageWorkspaceId === workspaceId;
  const permissionAllowed = permissions.includes(requiredPermission) && !permissionDenied;
  const scopedGrantRequired = Boolean(policy.requireScopedGrant || workspace.requireScopedGrant);
  const hasScopedGrantForPermission = appliedScopedGrants.some((grant) => (
    grant.permissions.includes(requiredPermission)
    || grant.roles.some((role) => privilegedAccessRoles.includes(role))
  ));
  const scopedGrantSatisfied = !scopedGrantRequired || hasScopedGrantForPermission;
  const isolationMode = cleanString(policy.isolationMode || tenant.isolationMode, 'strict');
  const boundaryMode = isolationMode === 'permissive' ? 'permissive' : 'strict';
  const violations = [
    ...(!tenantAllowed ? [`tenant-not-allowed:${tenantId}`] : []),
    ...(!workspaceAllowed ? [`workspace-not-allowed:${workspaceId}`] : []),
    ...(!packageInTenant ? [`package-tenant-mismatch:${packageTenantId}`] : []),
    ...(!packageInWorkspace ? [`package-workspace-mismatch:${packageWorkspaceId}`] : []),
    ...(permissionDenied ? [`denied-permission:${requiredPermission}`] : []),
    ...(!permissionAllowed && !permissionDenied ? [`missing-permission:${requiredPermission}`] : []),
    ...(!scopedGrantSatisfied ? [`missing-scoped-grant:${requiredPermission}`] : [])
  ];
  const advisoryViolations = boundaryMode === 'permissive'
    ? violations.filter((violation) => ![
        'missing-permission:',
        'denied-permission:',
        'missing-scoped-grant:'
      ].some((prefix) => violation.startsWith(prefix)))
    : [];
  const blockingViolations = boundaryMode === 'permissive'
    ? violations.filter((violation) => [
        'missing-permission:',
        'denied-permission:',
        'missing-scoped-grant:'
      ].some((prefix) => violation.startsWith(prefix)))
    : violations;

  return {
    kind: 'hosted-kernel.package-verifier.access-boundary',
    version: 1,
    tenantId,
    workspaceId,
    packageScope: {
      tenantId: packageTenantId,
      workspaceId: packageWorkspaceId
    },
    actor: {
      ref: requestState.actorRef,
      roles: actorRoles,
      permissions,
      explicitPermissions,
      rolePermissions: [...new Set(rolePermissions)],
      scopedPermissions: [...new Set(scopedPermissions)],
      deniedPermissions,
      hasPrivilegedRole
    },
    requiredPermission,
    boundaryMode,
    scopedGrantRequired,
    scopedGrantSatisfied,
    tenantAllowed,
    workspaceAllowed,
    packageInTenant,
    packageInWorkspace,
    permissionAllowed,
    decision: blockingViolations.length ? 'deny' : advisoryViolations.length ? 'review' : 'allow',
    violations,
    blockingViolations,
    advisoryViolations,
    grantResolution: {
      applied: appliedScopedGrants.map((grant) => ({
        id: grant.id,
        scopeLabel: grant.scopeLabel,
        roles: grant.roles,
        permissions: grant.permissions,
        deniedPermissions: grant.deniedPermissions,
        source: grant.source
      })),
      ignored: outOfScopeGrants.map((grant) => ({
        id: grant.id,
        scopeLabel: grant.scopeLabel,
        appliesToTenant: grant.appliesToTenant,
        appliesToWorkspace: grant.appliesToWorkspace,
        source: grant.source
      })),
      requiredPermissionSource: hasScopedGrantForPermission
        ? 'scoped-grant'
        : rolePermissions.includes(requiredPermission)
          ? 'actor-role'
          : explicitPermissions.includes(requiredPermission)
            ? 'actor-explicit'
            : 'missing'
    },
    auditScopeRef: `${surfaceId}:tenant:${tenantId}:workspace:${workspaceId}`
  };
}

function normalizeProviderContract(input, packageContract, capabilityContract, syncMetadata, accessContext, requestState, now) {
  const contract = asObject(input.providerContract || input.contract);
  const suppliedClauses = Array.isArray(contract.clauses)
    ? contract.clauses
    : Array.isArray(input.contractClauses)
      ? input.contractClauses
      : [];
  const clauseMap = new Map(
    suppliedClauses.map((clause) => {
      const source = asObject(clause);
      const id = cleanString(source.id || source.key || source.name);
      return [id, source];
    }).filter(([id]) => Boolean(id))
  );
  const packageRef = `${packageContract.normalized.name}@${packageContract.normalized.version}`;
  const derivedClauses = requiredProviderContractClauses.map((id) => {
    const supplied = asObject(clauseMap.get(id));
    const required = supplied.required !== false;
    const evidenceRef = cleanString(supplied.evidenceRef, `${surfaceId}:contract-clause:${id}:${packageRef}`);
    const assertion = cleanString(supplied.assertion || supplied.statement, {
      'package.identity': 'Package name and version identify the verifier artifact',
      'package.integrity': 'Package integrity digest is available for hosted-kernel verification',
      'provider.sync': 'Provider revision and sync cursor are traceable',
      'tenant.boundary': 'Package verification is scoped to the active tenant and workspace',
      'proof.export': 'Verifier proof can be exported in the requested format'
    }[id]);
    const satisfied = id === 'package.identity'
      ? packageContract.missing.every((field) => field !== 'name' && field !== 'version')
      : id === 'package.integrity'
        ? !packageContract.missing.includes('integrity')
        : id === 'provider.sync'
          ? Boolean(syncMetadata.providerRevision)
          : id === 'tenant.boundary'
            ? accessContext.decision !== 'deny'
            : capabilityContract.rejected.length === 0 && requestState.proofFormatAccepted;

    return {
      id,
      required,
      assertion,
      satisfied,
      evidenceRef,
      supplied: clauseMap.has(id),
      source: cleanString(supplied.source, clauseMap.has(id) ? 'provider-contract' : 'derived-hosted-kernel')
    };
  });
  const extraClauses = [...clauseMap.entries()]
    .filter(([id]) => !requiredProviderContractClauses.includes(id))
    .map(([id, source]) => ({
      id,
      required: source.required === true,
      assertion: cleanString(source.assertion || source.statement, 'Additional provider contract clause'),
      satisfied: source.satisfied !== false,
      evidenceRef: cleanString(source.evidenceRef, `${surfaceId}:contract-clause:${id}:${packageRef}`),
      supplied: true,
      source: cleanString(source.source, 'provider-contract')
    }));
  const clauses = [...derivedClauses, ...extraClauses];
  const failedRequiredClauses = clauses.filter((clause) => clause.required && !clause.satisfied).map((clause) => clause.id);

  return {
    kind: 'hosted-kernel.package-verifier.provider-contract',
    version: 1,
    generatedAt: now,
    contractRef: cleanString(contract.ref || contract.id, `${surfaceId}:provider-contract:${packageRef}:${syncMetadata.providerRevision}`),
    provider: packageContract.normalized.provider,
    packageRef,
    workflowId: requestState.workflowId,
    decision: failedRequiredClauses.length ? 'blocked' : extraClauses.some((clause) => !clause.satisfied) ? 'review' : 'satisfied',
    requiredClauses: [...requiredProviderContractClauses],
    failedRequiredClauses,
    clauses,
    evidenceRefs: clauses.map((clause) => clause.evidenceRef)
  };
}

function renderProviderOperationPath(path, packageContract) {
  const packageName = encodeURIComponent(packageContract.normalized.name);
  const packageVersion = encodeURIComponent(packageContract.normalized.version);
  const provider = encodeURIComponent(packageContract.normalized.provider);

  return cleanString(path)
    .replaceAll('{name}', packageName)
    .replaceAll('{version}', packageVersion)
    .replaceAll('{provider}', provider);
}

function buildProviderOperationInvocationPlan(operations, packageContract, syncMetadata, handoffState, requestState, service, now) {
  const packageRef = `${packageContract.normalized.name}@${packageContract.normalized.version}`;
  const operationMap = new Map(operations.map((operation) => [operation.id, operation]));
  const dispatchMode = cleanString(service.dispatchMode || service.mode, 'hosted-kernel-service-call');
  const acceptedDispatchMode = ['hosted-kernel-service-call', 'provider-webhook', 'client-handoff-outbox'].includes(dispatchMode)
    ? dispatchMode
    : 'hosted-kernel-service-call';
  const leaseId = cleanString(
    service.leaseId || service.operationLeaseId,
    `${surfaceId}:provider-lease:${requestState.workflowId}:${syncMetadata.providerRevision}`
  );
  const requiredOperations = operations.filter((operation) => operation.required);
  const invocationPlan = requiredOperations.map((operation, index) => {
    const dependencies = serviceOperationDependencies[operation.id] || [];
    const missingDependencies = dependencies.filter((dependencyId) => {
      const dependency = operationMap.get(dependencyId);
      return dependency?.required && !dependency.negotiated;
    });
    const syncCheckpointRequired = ['sync-provider-state', 'export-proof', 'prepare-handoff'].includes(operation.id);
    const handoffQueueRequired = operation.id === 'prepare-handoff'
      || (operation.id === 'export-proof' && requestState.deliveryChannels.includes('handoff-envelope'));
    const renderedPath = renderProviderOperationPath(operation.endpoint.path, packageContract);
    const blockedBy = [
      ...operation.blockedBy,
      ...missingDependencies.map((dependencyId) => `provider-operation-dependency-blocked:${dependencyId}`),
      ...(syncCheckpointRequired && !syncMetadata.nextCursor ? ['provider-sync-checkpoint-missing'] : []),
      ...(handoffQueueRequired && handoffState.state !== 'ready' ? [`handoff-state-not-ready:${handoffState.state}`] : [])
    ];
    const dispatchState = blockedBy.length
      ? 'blocked'
      : operation.retryable
        ? 'ready-retryable'
        : 'ready-once';

    return {
      id: `${surfaceId}:provider-invocation:${requestState.workflowId}:${operation.id}`,
      operation: operation.id,
      phase: serviceOperationPhases[operation.id] || 'custom',
      order: index + 1,
      dispatchState,
      dispatchMode: acceptedDispatchMode,
      serviceRef: operation.serviceRef,
      capability: operation.capability,
      endpoint: {
        method: operation.endpoint.method,
        path: renderedPath
      },
      dependencies,
      idempotencyKey: `${surfaceId}:provider:${requestState.workflowId}:${packageRef}:${operation.id}:${syncMetadata.providerRevision}`,
      timeoutMs: operation.timeoutMs,
      retryable: operation.retryable,
      leaseId,
      syncCheckpoint: syncCheckpointRequired
        ? {
            providerRevision: syncMetadata.providerRevision,
            upstreamCursor: syncMetadata.upstreamCursor || null,
            nextCursor: syncMetadata.nextCursor
          }
        : null,
      handoffOutboxRecord: handoffQueueRequired
        ? {
            target: handoffState.target,
            exportRef: handoffState.exportRef,
            workflowId: requestState.workflowId,
            requestId: requestState.requestId || null,
            correlationId: requestState.correlationId || null,
            deliveryChannels: requestState.deliveryChannels,
            state: handoffState.state === 'ready' && blockedBy.length === 0 ? 'queued' : 'blocked'
          }
        : null,
      auditHeaders: {
        'x-aios-workflow-id': requestState.workflowId,
        'x-aios-package-ref': packageRef,
        'x-aios-provider-revision': syncMetadata.providerRevision,
        'x-aios-proof-format': requestState.proofFormat
      },
      blockedBy
    };
  });
  const blockedInvocations = invocationPlan.filter((invocation) => invocation.dispatchState === 'blocked');
  const readyInvocations = invocationPlan.filter((invocation) => invocation.dispatchState !== 'blocked');

  return {
    dispatchMode: acceptedDispatchMode,
    leaseId,
    ready: blockedInvocations.length === 0,
    phases: [...new Set(invocationPlan.map((invocation) => invocation.phase))],
    readyInvocationIds: readyInvocations.map((invocation) => invocation.id),
    blockedInvocationIds: blockedInvocations.map((invocation) => invocation.id),
    outboxRecords: invocationPlan
      .filter((invocation) => invocation.handoffOutboxRecord)
      .map((invocation) => ({
        ...invocation.handoffOutboxRecord,
        invocationId: invocation.id,
        operation: invocation.operation,
        idempotencyKey: invocation.idempotencyKey,
        queuedAt: invocation.handoffOutboxRecord.state === 'queued' ? now : null
      })),
    invocations: invocationPlan
  };
}

function normalizeProviderServiceContract(input, packageContract, capabilityContract, syncMetadata, handoffState, requestState, providerContract, now) {
  const service = asObject(input.providerService || input.serviceContract || input.service);
  const suppliedOperations = Array.isArray(service.operations)
    ? service.operations
    : Array.isArray(input.providerOperations)
      ? input.providerOperations
      : [];
  const suppliedOperationMap = new Map(
    suppliedOperations.map((operation) => {
      const source = asObject(operation);
      const id = cleanString(source.id || source.operation || source.name);
      return [id, source];
    }).filter(([id]) => Boolean(id))
  );
  const packageRef = `${packageContract.normalized.name}@${packageContract.normalized.version}`;
  const requestedOperations = [
    'resolve-package',
    'fetch-manifest',
    'verify-integrity',
    'sync-provider-state',
    ...(['export-proof', 'handoff'].includes(requestState.intent) || requestState.deliveryChannels.includes('download') ? ['export-proof'] : []),
    ...(handoffState.requested || requestState.intent === 'handoff' || requestState.deliveryChannels.includes('handoff-envelope') ? ['prepare-handoff'] : [])
  ];
  const operations = supportedProviderServiceOperations.map((id) => {
    const defaults = serviceOperationDefaults[id];
    const supplied = asObject(suppliedOperationMap.get(id));
    const endpoint = asObject(supplied.endpoint);
    const required = requestedOperations.includes(id) || supplied.required === true;
    const capabilityAccepted = capabilityContract.accepted.includes(defaults.capability)
      || (capabilityContract.requested.length === 0 && capabilityContract.rejected.length === 0);
    const enabled = supplied.enabled !== false;
    const method = cleanString(endpoint.method || supplied.method, defaults.method).toUpperCase();
    const path = cleanString(endpoint.path || supplied.path, defaults.path);
    const serviceRef = cleanString(
      supplied.serviceRef || endpoint.serviceRef,
      `${surfaceId}:provider-service:${packageContract.normalized.provider}:${id}`
    );
    const blockedBy = [
      ...(required && !capabilityAccepted ? [`capability-not-negotiated:${defaults.capability}`] : []),
      ...(required && !enabled ? [`provider-operation-disabled:${id}`] : []),
      ...(required && !path ? [`provider-operation-missing-path:${id}`] : [])
    ];

    return {
      id,
      required,
      enabled,
      negotiated: capabilityAccepted && enabled && Boolean(path),
      capability: defaults.capability,
      serviceRef,
      endpoint: { method, path },
      timeoutMs: cleanPositiveInteger(supplied.timeoutMs || endpoint.timeoutMs, id === 'sync-provider-state' ? 15000 : 10000),
      retryable: supplied.retryable !== false,
      supplied: suppliedOperationMap.has(id),
      blockedBy,
      evidenceRef: cleanString(supplied.evidenceRef, `${surfaceId}:service-operation:${id}:${packageRef}`)
    };
  });
  const requiredOperations = operations.filter((operation) => operation.required);
  const missingOperations = requiredOperations
    .filter((operation) => !operation.negotiated)
    .map((operation) => operation.id);
  const unsupportedOperations = [...suppliedOperationMap.keys()]
    .filter((id) => !supportedProviderServiceOperations.includes(id));
  const syncCursorRequired = requestedOperations.includes('sync-provider-state');
  const syncReady = Boolean(syncMetadata.providerRevision) && (!syncCursorRequired || Boolean(syncMetadata.nextCursor));
  const handoffReady = !requestedOperations.includes('prepare-handoff') || handoffState.state === 'ready';
  const blockedBy = [
    ...requiredOperations.flatMap((operation) => operation.blockedBy),
    ...unsupportedOperations.map((id) => `unsupported-provider-operation:${id}`),
    ...(!syncReady ? ['provider-sync-binding-missing'] : []),
    ...(!handoffReady ? handoffState.blockingReasons.map((reason) => `handoff-binding:${reason}`) : []),
    ...(providerContract.decision === 'blocked' ? providerContract.failedRequiredClauses.map((clause) => `contract-clause-blocked:${clause}`) : [])
  ];
  const invocationPlan = buildProviderOperationInvocationPlan(
    operations,
    packageContract,
    syncMetadata,
    handoffState,
    requestState,
    service,
    now
  );
  const invocationBlockedBy = invocationPlan.invocations.flatMap((invocation) => (
    invocation.blockedBy.map((reason) => `provider-invocation:${invocation.operation}:${reason}`)
  ));
  const allBlockedBy = [...blockedBy, ...invocationBlockedBy];

  return {
    kind: 'hosted-kernel.package-verifier.provider-service-contract',
    version: 1,
    generatedAt: now,
    serviceRef: cleanString(service.ref || service.id, `${surfaceId}:provider-service:${packageContract.normalized.provider}:${syncMetadata.providerRevision}`),
    provider: packageContract.normalized.provider,
    packageRef,
    workflowId: requestState.workflowId,
    state: allBlockedBy.length ? 'blocked' : service.degraded ? 'degraded' : 'ready',
    requestedOperations,
    unsupportedOperations,
    missingOperations,
    operations,
    invocationPlan,
    syncBinding: {
      providerRevision: syncMetadata.providerRevision,
      upstreamCursor: syncMetadata.upstreamCursor || null,
      nextCursor: syncMetadata.nextCursor,
      stale: syncMetadata.stale,
      ready: syncReady
    },
    capabilityNegotiation: {
      mode: capabilityContract.mode,
      accepted: capabilityContract.accepted,
      rejected: capabilityContract.rejected
    },
    externalHandoffBinding: {
      requested: handoffState.requested,
      target: handoffState.target,
      state: handoffState.state,
      exportRef: handoffState.exportRef,
      ready: handoffReady
    },
    blockedBy: allBlockedBy,
    evidenceRefs: [
      ...operations.filter((operation) => operation.required || operation.supplied).map((operation) => operation.evidenceRef),
      ...invocationPlan.invocations.map((invocation) => invocation.id),
      ...invocationPlan.outboxRecords.map((record) => `${surfaceId}:provider-outbox:${record.operation}:${record.state}`)
    ]
  };
}

function normalizeWorkspaceHandoffBoundary(input, accessContext, requestState, handoffState, providerServiceContract, clientRuntime, now) {
  const policy = asObject(input.policy || input.accessPolicy);
  const handoffPolicy = asObject(policy.handoff || policy.auditHandoff || input.handoffPolicy);
  const requestedAllowedTargets = cleanStringList(
    handoffPolicy.allowedTargets || policy.allowedHandoffTargets
  );
  const requestedAllowedChannels = cleanStringList(
    handoffPolicy.allowedDeliveryChannels || policy.allowedProofDeliveryChannels
  );
  const allowedTargets = requestedAllowedTargets.length ? requestedAllowedTargets : ['hosted-kernel', 'external-verifier'];
  const allowedChannels = requestedAllowedChannels.length ? requestedAllowedChannels : ['client-state', 'handoff-envelope'];
  const targetAllowed = allowedTargets.includes(handoffState.target);
  const rejectedChannels = requestState.deliveryChannels.filter((channel) => !allowedChannels.includes(channel));
  const exportRequested = ['export-proof', 'handoff'].includes(requestState.intent)
    || requestState.deliveryChannels.some((channel) => channel !== 'client-state')
    || handoffState.requested;
  const handoffRequested = requestState.intent === 'handoff'
    || requestState.deliveryChannels.includes('handoff-envelope')
    || handoffState.requested;
  const allowedAuditScopes = cleanStringList(handoffPolicy.allowedAuditScopeRefs || policy.allowedAuditScopeRefs);
  const auditScopeAllowed = allowedAuditScopes.length === 0 || allowedAuditScopes.includes(accessContext.auditScopeRef);
  const requireExplicitExportGrant = handoffPolicy.requireExplicitExportGrant !== false;
  const requireClientHydration = handoffPolicy.requireClientHydration !== false;
  const actorCanExport = accessContext.actor.permissions.includes('package.proof.export');
  const actorCanHandoff = accessContext.actor.permissions.includes('package.handoff');
  const serviceReady = providerServiceContract.state !== 'blocked'
    && (!handoffRequested || providerServiceContract.externalHandoffBinding.ready);
  const clientReady = !requireClientHydration || clientRuntime.canHydrate;
  const boundaryViolations = [
    ...(accessContext.decision === 'deny' ? accessContext.blockingViolations.map((violation) => `access:${violation}`) : []),
    ...(!targetAllowed ? [`handoff-target-not-allowed:${handoffState.target}`] : []),
    ...rejectedChannels.map((channel) => `delivery-channel-not-allowed:${channel}`),
    ...(!auditScopeAllowed ? [`audit-scope-not-allowed:${accessContext.auditScopeRef}`] : []),
    ...(exportRequested && requireExplicitExportGrant && !actorCanExport ? ['missing-export-grant'] : []),
    ...(handoffRequested && !actorCanHandoff ? ['missing-handoff-grant'] : []),
    ...(handoffRequested && !serviceReady ? ['handoff-service-not-ready'] : []),
    ...(exportRequested && !clientReady ? clientRuntime.blockedBy.map((reason) => `client-state:${reason}`) : [])
  ];
  const advisoryViolations = [
    ...(accessContext.decision === 'review' ? accessContext.advisoryViolations.map((violation) => `access:${violation}`) : []),
    ...(handoffPolicy.allowDownload === true && requestState.deliveryChannels.includes('download') ? ['download-delivery-requires-review'] : []),
    ...(handoffRequested && handoffState.state === 'local-only' ? ['handoff-request-normalized-local-only'] : [])
  ];
  const decision = boundaryViolations.length
    ? 'deny'
    : advisoryViolations.length
      ? 'review'
      : 'allow';

  return {
    kind: 'hosted-kernel.package-verifier.workspace-handoff-boundary',
    version: 1,
    generatedAt: now,
    decision,
    tenantId: accessContext.tenantId,
    workspaceId: accessContext.workspaceId,
    auditScopeRef: accessContext.auditScopeRef,
    exportRequested,
    handoffRequested,
    target: handoffState.target,
    targetAllowed,
    allowedTargets,
    allowedDeliveryChannels: allowedChannels,
    rejectedDeliveryChannels: rejectedChannels,
    actorGrants: {
      canExport: actorCanExport,
      canHandoff: actorCanHandoff,
      requireExplicitExportGrant,
      scopedGrantRequired: accessContext.scopedGrantRequired,
      scopedGrantSatisfied: accessContext.scopedGrantSatisfied,
      requiredPermissionSource: accessContext.grantResolution.requiredPermissionSource,
      deniedPermissions: accessContext.actor.deniedPermissions
    },
    serviceReady,
    clientReady,
    boundaryViolations,
    advisoryViolations,
    blockedBy: boundaryViolations,
    auditEnvelope: {
      id: `${surfaceId}:handoff-boundary:${requestState.workflowId}:${accessContext.tenantId}:${accessContext.workspaceId}`,
      routeId: requestState.returnRouteId || null,
      workflowId: requestState.workflowId,
      requestId: requestState.requestId || null,
      actorRef: requestState.actorRef,
      providerServiceRef: providerServiceContract.serviceRef,
      clientStateKey: clientRuntime.stateKey,
      proofChannels: requestState.deliveryChannels,
      boundaryDecision: decision,
      accessDecision: accessContext.decision,
      grantResolution: {
        requiredPermission: accessContext.requiredPermission,
        requiredPermissionSource: accessContext.grantResolution.requiredPermissionSource,
        appliedGrantIds: accessContext.grantResolution.applied.map((grant) => grant.id),
        ignoredGrantIds: accessContext.grantResolution.ignored.map((grant) => grant.id),
        deniedPermissions: accessContext.actor.deniedPermissions
      }
    }
  };
}

function normalizePersistedCommandAttempts(state, requestState, checkpointKey, now) {
  const ledger = asObject(state.commandLedger);
  const attemptsSource = Array.isArray(state.commandAttempts)
    ? state.commandAttempts
    : Array.isArray(ledger.attempts)
      ? ledger.attempts
      : Array.isArray(state.commands)
        ? state.commands
        : Object.entries(asObject(ledger.commandAttempts || state.commandAttemptMap)).map(([type, attempt]) => ({
            ...asObject(attempt),
            type
          }));
  const attemptsByType = new Map(
    attemptsSource.map((attempt, index) => {
      const source = asObject(attempt);
      const type = inferLifecycleCommandType(source.type || source.commandType || source.command || source.id);
      return [type || `unknown-${index + 1}`, source];
    })
  );

  return supportedLifecycleCommands.map((command) => {
    const source = asObject(attemptsByType.get(command));
    const lease = asObject(source.lease);
    const commandId = cleanString(source.id || source.commandId, `${surfaceId}:${requestState.workflowId}:${command}`);
    const suppliedState = cleanString(source.state || source.status, 'not-started');
    const normalizedState = ['completed', 'failed', 'in-flight', 'leased', 'blocked', 'not-started'].includes(suppliedState)
      ? suppliedState
      : 'not-started';
    const leaseOwner = cleanString(lease.owner || source.leaseOwner);
    const leaseUntil = cleanString(lease.until || source.leaseUntil);
    const leaseActive = Boolean(leaseOwner && leaseUntil && Date.parse(leaseUntil) > Date.parse(now));
    const completedAt = cleanString(source.completedAt || source.finishedAt);
    const failedAt = cleanString(source.failedAt || source.lastFailedAt);
    const replayDecision = normalizedState === 'completed'
      ? 'skip-completed'
      : leaseActive
        ? 'wait-for-active-lease'
        : normalizedState === 'failed'
          ? 'recover-failed-attempt'
          : normalizedState === 'blocked'
            ? 'recheck-blockers'
            : 'enqueue-if-enabled';

    return {
      command,
      commandId,
      state: normalizedState,
      replayDecision,
      idempotencyKey: cleanString(
        source.idempotencyKey || source.key,
        `${checkpointKey}:command:${requestState.workflowId}:${command}`
      ),
      attempt: cleanPositiveInteger(source.attempt || source.attemptCount, 0),
      lease: {
        owner: leaseOwner || null,
        until: leaseUntil || null,
        active: leaseActive
      },
      resultRef: cleanString(source.resultRef || source.outputRef) || null,
      errorCode: cleanString(source.errorCode || source.failureCode) || null,
      updatedAt: cleanString(source.updatedAt || source.observedAt || completedAt || failedAt) || null,
      completedAt: completedAt || null,
      failedAt: failedAt || null
    };
  });
}

function normalizePersistedVerifierState(input, packageContract, requestState, syncMetadata, now) {
  const state = asObject(input.persistedState || input.state || input.checkpoint);
  const commandLedger = asObject(state.commandLedger);
  const completedCommandIds = cleanStringList(
    state.completedCommandIds || commandLedger.completedCommandIds || commandLedger.completed
  );
  const failedCommandIds = cleanStringList(
    state.failedCommandIds || commandLedger.failedCommandIds || commandLedger.failed
  );
  const packageRef = `${packageContract.normalized.name}@${packageContract.normalized.version}`;
  const persistedPackageRef = cleanString(state.packageRef || state.packageId);
  const persistedWorkflowId = cleanString(state.workflowId);
  const persistedProviderRevision = cleanString(state.providerRevision);
  const persistedRequestId = cleanString(state.requestId);
  const checkpointRevision = cleanPositiveInteger(
    state.checkpointRevision || state.revision || state.sequence,
    0
  );
  const workflowMismatch = Boolean(persistedWorkflowId && persistedWorkflowId !== requestState.workflowId);
  const packageMismatch = Boolean(persistedPackageRef && persistedPackageRef !== packageRef);
  const providerRevisionMismatch = Boolean(
    persistedProviderRevision && persistedProviderRevision !== syncMetadata.providerRevision
  );
  const requestReplay = Boolean(
    persistedRequestId && requestState.requestId && persistedRequestId === requestState.requestId
  );
  const checkpointKey = cleanString(
    state.checkpointKey,
    `${surfaceId}:${requestState.workflowId}:${packageRef}`
  );
  const commandAttempts = normalizePersistedCommandAttempts(state, requestState, checkpointKey, now);
  const activeLeases = commandAttempts.filter((attempt) => attempt.lease.active);
  const recoverableAttempts = commandAttempts.filter((attempt) => attempt.replayDecision === 'recover-failed-attempt');
  const blockedAttempts = commandAttempts.filter((attempt) => attempt.replayDecision === 'recheck-blockers');
  const resumableAttempts = commandAttempts.filter((attempt) => attempt.replayDecision === 'enqueue-if-enabled');
  const hasCheckpoint = Boolean(
    persistedWorkflowId ||
      persistedPackageRef ||
      persistedProviderRevision ||
      completedCommandIds.length ||
      failedCommandIds.length ||
      commandAttempts.some((attempt) => attempt.state !== 'not-started') ||
      checkpointRevision
  );
  const recoveryIssues = [
    ...(workflowMismatch ? ['workflow-mismatch'] : []),
    ...(packageMismatch ? ['package-ref-mismatch'] : []),
    ...(providerRevisionMismatch ? ['provider-revision-changed'] : []),
    ...activeLeases.map((attempt) => `active-command-lease:${attempt.command}`),
    ...failedCommandIds.map((commandId) => `failed-command:${commandId}`)
  ];
  const restartStatus = !hasCheckpoint
    ? 'new'
    : recoveryIssues.length
      ? 'needs-reconciliation'
      : requestReplay
        ? 'idempotent-replay'
        : 'recovered';
  const resumeMode = workflowMismatch || packageMismatch
    ? 'manual-reconcile'
    : providerRevisionMismatch
      ? 'refresh-provider-sync'
      : activeLeases.length
        ? 'wait-for-command-lease'
        : recoverableAttempts.length
          ? 'recover-failed-commands'
          : requestReplay
            ? 'return-cached-command-results'
            : hasCheckpoint
              ? 'resume-from-checkpoint'
              : 'start-new-checkpoint';

  return {
    kind: 'hosted-kernel.package-verifier.persisted-state',
    version: 1,
    checkpointKey,
    checkpointRevision,
    status: restartStatus,
    restartSafe: recoveryIssues.length === 0 || activeLeases.length === recoveryIssues.length,
    recovered: hasCheckpoint && recoveryIssues.length === 0,
    requestReplay,
    workflowId: requestState.workflowId,
    requestId: requestState.requestId || persistedRequestId || null,
    packageRef,
    providerRevision: syncMetadata.providerRevision,
    previous: {
      workflowId: persistedWorkflowId || null,
      packageRef: persistedPackageRef || null,
      providerRevision: persistedProviderRevision || null,
      requestId: persistedRequestId || null,
      updatedAt: cleanString(state.updatedAt || state.lastUpdatedAt) || null
    },
    recoveryIssues,
    restartSemantics: {
      resumeMode,
      status: restartStatus,
      canHydrateCheckpoint: !workflowMismatch && !packageMismatch,
      canReplayRequest: requestReplay && !workflowMismatch && !packageMismatch,
      activeLeases: activeLeases.map((attempt) => ({
        command: attempt.command,
        commandId: attempt.commandId,
        leaseOwner: attempt.lease.owner,
        leaseUntil: attempt.lease.until
      })),
      recoverableCommands: recoverableAttempts.map((attempt) => attempt.command),
      blockedCommands: blockedAttempts.map((attempt) => attempt.command),
      resumableCommands: resumableAttempts.map((attempt) => attempt.command)
    },
    commandLedger: {
      completedCommandIds,
      failedCommandIds,
      nextRevision: checkpointRevision + 1,
      commandAttempts
    },
    persist: {
      requested: true,
      routeId: requestState.returnRouteId,
      updatedAt: now,
      writeMode: restartStatus === 'idempotent-replay' ? 'compare-and-skip' : 'compare-and-set',
      checkpointShape: {
        checkpointKey,
        checkpointRevision: checkpointRevision + 1,
        workflowId: requestState.workflowId,
        requestId: requestState.requestId || persistedRequestId || null,
        packageRef,
        providerRevision: syncMetadata.providerRevision,
        commandAttemptKeys: commandAttempts.map((attempt) => attempt.idempotencyKey),
        leaseSensitive: activeLeases.length > 0
      }
    }
  };
}

function normalizeOperationalHealth(input, syncMetadata, handoffState, persistedState, requestState, now) {
  const health = asObject(input.health || input.operationalHealth);
  const runtime = asObject(input.runtime);
  const failure = asObject(health.failure || health.lastFailure || input.failure);
  const failureInputs = Array.isArray(health.failures)
    ? health.failures
    : Array.isArray(runtime.failures)
      ? runtime.failures
      : Array.isArray(input.failures)
        ? input.failures
        : [];
  const observedFailures = [
    ...failureInputs,
    ...(failure.code || health.failureCode ? [failure] : [])
  ].map((entry, index) => {
    const source = asObject(entry);
    const code = cleanString(source.code || source.failureCode || source.reason);
    const policy = classifyOperationalFailure(code || `unknown-operational-failure-${index + 1}`);

    return {
      ...policy,
      code: policy.code,
      message: cleanString(source.message || source.detail || health.message, policy.title),
      severity: cleanString(source.severity, policy.retryable || policy.degraded ? 'warning' : 'error'),
      source: cleanString(source.source || source.component, 'hosted-kernel-runtime'),
      observedAt: cleanString(source.observedAt || source.lastSeenAt || health.observedAt, now),
      evidenceRef: cleanString(
        source.evidenceRef,
        `${surfaceId}:operational-failure:${requestState.workflowId}:${policy.code}`
      )
    };
  }).filter((entry) => entry.code);
  const failureCodes = [...new Set(observedFailures.map((entry) => entry.code))];
  const dependencyInputs = Array.isArray(health.dependencies)
    ? health.dependencies
    : Array.isArray(runtime.dependencies)
      ? runtime.dependencies
      : [];
  const dependencies = dependencyInputs.map((dependency, index) => {
    const source = asObject(dependency);
    const name = cleanString(source.name || source.id, `dependency-${index + 1}`);
    const state = cleanString(source.state || source.status, 'ready');
    return {
      name,
      state: ['ready', 'degraded', 'down', 'unknown'].includes(state) ? state : 'unknown',
      required: source.required !== false,
      lastCheckedAt: cleanString(source.lastCheckedAt || source.checkedAt, now),
      detail: cleanString(source.detail || source.reason),
      recoveryAction: cleanString(source.recoveryAction || source.action),
      evidenceRef: cleanString(
        source.evidenceRef,
        `${surfaceId}:dependency-health:${requestState.workflowId}:${name}`
      )
    };
  });
  const failureCode = cleanString(failure.code || health.failureCode);
  const retryAttempt = cleanPositiveInteger(health.retryAttempt || failure.retryAttempt || runtime.retryAttempt, 0);
  const retryBudgetInput = asObject(health.retryBudget || runtime.retryBudget || failure.retryBudget);
  const maxAttempts = cleanPositiveInteger(retryBudgetInput.maxAttempts || health.retryMaxAttempts, 5);
  const consumedAttempts = cleanPositiveInteger(retryBudgetInput.consumedAttempts, retryAttempt);
  const remainingAttempts = Math.max(0, cleanPositiveInteger(
    retryBudgetInput.remainingAttempts,
    Math.max(0, maxAttempts - consumedAttempts)
  ));
  const circuitInput = asObject(health.circuitBreaker || runtime.circuitBreaker);
  const requestedCircuitState = cleanString(circuitInput.state || circuitInput.status, 'closed');
  const circuitState = ['closed', 'half-open', 'open', 'tripped'].includes(requestedCircuitState)
    ? requestedCircuitState
    : 'closed';
  const circuitOpen = circuitState === 'open' || circuitState === 'tripped';
  const circuitHalfOpen = circuitState === 'half-open';
  const circuitRetryAfterMs = cleanPositiveInteger(circuitInput.retryAfterMs || circuitInput.resetAfterMs, 0);
  const degradedFailureCodes = failureCodes.filter((code) => degradedOperationalFailures.includes(code));
  const retryableFailureCandidates = [
    ...failureCodes.filter((code) => retryableOperationalFailures.includes(code)),
    ...dependencies
      .filter((dependency) => dependency.required && dependency.state === 'unknown')
      .map((dependency) => `dependency-unknown:${dependency.name}`),
    ...persistedState.commandLedger.failedCommandIds.map((commandId) => `command-failed:${commandId}`)
  ];
  const retryBudgetExhausted = retryableFailureCandidates.length > 0 && maxAttempts > 0 && remainingAttempts === 0;
  const degradedSignals = [
    ...(syncMetadata.stale ? ['sync-stale'] : []),
    ...(handoffState.requested && handoffState.state === 'blocked' ? ['handoff-blocked'] : []),
    ...degradedFailureCodes,
    ...dependencies.filter((dependency) => dependency.state === 'degraded').map((dependency) => `dependency-degraded:${dependency.name}`),
    ...dependencies
      .filter((dependency) => !dependency.required && dependency.state === 'down')
      .map((dependency) => `optional-dependency-down:${dependency.name}`),
    ...(circuitHalfOpen ? ['circuit-breaker-half-open'] : []),
    ...cleanStringList(health.degradedSignals)
  ];
  const hardFailures = [
    ...failureCodes.filter((code) => !retryableOperationalFailures.includes(code) && !degradedOperationalFailures.includes(code)),
    ...dependencies
      .filter((dependency) => dependency.required && dependency.state === 'down')
      .map((dependency) => `dependency-down:${dependency.name}`),
    ...(!persistedState.restartSafe ? persistedState.recoveryIssues : []),
    ...(circuitOpen ? ['circuit-breaker-open'] : []),
    ...(retryBudgetExhausted ? ['retry-budget-exhausted'] : [])
  ];
  const retryableFailures = [...new Set(retryableFailureCandidates)];
  const baseDelayMs = clampNumber(health.retryBaseDelayMs || runtime.retryBaseDelayMs, 250, 30000, 1000);
  const maxDelayMs = clampNumber(health.retryMaxDelayMs || runtime.retryMaxDelayMs, baseDelayMs, 300000, 30000);
  const retryPermitted = retryableFailures.length > 0 && !retryBudgetExhausted && !circuitOpen;
  const retryAfterMs = retryPermitted
    ? Math.max(circuitRetryAfterMs, Math.min(maxDelayMs, Math.round(baseDelayMs * 2 ** Math.min(retryAttempt, 8))))
    : 0;
  const nextRetryAt = retryPermitted ? addMilliseconds(now, retryAfterMs) : null;
  const degradedMode = Boolean(health.degradedMode || runtime.degradedMode || degradedSignals.length || degradedOperationalFailures.includes(failureCode));
  const state = hardFailures.length
    ? 'failed'
    : retryableFailures.length
      ? 'retrying'
      : degradedMode
        ? 'degraded'
        : 'healthy';
  const hardFailureSet = new Set(hardFailures);
  const actionableErrors = [
    ...hardFailures.map((code) => {
      const policy = classifyOperationalFailure(code);
      return {
      code,
      category: policy.category,
      title: policy.title,
      severity: 'error',
      retryable: false,
      degraded: false,
      blocksCommands: policy.blocks,
      action: code.startsWith('dependency-down:')
        ? 'Restore required verifier dependency before accepting or exporting proof'
        : policy.action
      };
    }),
    ...retryableFailures.map((code) => ({
      code,
      category: classifyOperationalFailure(code).category,
      title: classifyOperationalFailure(code).title,
      severity: 'warning',
      retryable: retryPermitted,
      degraded: false,
      retryAfterMs,
      nextRetryAt,
      blocksCommands: classifyOperationalFailure(code).blocks,
      action: retryPermitted
        ? classifyOperationalFailure(code).action
        : 'Retry is blocked by the verifier failure state; repair the blocking health issue first'
    })),
    ...degradedSignals.filter((code) => !hardFailureSet.has(code)).map((code) => {
      const policy = classifyOperationalFailure(code);
      return {
      code,
      category: policy.category,
      title: policy.title,
      severity: 'warning',
      retryable: false,
      degraded: true,
      blocksCommands: policy.blocks,
      action: policy.action
      };
    })
  ];
  const blockedCommandSet = new Set(actionableErrors.flatMap((error) => error.blocksCommands || []));
  const primaryFailure = observedFailures.find((entry) => entry.code === failureCode) || observedFailures[0] || null;

  return {
    kind: 'hosted-kernel.package-verifier.operational-health',
    version: 1,
    generatedAt: now,
    state,
    degradedMode,
    canServePreview: state !== 'failed',
    canAcceptOrExport: state === 'healthy' || state === 'degraded',
    failure: primaryFailure
      ? {
          code: primaryFailure.code,
          message: primaryFailure.message,
          observedAt: primaryFailure.observedAt,
          category: primaryFailure.category,
          evidenceRef: primaryFailure.evidenceRef
        }
      : null,
    failures: observedFailures,
    retry: {
      retryable: retryPermitted,
      attempt: retryAttempt,
      retryAfterMs,
      nextRetryAt,
      maxDelayMs,
      budget: {
        maxAttempts,
        consumedAttempts,
        remainingAttempts,
        exhausted: retryBudgetExhausted
      },
      circuitBreaker: {
        state: circuitState,
        open: circuitOpen,
        halfOpen: circuitHalfOpen,
        retryAfterMs: circuitRetryAfterMs,
        resetAt: cleanString(circuitInput.resetAt) || addMilliseconds(now, circuitRetryAfterMs)
      },
      nextCheckpointKey: persistedState.checkpointKey,
      idempotencyScope: `${surfaceId}:${requestState.workflowId}`
    },
    dependencies,
    blockedCommands: [...blockedCommandSet],
    hardFailures,
    retryableFailures,
    degradedSignals,
    actionableErrors
  };
}

function buildValidationSummary(packageContract, capabilityContract, syncMetadata, handoffState, accessContext, workspaceHandoffBoundary, operationalHealth, lifecycleSettings, providerContract, providerServiceContract) {
  const items = [
    {
      code: 'package.required-fields',
      status: packageContract.missing.length ? 'fail' : 'pass',
      severity: packageContract.missing.length ? 'error' : 'info',
      message: packageContract.missing.length
        ? `Missing package fields: ${packageContract.missing.join(', ')}`
        : 'Package identity is complete',
      fields: packageContract.missing
    },
    {
      code: 'capabilities.supported',
      status: capabilityContract.rejected.length ? 'fail' : 'pass',
      severity: capabilityContract.rejected.length ? 'error' : 'info',
      message: capabilityContract.rejected.length
        ? `Unsupported capabilities requested: ${capabilityContract.rejected.join(', ')}`
        : 'Capability request is supported',
      fields: capabilityContract.rejected
    },
    {
      code: 'sync.traceable',
      status: syncMetadata.providerRevision ? 'pass' : 'warn',
      severity: syncMetadata.providerRevision ? 'info' : 'warning',
      message: syncMetadata.providerRevision
        ? `Provider revision ${syncMetadata.providerRevision} is traceable`
        : 'Provider revision was not supplied',
      fields: syncMetadata.providerRevision ? [] : ['providerRevision']
    },
    {
      code: 'handoff.ready',
      status: handoffState.requested ? (handoffState.state === 'ready' ? 'pass' : 'fail') : 'skip',
      severity: handoffState.requested && handoffState.state !== 'ready' ? 'error' : 'info',
      message: handoffState.requested
        ? `External handoff is ${handoffState.state}`
        : 'External handoff was not requested',
      fields: handoffState.blockingReasons
    },
    {
      code: 'access.boundary',
      status: accessContext.decision === 'deny' ? 'fail' : accessContext.decision === 'review' ? 'warn' : 'pass',
      severity: accessContext.decision === 'deny' ? 'error' : accessContext.decision === 'review' ? 'warning' : 'info',
      message: accessContext.decision === 'allow'
        ? `Tenant ${accessContext.tenantId} workspace ${accessContext.workspaceId} is authorized`
        : `Boundary review required for ${accessContext.auditScopeRef}`,
      fields: accessContext.decision === 'deny'
        ? accessContext.blockingViolations
        : accessContext.advisoryViolations
    },
    {
      code: 'workspace.handoff-boundary',
      status: workspaceHandoffBoundary.decision === 'deny' ? 'fail' : workspaceHandoffBoundary.decision === 'review' ? 'warn' : 'pass',
      severity: workspaceHandoffBoundary.decision === 'deny' ? 'error' : workspaceHandoffBoundary.decision === 'review' ? 'warning' : 'info',
      message: workspaceHandoffBoundary.decision === 'allow'
        ? `Workspace handoff boundary allows ${workspaceHandoffBoundary.target}`
        : `Workspace handoff boundary requires ${workspaceHandoffBoundary.decision}`,
      fields: workspaceHandoffBoundary.decision === 'deny'
        ? workspaceHandoffBoundary.boundaryViolations
        : workspaceHandoffBoundary.advisoryViolations
    },
    {
      code: 'provider.contract',
      status: providerContract.decision === 'blocked' ? 'fail' : providerContract.decision === 'review' ? 'warn' : 'pass',
      severity: providerContract.decision === 'blocked' ? 'error' : providerContract.decision === 'review' ? 'warning' : 'info',
      message: providerContract.decision === 'satisfied'
        ? `Provider contract ${providerContract.contractRef} is satisfied`
        : `Provider contract ${providerContract.contractRef} needs ${providerContract.decision}`,
      fields: providerContract.failedRequiredClauses
    },
    {
      code: 'provider.service-contract',
      status: providerServiceContract.state === 'blocked' ? 'fail' : providerServiceContract.state === 'degraded' ? 'warn' : 'pass',
      severity: providerServiceContract.state === 'blocked' ? 'error' : providerServiceContract.state === 'degraded' ? 'warning' : 'info',
      message: providerServiceContract.state === 'ready'
        ? `Provider service ${providerServiceContract.serviceRef} is ready`
        : `Provider service ${providerServiceContract.serviceRef} is ${providerServiceContract.state}`,
      fields: providerServiceContract.blockedBy
    },
    {
      code: 'operational.health',
      status: operationalHealth.state === 'failed' ? 'fail' : operationalHealth.state === 'healthy' ? 'pass' : 'warn',
      severity: operationalHealth.state === 'failed' ? 'error' : operationalHealth.state === 'healthy' ? 'info' : 'warning',
      message: operationalHealth.state === 'healthy'
        ? 'Verifier runtime is healthy'
        : `Verifier runtime is ${operationalHealth.state}`,
      fields: [
        ...operationalHealth.hardFailures,
        ...operationalHealth.retryableFailures,
        ...operationalHealth.degradedSignals
      ]
    },
    {
      code: 'lifecycle.settings',
      status: lifecycleSettings.status === 'blocked' ? 'fail' : lifecycleSettings.status === 'review' ? 'warn' : 'pass',
      severity: lifecycleSettings.status === 'blocked' ? 'error' : lifecycleSettings.status === 'review' ? 'warning' : 'info',
      message: lifecycleSettings.status === 'scheduled'
        ? `Lifecycle controls are scheduled by ${lifecycleSettings.schedule.cadence}`
        : lifecycleSettings.status === 'enabled'
          ? 'Lifecycle controls allow verifier commands'
          : `Lifecycle controls are ${lifecycleSettings.status}`,
      fields: lifecycleSettings.blockingReasons
    }
  ];

  const errors = items.filter((item) => item.severity === 'error').length;
  const warnings = items.filter((item) => item.severity === 'warning').length;

  return {
    status: errors ? 'invalid' : warnings ? 'review' : 'valid',
    errors,
    warnings,
    passed: items.filter((item) => item.status === 'pass').length,
    items
  };
}

function buildPreviewContract(packageContract, capabilityContract, syncMetadata, handoffState, accessContext, routeClient, providerContract, providerServiceContract, now) {
  const title = `${packageContract.normalized.name}@${packageContract.normalized.version}`;

  return {
    kind: 'hosted-kernel.package-verifier.preview',
    version: 1,
    generatedAt: now,
    target: routeClient.previewTarget,
    title,
    subtitle: `${packageContract.normalized.provider} via ${packageContract.normalized.route}`,
    badges: [
      packageContract.missing.length ? 'package-incomplete' : 'package-complete',
      capabilityContract.rejected.length ? 'capability-review' : 'capability-ready',
      syncMetadata.stale ? 'sync-stale' : 'sync-current',
      `boundary-${accessContext.decision}`,
      `contract-${providerContract.decision}`,
      `service-${providerServiceContract.state}`,
      handoffState.state
    ],
    primaryFields: [
      { label: 'Package', value: title },
      { label: 'Integrity', value: packageContract.normalized.integrity || 'missing' },
      { label: 'Provider revision', value: syncMetadata.providerRevision },
      { label: 'Provider service', value: providerServiceContract.state },
      { label: 'Workspace', value: `${accessContext.tenantId}/${accessContext.workspaceId}` },
      { label: 'Handoff', value: handoffState.state }
    ],
    proofPreview: {
      proofType: 'hosted-kernel-package-provider-contract',
      evidenceCount: 8 + providerContract.evidenceRefs.length + providerServiceContract.evidenceRefs.length,
      exportRef: handoffState.exportRef,
      nextCursor: syncMetadata.nextCursor,
      contractRef: providerContract.contractRef,
      serviceRef: providerServiceContract.serviceRef
    }
  };
}

function buildAcceptanceContract(audit, validationSummary, handoffState, routeClient, requestState, now) {
  const gates = Object.entries(audit.checks).map(([key, passed]) => ({
    key,
    label: acceptanceGateLabels[key] || key,
    passed,
    required: key !== 'handoffReady' || handoffState.requested,
    evidenceRef: `${surfaceId}:gate:${key}`
  }));
  const failedRequiredGates = gates.filter((gate) => gate.required && !gate.passed);

  return {
    kind: 'hosted-kernel.package-verifier.acceptance',
    version: 1,
    action: routeClient.acceptAction,
    generatedAt: now,
    acceptable: failedRequiredGates.length === 0 && validationSummary.status !== 'invalid',
    mode: validationSummary.status === 'review' ? 'accept-with-review' : 'accept',
    gates,
    failedRequiredGates: failedRequiredGates.map((gate) => gate.key),
    submit: {
      method: 'POST',
      routeId: routeClient.routeId,
      action: routeClient.acceptAction,
      clientSessionId: routeClient.clientSessionId || null,
      responseFormat: routeClient.responseFormat,
      workflowId: requestState.workflowId,
      requestId: requestState.requestId || null,
      correlationId: requestState.correlationId || null
    }
  };
}

function buildReadinessContract(validationSummary, packageContract, capabilityContract, syncMetadata, handoffState, accessContext, workspaceHandoffBoundary, operationalHealth, lifecycleSettings, providerContract, providerServiceContract) {
  const blockers = [
    ...packageContract.missing.map((field) => `Add package.${field}`),
    ...capabilityContract.rejected.map((capability) => `Remove or implement ${capability}`),
    ...syncMetadata.conflicts.map((conflict) => `Resolve sync conflict ${conflict}`),
    ...handoffState.blockingReasons.map((reason) => `Resolve handoff blocker ${reason}`),
    ...providerContract.failedRequiredClauses.map((clause) => `Satisfy provider contract clause ${clause}`),
    ...providerServiceContract.blockedBy.map((reason) => `Resolve provider service blocker ${reason}`),
    ...accessContext.blockingViolations.map((violation) => `Resolve boundary violation ${violation}`),
    ...workspaceHandoffBoundary.blockedBy.map((violation) => `Resolve workspace handoff boundary ${violation}`),
    ...operationalHealth.hardFailures.map((failure) => `Resolve verifier failure ${failure}`),
    ...lifecycleSettings.blockingReasons
      .filter((reason) => lifecycleSettings.strict || reason !== 'schedule-missing-trigger')
      .map((reason) => `Resolve lifecycle setting ${reason}`)
  ];
  const score = Math.max(0, 100 - validationSummary.errors * 35 - validationSummary.warnings * 15 - syncMetadata.conflicts.length * 10 - operationalHealth.retryableFailures.length * 8);

  return {
    kind: 'hosted-kernel.package-verifier.readiness',
    version: 1,
    state: blockers.length
      ? 'blocked'
      : operationalHealth.state === 'retrying'
        ? 'retrying'
        : validationSummary.status === 'review' || operationalHealth.degradedMode
          ? 'review'
          : 'ready',
    score,
    blockers,
    retryAfterMs: operationalHealth.retry.retryAfterMs,
    canExportProof: blockers.length === 0 && operationalHealth.canAcceptOrExport && lifecycleSettings.commandSettings.find((command) => command.command === 'export-proof')?.enabled,
    canAcceptPreview: validationSummary.status !== 'invalid'
      && packageContract.missing.length === 0
      && operationalHealth.canServePreview
      && lifecycleSettings.commandSettings.find((command) => command.command === 'accept-preview')?.enabled,
    boundaryDecision: accessContext.decision,
    workspaceHandoffBoundaryDecision: workspaceHandoffBoundary.decision,
    operationalState: operationalHealth.state,
    lifecycleState: lifecycleSettings.status,
    scheduleState: lifecycleSettings.schedule.nextAction,
    providerServiceState: providerServiceContract.state
  };
}

function buildProofExportContract(audit, packageContract, syncMetadata, handoffState, requestState, readiness, accessContext, workspaceHandoffBoundary, providerContract, providerServiceContract, clientRuntime, now) {
  const packageRef = `${packageContract.normalized.name}@${packageContract.normalized.version}`;
  const exportRef = handoffState.exportRef || `${surfaceId}:${packageRef}`;
  const deliveryState = readiness.canExportProof
    ? requestState.deliveryChannels.map((channel) => ({
        channel,
        state: channel === 'handoff-envelope' && handoffState.state !== 'ready' ? 'blocked' : 'ready'
      }))
    : requestState.deliveryChannels.map((channel) => ({ channel, state: 'blocked' }));

  return {
    kind: 'hosted-kernel.package-verifier.proof-export',
    version: 1,
    generatedAt: now,
    exportRef,
    packageRef,
    proofType: audit.proofType,
    proofFormat: requestState.proofFormat,
    contractRef: providerContract.contractRef,
    serviceRef: providerServiceContract.serviceRef,
    artifactName: `${packageContract.normalized.name}-${packageContract.normalized.version}.verifier-proof.${requestState.proofFormat}`,
    canExport: readiness.canExportProof,
    blockedBy: readiness.canExportProof ? [] : readiness.blockers,
    delivery: {
      requestedChannels: requestState.deliveryChannels,
      rejectedChannels: requestState.rejectedDeliveryChannels,
      channels: deliveryState,
      clientState: {
        requested: requestState.deliveryChannels.includes('client-state'),
        stateKey: clientRuntime.stateKey,
        stateVersion: clientRuntime.stateVersion,
        canHydrate: clientRuntime.canHydrate,
        blockedBy: clientRuntime.blockedBy
      }
    },
    envelope: {
      workflowId: requestState.workflowId,
      requestId: requestState.requestId || null,
      correlationId: requestState.correlationId || null,
      clientSessionId: requestState.clientSessionId || null,
      clientStateKey: clientRuntime.stateKey,
      clientStateVersion: clientRuntime.stateVersion,
      providerRevision: syncMetadata.providerRevision,
      tenantId: accessContext.tenantId,
      workspaceId: accessContext.workspaceId,
      boundaryDecision: accessContext.decision,
      requiredPermission: accessContext.requiredPermission,
      requiredPermissionSource: accessContext.grantResolution.requiredPermissionSource,
      scopedGrantRequired: accessContext.scopedGrantRequired,
      scopedGrantSatisfied: accessContext.scopedGrantSatisfied,
      deniedPermissions: accessContext.actor.deniedPermissions,
      workspaceHandoffBoundaryDecision: workspaceHandoffBoundary.decision,
      workspaceHandoffAuditEnvelopeId: workspaceHandoffBoundary.auditEnvelope.id,
      allowedHandoffTargets: workspaceHandoffBoundary.allowedTargets,
      allowedDeliveryChannels: workspaceHandoffBoundary.allowedDeliveryChannels,
      boundaryViolations: workspaceHandoffBoundary.boundaryViolations,
      providerContractDecision: providerContract.decision,
      failedContractClauses: providerContract.failedRequiredClauses,
      providerServiceState: providerServiceContract.state,
      providerServiceOperations: providerServiceContract.requestedOperations,
      failedServiceOperations: providerServiceContract.missingOperations,
      evidenceCount: audit.evidence.length,
      auditStatus: audit.status
    }
  };
}

function buildWorkflowHandoffContract(validationSummary, readiness, handoffState, routeClient, requestState, proofExport, accessContext, workspaceHandoffBoundary, lifecycleSettings, providerServiceContract, clientRuntime, now) {
  const shouldReturnToClient = Boolean(requestState.returnUrl || requestState.returnRouteId);
  const commandControls = new Map(lifecycleSettings.commandSettings.map((setting) => [setting.command, setting]));
  const baseBlockedBy = [
    ...readiness.blockers,
    ...(!requestState.intentAccepted ? [`Unsupported request intent ${requestState.requestedIntent}`] : []),
    ...(!requestState.proofFormatAccepted ? [`Unsupported proof format ${requestState.requestedProofFormat}`] : []),
    ...requestState.rejectedDeliveryChannels.map((channel) => `Unsupported delivery channel ${channel}`),
    ...accessContext.blockingViolations.map((violation) => `Boundary violation ${violation}`),
    ...workspaceHandoffBoundary.blockedBy.map((violation) => `Workspace handoff boundary ${violation}`),
    ...lifecycleSettings.blockingReasons.map((reason) => `Lifecycle control ${reason}`),
    ...providerServiceContract.blockedBy.map((reason) => `Provider service ${reason}`),
    ...clientRuntime.blockedBy.map((reason) => `Client runtime ${reason}`)
  ];
  const actions = [
    {
      id: 'render-preview',
      label: 'Render verifier preview',
      enabled: commandControls.get('verify-package')?.enabled !== false,
      routeId: routeClient.routeId,
      target: routeClient.previewTarget,
      blockedBy: commandControls.get('verify-package')?.blockedBy || []
    },
    {
      id: 'submit-acceptance',
      label: 'Submit package acceptance',
      enabled: readiness.canAcceptPreview && validationSummary.status !== 'invalid',
      routeId: routeClient.routeId,
      target: routeClient.acceptAction,
      blockedBy: readiness.canAcceptPreview ? [] : [...baseBlockedBy, ...(commandControls.get('accept-preview')?.blockedBy || [])]
    },
    {
      id: 'deliver-proof',
      label: 'Deliver verifier proof',
      enabled: proofExport.canExport && requestState.proofFormatAccepted && requestState.rejectedDeliveryChannels.length === 0,
      routeId: routeClient.routeId,
      target: proofExport.exportRef,
      blockedBy: proofExport.canExport ? baseBlockedBy : [...proofExport.blockedBy, ...(commandControls.get('export-proof')?.blockedBy || [])]
    },
    {
      id: 'return-to-client',
      label: 'Return workflow state to client',
      enabled: shouldReturnToClient
        && clientRuntime.canReturnToClient
        && validationSummary.status !== 'invalid'
        && commandControls.get('return-to-client')?.enabled !== false,
      routeId: requestState.returnRouteId,
      target: requestState.returnUrl || requestState.returnRouteId,
      blockedBy: shouldReturnToClient
        ? [
            ...baseBlockedBy,
            ...(!clientRuntime.canReturnToClient ? clientRuntime.returnBlockedBy : []),
            ...(commandControls.get('return-to-client')?.blockedBy || [])
          ]
        : ['No client return target supplied']
    }
  ];

  return {
    kind: 'hosted-kernel.package-verifier.workflow-handoff',
    version: 1,
    generatedAt: now,
    state: actions.every((action) => action.enabled) ? 'ready' : baseBlockedBy.length ? 'blocked' : 'actionable',
    workflowId: requestState.workflowId,
    intent: requestState.intent,
    requestedIntent: requestState.requestedIntent,
    clientStateKey: clientRuntime.stateKey,
    clientStateVersion: clientRuntime.stateVersion,
    clientHydrationReady: clientRuntime.canHydrate,
    externalHandoffState: handoffState.state,
    providerServiceState: providerServiceContract.state,
    lifecycleState: lifecycleSettings.status,
    scheduleNextAction: lifecycleSettings.schedule.nextAction,
    auditScopeRef: accessContext.auditScopeRef,
    handoffBoundaryDecision: workspaceHandoffBoundary.decision,
    handoffBoundaryAuditEnvelopeId: workspaceHandoffBoundary.auditEnvelope.id,
    actions
  };
}

function buildNextStepContracts(validationSummary, readiness, handoffState, routeClient, workflowHandoff, lifecycleSettings) {
  const steps = [];
  const scheduledCommand = lifecycleSettings.schedule.nextCommand;

  if (lifecycleSettings.status === 'blocked') {
    steps.push({
      id: 'fix-lifecycle-settings',
      label: 'Fix lifecycle settings',
      reason: lifecycleSettings.blockingReasons.join(', '),
      routeId: routeClient.routeId,
      priority: 'high'
    });
  } else if (lifecycleSettings.schedule.nextAction === 'fix-schedule') {
    steps.push({
      id: 'fix-lifecycle-schedule',
      label: 'Fix lifecycle schedule',
      reason: lifecycleSettings.schedule.validation.blockingReasons.join(', '),
      routeId: routeClient.routeId,
      priority: lifecycleSettings.strict ? 'high' : 'normal'
    });
  } else if (lifecycleSettings.schedule.nextAction === 'run-due-command' && scheduledCommand) {
    steps.push({
      id: `run-${scheduledCommand.command}`,
      label: `Run ${scheduledCommand.command}`,
      reason: scheduledCommand.auditReason,
      routeId: routeClient.routeId,
      priority: scheduledCommand.autoRunnable ? 'high' : 'normal',
      command: scheduledCommand.command,
      controlRef: scheduledCommand.controlRef
    });
  } else if (lifecycleSettings.schedule.nextAction === 'wait-until-next-run') {
    steps.push({
      id: 'wait-for-scheduled-run',
      label: 'Wait for scheduled run',
      reason: `Next verifier run is scheduled for ${lifecycleSettings.schedule.effectiveNextRunAt}`,
      routeId: routeClient.routeId,
      priority: 'low',
      nextRunAt: lifecycleSettings.schedule.effectiveNextRunAt
    });
  } else if (lifecycleSettings.schedule.nextAction === 'wait-for-change') {
    steps.push({
      id: 'wait-for-package-change',
      label: 'Wait for package change',
      reason: 'On-change lifecycle cadence is enabled and no unprocessed change token is pending',
      routeId: routeClient.routeId,
      priority: 'low',
      lastProcessedChangeToken: lifecycleSettings.schedule.lastProcessedChangeToken
    });
  } else if (lifecycleSettings.schedule.nextAction === 'schedule-next-run') {
    steps.push({
      id: 'schedule-verifier-run',
      label: 'Schedule verifier run',
      reason: `Lifecycle cadence ${lifecycleSettings.schedule.cadence} is enabled without a next run`,
      routeId: routeClient.routeId,
      priority: 'normal'
    });
  }

  if (validationSummary.status === 'invalid') {
    steps.push({
      id: 'fix-validation',
      label: 'Fix validation issues',
      reason: 'Acceptance requires all error-level validation items to pass',
      routeId: routeClient.routeId,
      priority: 'high'
    });
  }

  if (readiness.canExportProof) {
    steps.push({
      id: 'export-proof',
      label: 'Export verifier proof',
      reason: 'Package, capability, sync, and handoff gates are ready',
      routeId: routeClient.routeId,
      priority: 'normal',
      exportRef: handoffState.exportRef
    });
  }

  const handoffAction = workflowHandoff.actions.find((action) => action.id === 'return-to-client');
  if (handoffAction?.enabled) {
    steps.push({
      id: 'return-to-client',
      label: 'Return to client workflow',
      reason: 'Verifier state can be handed back to the requesting client',
      routeId: handoffAction.routeId,
      priority: 'normal',
      target: handoffAction.target
    });
  }

  steps.push({
    id: readiness.canAcceptPreview ? 'accept-preview' : 'review-preview',
    label: readiness.canAcceptPreview ? 'Accept preview' : 'Review preview',
    reason: readiness.canAcceptPreview
      ? 'Preview contract is acceptable for client submission'
      : 'Preview is visible but not yet acceptable',
    routeId: routeClient.routeId,
    priority: readiness.canAcceptPreview ? 'normal' : 'high'
  });

  return {
    kind: 'hosted-kernel.package-verifier.next-steps',
    version: 1,
    routeId: routeClient.routeId,
    steps
  };
}

function inferLifecycleCommandType(commandId) {
  const cleaned = cleanString(commandId);
  return supportedLifecycleCommands.find((command) => (
    cleaned === command ||
    cleaned.endsWith(`:${command}`) ||
    cleaned.includes(`:${command}:`)
  )) || null;
}

function buildCommandFailureRecoveryRecords(
  requestState,
  persistedState,
  operationalHealth,
  lifecycleSettings,
  now
) {
  const lifecycleControls = new Map(lifecycleSettings.commandSettings.map((setting) => [setting.command, setting]));
  const retryAfterMs = operationalHealth.retry.retryAfterMs;

  return persistedState.commandLedger.failedCommandIds.map((failedCommandId, index) => {
    const commandType = inferLifecycleCommandType(failedCommandId);
    const policy = commandType ? lifecycleCommandRecoveryPolicy[commandType] : null;
    const lifecycleControl = commandType ? lifecycleControls.get(commandType) : null;
    const lifecycleBlocked = Boolean(lifecycleControl && lifecycleControl.enabled === false);
    const recoveryRetryable = Boolean(policy?.retryable) && operationalHealth.state !== 'failed' && !lifecycleBlocked;
    const degradedAllowed = Boolean(policy?.degradedAllowed) && operationalHealth.degradedMode;
    const recoveryState = !commandType
      ? 'needs-triage'
      : lifecycleBlocked
        ? 'blocked-by-lifecycle'
        : recoveryRetryable
          ? 'retry-ready'
          : degradedAllowed
            ? 'degraded-resume'
            : 'manual-repair';

    return {
      id: `${persistedState.checkpointKey}:recovery:${index + 1}`,
      commandId: failedCommandId,
      commandType: commandType || 'unknown',
      state: recoveryState,
      retryable: recoveryRetryable,
      degradedResumeAllowed: degradedAllowed,
      retryAfterMs: recoveryRetryable ? retryAfterMs : 0,
      idempotencyKey: commandType
        ? `${persistedState.checkpointKey}:recover:${requestState.workflowId}:${commandType}`
        : `${persistedState.checkpointKey}:recover:unknown:${index + 1}`,
      action: policy?.action || 'Inspect failed command ledger entry before resuming verifier workflow',
      blocksCommands: policy?.blocks || supportedLifecycleCommands,
      blockedBy: [
        ...(!commandType ? ['unknown-lifecycle-command'] : []),
        ...(lifecycleBlocked ? lifecycleControl.blockedBy.map((reason) => `lifecycle:${reason}`) : []),
        ...(operationalHealth.state === 'failed' ? operationalHealth.hardFailures.map((failure) => `health:${failure}`) : [])
      ],
      observedAt: now
    };
  });
}

function buildIdempotentCommandContracts(
  packageContract,
  requestState,
  readiness,
  proofExport,
  workflowHandoff,
  persistedState,
  accessContext,
  operationalHealth,
  lifecycleSettings,
  now
) {
  const completedCommandIds = new Set(persistedState.commandLedger.completedCommandIds);
  const failedCommandIds = new Set(persistedState.commandLedger.failedCommandIds);
  const commandAttemptsByType = new Map(
    persistedState.commandLedger.commandAttempts.map((attempt) => [attempt.command, attempt])
  );
  const packageRef = `${packageContract.normalized.name}@${packageContract.normalized.version}`;
  const baseKey = `${persistedState.checkpointKey}:r${persistedState.commandLedger.nextRevision}`;
  const lifecycleControls = new Map(lifecycleSettings.commandSettings.map((setting) => [setting.command, setting]));
  const persistedReplayIssues = new Set(persistedState.recoveryIssues || []);
  const completedCommandIdsByType = new Set(
    [...completedCommandIds]
      .map((commandId) => inferLifecycleCommandType(commandId) || (supportedLifecycleCommands.includes(commandId) ? commandId : null))
      .filter(Boolean)
  );
  const failedCommandIdsByType = new Set(
    [...failedCommandIds]
      .map((commandId) => inferLifecycleCommandType(commandId) || (supportedLifecycleCommands.includes(commandId) ? commandId : null))
      .filter(Boolean)
  );
  const healthBlockersForCommand = (commandType) => operationalHealth.actionableErrors
    .filter((error) => (
      Array.isArray(error.blocksCommands)
        && error.blocksCommands.includes(commandType)
        && (error.severity === 'error' || (!error.retryable && !error.degraded))
    ))
    .map((error) => `operational-health:${error.code}`);
  const failureRecovery = buildCommandFailureRecoveryRecords(
    requestState,
    persistedState,
    operationalHealth,
    lifecycleSettings,
    now
  );
  const commandSpecs = [
    {
      type: 'verify-package',
      enabled: lifecycleControls.get('verify-package')?.enabled !== false && healthBlockersForCommand('verify-package').length === 0,
      blockedBy: [
        ...(lifecycleControls.get('verify-package')?.blockedBy || []),
        ...healthBlockersForCommand('verify-package')
      ],
      resultRef: `${surfaceId}:validation:${packageRef}`
    },
    {
      type: 'accept-preview',
      enabled: readiness.canAcceptPreview
        && lifecycleControls.get('accept-preview')?.enabled !== false
        && healthBlockersForCommand('accept-preview').length === 0,
      blockedBy: readiness.canAcceptPreview
        ? [
            ...(lifecycleControls.get('accept-preview')?.blockedBy || []),
            ...healthBlockersForCommand('accept-preview')
          ]
        : [
            ...readiness.blockers,
            ...(lifecycleControls.get('accept-preview')?.blockedBy || []),
            ...healthBlockersForCommand('accept-preview')
          ],
      resultRef: `${surfaceId}:acceptance:${packageRef}`
    },
    {
      type: 'export-proof',
      enabled: proofExport.canExport
        && lifecycleControls.get('export-proof')?.enabled !== false
        && healthBlockersForCommand('export-proof').length === 0,
      blockedBy: proofExport.canExport
        ? [
            ...(lifecycleControls.get('export-proof')?.blockedBy || []),
            ...healthBlockersForCommand('export-proof')
          ]
        : [
            ...proofExport.blockedBy,
            ...(lifecycleControls.get('export-proof')?.blockedBy || []),
            ...healthBlockersForCommand('export-proof')
          ],
      resultRef: proofExport.exportRef
    },
    {
      type: 'return-to-client',
      enabled: Boolean(workflowHandoff.actions.find((action) => action.id === 'return-to-client')?.enabled)
        && lifecycleControls.get('return-to-client')?.enabled !== false
        && healthBlockersForCommand('return-to-client').length === 0,
      blockedBy:
        [
          ...(workflowHandoff.actions.find((action) => action.id === 'return-to-client')?.blockedBy || []),
          ...(lifecycleControls.get('return-to-client')?.blockedBy || []),
          ...healthBlockersForCommand('return-to-client')
        ],
      resultRef: requestState.returnUrl || requestState.returnRouteId
    }
  ];
  const replayPolicyByCommand = new Map(commandSpecs.map((command) => {
    const persistedAttempt = commandAttemptsByType.get(command.type);
    const recoveryPolicy = lifecycleCommandRecoveryPolicy[command.type] || {};
    const lifecycleControl = lifecycleControls.get(command.type);
    const commandId = `${surfaceId}:${requestState.workflowId}:${command.type}`;
    const wasCompleted = persistedAttempt?.replayDecision === 'skip-completed'
      || completedCommandIds.has(commandId)
      || completedCommandIds.has(command.type)
      || completedCommandIdsByType.has(command.type);
    const wasFailed = persistedAttempt?.replayDecision === 'recover-failed-attempt'
      || failedCommandIds.has(commandId)
      || failedCommandIds.has(command.type)
      || failedCommandIdsByType.has(command.type);
    const leaseHeld = persistedAttempt?.replayDecision === 'wait-for-active-lease';
    const checkpointConflict = !persistedState.restartSemantics.canHydrateCheckpoint;
    const providerRefreshRequired = persistedReplayIssues.has('provider-revision-changed')
      && command.type !== 'verify-package';
    const lifecycleBlocked = Boolean(lifecycleControl && lifecycleControl.enabled === false);
    const canRetryFailed = wasFailed
      && recoveryPolicy.retryable === true
      && operationalHealth.state !== 'failed'
      && !lifecycleBlocked
      && !checkpointConflict
      && !providerRefreshRequired;
    const canResumeDegraded = wasFailed
      && recoveryPolicy.degradedAllowed === true
      && operationalHealth.degradedMode
      && !lifecycleBlocked
      && !checkpointConflict;
    const action = wasCompleted
      ? persistedState.requestReplay
        ? 'return-cached-result'
        : 'skip-completed'
      : leaseHeld
        ? 'wait-for-lease'
        : checkpointConflict
          ? 'block-checkpoint-conflict'
          : providerRefreshRequired
            ? 'refresh-provider-before-replay'
            : canRetryFailed
              ? 'retry-failed-command'
              : canResumeDegraded
                ? 'resume-degraded-command'
                : wasFailed
                  ? 'manual-recovery-required'
                  : lifecycleBlocked
                    ? 'blocked-by-lifecycle'
                    : command.enabled
                      ? 'enqueue-new-attempt'
                      : 'blocked-by-current-state';
    const terminal = ['return-cached-result', 'skip-completed'].includes(action);
    const runnable = ['retry-failed-command', 'resume-degraded-command', 'enqueue-new-attempt'].includes(action);
    const blockedBy = [
      ...(checkpointConflict ? persistedState.recoveryIssues.map((issue) => `checkpoint:${issue}`) : []),
      ...(providerRefreshRequired ? ['provider-sync-refresh-required'] : []),
      ...(leaseHeld ? [`active-command-lease:${persistedAttempt.lease.owner || 'unknown'}`] : []),
      ...(lifecycleBlocked ? (lifecycleControl?.blockedBy || []).map((reason) => `lifecycle:${reason}`) : []),
      ...(wasFailed && !canRetryFailed && !canResumeDegraded && !lifecycleBlocked && !checkpointConflict
        ? [`command-recovery-policy:${command.type}:${recoveryPolicy.retryable ? 'retry-blocked' : 'non-retryable'}`]
        : [])
    ];

    return [command.type, {
      command: command.type,
      commandId,
      action,
      terminal,
      runnable,
      wasCompleted,
      wasFailed,
      leaseHeld,
      checkpointConflict,
      providerRefreshRequired,
      previousAttempt: persistedAttempt
        ? {
            state: persistedAttempt.state,
            replayDecision: persistedAttempt.replayDecision,
            attempt: persistedAttempt.attempt,
            resultRef: persistedAttempt.resultRef,
            errorCode: persistedAttempt.errorCode,
            updatedAt: persistedAttempt.updatedAt
          }
        : null,
      nextAttemptOrdinal: terminal ? persistedAttempt?.attempt || 0 : (persistedAttempt?.attempt || 0) + 1,
      checkpointWriteMode: terminal ? 'read-through' : persistedState.persist.writeMode,
      idempotencyKey: persistedAttempt?.idempotencyKey || `${baseKey}:${command.type}`,
      blockedBy
    }];
  }));
  const commands = commandSpecs.map((command) => {
    const commandId = `${surfaceId}:${requestState.workflowId}:${command.type}`;
    const persistedAttempt = commandAttemptsByType.get(command.type);
    const replayPolicy = replayPolicyByCommand.get(command.type);
    const recoveryRecord = failureRecovery.find((record) => (
      record.commandId === commandId ||
      record.commandId === command.type ||
      record.commandType === command.type
    ));
    const replayState = replayPolicy.terminal
      ? 'already-completed'
      : replayPolicy.action === 'wait-for-lease'
        ? 'lease-held'
        : ['retry-failed-command', 'resume-degraded-command'].includes(replayPolicy.action)
          ? 'retryable'
          : replayPolicy.runnable
            ? 'ready'
            : 'blocked';
    const persistedBlockedBy = replayPolicy.blockedBy.length
      ? replayPolicy.blockedBy
      : persistedAttempt?.replayDecision === 'recheck-blockers'
        ? [`persisted-command-blocked:${command.type}`]
        : [];

    return {
      id: commandId,
      type: command.type,
      state: replayState,
      enabled: command.enabled && replayPolicy.runnable,
      idempotencyKey: replayPolicy.idempotencyKey,
      attempt: replayPolicy.nextAttemptOrdinal,
      restartSafe: persistedState.restartSafe,
      restartReplayAction: replayPolicy.action,
      checkpointWriteMode: replayPolicy.checkpointWriteMode,
      previousAttempt: replayPolicy.previousAttempt,
      retryAfterMs: replayState === 'retryable' || operationalHealth.state === 'retrying'
        ? operationalHealth.retry.retryAfterMs
        : 0,
      replayDecision: replayPolicy.action,
      lease: persistedAttempt?.lease || { owner: null, until: null, active: false },
      recoveryState: recoveryRecord?.state || null,
      recoveryAction: recoveryRecord?.action || null,
      recoveryBlockedBy: recoveryRecord?.blockedBy || [],
      degradedMode: operationalHealth.degradedMode,
      lifecycleState: lifecycleSettings.status,
      scheduleNextAction: lifecycleSettings.schedule.nextAction,
      createdAt: now,
      workflowId: requestState.workflowId,
      requestId: requestState.requestId || null,
      packageRef,
      tenantId: accessContext.tenantId,
      workspaceId: accessContext.workspaceId,
      auditScopeRef: accessContext.auditScopeRef,
      resultRef: persistedAttempt?.resultRef || command.resultRef,
      blockedBy: replayState === 'already-completed' ? [] : [...persistedBlockedBy, ...command.blockedBy]
    };
  });
  const restartReplay = {
    status: persistedState.status,
    resumeMode: persistedState.restartSemantics.resumeMode,
    checkpointKey: persistedState.checkpointKey,
    checkpointRevision: persistedState.checkpointRevision,
    nextRevision: persistedState.commandLedger.nextRevision,
    requestReplay: persistedState.requestReplay,
    canHydrateCheckpoint: persistedState.restartSemantics.canHydrateCheckpoint,
    canReplayRequest: persistedState.restartSemantics.canReplayRequest,
    blockingActions: commands
      .filter((command) => command.state === 'blocked' || command.state === 'lease-held')
      .map((command) => ({
        command: command.type,
        action: command.restartReplayAction,
        blockedBy: command.blockedBy
      })),
    replayableCommands: commands
      .filter((command) => ['retryable', 'ready'].includes(command.state))
      .map((command) => ({
        command: command.type,
        action: command.restartReplayAction,
        idempotencyKey: command.idempotencyKey,
        attempt: command.attempt
      })),
    completedCommands: commands
      .filter((command) => command.state === 'already-completed')
      .map((command) => ({
        command: command.type,
        action: command.restartReplayAction,
        resultRef: command.resultRef
      }))
  };
  const restartRunnable = restartReplay.replayableCommands.length > 0;
  const restartBlocked = restartReplay.blockingActions.some((entry) => (
    !entry.blockedBy.every((reason) => reason.startsWith('active-command-lease:'))
  ));
  const overallRestartState = restartBlocked
    ? 'blocked'
    : restartReplay.blockingActions.length
      ? 'waiting'
      : restartRunnable
        ? persistedState.status === 'new'
          ? 'new'
          : 'resumable'
        : 'settled';
  const blockedCommandRecords = commands.filter((command) => command.state === 'blocked');
  const leaseHeldCommandRecords = commands.filter((command) => command.state === 'lease-held');
  const replayableCommandRecords = commands.filter((command) => ['ready', 'retryable'].includes(command.state));
  const completedCommandRecords = commands.filter((command) => command.state === 'already-completed');
  const checkpointDocument = {
    kind: 'hosted-kernel.package-verifier.restart-checkpoint',
    version: 1,
    generatedAt: now,
    checkpointKey: persistedState.checkpointKey,
    checkpointRevision: persistedState.commandLedger.nextRevision,
    previousRevision: persistedState.checkpointRevision,
    write: {
      mode: persistedState.persist.writeMode,
      compareRevision: persistedState.checkpointRevision,
      idempotencyScope: `${surfaceId}:${requestState.workflowId}`,
      skipWhenReplay: persistedState.status === 'idempotent-replay',
      leaseSensitive: persistedState.persist.checkpointShape.leaseSensitive,
      conflictPolicy: persistedState.restartSemantics.canHydrateCheckpoint
        ? 'compare-and-set'
        : 'manual-reconcile-before-write'
    },
    identity: {
      workflowId: requestState.workflowId,
      requestId: requestState.requestId || null,
      packageRef,
      tenantId: accessContext.tenantId,
      workspaceId: accessContext.workspaceId,
      auditScopeRef: accessContext.auditScopeRef
    },
    restart: {
      status: persistedState.status,
      state: overallRestartState,
      resumeMode: persistedState.restartSemantics.resumeMode,
      restartSafe: persistedState.restartSafe,
      requestReplay: persistedState.requestReplay,
      canHydrateCheckpoint: persistedState.restartSemantics.canHydrateCheckpoint,
      canReplayRequest: persistedState.restartSemantics.canReplayRequest,
      recoveryIssues: persistedState.recoveryIssues,
      blockedBy: [
        ...blockedCommandRecords.flatMap((command) => command.blockedBy.map((reason) => `${command.type}:${reason}`)),
        ...leaseHeldCommandRecords.map((command) => `${command.type}:lease-held`)
      ]
    },
    commandLedger: {
      completedCommandIds: completedCommandRecords.map((command) => command.id),
      failedCommandIds: failureRecovery
        .filter((record) => ['manual-repair', 'needs-triage', 'blocked-by-lifecycle'].includes(record.state))
        .map((record) => record.commandId),
      leasedCommandIds: leaseHeldCommandRecords.map((command) => command.id),
      readyCommandIds: replayableCommandRecords.map((command) => command.id),
      commandAttempts: commands.map((command) => ({
        id: command.id,
        type: command.type,
        state: command.state === 'already-completed'
          ? 'completed'
          : command.state === 'lease-held'
            ? 'leased'
            : command.state === 'retryable'
              ? 'failed'
              : command.state,
        replayDecision: command.replayDecision,
        idempotencyKey: command.idempotencyKey,
        attempt: command.attempt,
        lease: command.lease,
        resultRef: command.resultRef || null,
        errorCode: command.recoveryState || null,
        blockedBy: command.blockedBy,
        updatedAt: now
      }))
    },
    recovery: {
      queue: failureRecovery.map((record) => ({
        id: record.id,
        commandId: record.commandId,
        commandType: record.commandType,
        state: record.state,
        retryable: record.retryable,
        degradedResumeAllowed: record.degradedResumeAllowed,
        retryAfterMs: record.retryAfterMs,
        idempotencyKey: record.idempotencyKey,
        blockedBy: record.blockedBy
      })),
      nextRunnableCommandIds: replayableCommandRecords.map((command) => command.id),
      nextRunnableIdempotencyKeys: replayableCommandRecords.map((command) => command.idempotencyKey),
      waitingForLeaseCommandIds: leaseHeldCommandRecords.map((command) => command.id),
      manualRepairCommandIds: blockedCommandRecords
        .filter((command) => command.recoveryState === 'manual-repair' || command.recoveryState === 'needs-triage')
        .map((command) => command.id)
    },
    statusIndex: {
      byState: commands.reduce((index, command) => {
        index[command.state] = [...(index[command.state] || []), command.id];
        return index;
      }, {}),
      byReplayDecision: commands.reduce((index, command) => {
        index[command.replayDecision] = [...(index[command.replayDecision] || []), command.id];
        return index;
      }, {}),
      terminal: completedCommandRecords.length === commands.length,
      runnable: replayableCommandRecords.length > 0,
      blocked: blockedCommandRecords.length > 0,
      waitingForLease: leaseHeldCommandRecords.length > 0
    }
  };

  return {
    kind: 'hosted-kernel.package-verifier.command-plan',
    version: 1,
    generatedAt: now,
    checkpointKey: persistedState.checkpointKey,
    restartStatus: persistedState.status,
    restartState: overallRestartState,
    restartReplay,
    checkpointDocument,
    lifecycleState: lifecycleSettings.status,
    schedule: lifecycleSettings.schedule,
    writeMode: persistedState.persist.writeMode,
    failureRecovery,
    recoveryQueue: failureRecovery
      .filter((record) => record.retryable || record.degradedResumeAllowed || record.state === 'manual-repair')
      .map((record) => ({
        id: record.id,
        commandId: record.commandId,
        commandType: record.commandType,
        state: record.state,
        retryAfterMs: record.retryAfterMs,
        action: record.action,
        blockedBy: record.blockedBy
      })),
    commands,
    readyCommandIds: commands
      .filter((command) => command.state === 'ready' || command.state === 'retryable')
      .map((command) => command.id),
    leaseHeldCommandIds: commands
      .filter((command) => command.state === 'lease-held')
      .map((command) => command.id),
    completedCommandIds: commands
      .filter((command) => command.state === 'already-completed')
      .map((command) => command.id)
  };
}

function buildClientWorkflowReturnEnvelope(
  requestState,
  routeClient,
  clientRuntime,
  readiness,
  proofExport,
  workflowHandoff,
  commandPlan,
  analyticsReport,
  now
) {
  const returnAction = workflowHandoff.actions.find((action) => action.id === 'return-to-client');
  const deliverProofAction = workflowHandoff.actions.find((action) => action.id === 'deliver-proof');
  const acceptedSlots = new Set(clientRuntime.slots.accepted);
  const proofReady = proofExport.canExport && proofExport.delivery.channels.some((channel) => channel.state === 'ready');
  const returnEnabled = Boolean(returnAction?.enabled);
  const emitEvents = [
    ...(acceptedSlots.has('verifier.preview') ? ['verifier.preview.rendered'] : []),
    ...(proofReady && acceptedSlots.has('verifier.proof') ? ['verifier.proof.delivered'] : []),
    ...(returnEnabled ? ['verifier.workflow.returned'] : [])
  ].filter((event) => clientRuntime.events.subscribed.includes(event));
  const proofDeliveryByChannel = proofExport.delivery.channels.reduce((channels, channel) => {
    channels[channel.channel] = {
      state: channel.state,
      exportRef: channel.state === 'ready' ? proofExport.exportRef : null,
      artifactName: channel.state === 'ready' ? proofExport.artifactName : null
    };
    return channels;
  }, {});
  const pendingCommands = commandPlan.commands
    .filter((command) => command.state !== 'already-completed')
    .map((command) => ({
      id: command.id,
      type: command.type,
      state: command.state,
      replayDecision: command.replayDecision,
      retryAfterMs: command.retryAfterMs,
      lease: command.lease,
      blockedBy: command.blockedBy
    }));
  const acknowledgementBlockedBy = clientRuntime.acknowledgements.requiredBeforeReturn
    ? clientRuntime.acknowledgements.missing.map((receipt) => `missing-client-acknowledgement:${receipt}`)
    : [];
  const blockedBy = [
    ...(returnAction?.blockedBy || []),
    ...(!clientRuntime.canHydrate ? clientRuntime.blockedBy : []),
    ...acknowledgementBlockedBy,
    ...(!proofReady && requestState.intent === 'export-proof' ? proofExport.blockedBy : []),
    ...(deliverProofAction && !deliverProofAction.enabled ? deliverProofAction.blockedBy : [])
  ];
  const state = returnEnabled
    ? 'return-ready'
    : clientRuntime.canHydrate && acknowledgementBlockedBy.length
      ? 'awaiting-client-acknowledgement'
    : clientRuntime.canHydrate
      ? 'client-state-ready'
      : 'blocked';
  const primaryAction = returnEnabled
    ? returnAction
    : proofReady && deliverProofAction?.enabled
      ? deliverProofAction
      : workflowHandoff.actions.find((action) => action.enabled) || null;

  return {
    kind: 'hosted-kernel.package-verifier.client-workflow-return',
    version: 1,
    generatedAt: now,
    state,
    workflowId: requestState.workflowId,
    requestId: requestState.requestId || null,
    correlationId: requestState.correlationId || null,
    actorRef: requestState.actorRef,
    routeId: routeClient.routeId,
    returnRouteId: requestState.returnRouteId || null,
    returnUrl: requestState.returnUrl || null,
    target: returnAction?.target || requestState.returnUrl || requestState.returnRouteId || routeClient.routeId,
    clientSessionId: requestState.clientSessionId || null,
    clientState: {
      key: clientRuntime.stateKey,
      version: clientRuntime.stateVersion,
      patchMode: clientRuntime.statePatch.op,
      slots: Object.keys(clientRuntime.statePatch.slots),
      canHydrate: clientRuntime.canHydrate,
      blockedBy: clientRuntime.blockedBy,
      returnBlockedBy: clientRuntime.returnBlockedBy,
      acknowledgementRequired: clientRuntime.acknowledgements.requiredBeforeReturn,
      acknowledgementToken: clientRuntime.acknowledgements.returnAckToken
    },
    events: {
      subscribed: clientRuntime.events.subscribed,
      emit: emitEvents,
      rejected: clientRuntime.events.rejected
    },
    acknowledgements: {
      requiredBeforeReturn: clientRuntime.acknowledgements.requiredBeforeReturn,
      token: clientRuntime.acknowledgements.returnAckToken,
      requiredSlots: clientRuntime.acknowledgements.requiredSlots,
      requiredEvents: clientRuntime.acknowledgements.requiredEvents,
      acknowledgedSlots: clientRuntime.acknowledgements.acknowledgedSlots,
      acknowledgedEvents: clientRuntime.acknowledgements.acknowledgedEvents,
      acknowledgedStateVersion: clientRuntime.acknowledgements.acknowledgedStateVersion,
      missing: clientRuntime.acknowledgements.missing,
      blockedBy: acknowledgementBlockedBy,
      receipts: clientRuntime.acknowledgements.receipts
    },
    proofDelivery: {
      proofReady,
      exportRef: proofReady ? proofExport.exportRef : null,
      format: proofExport.proofFormat,
      channels: proofDeliveryByChannel,
      blockedBy: proofReady ? [] : proofExport.blockedBy
    },
    continuation: {
      token: `${clientRuntime.stateKey}:return:${clientRuntime.stateVersion}`,
      expectedAckToken: clientRuntime.acknowledgements.returnAckToken,
      checkpointKey: commandPlan.checkpointKey,
      writeMode: commandPlan.writeMode,
      readyCommandIds: commandPlan.readyCommandIds,
      pendingCommands,
      recoveryQueue: commandPlan.recoveryQueue
    },
    handoffInstructions: {
      primaryActionId: primaryAction?.id || null,
      primaryActionLabel: primaryAction?.label || null,
      routeId: primaryAction?.routeId || routeClient.routeId,
      target: primaryAction?.target || requestState.returnUrl || requestState.returnRouteId || routeClient.routeId,
      clientStatePatchKey: clientRuntime.statePatch.key,
      clientStatePatchVersion: clientRuntime.statePatch.version,
      emitEvents,
      requireAcknowledgement: clientRuntime.acknowledgements.requiredBeforeReturn,
      acknowledgementToken: clientRuntime.acknowledgements.returnAckToken,
      blockedBy
    },
    userVisibleStatus: {
      label: returnEnabled
        ? 'Verifier workflow can return to the client'
        : acknowledgementBlockedBy.length
          ? 'Verifier workflow is waiting for client acknowledgement'
        : clientRuntime.canHydrate
          ? 'Verifier client state is ready for hydration'
          : 'Verifier workflow needs attention before return',
      readinessState: readiness.state,
      workflowState: workflowHandoff.state,
      reportState: analyticsReport.reportState,
      blockedBy
    }
  };
}

function normalizeVerifierHistory(input, requestState, packageContract, now) {
  const historySource = asObject(input.history || input.analyticsHistory || input.reporting);
  const entries = Array.isArray(historySource.snapshots)
    ? historySource.snapshots
    : Array.isArray(historySource.entries)
      ? historySource.entries
      : Array.isArray(input.history)
        ? input.history
        : [];
  const packageRef = `${packageContract.normalized.name}@${packageContract.normalized.version}`;

  return entries.slice(-12).map((entry, index) => {
    const source = asObject(entry);
    const validation = asObject(source.validation);
    const readiness = asObject(source.readiness);
    const exportState = asObject(source.export || source.proofExport);

    return {
      index,
      capturedAt: cleanString(source.capturedAt || source.generatedAt || source.at, now),
      workflowId: cleanString(source.workflowId, requestState.workflowId),
      requestId: cleanString(source.requestId, requestState.requestId || `history-${index + 1}`),
      packageRef: cleanString(source.packageRef, packageRef),
      validationStatus: cleanString(source.validationStatus || validation.status, 'unknown'),
      readinessState: cleanString(source.readinessState || readiness.state, 'unknown'),
      operationalState: cleanString(source.operationalState || source.healthState, 'unknown'),
      proofExported: Boolean(source.proofExported || exportState.exported || exportState.canExport),
      exportRef: cleanString(source.exportRef || exportState.exportRef),
      errorCount: cleanPositiveInteger(source.errorCount || validation.errors, 0),
      warningCount: cleanPositiveInteger(source.warningCount || validation.warnings, 0),
      readyCommandCount: cleanPositiveInteger(source.readyCommandCount, 0),
      completedCommandCount: cleanPositiveInteger(source.completedCommandCount, 0),
      score: clampNumber(source.score || readiness.score, 0, 100, 0)
    };
  });
}

function normalizeAnalyticsEventHistory(input, requestState, packageContract, now) {
  const analytics = asObject(input.analytics || input.metrics);
  const history = asObject(input.history || input.analyticsHistory || input.reporting);
  const eventInputs = Array.isArray(analytics.events)
    ? analytics.events
    : Array.isArray(history.events)
      ? history.events
      : Array.isArray(input.analyticsEvents)
        ? input.analyticsEvents
        : [];
  const packageRef = `${packageContract.normalized.name}@${packageContract.normalized.version}`;

  return eventInputs.slice(-40).map((event, index) => {
    const source = asObject(event);
    const command = inferLifecycleCommandType(source.command || source.commandType || source.type);
    const phase = cleanString(
      source.phase,
      command
        ? {
            'verify-package': 'verify',
            'accept-preview': 'accept',
            'export-proof': 'proof',
            'return-to-client': 'handoff'
          }[command]
        : 'workflow'
    );
    const state = cleanString(source.state || source.status || source.outcome, 'observed');
    const startedAt = cleanString(source.startedAt || source.beginAt || source.at || source.capturedAt, now);
    const completedAt = cleanString(source.completedAt || source.finishedAt || source.endAt);
    const suppliedDuration = cleanPositiveInteger(source.durationMs || source.elapsedMs, 0);
    const computedDuration = completedAt && Date.parse(completedAt) >= Date.parse(startedAt)
      ? Date.parse(completedAt) - Date.parse(startedAt)
      : 0;
    const durationMs = suppliedDuration || computedDuration;
    const proofChannel = cleanString(source.proofChannel || source.deliveryChannel || source.channel);

    return {
      id: cleanString(source.id || source.eventId, `${surfaceId}:analytics-event:${requestState.workflowId}:${index + 1}`),
      at: cleanString(source.at || source.capturedAt || completedAt || startedAt, now),
      workflowId: cleanString(source.workflowId, requestState.workflowId),
      requestId: cleanString(source.requestId, requestState.requestId || null),
      packageRef: cleanString(source.packageRef, packageRef),
      type: cleanString(source.type || source.eventType, command || 'workflow-observation'),
      phase,
      command,
      state,
      actorRef: cleanString(source.actorRef, requestState.actorRef),
      durationMs,
      proofChannel: proofChannel || null,
      exportRef: cleanString(source.exportRef),
      blockedBy: cleanStringList(source.blockedBy || source.blockers || source.reasons),
      evidenceRef: cleanString(source.evidenceRef, `${surfaceId}:analytics-event:${requestState.workflowId}:${phase}:${index + 1}`)
    };
  });
}

function incrementCounter(index, key, amount = 1) {
  const normalizedKey = cleanString(key, 'unknown');
  index[normalizedKey] = (index[normalizedKey] || 0) + amount;
  return index;
}

function buildAnalyticsReportingContract(
  input,
  packageContract,
  requestState,
  validationSummary,
  readiness,
  proofExport,
  workflowHandoff,
  commandPlan,
  accessContext,
  workspaceHandoffBoundary,
  operationalHealth,
  persistedState,
  now
) {
  const suppliedAnalytics = asObject(input.analytics || input.metrics);
  const historySnapshots = normalizeVerifierHistory(input, requestState, packageContract, now);
  const observedEvents = normalizeAnalyticsEventHistory(input, requestState, packageContract, now);
  const currentSnapshot = {
    index: historySnapshots.length,
    capturedAt: now,
    workflowId: requestState.workflowId,
    requestId: requestState.requestId || null,
    packageRef: proofExport.packageRef,
    validationStatus: validationSummary.status,
    readinessState: readiness.state,
    operationalState: operationalHealth.state,
    proofExported: proofExport.canExport && proofExport.delivery.channels.some((channel) => channel.state === 'ready'),
    exportRef: proofExport.canExport ? proofExport.exportRef : null,
    errorCount: validationSummary.errors,
    warningCount: validationSummary.warnings,
    readyCommandCount: commandPlan.readyCommandIds.length,
    completedCommandCount: commandPlan.completedCommandIds.length,
    score: readiness.score
  };
  const snapshots = [...historySnapshots, currentSnapshot];
  const synthesizedEvents = [
    ...commandPlan.commands.map((command) => ({
      id: `${command.id}:analytics`,
      at: command.createdAt,
      workflowId: command.workflowId,
      requestId: command.requestId,
      packageRef: command.packageRef,
      type: command.type,
      phase: {
        'verify-package': 'verify',
        'accept-preview': 'accept',
        'export-proof': 'proof',
        'return-to-client': 'handoff'
      }[command.type] || 'workflow',
      command: command.type,
      state: command.state,
      actorRef: requestState.actorRef,
      durationMs: 0,
      proofChannel: null,
      exportRef: command.type === 'export-proof' ? proofExport.exportRef : '',
      blockedBy: command.blockedBy,
      evidenceRef: command.resultRef || command.id
    })),
    ...proofExport.delivery.channels.map((channel) => ({
      id: `${proofExport.exportRef}:delivery:${channel.channel}`,
      at: now,
      workflowId: requestState.workflowId,
      requestId: requestState.requestId || null,
      packageRef: proofExport.packageRef,
      type: 'proof-delivery',
      phase: 'proof',
      command: 'export-proof',
      state: channel.state,
      actorRef: requestState.actorRef,
      durationMs: 0,
      proofChannel: channel.channel,
      exportRef: channel.state === 'ready' ? proofExport.exportRef : '',
      blockedBy: channel.state === 'ready' ? [] : proofExport.blockedBy,
      evidenceRef: `${surfaceId}:proof-delivery:${requestState.workflowId}:${channel.channel}`
    })),
    {
      id: `${workflowHandoff.workflowId}:handoff:${workflowHandoff.state}`,
      at: workflowHandoff.generatedAt,
      workflowId: workflowHandoff.workflowId,
      requestId: requestState.requestId || null,
      packageRef: proofExport.packageRef,
      type: 'workflow-handoff',
      phase: 'handoff',
      command: 'return-to-client',
      state: workflowHandoff.state,
      actorRef: requestState.actorRef,
      durationMs: 0,
      proofChannel: null,
      exportRef: proofExport.canExport ? proofExport.exportRef : '',
      blockedBy: workflowHandoff.actions.flatMap((action) => action.enabled ? [] : action.blockedBy),
      evidenceRef: workflowHandoff.handoffBoundaryAuditEnvelopeId
    }
  ];
  const eventLedger = [...observedEvents, ...synthesizedEvents];
  const previousSnapshot = snapshots.length > 1 ? snapshots[snapshots.length - 2] : null;
  const validationCounts = validationSummary.items.reduce((counts, item) => {
    counts[item.status] = (counts[item.status] || 0) + 1;
    return counts;
  }, { pass: 0, warn: 0, fail: 0, skip: 0 });
  const commandCounts = commandPlan.commands.reduce((counts, command) => {
    counts[command.state] = (counts[command.state] || 0) + 1;
    return counts;
  }, { ready: 0, blocked: 0, retryable: 0, 'already-completed': 0, 'lease-held': 0 });
  const recoveryCounts = commandPlan.failureRecovery.reduce((counts, recovery) => {
    counts[recovery.state] = (counts[recovery.state] || 0) + 1;
    return counts;
  }, {
    'retry-ready': 0,
    'degraded-resume': 0,
    'manual-repair': 0,
    'blocked-by-lifecycle': 0,
    'needs-triage': 0
  });
  const deliveryCounts = proofExport.delivery.channels.reduce((counts, channel) => {
    counts[channel.state] = (counts[channel.state] || 0) + 1;
    return counts;
  }, { ready: 0, blocked: 0 });
  const eventCounts = eventLedger.reduce((counts, event) => {
    incrementCounter(counts.byType, event.type);
    incrementCounter(counts.byPhase, event.phase);
    incrementCounter(counts.byState, event.state);
    if (event.command) {
      incrementCounter(counts.byCommand, event.command);
    }
    if (event.proofChannel) {
      incrementCounter(counts.byProofChannel, event.proofChannel);
    }
    counts.blockedEvents += event.blockedBy.length ? 1 : 0;
    counts.totalDurationMs += event.durationMs;
    return counts;
  }, {
    byType: {},
    byPhase: {},
    byState: {},
    byCommand: {},
    byProofChannel: {},
    blockedEvents: 0,
    totalDurationMs: 0
  });
  const exportedSnapshots = snapshots.filter((snapshot) => snapshot.proofExported).length;
  const failedSnapshots = snapshots.filter((snapshot) => snapshot.validationStatus === 'invalid' || snapshot.operationalState === 'failed').length;
  const reviewSnapshots = snapshots.filter((snapshot) => snapshot.validationStatus === 'review' || snapshot.readinessState === 'review').length;
  const averageReadinessScore = snapshots.length
    ? Math.round(snapshots.reduce((sum, snapshot) => sum + snapshot.score, 0) / snapshots.length)
    : readiness.score;
  const timeline = [
    {
      id: 'request-normalized',
      at: now,
      state: requestState.intentAccepted ? 'complete' : 'attention',
      label: `Request ${requestState.intent} normalized`,
      ref: requestState.requestId || requestState.workflowId
    },
    {
      id: 'validation-scored',
      at: now,
      state: validationSummary.status,
      label: `Validation ${validationSummary.status}`,
      ref: `${surfaceId}:validation:${proofExport.packageRef}`
    },
    {
      id: 'commands-planned',
      at: now,
      state: commandPlan.readyCommandIds.length ? 'ready' : 'blocked',
      label: `${commandPlan.readyCommandIds.length} verifier commands ready`,
      ref: commandPlan.checkpointKey
    },
    {
      id: 'proof-export',
      at: now,
      state: proofExport.canExport ? 'ready' : 'blocked',
      label: proofExport.canExport ? 'Proof export ready' : 'Proof export blocked',
      ref: proofExport.exportRef
    },
    {
      id: 'client-handoff',
      at: now,
      state: workflowHandoff.state,
      label: `Workflow handoff ${workflowHandoff.state}`,
      ref: workflowHandoff.auditScopeRef
    }
  ];

  return {
    kind: 'hosted-kernel.package-verifier.analytics-report',
    version: 1,
    generatedAt: now,
    reportRef: cleanString(suppliedAnalytics.reportRef, `${surfaceId}:report:${requestState.workflowId}`),
    packageRef: proofExport.packageRef,
    workflowId: requestState.workflowId,
    tenantId: accessContext.tenantId,
    workspaceId: accessContext.workspaceId,
    counters: {
      validation: validationCounts,
      commands: commandCounts,
      delivery: deliveryCounts,
      history: {
        snapshots: snapshots.length,
        exportedSnapshots,
        failedSnapshots,
        reviewSnapshots
      },
      access: {
        boundaryViolations: accessContext.violations.length,
        blockingViolations: accessContext.blockingViolations.length,
        advisoryViolations: accessContext.advisoryViolations.length
      },
      handoffBoundary: {
        decision: workspaceHandoffBoundary.decision,
        blockedViolations: workspaceHandoffBoundary.boundaryViolations.length,
        advisoryViolations: workspaceHandoffBoundary.advisoryViolations.length,
        rejectedDeliveryChannels: workspaceHandoffBoundary.rejectedDeliveryChannels.length,
        exportRequested: workspaceHandoffBoundary.exportRequested,
        handoffRequested: workspaceHandoffBoundary.handoffRequested
      },
      operational: {
        actionableErrors: operationalHealth.actionableErrors.length,
        retryableFailures: operationalHealth.retryableFailures.length,
        degradedSignals: operationalHealth.degradedSignals.length,
        recoveryQueue: commandPlan.recoveryQueue.length,
        failedCommandRecoveries: commandPlan.failureRecovery.length,
        leaseHeldCommands: commandPlan.leaseHeldCommandIds.length
      },
      events: {
        total: eventLedger.length,
        observed: observedEvents.length,
        synthesized: synthesizedEvents.length,
        blocked: eventCounts.blockedEvents,
        totalDurationMs: eventCounts.totalDurationMs,
        byType: eventCounts.byType,
        byPhase: eventCounts.byPhase,
        byState: eventCounts.byState,
        byCommand: eventCounts.byCommand,
        byProofChannel: eventCounts.byProofChannel
      }
    },
    snapshots,
    trend: {
      previousScore: previousSnapshot?.score ?? null,
      currentScore: currentSnapshot.score,
      scoreDelta: previousSnapshot ? currentSnapshot.score - previousSnapshot.score : 0,
      averageReadinessScore,
      exportReadinessChanged: previousSnapshot ? previousSnapshot.proofExported !== currentSnapshot.proofExported : false
    },
    exportSummary: {
      exportReady: proofExport.canExport,
      exportRef: proofExport.canExport ? proofExport.exportRef : null,
      artifactName: proofExport.artifactName,
      requestedChannels: proofExport.delivery.requestedChannels,
      readyChannels: proofExport.delivery.channels.filter((channel) => channel.state === 'ready').map((channel) => channel.channel),
      blockedChannels: proofExport.delivery.channels.filter((channel) => channel.state !== 'ready').map((channel) => channel.channel),
      blockedBy: proofExport.blockedBy,
      checkpointKey: persistedState.checkpointKey,
      recoveryQueue: commandPlan.recoveryQueue.map((record) => record.id),
      rows: eventLedger
        .filter((event) => event.type === 'proof-delivery' || event.command === 'export-proof')
        .map((event) => ({
          id: event.id,
          at: event.at,
          state: event.state,
          channel: event.proofChannel,
          exportRef: event.exportRef || null,
          durationMs: event.durationMs,
          blockedBy: event.blockedBy,
          evidenceRef: event.evidenceRef
        }))
    },
    recovery: {
      counts: recoveryCounts,
      queue: commandPlan.recoveryQueue,
      leaseHeldCommandIds: commandPlan.leaseHeldCommandIds,
      manualActions: commandPlan.failureRecovery
        .filter((record) => record.state === 'manual-repair' || record.state === 'needs-triage')
        .map((record) => ({
          commandId: record.commandId,
          commandType: record.commandType,
          action: record.action,
          blockedBy: record.blockedBy
        }))
    },
    eventLedger: eventLedger.map((event) => ({
      id: event.id,
      at: event.at,
      type: event.type,
      phase: event.phase,
      command: event.command,
      state: event.state,
      durationMs: event.durationMs,
      proofChannel: event.proofChannel,
      exportRef: event.exportRef || null,
      blockedBy: event.blockedBy,
      evidenceRef: event.evidenceRef
    })),
    reportingState: {
      lastEventAt: eventLedger.reduce((latest, event) => (
        Date.parse(event.at) > Date.parse(latest) ? event.at : latest
      ), snapshots[0]?.capturedAt || now),
      timelineRows: timeline.length,
      exportRows: eventLedger.filter((event) => event.type === 'proof-delivery' || event.command === 'export-proof').length,
      historyWindow: {
        retainedSnapshots: snapshots.length,
        retainedEvents: eventLedger.length,
        maxSnapshots: 13,
        maxObservedEvents: 40
      }
    },
    timeline,
    reportState: proofExport.canExport
      ? 'export-ready'
      : validationSummary.status === 'invalid' || operationalHealth.state === 'failed'
        ? 'blocked'
        : 'collecting-evidence'
  };
}

function buildAuditTrail(input, packageContract, capabilityContract, syncMetadata, handoffState, requestState, clientRuntime, accessContext, workspaceHandoffBoundary, operationalHealth, lifecycleSettings, providerContract, providerServiceContract, now) {
  const evidence = Array.isArray(input.evidence) ? input.evidence : [];
  const derivedEvidence = [
    `package:${packageContract.normalized.name}@${packageContract.normalized.version}`,
    `provider:${packageContract.normalized.provider}`,
    `sync:${syncMetadata.providerRevision}`,
    `handoff:${handoffState.state}`,
    `workflow:${requestState.workflowId}`,
    `intent:${requestState.intent}`,
    `proof-format:${requestState.proofFormat}`,
    `client-state:${clientRuntime.stateKey}:v${clientRuntime.stateVersion}`,
    `client-hydration:${clientRuntime.canHydrate ? 'ready' : 'blocked'}`,
    `client-return:${clientRuntime.canReturnToClient ? 'ready' : 'blocked'}`,
    ...clientRuntime.slots.accepted.map((slot) => `client-state-slot:${slot}`),
    ...clientRuntime.blockedBy.map((reason) => `client-runtime-blocker:${reason}`),
    `tenant:${accessContext.tenantId}`,
    `workspace:${accessContext.workspaceId}`,
    `boundary:${accessContext.decision}`,
    `workspace-handoff-boundary:${workspaceHandoffBoundary.decision}`,
    `workspace-handoff-audit-envelope:${workspaceHandoffBoundary.auditEnvelope.id}`,
    `workspace-handoff-target:${workspaceHandoffBoundary.target}:${workspaceHandoffBoundary.targetAllowed ? 'allowed' : 'blocked'}`,
    ...workspaceHandoffBoundary.rejectedDeliveryChannels.map((channel) => `workspace-handoff-channel-blocked:${channel}`),
    ...workspaceHandoffBoundary.boundaryViolations.map((violation) => `workspace-handoff-boundary-violation:${violation}`),
    ...workspaceHandoffBoundary.advisoryViolations.map((violation) => `workspace-handoff-boundary-advisory:${violation}`),
    `provider-contract:${providerContract.decision}`,
    `provider-contract-ref:${providerContract.contractRef}`,
    `provider-service:${providerServiceContract.state}`,
    `provider-service-ref:${providerServiceContract.serviceRef}`,
    `provider-service-sync:${providerServiceContract.syncBinding.ready ? 'ready' : 'blocked'}`,
    `provider-service-handoff:${providerServiceContract.externalHandoffBinding.ready ? 'ready' : 'blocked'}`,
    ...providerServiceContract.operations
      .filter((operation) => operation.required || operation.supplied)
      .map((operation) => `provider-operation:${operation.id}:${operation.negotiated ? 'negotiated' : 'blocked'}`),
    ...providerServiceContract.blockedBy.map((reason) => `provider-service-blocker:${reason}`),
    ...providerContract.clauses.map((clause) => `contract-clause:${clause.id}:${clause.satisfied ? 'satisfied' : 'unsatisfied'}`),
    `permission:${accessContext.requiredPermission}:${accessContext.permissionAllowed ? 'granted' : 'missing'}`,
    `permission-source:${accessContext.requiredPermission}:${accessContext.grantResolution.requiredPermissionSource}`,
    `scoped-grant-required:${accessContext.scopedGrantRequired ? 'yes' : 'no'}`,
    `scoped-grant-satisfied:${accessContext.scopedGrantSatisfied ? 'yes' : 'no'}`,
    ...accessContext.grantResolution.applied.map((grant) => `access-grant-applied:${grant.id}:${grant.scopeLabel}`),
    ...accessContext.grantResolution.ignored.map((grant) => `access-grant-ignored:${grant.id}:${grant.scopeLabel}`),
    ...accessContext.actor.deniedPermissions.map((permission) => `permission-denied:${permission}`),
    `operational-health:${operationalHealth.state}`,
    `lifecycle:${lifecycleSettings.status}`,
    `schedule:${lifecycleSettings.schedule.nextAction}`,
    `schedule-due:${lifecycleSettings.schedule.due ? 'yes' : 'no'}`,
    `schedule-effective-next-run:${lifecycleSettings.schedule.effectiveNextRunAt || 'none'}`,
    `schedule-change-pending:${lifecycleSettings.schedule.changePending ? 'yes' : 'no'}`,
    ...(lifecycleSettings.schedule.nextCommand
      ? [`schedule-next-command:${lifecycleSettings.schedule.nextCommand.command}:${lifecycleSettings.schedule.nextCommand.auditReason}`]
      : ['schedule-next-command:none']),
    ...lifecycleSettings.schedule.validation.blockingReasons.map((reason) => `schedule-validation:${reason}`),
    ...lifecycleSettings.commandSettings.map((setting) => `lifecycle-command:${setting.command}:${setting.enabled ? 'enabled' : 'blocked'}`),
    ...lifecycleSettings.commandSettings.map((setting) => `lifecycle-command-mode:${setting.command}:${setting.requestedMode}`),
    ...lifecycleSettings.commandSettings
      .filter((setting) => setting.autoRunnable)
      .map((setting) => `lifecycle-command-auto-runnable:${setting.command}`),
    ...lifecycleSettings.commandSettings
      .filter((setting) => setting.waitingForSchedule)
      .map((setting) => `lifecycle-command-waiting-schedule:${setting.command}`),
    ...lifecycleSettings.blockingReasons.map((reason) => `lifecycle-blocker:${reason}`),
    ...operationalHealth.actionableErrors.map((error) => `actionable-error:${error.code}:${error.retryable ? 'retryable' : 'manual'}`),
    ...cleanStringList(input.persistedState?.failedCommandIds || input.state?.failedCommandIds || input.checkpoint?.failedCommandIds)
      .map((commandId) => `failed-command-ledger:${commandId}`)
  ];

  return {
    generatedAt: now,
    verifier: surfaceId,
    proofType: 'hosted-kernel-package-provider-contract',
    status: packageContract.missing.length
      || capabilityContract.rejected.length
      || providerContract.decision === 'blocked'
      || accessContext.decision === 'deny'
      || workspaceHandoffBoundary.decision === 'deny'
      || operationalHealth.state === 'failed'
      || lifecycleSettings.status === 'blocked'
      ? 'attention-required'
      : 'verified',
    checks: {
      packageFieldsPresent: packageContract.missing.length === 0,
      capabilityContractSatisfied: capabilityContract.rejected.length === 0,
      syncMetadataPresent: Boolean(syncMetadata.providerRevision),
      handoffReady: handoffState.state === 'ready',
      requestIntentSupported: requestState.intentAccepted,
      proofFormatSupported: requestState.proofFormatAccepted,
      deliveryChannelsSupported: requestState.rejectedDeliveryChannels.length === 0,
      providerContractSatisfied: providerContract.decision !== 'blocked',
      providerServiceContractSatisfied: providerServiceContract.state !== 'blocked',
      tenantBoundarySatisfied: accessContext.decision !== 'deny',
      workspaceHandoffBoundarySatisfied: workspaceHandoffBoundary.decision !== 'deny',
      operationalHealthSatisfied: operationalHealth.state !== 'failed',
      lifecycleControlsSatisfied: lifecycleSettings.status !== 'blocked',
      scheduleControlsSatisfied: lifecycleSettings.schedule.cadenceAccepted
    },
    evidence: [...evidence, ...derivedEvidence]
  };
}

export function describeVerifierPackageSurface(input = {}) {
  const now = input.now || new Date().toISOString();
  const packageContract = normalizePackage(input.package);
  const capabilities = negotiateCapabilities(input.capabilities);
  const syncMetadata = buildSyncMetadata(input, now);
  const handoffState = buildHandoffState(input, packageContract, capabilities, now);
  const routeClient = normalizeRouteClient(input);
  const requestState = normalizeRequestState(input, routeClient);
  const clientRuntime = normalizeClientRuntimeState(input, packageContract, requestState, routeClient, handoffState, now);
  const lifecycleSettings = normalizeLifecycleSettings(input, requestState, now);
  const accessContext = normalizeAccessContext(input, packageContract, requestState);
  const providerContract = normalizeProviderContract(input, packageContract, capabilities, syncMetadata, accessContext, requestState, now);
  const providerServiceContract = normalizeProviderServiceContract(input, packageContract, capabilities, syncMetadata, handoffState, requestState, providerContract, now);
  const workspaceHandoffBoundary = normalizeWorkspaceHandoffBoundary(input, accessContext, requestState, handoffState, providerServiceContract, clientRuntime, now);
  const persistedState = normalizePersistedVerifierState(input, packageContract, requestState, syncMetadata, now);
  const operationalHealth = normalizeOperationalHealth(input, syncMetadata, handoffState, persistedState, requestState, now);
  const audit = buildAuditTrail(input, packageContract, capabilities, syncMetadata, handoffState, requestState, clientRuntime, accessContext, workspaceHandoffBoundary, operationalHealth, lifecycleSettings, providerContract, providerServiceContract, now);
  const validationSummary = buildValidationSummary(packageContract, capabilities, syncMetadata, handoffState, accessContext, workspaceHandoffBoundary, operationalHealth, lifecycleSettings, providerContract, providerServiceContract);
  const preview = buildPreviewContract(packageContract, capabilities, syncMetadata, handoffState, accessContext, routeClient, providerContract, providerServiceContract, now);
  const acceptance = buildAcceptanceContract(audit, validationSummary, handoffState, routeClient, requestState, now);
  const readiness = buildReadinessContract(validationSummary, packageContract, capabilities, syncMetadata, handoffState, accessContext, workspaceHandoffBoundary, operationalHealth, lifecycleSettings, providerContract, providerServiceContract);
  const proofExport = buildProofExportContract(audit, packageContract, syncMetadata, handoffState, requestState, readiness, accessContext, workspaceHandoffBoundary, providerContract, providerServiceContract, clientRuntime, now);
  const workflowHandoff = buildWorkflowHandoffContract(
    validationSummary,
    readiness,
    handoffState,
    routeClient,
    requestState,
    proofExport,
    accessContext,
    workspaceHandoffBoundary,
    lifecycleSettings,
    providerServiceContract,
    clientRuntime,
    now
  );
  const nextSteps = buildNextStepContracts(validationSummary, readiness, handoffState, routeClient, workflowHandoff, lifecycleSettings);
  const commandPlan = buildIdempotentCommandContracts(
    packageContract,
    requestState,
    readiness,
    proofExport,
    workflowHandoff,
    persistedState,
    accessContext,
    operationalHealth,
    lifecycleSettings,
    now
  );
  const analyticsReport = buildAnalyticsReportingContract(
    input,
    packageContract,
    requestState,
    validationSummary,
    readiness,
    proofExport,
    workflowHandoff,
    commandPlan,
    accessContext,
    workspaceHandoffBoundary,
    operationalHealth,
    persistedState,
    now
  );
  const clientWorkflowReturn = buildClientWorkflowReturnEnvelope(
    requestState,
    routeClient,
    clientRuntime,
    readiness,
    proofExport,
    workflowHandoff,
    commandPlan,
    analyticsReport,
    now
  );

  return {
    ok: operationalHealth.state !== 'failed'
      && accessContext.decision !== 'deny'
      && workspaceHandoffBoundary.decision !== 'deny'
      && (acceptance.acceptable || handoffState.state === 'local-only'),
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: {
      kind: 'hosted-kernel.provider-service-contract',
      version: 1,
      package: packageContract.normalized,
      missingRequiredFields: packageContract.missing,
      capabilities,
      sync: syncMetadata,
      request: requestState,
      clientRuntime,
      access: accessContext,
      workspaceHandoffBoundary,
      providerContract,
      providerServiceContract,
      lifecycleSettings,
      operationalHealth,
      persistence: persistedState,
      commandRecovery: {
        checkpointKey: commandPlan.checkpointKey,
        checkpointDocument: commandPlan.checkpointDocument,
        restartState: commandPlan.restartState,
        restartReplay: commandPlan.restartReplay,
        recoveryQueue: commandPlan.recoveryQueue,
        failureRecovery: commandPlan.failureRecovery
      },
      analytics: analyticsReport,
      clientWorkflowReturn,
      externalHandoff: handoffState
    },
    preview,
    acceptance,
    readiness,
    proofExport,
    clientRuntime,
    providerContract,
    providerServiceContract,
    workspaceHandoffBoundary,
    workflowHandoff,
    operationalHealth,
    lifecycleSettings,
      persistedState,
      persistedCheckpoint: commandPlan.checkpointDocument,
      commandPlan,
    analyticsReport,
    clientWorkflowReturn,
    validationSummary,
    nextSteps,
    audit,
    evidence: [
      ...audit.evidence,
      `persistence:${persistedState.status}`,
      `operational-health:${operationalHealth.state}`,
      `lifecycle:${lifecycleSettings.status}`,
      `schedule:${lifecycleSettings.schedule.nextAction}`,
      `schedule-due:${lifecycleSettings.schedule.due ? 'yes' : 'no'}`,
      `schedule-effective-next-run:${lifecycleSettings.schedule.effectiveNextRunAt || 'none'}`,
      ...(lifecycleSettings.schedule.nextCommand
        ? [`schedule-next-command:${lifecycleSettings.schedule.nextCommand.command}`]
        : ['schedule-next-command:none']),
      `client-state:${clientRuntime.stateKey}:v${clientRuntime.stateVersion}`,
      `client-hydration:${clientRuntime.canHydrate ? 'ready' : 'blocked'}`,
      `client-return:${clientRuntime.canReturnToClient ? 'ready' : 'blocked'}`,
      `client-workflow-return:${clientWorkflowReturn.state}`,
      `client-workflow-return-target:${clientWorkflowReturn.target}`,
      `client-workflow-return-events:${clientWorkflowReturn.events.emit.length}`,
      `client-workflow-continuation:${clientWorkflowReturn.continuation.checkpointKey}`,
      ...clientRuntime.blockedBy.map((reason) => `client-runtime-blocker:${reason}`),
      ...operationalHealth.actionableErrors.map((error) => `actionable-error:${error.code}`),
      ...lifecycleSettings.blockingReasons.map((reason) => `lifecycle-blocker:${reason}`),
      `checkpoint:${persistedState.checkpointKey}`,
      `checkpoint-document:${commandPlan.checkpointDocument.checkpointKey}:r${commandPlan.checkpointDocument.checkpointRevision}`,
      `checkpoint-write:${commandPlan.checkpointDocument.write.mode}:${commandPlan.checkpointDocument.write.conflictPolicy}`,
      `checkpoint-terminal:${commandPlan.checkpointDocument.statusIndex.terminal ? 'yes' : 'no'}`,
      `checkpoint-runnable:${commandPlan.checkpointDocument.statusIndex.runnable ? 'yes' : 'no'}`,
      `checkpoint-waiting-lease:${commandPlan.checkpointDocument.statusIndex.waitingForLease ? 'yes' : 'no'}`,
      `audit-scope:${accessContext.auditScopeRef}`,
      `workspace-handoff-boundary:${workspaceHandoffBoundary.decision}`,
      `workspace-handoff-audit-envelope:${workspaceHandoffBoundary.auditEnvelope.id}`,
      ...workspaceHandoffBoundary.boundaryViolations.map((violation) => `workspace-handoff-boundary-violation:${violation}`),
      `provider-contract:${providerContract.decision}`,
      `provider-contract-ref:${providerContract.contractRef}`,
      `provider-service:${providerServiceContract.state}`,
      `provider-service-ref:${providerServiceContract.serviceRef}`,
      ...providerServiceContract.missingOperations.map((operation) => `provider-service-missing:${operation}`),
      ...lifecycleSettings.schedule.validation.blockingReasons.map((reason) => `schedule-validation:${reason}`),
      ...lifecycleSettings.commandSettings.map((setting) => `lifecycle-command-mode:${setting.command}:${setting.requestedMode}`),
      ...lifecycleSettings.commandSettings
        .filter((setting) => setting.autoRunnable)
        .map((setting) => `lifecycle-command-auto-runnable:${setting.command}`),
      `analytics-report:${analyticsReport.reportState}`,
      `analytics-snapshots:${analyticsReport.counters.history.snapshots}`,
      `analytics-score:${analyticsReport.trend.currentScore}`,
      `analytics-events:${analyticsReport.counters.events.total}`,
      `analytics-events-blocked:${analyticsReport.counters.events.blocked}`,
      `analytics-export-rows:${analyticsReport.reportingState.exportRows}`,
      `analytics-last-event:${analyticsReport.reportingState.lastEventAt}`,
      ...commandPlan.recoveryQueue.map((record) => `recovery-queue:${record.commandType}:${record.state}`),
      ...commandPlan.failureRecovery.map((record) => `failed-command-recovery:${record.commandType}:${record.state}`),
      ...commandPlan.leaseHeldCommandIds.map((commandId) => `lease-held-command:${commandId}`),
      ...persistedState.commandLedger.commandAttempts.map((attempt) => `persisted-command-attempt:${attempt.command}:${attempt.replayDecision}`),
      `restart-resume-mode:${persistedState.restartSemantics.resumeMode}`,
      `restart-state:${commandPlan.restartState}`,
      ...commandPlan.restartReplay.replayableCommands.map((command) => `restart-replayable:${command.command}:${command.action}`),
      ...commandPlan.restartReplay.blockingActions.map((command) => `restart-blocked:${command.command}:${command.action}`),
      ...commandPlan.restartReplay.completedCommands.map((command) => `restart-completed:${command.command}:${command.action}`),
      ...commandPlan.commands.map((command) => `command:${command.type}:${command.state}`)
    ]
  };
}

export default describeVerifierPackageSurface;
