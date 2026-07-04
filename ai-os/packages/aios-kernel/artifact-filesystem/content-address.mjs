import { createHash } from 'node:crypto';

export const surfaceId = "aios_artifact-filesystem_content-address_032";
export const surfaceGroup = "artifact-filesystem";
export const surfaceName = "content-address";

const DEFAULT_ALGORITHM = 'sha256';
const CONTENT_ADDRESS_PATTERN = /^[a-z0-9][a-z0-9+.-]*:[A-Za-z0-9_-]{16,}$/;
const DEFAULT_PREVIEW_ROUTE = '/artifact-filesystem/content-address/preview';
const DEFAULT_ACCEPTANCE_ROUTE = '/artifact-filesystem/content-address/acceptance';
const DEFAULT_AUDIT_ROUTE = '/artifact-filesystem/content-address/audit-proof';
const STATE_CONTRACT_VERSION = 'content-address.persisted-state.v1';
const COMMAND_CONTRACT_VERSION = 'content-address.command.v1';
const COMMAND_TARGET_SCOPE_CONTRACT_VERSION = 'content-address.command-target-scope.v1';
const BOUNDARY_CONTRACT_VERSION = 'content-address.boundary.v1';
const HEALTH_CONTRACT_VERSION = 'content-address.operational-health.v1';
const ANALYTICS_CONTRACT_VERSION = 'content-address.analytics.v1';
const EXPORT_CONTRACT_VERSION = 'content-address.export-summary.v1';
const REPORTING_HISTORY_CONTRACT_VERSION = 'content-address.reporting-history.v1';
const LIFECYCLE_CONTRACT_VERSION = 'content-address.lifecycle-controls.v1';
const LIFECYCLE_MUTATION_CONTRACT_VERSION = 'content-address.lifecycle-settings-mutation.v1';
const PROVIDER_CONTRACT_VERSION = 'content-address.provider-contract.v1';
const PROVIDER_HANDOFF_CONTRACT_VERSION = 'content-address.provider-handoff.v1';
const WORKFLOW_HANDOFF_STATE_CONTRACT_VERSION = 'content-address.workflow-handoff-state.v1';
const VALIDATION_SUMMARY_CONTRACT_VERSION = 'content-address.validation-summary.v1';
const NEXT_STEP_CONTRACT_VERSION = 'content-address.next-step.v1';
const INTEGRITY_MANIFEST_CONTRACT_VERSION = 'content-address.integrity-manifest.v1';
const ARTIFACT_INTEGRITY_EVIDENCE_CONTRACT_VERSION = 'content-address.artifact-integrity-evidence.v1';
const ROUTE_READINESS_CONTRACT_VERSION = 'content-address.route-readiness.v1';
const BOUNDARY_AUDIT_HANDOFF_CONTRACT_VERSION = 'content-address.boundary-audit-handoff.v1';
const PREVIEW_ACCEPTANCE_CONTRACT_VERSION = 'content-address.preview-acceptance-client.v1';
const CLIENT_HANDOFF_QUEUE_CONTRACT_VERSION = 'content-address.client-handoff-queue.v1';
const CLIENT_HANDOFF_QUEUE_RECONCILIATION_CONTRACT_VERSION = 'content-address.client-handoff-queue-reconciliation.v1';
const RESTART_RESUME_CONTRACT_VERSION = 'content-address.restart-resume-checkpoint.v1';
const COMMAND_RECOVERY_CONTRACT_VERSION = 'content-address.command-recovery.v1';
const COMMAND_LOCK_RECOVERY_ACTIONS = new Set([
  'resume_or_replay_command',
  'await_matching_receipt',
  'drop_expired_lock',
  'require_operator_review',
  'observe_only'
]);
const DEFAULT_TENANT_ID = 'hosted-kernel';
const DEFAULT_WORKSPACE_ID = 'default';
const DEFAULT_PROVIDER_ID = 'hosted-kernel-artifact-store';
const REQUIRED_PROVIDER_CAPABILITIES = ['artifact.read', 'content-address.resolve', 'proof.record', 'handoff.sync'];
const DIGEST_ALGORITHM_PROFILES = {
  sha1: { digestBytes: 20, encodings: ['hex', 'base64url'] },
  sha224: { digestBytes: 28, encodings: ['hex', 'base64url'] },
  sha256: { digestBytes: 32, encodings: ['hex', 'base64url'] },
  sha384: { digestBytes: 48, encodings: ['hex', 'base64url'] },
  sha512: { digestBytes: 64, encodings: ['hex', 'base64url'] }
};
const DIGEST_HEX_PATTERN = /^[a-f0-9]{32,}$/i;
const DIGEST_BASE64URL_PATTERN = /^[A-Za-z0-9_-]{16,}$/;
const INLINE_CONTENT_ENCODINGS = new Set(['utf8', 'utf-8', 'text', 'base64', 'base64url', 'hex']);
const DEFAULT_LIFECYCLE_SETTINGS = {
  enabled: true,
  manualAcceptanceEnabled: true,
  proofRecordingEnabled: true,
  scheduledScanEnabled: false,
  scanIntervalMinutes: 60
};
const DEFAULT_RETRY_POLICY = {
  baseDelayMs: 1500,
  maxDelayMs: 30000,
  maxAttempts: 5
};
const ROLE_GRANTS = {
  owner: ['preview', 'accept', 'record_proof', 'audit'],
  maintainer: ['preview', 'accept', 'record_proof', 'audit'],
  editor: ['preview', 'accept', 'record_proof'],
  reviewer: ['preview', 'record_proof'],
  viewer: ['preview']
};
const MUTATING_ARTIFACT_ACTIONS = new Set(['accept', 'record_proof']);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeStringList(value) {
  return [...new Set(asArray(value)
    .map((entry) => String(entry).trim())
    .filter(Boolean))];
}

function normalizeScopedId(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function normalizeBoolean(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeIsoTimestamp(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function getDigestAlgorithmProfile(algorithm) {
  return DIGEST_ALGORITHM_PROFILES[String(algorithm || '').toLowerCase()] || null;
}

function classifyDigestEncoding(digest) {
  if (DIGEST_HEX_PATTERN.test(digest)) {
    return 'hex';
  }

  if (DIGEST_BASE64URL_PATTERN.test(digest)) {
    return 'base64url';
  }

  return 'unknown';
}

function expectedDigestLengthForEncoding(profile, encoding) {
  if (!profile || !profile.digestBytes) {
    return null;
  }

  if (encoding === 'hex') {
    return profile.digestBytes * 2;
  }

  if (encoding === 'base64url') {
    return Math.ceil((profile.digestBytes * 8) / 6);
  }

  return null;
}

function buildAddressFormatIssues({ raw, algorithm, digest, digestEncoding, validAlgorithm, validDigestShape }) {
  const profile = getDigestAlgorithmProfile(algorithm);
  const expectedLength = expectedDigestLengthForEncoding(profile, digestEncoding);
  const issues = [
    ...(!raw ? ['missing_content_address'] : []),
    ...(raw && !validAlgorithm ? ['unsupported_content_address_algorithm'] : []),
    ...(raw && !digest ? ['missing_digest'] : []),
    ...(raw && digest && !validDigestShape ? ['unsupported_digest_encoding'] : []),
    ...(raw && profile && digestEncoding !== 'unknown' && !profile.encodings.includes(digestEncoding)
      ? ['unsupported_digest_encoding']
      : []),
    ...(raw && profile && expectedLength !== null && digest.length !== expectedLength
      ? ['digest_length_mismatch']
      : [])
  ];

  return [...new Set(issues)];
}

function parseContentAddress(value, fallbackAlgorithm = DEFAULT_ALGORITHM) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) {
    return {
      raw,
      algorithm: fallbackAlgorithm,
      digest: null,
      digestEncoding: 'unknown',
      validFormat: false,
      normalized: '',
      formatIssues: ['missing_content_address'],
      expectedDigestBytes: getDigestAlgorithmProfile(fallbackAlgorithm)?.digestBytes || null,
      expectedDigestLength: null
    };
  }

  const separatorIndex = raw.indexOf(':');
  const algorithm = separatorIndex > 0
    ? raw.slice(0, separatorIndex).toLowerCase()
    : String(fallbackAlgorithm || DEFAULT_ALGORITHM).toLowerCase();
  const digest = separatorIndex > 0 ? raw.slice(separatorIndex + 1) : raw;
  const normalized = `${algorithm}:${digest}`;
  const validAlgorithm = /^[a-z0-9][a-z0-9+.-]*$/.test(algorithm);
  const digestEncoding = classifyDigestEncoding(digest);
  const validDigest = digestEncoding !== 'unknown';
  const algorithmProfile = getDigestAlgorithmProfile(algorithm);
  const expectedDigestLength = expectedDigestLengthForEncoding(algorithmProfile, digestEncoding);
  const formatIssues = buildAddressFormatIssues({
    raw,
    algorithm,
    digest,
    digestEncoding,
    validAlgorithm,
    validDigestShape: validDigest
  });

  return {
    raw,
    algorithm,
    digest,
    normalized,
    validFormat: validAlgorithm
      && validDigest
      && CONTENT_ADDRESS_PATTERN.test(normalized)
      && formatIssues.length === 0,
    digestEncoding,
    formatIssues,
    expectedDigestBytes: algorithmProfile?.digestBytes || null,
    expectedDigestLength
  };
}

function decodeDigestBytes(address) {
  if (!address?.digest || address.digestEncoding === 'unknown') {
    return null;
  }

  try {
    return Buffer.from(address.digest, address.digestEncoding);
  } catch {
    return null;
  }
}

function contentAddressesEquivalent(left, right, fallbackAlgorithm = DEFAULT_ALGORITHM) {
  const leftAddress = parseContentAddress(left, fallbackAlgorithm);
  const rightAddress = parseContentAddress(right, leftAddress.algorithm || fallbackAlgorithm);

  if (!leftAddress.raw || !rightAddress.raw || leftAddress.algorithm !== rightAddress.algorithm) {
    return false;
  }

  if (leftAddress.normalized === rightAddress.normalized) {
    return true;
  }

  const leftDigest = decodeDigestBytes(leftAddress);
  const rightDigest = decodeDigestBytes(rightAddress);
  return Boolean(
    leftDigest
    && rightDigest
    && leftDigest.length === rightDigest.length
    && leftDigest.equals(rightDigest)
  );
}

function normalizeExpectedArtifactDigests(artifact) {
  const expected = asRecord(artifact.expected || artifact.expectedDigest || artifact.integrity);
  const candidates = [
    artifact.expectedContentAddress,
    artifact.expectedAddress,
    artifact.expectedDigest,
    expected.contentAddress,
    expected.address,
    expected.digest
  ];

  return normalizeStringList(candidates.filter((candidate) => (
    typeof candidate === 'string' && candidate.trim()
  )))
    .map((value) => parseContentAddress(value))
    .filter((address) => address.raw)
    .map((address) => address.normalized);
}

function digestInlineArtifactContent(artifact, algorithm) {
  if (algorithm !== DEFAULT_ALGORITHM) {
    return null;
  }

  const rawContent = artifact.content ?? artifact.inlineContent ?? artifact.body;
  const rawBytes = artifact.bytesContent ?? artifact.data;
  const encoding = typeof artifact.encoding === 'string' && INLINE_CONTENT_ENCODINGS.has(artifact.encoding.toLowerCase())
    ? artifact.encoding.toLowerCase()
    : 'utf8';

  if (typeof rawContent === 'string') {
    const buffer = encoding === 'base64url'
      ? Buffer.from(rawContent, 'base64url')
      : encoding === 'base64' || encoding === 'hex'
        ? Buffer.from(rawContent, encoding)
        : Buffer.from(rawContent, 'utf8');
    return `${DEFAULT_ALGORITHM}:${createHash(DEFAULT_ALGORITHM).update(buffer).digest('base64url')}`;
  }

  if (typeof rawBytes === 'string') {
    const buffer = encoding === 'base64url'
      ? Buffer.from(rawBytes, 'base64url')
      : encoding === 'base64' || encoding === 'hex'
        ? Buffer.from(rawBytes, encoding)
        : Buffer.from(rawBytes, 'utf8');
    return `${DEFAULT_ALGORITHM}:${createHash(DEFAULT_ALGORITHM).update(buffer).digest('base64url')}`;
  }

  if (Array.isArray(rawBytes) && rawBytes.every((entry) => Number.isInteger(entry) && entry >= 0 && entry <= 255)) {
    return `${DEFAULT_ALGORITHM}:${createHash(DEFAULT_ALGORITHM).update(Buffer.from(rawBytes)).digest('base64url')}`;
  }

  return null;
}

function normalizeArtifact(rawArtifact, index) {
  const artifact = asRecord(rawArtifact);
  const scope = asRecord(artifact.scope || artifact.boundary || artifact.workspace);
  const explicitTenantId = normalizeScopedId(artifact.tenantId || scope.tenantId, null);
  const explicitWorkspaceId = normalizeScopedId(artifact.workspaceId || scope.workspaceId || scope.id, null);
  const id = String(artifact.id || artifact.path || artifact.name || `artifact-${index + 1}`);
  const bytes = Number.isFinite(artifact.bytes) ? Math.max(0, Math.trunc(artifact.bytes)) : null;
  const contentAddress = typeof artifact.contentAddress === 'string'
    ? artifact.contentAddress
    : typeof artifact.cid === 'string'
      ? artifact.cid
      : '';
  const algorithm = typeof artifact.algorithm === 'string' && artifact.algorithm
    ? artifact.algorithm.toLowerCase()
    : contentAddress.includes(':')
      ? contentAddress.slice(0, contentAddress.indexOf(':')).toLowerCase()
      : DEFAULT_ALGORITHM;
  const parsedAddress = parseContentAddress(contentAddress, algorithm);
  const computedContentAddress = digestInlineArtifactContent(artifact, parsedAddress.algorithm);
  const expectedContentAddresses = normalizeExpectedArtifactDigests(artifact);
  const tamperSignals = [
    ...parsedAddress.formatIssues,
    ...(computedContentAddress
      && parsedAddress.normalized
      && !contentAddressesEquivalent(computedContentAddress, parsedAddress.normalized, parsedAddress.algorithm)
      ? ['computed_digest_mismatch']
      : []),
    ...(expectedContentAddresses.length > 0
      && parsedAddress.normalized
      && !expectedContentAddresses.some((expectedAddress) => (
        contentAddressesEquivalent(expectedAddress, parsedAddress.normalized, parsedAddress.algorithm)
      ))
        ? ['expected_digest_mismatch']
        : [])
  ];

  return {
    id,
    path: typeof artifact.path === 'string' ? artifact.path : id,
    label: typeof artifact.label === 'string' ? artifact.label : id,
    contentAddress: parsedAddress.normalized || contentAddress,
    algorithm: parsedAddress.algorithm,
    digest: parsedAddress.digest,
    digestEncoding: parsedAddress.digestEncoding || 'unknown',
    addressFormatIssues: parsedAddress.formatIssues,
    expectedDigestBytes: parsedAddress.expectedDigestBytes,
    expectedDigestLength: parsedAddress.expectedDigestLength,
    computedContentAddress,
    expectedContentAddresses,
    addressVerifiedByInlineContent: Boolean(
      computedContentAddress
      && contentAddressesEquivalent(computedContentAddress, parsedAddress.normalized, parsedAddress.algorithm)
    ),
    tamperSignals,
    bytes,
    mediaType: typeof artifact.mediaType === 'string' ? artifact.mediaType : 'application/octet-stream',
    tenantId: explicitTenantId,
    workspaceId: explicitWorkspaceId,
    scopeBinding: {
      tenantExplicit: explicitTenantId !== null,
      workspaceExplicit: explicitWorkspaceId !== null,
      explicit: explicitTenantId !== null && explicitWorkspaceId !== null,
      source: artifact.tenantId || artifact.workspaceId
        ? 'artifact'
        : scope.tenantId || scope.workspaceId || scope.id
          ? 'artifact_scope'
          : 'inherited_request'
    },
    requiredRoles: normalizeStringList(artifact.requiredRoles || scope.requiredRoles),
    accepted: artifact.accepted === true,
    proof: asRecord(artifact.proof)
  };
}

function normalizeRequestContext(input, artifacts) {
  const request = asRecord(input.request || input.requestContext);
  const client = asRecord(input.client || input.clientState);
  const params = asRecord(input.params || input.routeParams);
  const requestedArtifactId = String(
    request.artifactId || client.selectedArtifactId || params.artifactId || ''
  );
  const selectedArtifact = artifacts.find((artifact) => artifact.id === requestedArtifactId) || artifacts[0] || null;
  const requestId = String(request.requestId || request.id || input.requestId || `content-address-${artifacts.length}`);
  const sessionId = typeof client.sessionId === 'string' && client.sessionId
    ? client.sessionId
    : typeof request.sessionId === 'string' && request.sessionId
      ? request.sessionId
      : null;
  const scope = asRecord(input.scope || request.scope || client.scope || input.workspace);
  const actorRoles = normalizeStringList(
    request.actorRoles || request.roles || client.actorRoles || client.roles || input.actorRoles
  );

  return {
    requestId,
    sessionId,
    actor: typeof request.actor === 'string' && request.actor ? request.actor : 'hosted-kernel',
    actorRoles,
    tenantId: normalizeScopedId(request.tenantId || scope.tenantId || input.tenantId, DEFAULT_TENANT_ID),
    workspaceId: normalizeScopedId(request.workspaceId || scope.workspaceId || scope.id || input.workspaceId, DEFAULT_WORKSPACE_ID),
    allowInheritedArtifactScopeMutation: normalizeBoolean(
      request.allowInheritedArtifactScopeMutation
        ?? request.trustInheritedArtifactScope
        ?? client.allowInheritedArtifactScopeMutation
        ?? input.allowInheritedArtifactScopeMutation,
      false
    ),
    sourceRoute: typeof request.route === 'string' && request.route ? request.route : DEFAULT_PREVIEW_ROUTE,
    selectedArtifactId: selectedArtifact ? selectedArtifact.id : null,
    requestedArtifactId: requestedArtifactId || null,
    hasSelectionMismatch: Boolean(requestedArtifactId && (!selectedArtifact || selectedArtifact.id !== requestedArtifactId)),
    intent: typeof request.intent === 'string' && request.intent ? request.intent : 'inspect-content-address'
  };
}

function normalizeWorkflowHandoffState(input, requestContext) {
  const client = asRecord(input.client || input.clientState);
  const request = asRecord(input.request || input.requestContext);
  const persisted = asRecord(input.persistedState || input.stateSnapshot || input.recoveredState);
  const workflow = asRecord(
    input.workflowHandoffState
    || input.workflowState
    || client.workflowHandoff
    || client.contentAddressWorkflow
    || request.workflowHandoff
    || persisted.workflowHandoff
  );
  const acknowledgedHandoffIds = normalizeStringList(
    workflow.acknowledgedHandoffIds
    || workflow.acknowledgedIds
    || workflow.seenHandoffIds
  );
  const completedHandoffIds = normalizeStringList(
    workflow.completedHandoffIds
    || workflow.completedIds
  );
  const dismissedIssueCodes = normalizeStringList(
    workflow.dismissedIssueCodes
    || workflow.dismissedValidationCodes
  );
  const pinnedArtifactId = normalizeScopedId(
    workflow.pinnedArtifactId || workflow.focusArtifactId || client.selectedArtifactId,
    requestContext.selectedArtifactId
  );
  const lastSeenRoute = typeof workflow.lastSeenRoute === 'string' && workflow.lastSeenRoute
    ? workflow.lastSeenRoute
    : typeof client.route === 'string' && client.route
      ? client.route
      : requestContext.sourceRoute;
  const returnToRoute = typeof workflow.returnToRoute === 'string' && workflow.returnToRoute
    ? workflow.returnToRoute
    : typeof client.returnToRoute === 'string' && client.returnToRoute
      ? client.returnToRoute
      : requestContext.sourceRoute;

  return {
    contract: WORKFLOW_HANDOFF_STATE_CONTRACT_VERSION,
    present: Object.keys(workflow).length > 0,
    acknowledgedHandoffIds,
    completedHandoffIds,
    dismissedIssueCodes,
    pinnedArtifactId,
    lastSeenRoute,
    returnToRoute,
    lastSeenAction: typeof workflow.lastSeenAction === 'string' && workflow.lastSeenAction
      ? workflow.lastSeenAction
      : null,
    acknowledgedAt: normalizeIsoTimestamp(workflow.acknowledgedAt || workflow.lastAcknowledgedAt),
    completedAt: normalizeIsoTimestamp(workflow.completedAt || workflow.lastCompletedAt),
    clientRevision: typeof workflow.clientRevision === 'string' && workflow.clientRevision
      ? workflow.clientRevision
      : typeof client.revision === 'string' && client.revision
        ? client.revision
        : null
  };
}

function normalizeClientHandoffQueueState(input, requestContext) {
  const client = asRecord(input.client || input.clientState);
  const persisted = asRecord(input.persistedState || input.stateSnapshot || input.recoveredState);
  const queue = asRecord(
    input.clientHandoffQueue
    || client.clientHandoffQueue
    || client.handoffQueue
    || persisted.clientHandoffQueue
  );
  const rawItems = asArray(queue.items || queue.pendingItems || queue.handoffs);
  const items = rawItems
    .map((item) => asRecord(item))
    .filter((item) => typeof item.id === 'string' && item.id)
    .map((item) => {
      const completed = item.completed === true || item.state === 'completed';
      const acknowledged = completed || item.acknowledged === true || item.state === 'acknowledged';
      const route = typeof item.route === 'string' && item.route
        ? item.route
        : typeof item.resumeRoute === 'string' && item.resumeRoute
          ? item.resumeRoute
          : null;

      return {
        id: item.id,
        source: typeof item.source === 'string' && item.source ? item.source : 'client_queue',
        route,
        action: typeof item.action === 'string' && item.action ? item.action : null,
        state: typeof item.state === 'string' && item.state ? item.state : 'unknown',
        acknowledged,
        completed,
        artifactIds: normalizeStringList(item.artifactIds),
        evidenceRefs: normalizeStringList(item.evidenceRefs),
        disabledReasonCodes: normalizeStringList(item.disabledReasonCodes),
        returnToRoute: typeof item.returnToRoute === 'string' && item.returnToRoute
          ? item.returnToRoute
          : requestContext.sourceRoute,
        updatedAt: normalizeIsoTimestamp(item.updatedAt || item.generatedAt || item.acknowledgedAt || item.completedAt)
      };
    })
    .filter((item, index, allItems) => allItems.findIndex((candidate) => candidate.id === item.id) === index);

  return {
    contract: CLIENT_HANDOFF_QUEUE_CONTRACT_VERSION,
    present: Object.keys(queue).length > 0,
    queueDigest: typeof queue.queueDigest === 'string' && queue.queueDigest ? queue.queueDigest : null,
    activeItemId: typeof queue.activeItemId === 'string' && queue.activeItemId ? queue.activeItemId : null,
    state: typeof queue.state === 'string' && queue.state ? queue.state : 'unknown',
    generatedAt: normalizeIsoTimestamp(queue.generatedAt),
    updatedAt: normalizeIsoTimestamp(queue.updatedAt || queue.persistedAt),
    items
  };
}

function buildBoundaryContext(artifacts, requestContext, command = null) {
  const roles = requestContext.actorRoles.length > 0 ? requestContext.actorRoles : ['viewer'];
  const grants = new Set(roles.flatMap((role) => ROLE_GRANTS[role] || []));
  const requestedAction = command?.type === 'accept_artifacts'
    ? 'accept'
    : command?.type === 'record_proof'
      ? 'record_proof'
      : 'preview';
  const hasCommandPermission = grants.has(requestedAction);
  const mutatingAction = MUTATING_ARTIFACT_ACTIONS.has(requestedAction);
  const inheritedScopeOverrideAllowed = requestContext.allowInheritedArtifactScopeMutation === true
    && grants.has('audit');
  const artifactAccess = artifacts.map((artifact) => {
    const tenantId = artifact.tenantId || requestContext.tenantId;
    const workspaceId = artifact.workspaceId || requestContext.workspaceId;
    const tenantMatches = tenantId === requestContext.tenantId;
    const workspaceMatches = workspaceId === requestContext.workspaceId;
    const scopeBinding = asRecord(artifact.scopeBinding);
    const explicitScopeBinding = scopeBinding.explicit === true;
    const inheritedScopeBinding = !explicitScopeBinding;
    const inheritedScopeMutationDenied = mutatingAction
      && inheritedScopeBinding
      && !inheritedScopeOverrideAllowed;
    const roleMatches = artifact.requiredRoles.length === 0
      || artifact.requiredRoles.some((role) => roles.includes(role));
    const readable = tenantMatches && workspaceMatches && grants.has('preview') && roleMatches;
    const writable = readable && hasCommandPermission && !inheritedScopeMutationDenied;

    return {
      artifactId: artifact.id,
      tenantId,
      workspaceId,
      scopeBinding: {
        tenantExplicit: scopeBinding.tenantExplicit === true,
        workspaceExplicit: scopeBinding.workspaceExplicit === true,
        explicit: explicitScopeBinding,
        inherited: inheritedScopeBinding,
        source: typeof scopeBinding.source === 'string' && scopeBinding.source
          ? scopeBinding.source
          : 'unknown'
      },
      tenantMatches,
      workspaceMatches,
      requiredRoles: artifact.requiredRoles,
      readable,
      writable,
      quarantine: !tenantMatches || !workspaceMatches || !roleMatches || inheritedScopeMutationDenied,
      denialCode: !tenantMatches
        ? 'tenant_boundary_mismatch'
        : !workspaceMatches
          ? 'workspace_boundary_mismatch'
          : !roleMatches
            ? 'artifact_role_denied'
            : inheritedScopeMutationDenied
              ? 'inherited_scope_mutation_denied'
              : !grants.has('preview')
                ? 'preview_permission_denied'
                : null
    };
  });

  return {
    contract: BOUNDARY_CONTRACT_VERSION,
    tenantId: requestContext.tenantId,
    workspaceId: requestContext.workspaceId,
    actor: requestContext.actor,
    actorRoles: roles,
    requestedAction,
    commandAuthorized: requestedAction === 'preview' || hasCommandPermission,
    scopeMutationPolicy: {
      requiresExplicitArtifactScope: true,
      allowInheritedArtifactScopeMutation: inheritedScopeOverrideAllowed,
      overrideRequested: requestContext.allowInheritedArtifactScopeMutation === true,
      overrideRequiresGrant: 'audit',
      mutatingAction
    },
    grants: [...grants].sort(),
    artifactAccess,
    visibleArtifactIds: artifactAccess.filter((entry) => entry.readable).map((entry) => entry.artifactId),
    quarantinedArtifactIds: artifactAccess.filter((entry) => entry.quarantine).map((entry) => entry.artifactId),
    deniedArtifactIds: artifactAccess.filter((entry) => !entry.writable && requestedAction !== 'preview').map((entry) => entry.artifactId)
  };
}

function buildCommandTargetScope(artifacts, command, boundaryContext) {
  const mutatingCommandTypes = ['accept_artifacts', 'record_proof'];
  const mutating = command?.present === true && mutatingCommandTypes.includes(command.type);
  const implicitAllArtifacts = mutating && command.artifactIds.length === 0;
  const targetIds = implicitAllArtifacts
    ? artifacts.map((artifact) => artifact.id)
    : normalizeStringList(command?.artifactIds || []);
  const knownArtifactIds = new Set(artifacts.map((artifact) => artifact.id));
  const accessByArtifactId = new Map(
    asArray(boundaryContext?.artifactAccess).map((entry) => [entry.artifactId, entry])
  );
  const unknownArtifactIds = targetIds.filter((artifactId) => !knownArtifactIds.has(artifactId));
  const targetRecords = targetIds
    .filter((artifactId) => knownArtifactIds.has(artifactId))
    .map((artifactId) => {
      const access = accessByArtifactId.get(artifactId) || {};
      const denied = access.writable !== true;

      return {
        artifactId,
        tenantId: access.tenantId || boundaryContext?.tenantId || null,
        workspaceId: access.workspaceId || boundaryContext?.workspaceId || null,
        scopeBinding: access.scopeBinding || {
          explicit: false,
          inherited: true,
          source: 'unknown'
        },
        readable: access.readable === true,
        writable: access.writable === true,
        quarantine: access.quarantine === true,
        denialCode: denied
          ? access.denialCode || 'command_write_denied'
          : null
      };
    });
  const deniedTargets = targetRecords.filter((record) => record.denialCode);
  const blockedReasonCodes = [
    ...(boundaryContext?.commandAuthorized === false ? ['command_permission_denied'] : []),
    ...(unknownArtifactIds.length > 0 ? ['unknown_artifact_target'] : []),
    ...(mutating && targetRecords.length === 0 && unknownArtifactIds.length === 0 ? ['no_artifact_targets'] : []),
    ...deniedTargets.map((record) => record.denialCode)
  ];
  const payload = {
    contract: COMMAND_TARGET_SCOPE_CONTRACT_VERSION,
    commandId: command?.commandId || null,
    commandType: command?.type || null,
    requestedAction: boundaryContext?.requestedAction || 'preview',
    tenantId: boundaryContext?.tenantId || null,
    workspaceId: boundaryContext?.workspaceId || null,
    targetIds,
    unknownArtifactIds,
    deniedTargetIds: deniedTargets.map((record) => record.artifactId),
    implicitAllArtifacts
  };

  return {
    ...payload,
    present: command?.present === true,
    mutating,
    actorRoles: boundaryContext?.actorRoles || [],
    grants: boundaryContext?.grants || [],
    scopeMutationPolicy: boundaryContext?.scopeMutationPolicy || null,
    knownTargetIds: targetRecords.map((record) => record.artifactId),
    writableArtifactIds: targetRecords
      .filter((record) => record.writable)
      .map((record) => record.artifactId),
    deniedTargets,
    blockedReasonCodes: [...new Set(blockedReasonCodes.filter(Boolean))],
    allowed: mutating
      ? boundaryContext?.commandAuthorized === true
        && unknownArtifactIds.length === 0
        && deniedTargets.length === 0
        && targetRecords.length > 0
      : boundaryContext?.commandAuthorized !== false,
    scopeDigest: `${DEFAULT_ALGORITHM}:${sha256Base64Url(stableManifestJson(payload))}`
  };
}

function buildBoundaryAuditHandoff(now, artifacts, boundaryContext, requestContext, commandResult, validation) {
  const accessByArtifactId = new Map(boundaryContext.artifactAccess.map((entry) => [entry.artifactId, entry]));
  const visibleArtifactIds = new Set(boundaryContext.visibleArtifactIds);
  const deniedRecords = artifacts
    .map((artifact) => {
      const access = accessByArtifactId.get(artifact.id);
      if (!access || (access.readable && access.writable)) {
        return null;
      }

      const issueCodes = validation.byArtifact
        .find((entry) => entry.artifactId === artifact.id)?.issues
        ?.map((issue) => issue.code) || [];

      return {
        artifactId: artifact.id,
        tenantId: access.tenantId,
        workspaceId: access.workspaceId,
        requestedTenantId: requestContext.tenantId,
        requestedWorkspaceId: requestContext.workspaceId,
        readable: access.readable,
        writable: access.writable,
        quarantine: access.quarantine,
        scopeBinding: access.scopeBinding || {
          explicit: false,
          inherited: true,
          source: 'unknown'
        },
        denialCode: access.denialCode || (
          access.writable === false && boundaryContext.requestedAction !== 'preview'
            ? 'command_write_denied'
            : null
        ),
        requiredRoles: access.requiredRoles,
        issueCodes: [...new Set(issueCodes)]
      };
    })
    .filter(Boolean);
  const denialCounts = deniedRecords.reduce((counts, record) => ({
    ...counts,
    [record.denialCode || 'unknown_denial']: (counts[record.denialCode || 'unknown_denial'] || 0) + 1
  }), {});
  const commandDenied = commandResult.applied === false
    && [
      'permission_denied',
      'artifact_boundary_denied',
      'unknown_artifact_target',
      'no_artifact_targets',
      'command_id_replay_mismatch',
      'command_lock_replay_mismatch',
      'unsafe_restart_command_recovery',
      'expired_command_lock_requires_recovery',
      'blocked_command_lock_requires_recovery',
      'artifact_integrity_evidence_blocked'
    ].includes(commandResult.code);
  const commandTargetScope = commandResult.commandTargetScope || null;
  const handoffRequired = deniedRecords.length > 0 || commandDenied;
  const visibleEvidence = artifacts
    .filter((artifact) => visibleArtifactIds.has(artifact.id))
    .map((artifact) => ({
      artifactId: artifact.id,
      algorithm: artifact.algorithm,
      accepted: artifact.accepted,
      proofVerified: artifact.proof.verified === true
    }));
  const redactedEvidence = {
    contract: BOUNDARY_AUDIT_HANDOFF_CONTRACT_VERSION,
    requestId: requestContext.requestId,
    tenantId: requestContext.tenantId,
    workspaceId: requestContext.workspaceId,
    actor: requestContext.actor,
    actorRoles: boundaryContext.actorRoles,
    requestedAction: boundaryContext.requestedAction,
    grants: boundaryContext.grants,
    scopeMutationPolicy: boundaryContext.scopeMutationPolicy,
    visibleArtifactIds: boundaryContext.visibleArtifactIds,
    quarantinedArtifactIds: boundaryContext.quarantinedArtifactIds,
    deniedArtifactIds: deniedRecords.map((record) => record.artifactId),
    commandTargetScope: commandTargetScope
      ? {
          contract: commandTargetScope.contract,
          commandId: commandTargetScope.commandId,
          commandType: commandTargetScope.commandType,
          targetIds: commandTargetScope.targetIds,
          unknownArtifactIds: commandTargetScope.unknownArtifactIds,
          deniedTargetIds: commandTargetScope.deniedTargets.map((record) => record.artifactId),
          blockedReasonCodes: commandTargetScope.blockedReasonCodes,
          scopeMutationPolicy: commandTargetScope.scopeMutationPolicy,
          scopeDigest: commandTargetScope.scopeDigest
        }
      : null,
    commandIntegrityGate: commandResult.commandIntegrityGate
      ? {
          contract: commandResult.commandIntegrityGate.contract,
          allowed: commandResult.commandIntegrityGate.allowed,
          commandType: commandResult.commandIntegrityGate.commandType,
          targetIds: commandResult.commandIntegrityGate.targetIds,
          blockedTargetIds: commandResult.commandIntegrityGate.blockedTargetIds,
          blockedReasonCodes: commandResult.commandIntegrityGate.blockedReasonCodes,
          evidenceDigest: `${DEFAULT_ALGORITHM}:${sha256Base64Url(stableManifestJson(
            commandResult.commandIntegrityGate.targetEvidence || []
          ))}`
        }
      : null,
    denialCounts,
    visibleEvidence,
    deniedRecords
  };
  const evidenceDigest = `${DEFAULT_ALGORITHM}:${sha256Base64Url(stableManifestJson(redactedEvidence))}`;

  return {
    contract: BOUNDARY_AUDIT_HANDOFF_CONTRACT_VERSION,
    generatedAt: now,
    handoffId: `${requestContext.requestId}:boundary-audit:${evidenceDigest.slice(-16)}`,
    required: handoffRequired,
    state: handoffRequired
      ? commandDenied
        ? 'command_blocked'
        : 'boundary_review_required'
      : 'clear',
    route: DEFAULT_AUDIT_ROUTE,
    tenantId: requestContext.tenantId,
    workspaceId: requestContext.workspaceId,
    requestedAction: boundaryContext.requestedAction,
    commandCode: commandResult.code || null,
    commandDenied,
    redactionPolicy: {
      contentAddressesRedactedForDeniedArtifacts: true,
      pathsRedactedForDeniedArtifacts: true,
      exposesOnlyScopedArtifactIds: true
    },
    counts: {
      totalArtifacts: artifacts.length,
      visibleArtifacts: boundaryContext.visibleArtifactIds.length,
      quarantinedArtifacts: boundaryContext.quarantinedArtifactIds.length,
      deniedArtifacts: deniedRecords.length,
      deniedCommandTargets: commandTargetScope?.deniedTargets?.length || 0,
      unknownCommandTargets: commandTargetScope?.unknownArtifactIds?.length || 0,
      validationBoundaryErrors: validation.issues
        .filter((issue) => issue.code === 'tenant_boundary_mismatch'
          || issue.code === 'workspace_boundary_mismatch'
          || issue.code === 'artifact_role_denied'
          || issue.code === 'inherited_scope_mutation_denied')
        .length
    },
    denialCounts,
    deniedRecords,
    commandTargetScope,
    safeEvidence: {
      digest: evidenceDigest,
      algorithm: DEFAULT_ALGORITHM,
      canonicalContract: BOUNDARY_AUDIT_HANDOFF_CONTRACT_VERSION,
      artifactIds: redactedEvidence.deniedArtifactIds,
      visibleArtifactIds: boundaryContext.visibleArtifactIds
    },
    auditEvent: {
      type: handoffRequired ? 'content_address_boundary_review_requested' : 'content_address_boundary_clear',
      subject: `${requestContext.tenantId}/${requestContext.workspaceId}`,
      evidenceDigest,
      route: DEFAULT_AUDIT_ROUTE,
      boundaryContract: BOUNDARY_CONTRACT_VERSION
    }
  };
}

function normalizeCommandLockRecord(rawLock, now) {
  const lock = asRecord(rawLock);
  const state = ['pending', 'running', 'recovering', 'mismatch', 'blocked'].includes(lock.state)
    ? lock.state
    : lock.completed === true
      ? 'completed'
      : 'pending';
  const lockedAt = normalizeIsoTimestamp(lock.lockedAt || lock.startedAt || lock.generatedAt);
  const expiresAt = normalizeIsoTimestamp(lock.expiresAt || lock.deadlineAt);
  const parsedNowMs = Date.parse(now);
  const nowMs = Number.isFinite(parsedNowMs) ? parsedNowMs : Date.now();
  const lockedAtMs = lockedAt ? Date.parse(lockedAt) : null;
  const expiresAtMs = expiresAt ? Date.parse(expiresAt) : null;
  const expired = Number.isFinite(expiresAtMs) && expiresAtMs <= nowMs;
  const replayKey = typeof lock.replayKey === 'string' && lock.replayKey
    ? lock.replayKey
    : null;
  const artifactIds = normalizeStringList(lock.artifactIds || lock.targetIds);
  const ageMs = Number.isFinite(lockedAtMs) ? Math.max(0, nowMs - lockedAtMs) : null;
  const recoveryIssueCodes = [
    ...(replayKey ? [] : ['missing_replay_key']),
    ...(expired ? ['command_lock_expired'] : []),
    ...(state === 'mismatch' ? ['command_lock_replay_mismatch'] : []),
    ...(state === 'blocked' ? ['command_lock_blocked'] : []),
    ...(state === 'pending' && !lockedAt ? ['missing_lock_timestamp'] : [])
  ];
  const recoveryAction = expired
    ? state === 'pending' || state === 'running' || state === 'recovering'
      ? 'await_matching_receipt'
      : 'drop_expired_lock'
    : state === 'mismatch' || state === 'blocked'
      ? 'require_operator_review'
      : state === 'pending' || state === 'running' || state === 'recovering'
        ? 'resume_or_replay_command'
        : 'observe_only';
  const restartSafe = !expired
    && recoveryAction === 'resume_or_replay_command'
    && replayKey !== null
    && state !== 'mismatch'
    && state !== 'blocked';
  const payload = {
    contract: COMMAND_RECOVERY_CONTRACT_VERSION,
    commandId: String(lock.commandId || lock.id),
    commandType: typeof lock.commandType === 'string' && lock.commandType
      ? lock.commandType
      : typeof lock.type === 'string' && lock.type
        ? lock.type
        : null,
    replayKey,
    state,
    artifactIds,
    lockedAt,
    expiresAt,
    source: typeof lock.source === 'string' && lock.source ? lock.source : 'persisted_state'
  };

  return {
    ...payload,
    expired,
    ageMs,
    restartSafe,
    recoveryAction: COMMAND_LOCK_RECOVERY_ACTIONS.has(recoveryAction) ? recoveryAction : 'observe_only',
    recoveryIssueCodes: [...new Set(recoveryIssueCodes)],
    lockDigest: `${DEFAULT_ALGORITHM}:${sha256Base64Url(stableManifestJson(payload))}`,
    resultDigest: typeof lock.resultDigest === 'string' && lock.resultDigest
      ? lock.resultDigest
      : null
  };
}

function normalizeCommandReceiptRecord(rawReceipt) {
  const receipt = asRecord(rawReceipt);
  const commandId = String(receipt.commandId || receipt.id);
  const commandType = typeof receipt.commandType === 'string' && receipt.commandType
    ? receipt.commandType
    : typeof receipt.type === 'string' && receipt.type
      ? receipt.type
      : null;
  const replayKey = typeof receipt.replayKey === 'string' && receipt.replayKey
    ? receipt.replayKey
    : null;
  const artifactIds = normalizeStringList(receipt.artifactIds || receipt.targetIds);
  const recordedAt = normalizeIsoTimestamp(
    receipt.recordedAt
    || receipt.persistedAt
    || receipt.appliedAt
    || receipt.completedAt
  );
  const resultDigest = typeof receipt.resultDigest === 'string' && receipt.resultDigest
    ? receipt.resultDigest
    : null;
  const payload = {
    contract: COMMAND_RECOVERY_CONTRACT_VERSION,
    commandId,
    commandType,
    replayKey,
    applied: receipt.applied === true,
    code: typeof receipt.code === 'string' && receipt.code ? receipt.code : null,
    artifactIds,
    recordedAt,
    resultDigest
  };

  return {
    ...payload,
    receiptDigest: typeof receipt.receiptDigest === 'string' && receipt.receiptDigest
      ? receipt.receiptDigest
      : `${DEFAULT_ALGORITHM}:${sha256Base64Url(stableManifestJson(payload))}`
  };
}

function reconcileCommandLocksWithReceipts(commandLocks, commandReceipts) {
  const receiptsByCommandId = new Map();
  const receiptsByReplayKey = new Map();

  commandReceipts.forEach((receipt) => {
    if (!receiptsByCommandId.has(receipt.commandId)) {
      receiptsByCommandId.set(receipt.commandId, []);
    }
    receiptsByCommandId.get(receipt.commandId).push(receipt);

    if (receipt.replayKey && !receiptsByReplayKey.has(receipt.replayKey)) {
      receiptsByReplayKey.set(receipt.replayKey, receipt);
    }
  });

  return commandLocks.map((lock) => {
    const sameCommandReceipts = receiptsByCommandId.get(lock.commandId) || [];
    const replayKeyReceipt = lock.replayKey ? receiptsByReplayKey.get(lock.replayKey) : null;
    const matchingReceipt = replayKeyReceipt
      || sameCommandReceipts.find((receipt) => !lock.replayKey || !receipt.replayKey || receipt.replayKey === lock.replayKey)
      || null;
    const conflictingReceipt = sameCommandReceipts.find((receipt) => (
      lock.replayKey
      && receipt.replayKey
      && receipt.replayKey !== lock.replayKey
    )) || null;
    const resultDigestMismatch = Boolean(
      matchingReceipt
      && lock.resultDigest
      && matchingReceipt.resultDigest
      && lock.resultDigest !== matchingReceipt.resultDigest
    );
    const receiptResolved = Boolean(matchingReceipt && !resultDigestMismatch);
    const reconciliationIssueCodes = [
      ...(receiptResolved ? ['matching_command_receipt_observed'] : []),
      ...(conflictingReceipt ? ['command_receipt_replay_mismatch'] : []),
      ...(resultDigestMismatch ? ['command_receipt_result_digest_mismatch'] : [])
    ];

    return {
      ...lock,
      receiptResolved,
      restartSafe: receiptResolved ? true : lock.restartSafe,
      recoveryAction: receiptResolved ? 'observe_only' : lock.recoveryAction,
      recoveryIssueCodes: receiptResolved
        ? lock.recoveryIssueCodes.filter((code) => code !== 'command_lock_expired')
        : lock.recoveryIssueCodes,
      receiptReconciliation: {
        state: receiptResolved
          ? 'receipt_resolved'
          : resultDigestMismatch
            ? 'receipt_digest_mismatch'
            : conflictingReceipt
              ? 'receipt_replay_mismatch'
              : 'awaiting_receipt',
        matchingReceiptDigest: matchingReceipt?.receiptDigest || null,
        matchingReceiptRecordedAt: matchingReceipt?.recordedAt || null,
        matchingReceiptApplied: matchingReceipt?.applied === true,
        conflictingReceiptDigest: conflictingReceipt?.receiptDigest || null,
        issueCodes: reconciliationIssueCodes
      }
    };
  });
}

function normalizePersistedState(input, artifacts, now) {
  const persisted = asRecord(input.persistedState || input.stateSnapshot || input.recoveredState);
  const persistedRestartResume = asRecord(persisted.restartResume || persisted.restartCheckpoint);
  const persistedCommandReplay = asRecord(persistedRestartResume.commandReplay);
  const rawSnapshots = asArray(persisted.artifacts || persisted.artifactStates || persisted.snapshots);
  const rawCommandReceipts = [
    ...asArray(persisted.commandReceipts),
    ...asArray(persisted.commandLedger),
    ...asArray(asRecord(persisted.commands).receipts)
  ];
  const rawCommandLocks = [
    ...asArray(persisted.commandLocks),
    ...asArray(persisted.pendingCommands),
    ...asArray(asRecord(persisted.commands).locks),
    ...(persistedCommandReplay.commandId
      ? [{
          ...persistedCommandReplay,
          state: persistedCommandReplay.mismatch ? 'mismatch' : 'recovering',
          source: 'restart_resume'
        }]
      : [])
  ];
  const snapshotsById = new Map(rawSnapshots
    .map((snapshot) => asRecord(snapshot))
    .filter((snapshot) => typeof snapshot.artifactId === 'string' || typeof snapshot.id === 'string')
    .map((snapshot) => [String(snapshot.artifactId || snapshot.id), snapshot]));
  const commandReceipts = rawCommandReceipts
    .map((receipt) => asRecord(receipt))
    .filter((receipt) => typeof receipt.commandId === 'string' || typeof receipt.id === 'string')
    .map(normalizeCommandReceiptRecord)
    .filter((receipt, index, receipts) => (
      receipts.findIndex((candidate) => (
        candidate.commandId === receipt.commandId
        && candidate.replayKey === receipt.replayKey
        && candidate.receiptDigest === receipt.receiptDigest
      )) === index
    ))
    .slice(-25);
  const reconciledCommandLocks = reconcileCommandLocksWithReceipts(
    rawCommandLocks
      .map((lock) => asRecord(lock))
      .filter((lock) => typeof lock.commandId === 'string' || typeof lock.id === 'string')
      .map((lock) => normalizeCommandLockRecord(lock, now))
      .filter((lock) => lock.state !== 'completed'),
    commandReceipts
  );
  const activeCommandLocks = reconciledCommandLocks
    .filter((lock) => lock.receiptResolved !== true)
    .slice(-10);
  const resolvedCommandLocks = reconciledCommandLocks
    .filter((lock) => lock.receiptResolved === true)
    .slice(-10);

  return {
    contract: STATE_CONTRACT_VERSION,
    present: Object.keys(persisted).length > 0,
    generation: Number.isFinite(persisted.generation) ? Math.max(0, Math.trunc(persisted.generation)) : 0,
    recoveredAt: typeof persisted.recoveredAt === 'string' ? persisted.recoveredAt : null,
    restartResume: {
      contract: RESTART_RESUME_CONTRACT_VERSION,
      present: Object.keys(persistedRestartResume).length > 0,
      status: typeof persistedRestartResume.status === 'string' && persistedRestartResume.status
        ? persistedRestartResume.status
        : 'unknown',
      resumeMode: typeof persistedRestartResume.resumeMode === 'string' && persistedRestartResume.resumeMode
        ? persistedRestartResume.resumeMode
        : typeof persisted.restartStatus === 'string' && persisted.restartStatus
          ? persisted.restartStatus
          : 'resume_preview',
      resumeRoute: typeof persistedRestartResume.resumeRoute === 'string' && persistedRestartResume.resumeRoute
        ? persistedRestartResume.resumeRoute
        : DEFAULT_PREVIEW_ROUTE,
      resumeToken: typeof persistedRestartResume.resumeToken === 'string' && persistedRestartResume.resumeToken
        ? persistedRestartResume.resumeToken
        : null,
      restartSafe: persistedRestartResume.restartSafe !== false,
      generatedAt: normalizeIsoTimestamp(persistedRestartResume.generatedAt || persisted.persistedAt),
      activeHandoffId: typeof persistedRestartResume.activeHandoffId === 'string' && persistedRestartResume.activeHandoffId
        ? persistedRestartResume.activeHandoffId
        : null,
      providerHandoffId: typeof persistedRestartResume.providerHandoffId === 'string' && persistedRestartResume.providerHandoffId
        ? persistedRestartResume.providerHandoffId
        : null,
      lastCommandId: typeof persistedRestartResume.lastCommandId === 'string' && persistedRestartResume.lastCommandId
        ? persistedRestartResume.lastCommandId
        : null,
      lastCommandCode: typeof persistedRestartResume.lastCommandCode === 'string' && persistedRestartResume.lastCommandCode
        ? persistedRestartResume.lastCommandCode
        : null
    },
    commandReceipts,
    commandLocks: activeCommandLocks,
    resolvedCommandLocks,
    commandLockReconciliation: {
      contract: COMMAND_RECOVERY_CONTRACT_VERSION,
      total: reconciledCommandLocks.length,
      active: activeCommandLocks.length,
      receiptResolved: resolvedCommandLocks.length,
      awaitingReceipt: reconciledCommandLocks.filter((lock) => (
        lock.receiptReconciliation.state === 'awaiting_receipt'
      )).length,
      issueCodes: [...new Set(reconciledCommandLocks.flatMap((lock) => (
        lock.receiptReconciliation.issueCodes
      )))],
      resolvedCommandIds: resolvedCommandLocks.map((lock) => lock.commandId)
    },
    artifactSnapshots: artifacts.map((artifact) => {
      const snapshot = asRecord(snapshotsById.get(artifact.id));
      const snapshotProof = asRecord(snapshot.proof);
      const snapshotAddress = typeof snapshot.contentAddress === 'string' ? snapshot.contentAddress : '';
      const parsedSnapshotAddress = parseContentAddress(snapshotAddress, artifact.algorithm);
      const normalizedSnapshotAddress = parsedSnapshotAddress.normalized || snapshotAddress;
      const addressMatches = !normalizedSnapshotAddress
        || contentAddressesEquivalent(normalizedSnapshotAddress, artifact.contentAddress, artifact.algorithm);
      const proofVerified = snapshot.proofVerified === true || snapshotProof.verified === true;
      const snapshotDigest = typeof snapshot.snapshotDigest === 'string' && snapshot.snapshotDigest
        ? snapshot.snapshotDigest
        : typeof snapshot.digest === 'string' && snapshot.digest
          ? snapshot.digest
          : null;
      const currentSnapshotDigest = `${DEFAULT_ALGORITHM}:${sha256Base64Url(stableManifestJson({
        artifactId: artifact.id,
        contentAddress: artifact.contentAddress,
        accepted: snapshot.accepted === true || snapshot.status === 'accepted',
        proofVerified
      }))}`;
      const snapshotDigestMatches = !snapshotDigest || snapshotDigest === currentSnapshotDigest;

      return {
        artifactId: artifact.id,
        found: Object.keys(snapshot).length > 0,
        contentAddress: normalizedSnapshotAddress || artifact.contentAddress,
        addressMatches,
        snapshotDigest,
        currentSnapshotDigest,
        snapshotDigestMatches,
        accepted: addressMatches && (snapshot.accepted === true || snapshot.status === 'accepted'),
        proof: addressMatches && proofVerified
          ? {
              ...snapshotProof,
              verified: true,
              verifiedAt: snapshotProof.verifiedAt || snapshot.verifiedAt || null
            }
          : {},
        lastCommandId: typeof snapshot.lastCommandId === 'string' ? snapshot.lastCommandId : null,
        status: typeof snapshot.status === 'string' ? snapshot.status : 'unseen'
      };
    })
  };
}

function applyRecoveredState(artifacts, persistedState) {
  return artifacts.map((artifact) => {
    const snapshot = persistedState.artifactSnapshots.find((entry) => entry.artifactId === artifact.id);
    if (!snapshot || !snapshot.found || !snapshot.addressMatches || !snapshot.snapshotDigestMatches) {
      return {
        ...artifact,
        tamperSignals: [
          ...artifact.tamperSignals,
          ...(snapshot?.found && !snapshot.addressMatches ? ['recovered_address_mismatch'] : []),
          ...(snapshot?.found && !snapshot.snapshotDigestMatches ? ['recovered_snapshot_digest_mismatch'] : [])
        ],
        recovery: {
          restored: false,
          staleSnapshot: Boolean(snapshot && (!snapshot.addressMatches || !snapshot.snapshotDigestMatches))
        }
      };
    }

    return {
      ...artifact,
      accepted: artifact.accepted || snapshot.accepted,
      proof: {
        ...snapshot.proof,
        ...artifact.proof,
        verified: artifact.proof.verified === true || snapshot.proof.verified === true,
        verifiedAt: artifact.proof.verifiedAt || snapshot.proof.verifiedAt || null
      },
      recovery: {
        restored: snapshot.accepted || snapshot.proof.verified === true,
        staleSnapshot: false,
        lastCommandId: snapshot.lastCommandId
      }
    };
  });
}

function expectedAddressMatchesArtifact(artifact) {
  return artifact.expectedContentAddresses.some((expectedAddress) => (
    contentAddressesEquivalent(expectedAddress, artifact.contentAddress, artifact.algorithm)
  ));
}

function buildArtifactIntegrityEvidence(artifact) {
  const hasValidFormat = Boolean(
    artifact.contentAddress
    && CONTENT_ADDRESS_PATTERN.test(artifact.contentAddress)
    && artifact.digest
    && artifact.digestEncoding !== 'unknown'
    && artifact.addressFormatIssues.length === 0
  );
  const expectedAddressMatched = expectedAddressMatchesArtifact(artifact);
  const inlineContentChecked = Boolean(artifact.computedContentAddress);
  const blockers = [
    ...artifact.addressFormatIssues,
    ...(!artifact.contentAddress ? ['missing_content_address'] : []),
    ...(artifact.contentAddress && !CONTENT_ADDRESS_PATTERN.test(artifact.contentAddress) ? ['invalid_content_address'] : []),
    ...(artifact.tamperSignals.includes('computed_digest_mismatch') ? ['computed_digest_mismatch'] : []),
    ...(artifact.tamperSignals.includes('expected_digest_mismatch') ? ['expected_digest_mismatch'] : []),
    ...(artifact.tamperSignals.includes('recovered_address_mismatch') ? ['recovered_address_mismatch'] : []),
    ...(artifact.tamperSignals.includes('recovered_snapshot_digest_mismatch') ? ['recovered_snapshot_digest_mismatch'] : []),
    ...(artifact.recovery?.staleSnapshot ? ['stale_recovered_snapshot'] : []),
    ...(artifact.proof.verified === false ? ['proof_failed'] : [])
  ];
  const positiveSignals = [
    ...(artifact.addressVerifiedByInlineContent ? ['inline_content_digest_match'] : []),
    ...(expectedAddressMatched ? ['expected_digest_match'] : []),
    ...(artifact.proof.verified === true ? ['recorded_proof_verified'] : [])
  ];
  const verificationState = blockers.length > 0
    ? 'blocked'
    : positiveSignals.length > 0
      ? 'verified'
      : hasValidFormat
        ? 'address_format_only'
        : 'unverified';

  return {
    contract: ARTIFACT_INTEGRITY_EVIDENCE_CONTRACT_VERSION,
    artifactId: artifact.id,
    contentAddress: artifact.contentAddress,
    algorithm: artifact.algorithm,
    digestEncoding: artifact.digestEncoding,
    addressFormatIssues: artifact.addressFormatIssues,
    expectedDigestBytes: artifact.expectedDigestBytes,
    expectedDigestLength: artifact.expectedDigestLength,
    verificationState,
    inlineContentChecked,
    addressVerifiedByInlineContent: artifact.addressVerifiedByInlineContent,
    expectedAddressMatched,
    proofVerified: artifact.proof.verified === true,
    positiveSignals,
    blockerCodes: [...new Set(blockers)],
    canRecordProof: hasValidFormat && blockers.length === 0,
    canAccept: blockers.length === 0 && positiveSignals.length > 0,
    acceptanceRequires: positiveSignals.length > 0
      ? []
      : ['inline_content_digest_match_or_expected_digest_or_recorded_proof']
  };
}

function buildCommandIntegrityGate(artifacts, command, commandTargetScope) {
  const mutatingCommandTypes = ['accept_artifacts', 'record_proof'];
  if (!command?.present || !mutatingCommandTypes.includes(command.type)) {
    return {
      contract: ARTIFACT_INTEGRITY_EVIDENCE_CONTRACT_VERSION,
      present: false,
      allowed: true,
      commandType: command?.type || null,
      targetIds: [],
      blockedTargetIds: [],
      blockedReasonCodes: [],
      targetEvidence: []
    };
  }

  const targetIdSet = new Set(commandTargetScope.knownTargetIds || []);
  const targetEvidence = artifacts
    .filter((artifact) => targetIdSet.has(artifact.id))
    .map(buildArtifactIntegrityEvidence);
  const blockedTargets = targetEvidence.filter((evidence) => (
    command.type === 'accept_artifacts'
      ? !evidence.canAccept
      : !evidence.canRecordProof
  ));
  const blockedReasonCodes = blockedTargets.flatMap((evidence) => [
    ...evidence.blockerCodes,
    ...(command.type === 'accept_artifacts' ? evidence.acceptanceRequires : [])
  ]);

  return {
    contract: ARTIFACT_INTEGRITY_EVIDENCE_CONTRACT_VERSION,
    present: true,
    allowed: commandTargetScope.allowed && blockedTargets.length === 0,
    commandType: command.type,
    targetIds: targetEvidence.map((evidence) => evidence.artifactId),
    blockedTargetIds: blockedTargets.map((evidence) => evidence.artifactId),
    blockedReasonCodes: [...new Set(blockedReasonCodes.filter(Boolean))],
    targetEvidence
  };
}

function normalizeCommand(input) {
  const command = asRecord(input.command || input.contentAddressCommand);
  const rawArtifactIds = asArray(command.artifactIds);
  const singleArtifactId = typeof command.artifactId === 'string' && command.artifactId ? [command.artifactId] : [];
  const lifecyclePatch = asRecord(command.lifecycleSettings || command.settingsPatch || command.lifecyclePatch);
  const explicitIdempotencyKey = typeof command.idempotencyKey === 'string' && command.idempotencyKey
    ? command.idempotencyKey
    : typeof command.replayKey === 'string' && command.replayKey
      ? command.replayKey
      : null;

  return {
    contract: COMMAND_CONTRACT_VERSION,
    present: Object.keys(command).length > 0,
    commandId: typeof command.commandId === 'string' && command.commandId
      ? command.commandId
      : typeof command.id === 'string' && command.id
        ? command.id
        : explicitIdempotencyKey,
    idempotencyKey: explicitIdempotencyKey,
    type: typeof command.type === 'string' ? command.type : null,
    artifactIds: [...new Set([...singleArtifactId, ...rawArtifactIds.map(String)].filter(Boolean))],
    verifiedAt: typeof command.verifiedAt === 'string' ? command.verifiedAt : null,
    scheduledFor: normalizeIsoTimestamp(command.scheduledFor || command.nextRunAt),
    actor: typeof command.actor === 'string' && command.actor ? command.actor : null,
    lifecyclePatch
  };
}

function normalizeLifecycleSettings(input, now) {
  const settings = asRecord(
    input.lifecycleSettings
    || input.contentAddressLifecycle
    || asRecord(input.settings).contentAddressLifecycle
  );
  const schedule = asRecord(settings.schedule || settings.scanSchedule);
  const scheduledScanEnabled = normalizeBoolean(
    settings.scheduledScanEnabled ?? schedule.enabled,
    DEFAULT_LIFECYCLE_SETTINGS.scheduledScanEnabled
  );
  const rawInterval = Number(settings.scanIntervalMinutes ?? schedule.intervalMinutes);
  const scanIntervalMinutes = Number.isFinite(rawInterval)
    ? Math.trunc(rawInterval)
    : DEFAULT_LIFECYCLE_SETTINGS.scanIntervalMinutes;
  const normalizedNextRunAt = normalizeIsoTimestamp(settings.nextRunAt || schedule.nextRunAt);
  const issues = [];

  if (scanIntervalMinutes < 5 || scanIntervalMinutes > 1440) {
    issues.push({
      code: 'invalid_scan_interval',
      severity: 'error',
      message: 'Lifecycle scheduled scan interval must be between 5 and 1440 minutes.'
    });
  }

  if (scheduledScanEnabled && !normalizedNextRunAt) {
    issues.push({
      code: 'missing_next_scan_time',
      severity: 'warning',
      message: 'Lifecycle scheduling is enabled but no valid next scan time was provided.'
    });
  }

  return {
    contract: LIFECYCLE_CONTRACT_VERSION,
    enabled: normalizeBoolean(settings.enabled, DEFAULT_LIFECYCLE_SETTINGS.enabled),
    manualAcceptanceEnabled: normalizeBoolean(
      settings.manualAcceptanceEnabled,
      DEFAULT_LIFECYCLE_SETTINGS.manualAcceptanceEnabled
    ),
    proofRecordingEnabled: normalizeBoolean(
      settings.proofRecordingEnabled,
      DEFAULT_LIFECYCLE_SETTINGS.proofRecordingEnabled
    ),
    scheduledScanEnabled,
    scanIntervalMinutes: Math.min(1440, Math.max(5, scanIntervalMinutes)),
    nextRunAt: normalizedNextRunAt,
    scheduleDue: scheduledScanEnabled && normalizedNextRunAt
      ? Date.parse(normalizedNextRunAt) <= Date.parse(now)
      : false,
    updatedBy: typeof settings.updatedBy === 'string' && settings.updatedBy ? settings.updatedBy : null,
    updatedAt: normalizeIsoTimestamp(settings.updatedAt),
    issues,
    valid: !issues.some((issue) => issue.severity === 'error')
  };
}

function addMinutesIso(timestamp, minutes) {
  return new Date(Date.parse(timestamp) + minutes * 60 * 1000).toISOString();
}

function buildLifecycleSchedulePlan(settings, now, override = {}) {
  const enabled = normalizeBoolean(override.scheduledScanEnabled, settings.scheduledScanEnabled);
  const rawInterval = Number.isFinite(override.scanIntervalMinutes)
    ? override.scanIntervalMinutes
    : settings.scanIntervalMinutes;
  const intervalMinutes = Math.min(1440, Math.max(5, Math.trunc(rawInterval)));
  const requestedNextRunAt = Object.prototype.hasOwnProperty.call(override, 'nextRunAt')
    ? override.nextRunAt
    : settings.nextRunAt;
  const nextRunAt = enabled
    ? requestedNextRunAt || addMinutesIso(now, intervalMinutes)
    : null;
  const nextRunMs = nextRunAt ? Date.parse(nextRunAt) : null;
  const nowMs = Date.parse(now);
  const due = Boolean(enabled && Number.isFinite(nextRunMs) && nextRunMs <= nowMs);
  const state = !enabled
    ? 'disabled'
    : due
      ? 'due'
      : nextRunAt
        ? 'scheduled'
        : 'unscheduled';

  return {
    enabled,
    state,
    intervalMinutes,
    nextRunAt,
    due,
    overdueByMs: due && Number.isFinite(nextRunMs) && Number.isFinite(nowMs)
      ? Math.max(0, nowMs - nextRunMs)
      : 0,
    nextSuggestedRunAt: enabled
      ? due
        ? addMinutesIso(now, intervalMinutes)
        : nextRunAt
      : null
  };
}

function normalizeLifecyclePatch(command) {
  const patch = asRecord(command.lifecyclePatch);
  const schedule = asRecord(patch.schedule || patch.scanSchedule);
  const normalized = {};
  const issues = [];
  const scheduleRequested = patch.scheduledScanEnabled !== undefined
    || schedule.enabled !== undefined
    || patch.scanIntervalMinutes !== undefined
    || schedule.intervalMinutes !== undefined
    || patch.nextRunAt !== undefined
    || schedule.nextRunAt !== undefined;

  if (typeof patch.enabled === 'boolean') {
    normalized.enabled = patch.enabled;
  }

  if (typeof patch.manualAcceptanceEnabled === 'boolean') {
    normalized.manualAcceptanceEnabled = patch.manualAcceptanceEnabled;
  }

  if (typeof patch.proofRecordingEnabled === 'boolean') {
    normalized.proofRecordingEnabled = patch.proofRecordingEnabled;
  }

  if (typeof patch.scheduledScanEnabled === 'boolean' || typeof schedule.enabled === 'boolean') {
    normalized.scheduledScanEnabled = normalizeBoolean(patch.scheduledScanEnabled ?? schedule.enabled, false);
  }

  if (patch.scanIntervalMinutes !== undefined || schedule.intervalMinutes !== undefined) {
    const rawInterval = Number(patch.scanIntervalMinutes ?? schedule.intervalMinutes);
    if (!Number.isFinite(rawInterval) || rawInterval < 5 || rawInterval > 1440) {
      issues.push({
        code: 'invalid_scan_interval',
        severity: 'error',
        message: 'Lifecycle settings update must use a scan interval between 5 and 1440 minutes.'
      });
    } else {
      normalized.scanIntervalMinutes = Math.trunc(rawInterval);
    }
  }

  if (patch.nextRunAt !== undefined || schedule.nextRunAt !== undefined) {
    const nextRunAt = normalizeIsoTimestamp(patch.nextRunAt || schedule.nextRunAt);
    if (!nextRunAt) {
      issues.push({
        code: 'invalid_next_scan_time',
        severity: 'error',
        message: 'Lifecycle settings update included an invalid next scan time.'
      });
    } else {
      normalized.nextRunAt = nextRunAt;
    }
  }

  if (
    scheduleRequested
    && normalized.scheduledScanEnabled === true
    && !normalized.nextRunAt
    && (patch.nextRunAt !== undefined || schedule.nextRunAt !== undefined)
  ) {
    issues.push({
      code: 'missing_next_scan_time',
      severity: 'error',
      message: 'Lifecycle settings update cannot enable scheduled scans with an empty next scan time.'
    });
  }

  return {
    values: normalized,
    issues,
    scheduleRequested,
    present: Object.keys(normalized).length > 0 || Object.keys(patch).length > 0
  };
}

function buildLifecycleSettingsSnapshot(settings, now, override = {}) {
  const enabled = normalizeBoolean(override.enabled, settings.enabled);
  const manualAcceptanceEnabled = normalizeBoolean(
    override.manualAcceptanceEnabled,
    settings.manualAcceptanceEnabled
  );
  const proofRecordingEnabled = normalizeBoolean(
    override.proofRecordingEnabled,
    settings.proofRecordingEnabled
  );
  const scheduledScanEnabled = normalizeBoolean(
    override.scheduledScanEnabled,
    settings.scheduledScanEnabled
  );
  const scanIntervalMinutes = Math.min(1440, Math.max(
    5,
    Number.isFinite(override.scanIntervalMinutes)
      ? Math.trunc(override.scanIntervalMinutes)
      : settings.scanIntervalMinutes
  ));
  const requestedNextRunAt = Object.prototype.hasOwnProperty.call(override, 'nextRunAt')
    ? override.nextRunAt
    : settings.nextRunAt;
  const schedulePlan = buildLifecycleSchedulePlan(settings, now, {
    scheduledScanEnabled,
    scanIntervalMinutes,
    nextRunAt: requestedNextRunAt
  });
  const nextRunAt = schedulePlan.nextRunAt;
  const issues = [...settings.issues];

  return {
    ...settings,
    enabled,
    manualAcceptanceEnabled,
    proofRecordingEnabled,
    scheduledScanEnabled,
    scanIntervalMinutes,
    nextRunAt,
    scheduleDue: schedulePlan.due,
    issues: issues.filter((issue, index, allIssues) => (
      allIssues.findIndex((candidate) => candidate.code === issue.code) === index
    )),
    valid: !issues.some((issue) => issue.severity === 'error')
  };
}

function buildLifecycleMutation(command, commandResult, lifecycleSettings, boundaryContext, now) {
  const lifecycleCommandTypes = [
    'enable_lifecycle',
    'disable_lifecycle',
    'schedule_lifecycle_scan',
    'update_lifecycle_settings'
  ];
  const isLifecycleCommand = command.present && lifecycleCommandTypes.includes(command.type);
  const patch = normalizeLifecyclePatch(command);
  const nextRunFromScheduleCommand = command.type === 'schedule_lifecycle_scan'
    ? command.scheduledFor
    : undefined;
  const scheduleCommandOverride = command.type === 'schedule_lifecycle_scan'
    ? {
        scheduledScanEnabled: true,
        nextRunAt: nextRunFromScheduleCommand,
        scanIntervalMinutes: lifecycleSettings.scanIntervalMinutes
      }
    : {};
  const proposedOverride = command.type === 'enable_lifecycle'
    ? { enabled: true }
    : command.type === 'disable_lifecycle'
      ? { enabled: false }
      : command.type === 'schedule_lifecycle_scan'
        ? scheduleCommandOverride
        : command.type === 'update_lifecycle_settings'
          ? patch.values
          : {};
  const after = commandResult.applied === true && isLifecycleCommand
    ? buildLifecycleSettingsSnapshot(lifecycleSettings, now, proposedOverride)
    : lifecycleSettings;
  const fieldsChanged = Object.keys(proposedOverride).filter((key) => lifecycleSettings[key] !== after[key]);
  const beforeSchedulePlan = buildLifecycleSchedulePlan(lifecycleSettings, now);
  const afterSchedulePlan = buildLifecycleSchedulePlan(after, now);
  const auditPayload = {
    contract: LIFECYCLE_MUTATION_CONTRACT_VERSION,
    commandId: command.commandId,
    commandType: command.type,
    actor: command.actor || 'hosted-kernel',
    applied: commandResult.applied === true,
    code: commandResult.code,
    fieldsChanged,
    before: {
      enabled: lifecycleSettings.enabled,
      manualAcceptanceEnabled: lifecycleSettings.manualAcceptanceEnabled,
      proofRecordingEnabled: lifecycleSettings.proofRecordingEnabled,
      scheduledScanEnabled: lifecycleSettings.scheduledScanEnabled,
      scanIntervalMinutes: lifecycleSettings.scanIntervalMinutes,
      nextRunAt: lifecycleSettings.nextRunAt
    },
    after: {
      enabled: after.enabled,
      manualAcceptanceEnabled: after.manualAcceptanceEnabled,
      proofRecordingEnabled: after.proofRecordingEnabled,
      scheduledScanEnabled: after.scheduledScanEnabled,
      scanIntervalMinutes: after.scanIntervalMinutes,
      nextRunAt: after.nextRunAt
    }
  };

  return {
    contract: LIFECYCLE_MUTATION_CONTRACT_VERSION,
    present: isLifecycleCommand,
    generatedAt: now,
    applied: commandResult.applied === true && isLifecycleCommand,
    code: isLifecycleCommand ? commandResult.code : 'no_lifecycle_command',
    commandId: command.commandId,
    commandType: command.type,
    permission: {
      requiredGrant: 'audit',
      actorRoles: boundaryContext.actorRoles,
      allowed: boundaryContext.grants.includes('audit')
    },
    validationIssues: patch.issues,
    fieldsChanged,
    before: auditPayload.before,
    after: auditPayload.after,
    effectiveSettings: after,
    schedulePlan: {
      before: beforeSchedulePlan,
      after: afterSchedulePlan,
      enabled: afterSchedulePlan.enabled,
      state: afterSchedulePlan.state,
      intervalMinutes: afterSchedulePlan.intervalMinutes,
      nextRunAt: afterSchedulePlan.nextRunAt,
      due: afterSchedulePlan.due,
      nextSuggestedRunAt: afterSchedulePlan.nextSuggestedRunAt
    },
    auditDigest: `${DEFAULT_ALGORITHM}:${sha256Base64Url(stableManifestJson(auditPayload))}`
  };
}

function normalizeProviderContract(input) {
  const provider = asRecord(
    input.provider
    || input.contentAddressProvider
    || input.providerContract
    || asRecord(input.integration).provider
  );
  const rawCapabilities = normalizeStringList(provider.capabilities || provider.supportedCapabilities);
  const capabilities = rawCapabilities.length > 0
    ? rawCapabilities
    : ['artifact.read', 'content-address.resolve'];
  const rawMaxBatchSize = Number(provider.maxBatchSize || provider.batchSizeLimit);
  const maxBatchSize = Number.isFinite(rawMaxBatchSize)
    ? Math.max(1, Math.trunc(rawMaxBatchSize))
    : 100;
  const endpoint = typeof provider.endpoint === 'string' && provider.endpoint
    ? provider.endpoint
    : typeof provider.syncEndpoint === 'string' && provider.syncEndpoint
      ? provider.syncEndpoint
      : null;
  const handshakeId = typeof provider.handshakeId === 'string' && provider.handshakeId
    ? provider.handshakeId
    : typeof provider.connectionId === 'string' && provider.connectionId
      ? provider.connectionId
      : null;
  const requiredMissing = REQUIRED_PROVIDER_CAPABILITIES
    .filter((capability) => !capabilities.includes(capability));
  const status = typeof provider.status === 'string' && provider.status
    ? provider.status
    : requiredMissing.length === 0
      ? 'ready'
      : 'negotiation_required';

  return {
    contract: PROVIDER_CONTRACT_VERSION,
    providerId: normalizeScopedId(provider.providerId || provider.id || provider.name, DEFAULT_PROVIDER_ID),
    status,
    endpoint,
    handshakeId,
    maxBatchSize,
    capabilities,
    requiredCapabilities: REQUIRED_PROVIDER_CAPABILITIES,
    missingCapabilities: requiredMissing,
    supportsExternalHandoff: capabilities.includes('handoff.sync') && Boolean(endpoint),
    supportsProofRecording: capabilities.includes('proof.record'),
    supportsDigestResolution: capabilities.includes('content-address.resolve'),
    syncCursor: typeof provider.syncCursor === 'string' && provider.syncCursor
      ? provider.syncCursor
      : null,
    lastSyncedAt: normalizeIsoTimestamp(provider.lastSyncedAt),
    negotiatedAt: normalizeIsoTimestamp(provider.negotiatedAt),
    valid: requiredMissing.length === 0
      && (endpoint !== null || provider.localOnly === true)
  };
}

function normalizeProviderHandoffReceipts(input, providerContract, requestContext, retryPolicy, now) {
  const persisted = asRecord(input.persistedState || input.stateSnapshot || input.recoveredState);
  const persistedProvider = asRecord(persisted.providerSync || persisted.provider || persisted.contentAddressProvider);
  const provider = asRecord(
    input.provider
    || input.contentAddressProvider
    || input.providerContract
    || asRecord(input.integration).provider
  );
  const rawReceipts = [
    ...asArray(input.providerHandoffReceipts || input.externalHandoffReceipts),
    ...asArray(provider.handoffReceipts || provider.receipts),
    ...asArray(persistedProvider.handoffReceipts || persistedProvider.externalHandoffReceipts)
  ];

  return rawReceipts
    .map((receipt) => asRecord(receipt))
    .filter((receipt) => typeof receipt.handoffId === 'string' || typeof receipt.id === 'string')
    .map((receipt) => {
      const state = receipt.state === 'accepted' || receipt.state === 'completed'
        ? 'accepted'
        : receipt.state === 'failed' || receipt.state === 'rejected'
          ? 'failed'
          : receipt.state === 'in_progress'
            ? 'in_progress'
            : 'received';
      const retryAttempt = normalizeRetryAttempt(
        receipt.retryAttempt
          ?? receipt.attempt
          ?? receipt.failureCount
          ?? receipt.consecutiveFailures,
        state === 'failed' ? 1 : 0
      );
      const retryState = buildProviderReceiptRetryState({
        state,
        retryAttempt,
        retryAfter: receipt.retryAfter || receipt.nextRetryAt,
        errorCode: typeof receipt.errorCode === 'string' && receipt.errorCode
          ? receipt.errorCode
          : typeof receipt.code === 'string' && receipt.code
            ? receipt.code
            : null
      }, retryPolicy, now);

      return {
        handoffId: String(receipt.handoffId || receipt.id),
        providerId: normalizeScopedId(receipt.providerId, providerContract.providerId),
        tenantId: normalizeScopedId(receipt.tenantId, requestContext.tenantId),
        workspaceId: normalizeScopedId(receipt.workspaceId, requestContext.workspaceId),
        state,
        cursor: typeof receipt.cursor === 'string' && receipt.cursor ? receipt.cursor : null,
        receiptDigest: typeof receipt.receiptDigest === 'string' && receipt.receiptDigest
          ? receipt.receiptDigest
          : typeof receipt.digest === 'string' && receipt.digest
            ? receipt.digest
            : null,
        acknowledgedAt: normalizeIsoTimestamp(receipt.acknowledgedAt || receipt.receivedAt || receipt.completedAt),
        retryAfter: normalizeIsoTimestamp(receipt.retryAfter || receipt.nextRetryAt),
        errorCode: typeof receipt.errorCode === 'string' && receipt.errorCode
          ? receipt.errorCode
          : typeof receipt.code === 'string' && receipt.code
            ? receipt.code
            : null,
        retryAttempt,
        retryable: retryState.retryable,
        retryExhausted: retryState.exhausted,
        retryDelayMs: retryState.delayMs,
        retryPlan: retryState.retryable || retryState.exhausted
          ? {
              operation: 'sync_provider_handoff',
              attempt: retryState.attempt,
              maxAttempts: retryState.maxAttempts,
              delayMs: retryState.delayMs,
              nextRetryAt: retryState.nextRetryAt,
              backoff: 'exponential',
              exhausted: retryState.exhausted,
              degradedMode: retryState.degradedMode,
              reasonCode: retryState.reasonCode
            }
          : null
      };
    })
    .filter((receipt) => (
      receipt.providerId === providerContract.providerId
      && receipt.tenantId === requestContext.tenantId
      && receipt.workspaceId === requestContext.workspaceId
    ))
    .slice(-10);
}

function buildProviderHandoffState({
  input,
  now,
  providerContract,
  syncableArtifacts,
  blockedArtifactIds,
  proofRequiredIds,
  overflowArtifactIds,
  externalBlocked,
  handoffAction,
  acceptance,
  operationalHealth,
  requestContext,
  boundaryContext
}) {
  const artifactIds = syncableArtifacts.map((artifact) => artifact.id);
  const payload = {
    contract: PROVIDER_HANDOFF_CONTRACT_VERSION,
    providerId: providerContract.providerId,
    tenantId: requestContext.tenantId,
    workspaceId: requestContext.workspaceId,
    action: handoffAction,
    artifactIds,
    proofRequiredIds,
    blockedArtifactIds,
    overflowArtifactIds,
    manifestAccepted: acceptance.complete,
    cursor: providerContract.syncCursor
  };
  const payloadDigest = `${DEFAULT_ALGORITHM}:${sha256Base64Url(stableManifestJson(payload))}`;
  const handoffId = `${requestContext.requestId}:provider:${payloadDigest.slice(-18)}`;
  const retryPolicy = normalizeRetryPolicy(input);
  const receipts = normalizeProviderHandoffReceipts(input, providerContract, requestContext, retryPolicy, now);
  const matchingReceipt = receipts.find((receipt) => receipt.handoffId === handoffId) || null;
  const failedReceipt = matchingReceipt?.state === 'failed';
  const acceptedReceipt = matchingReceipt?.state === 'accepted';
  const retryExhausted = matchingReceipt?.retryExhausted === true;
  const retryPlan = matchingReceipt?.retryPlan || null;
  const state = externalBlocked
    ? 'blocked'
    : acceptedReceipt
      ? 'acknowledged'
      : failedReceipt && retryExhausted
        ? 'retry_exhausted'
        : failedReceipt
          ? 'retry_wait'
        : artifactIds.length === 0
          ? 'empty_batch'
          : 'ready_to_send';
  const blockedBy = [
    ...providerContract.missingCapabilities.map((capability) => `missing_capability:${capability}`),
    ...(providerContract.endpoint ? [] : ['missing_provider_endpoint']),
    ...(providerContract.capabilities.includes('handoff.sync') ? [] : ['handoff_sync_not_supported']),
    ...(operationalHealth.state === 'failing' ? ['operational_health_failing'] : []),
    ...(operationalHealth.providerHealth?.circuitBreaker?.open === true ? ['provider_circuit_breaker_open'] : []),
    ...asArray(operationalHealth.providerHealth?.incidents).map((incident) => `provider_incident:${incident.code}`),
    ...(boundaryContext.quarantinedArtifactIds.length > 0 ? ['boundary_quarantine_present'] : []),
    ...(failedReceipt && !retryExhausted ? ['provider_handoff_retry_wait'] : []),
    ...(retryExhausted ? ['provider_handoff_retry_exhausted'] : [])
  ];

  return {
    contract: PROVIDER_HANDOFF_CONTRACT_VERSION,
    handoffId,
    state,
    idempotencyKey: `${providerContract.providerId}:${payloadDigest}`,
    payloadDigest,
    action: handoffAction,
    endpoint: providerContract.supportsExternalHandoff ? providerContract.endpoint : null,
    method: 'POST',
    providerId: providerContract.providerId,
    tenantId: requestContext.tenantId,
    workspaceId: requestContext.workspaceId,
    artifactIds,
    blockedArtifactIds,
    proofRequiredIds,
    overflowArtifactIds,
    acknowledged: acceptedReceipt,
    receipt: matchingReceipt,
    receiptHistory: receipts,
    retryPolicy,
    retryPlan,
    retryAttempt: matchingReceipt?.retryAttempt || 0,
    retryExhausted,
    retryAfter: retryPlan?.nextRetryAt
      || matchingReceipt?.retryAfter
      || (failedReceipt && !retryExhausted ? addMinutesIso(now, 5) : null),
    degradedMode: retryExhausted
      ? 'provider_handoff_retry_exhausted'
      : failedReceipt
        ? 'provider_handoff_retry_wait'
        : externalBlocked
          ? 'provider_handoff_blocked'
          : null,
    actionableError: failedReceipt
      ? {
          code: retryExhausted ? 'provider_handoff_retry_exhausted' : 'provider_handoff_failed',
          message: retryExhausted
            ? `Content-address provider handoff failed after ${matchingReceipt.retryAttempt} attempt${matchingReceipt.retryAttempt === 1 ? '' : 's'}.`
            : 'Content-address provider handoff failed and is waiting for retry backoff.',
          route: DEFAULT_AUDIT_ROUTE,
          retryable: !retryExhausted,
          retryPlan
        }
      : null,
    requiredAckBy: externalBlocked || artifactIds.length === 0 || retryExhausted
      ? null
      : addMinutesIso(now, 15),
    blockedBy,
    payload
  };
}

function classifyProviderArtifactSyncState({
  artifact,
  providerContract,
  visibleArtifactIds,
  blockedArtifactIds,
  proofRequiredIds,
  syncableArtifactIds,
  overflowArtifactIds,
  validationByArtifact,
  externalBlocked
}) {
  const visible = visibleArtifactIds.has(artifact.id);
  const validationIssues = validationByArtifact.get(artifact.id) || [];
  const blockingIssueCodes = validationIssues
    .filter((issue) => issue.severity === 'error')
    .map((issue) => issue.code);
  const missingCapabilities = [
    ...(!providerContract.supportsDigestResolution ? ['content-address.resolve'] : []),
    ...(proofRequiredIds.has(artifact.id) && !providerContract.supportsProofRecording ? ['proof.record'] : []),
    ...(!providerContract.capabilities.includes('handoff.sync') ? ['handoff.sync'] : [])
  ];
  const blockedReasonCodes = [
    ...(visible ? [] : ['artifact_not_visible_for_provider_sync']),
    ...(blockedArtifactIds.has(artifact.id) ? blockingIssueCodes : []),
    ...(overflowArtifactIds.has(artifact.id) ? ['provider_batch_limit_exceeded'] : []),
    ...missingCapabilities.map((capability) => `missing_capability:${capability}`),
    ...(externalBlocked ? ['provider_handoff_blocked'] : [])
  ];
  const state = !visible
    ? 'hidden'
    : blockedArtifactIds.has(artifact.id)
      ? 'blocked'
      : overflowArtifactIds.has(artifact.id)
        ? 'deferred'
        : proofRequiredIds.has(artifact.id)
          ? providerContract.supportsProofRecording && !externalBlocked
            ? 'proof_requested'
            : 'proof_blocked'
          : syncableArtifactIds.has(artifact.id) && !externalBlocked
            ? 'sync_ready'
            : 'pending_provider';
  const operation = state === 'sync_ready'
    ? 'sync_acceptance_snapshot'
    : state === 'proof_requested'
      ? 'record_proof'
      : state === 'deferred'
        ? 'defer_to_next_batch'
        : state === 'blocked' || state === 'proof_blocked'
          ? 'resolve_provider_sync_blocker'
          : 'observe_only';
  const payload = {
    artifactId: artifact.id,
    providerId: providerContract.providerId,
    contentAddress: visible ? artifact.contentAddress : null,
    state,
    operation,
    visible,
    accepted: visible ? artifact.accepted : false,
    proofVerified: visible ? artifact.proof.verified === true : false,
    requiresProof: proofRequiredIds.has(artifact.id),
    blockingIssueCodes,
    missingCapabilities,
    blockedReasonCodes: [...new Set(blockedReasonCodes)]
  };

  return {
    ...payload,
    syncRecordDigest: `${DEFAULT_ALGORITHM}:${sha256Base64Url(stableManifestJson(payload))}`
  };
}

function buildProviderArtifactSyncRecords({
  artifacts,
  providerContract,
  validation,
  boundaryContext,
  syncableArtifacts,
  blockedArtifactIds,
  proofRequiredIds,
  overflowArtifactIds,
  externalBlocked
}) {
  const visibleArtifactIds = new Set(boundaryContext.visibleArtifactIds);
  const syncableArtifactIds = new Set(syncableArtifacts.map((artifact) => artifact.id));
  const blockedArtifactIdSet = new Set(blockedArtifactIds);
  const proofRequiredIdSet = new Set(proofRequiredIds);
  const overflowArtifactIdSet = new Set(overflowArtifactIds);
  const validationByArtifact = new Map(
    validation.byArtifact.map((entry) => [entry.artifactId, entry.issues])
  );
  const records = artifacts.map((artifact) => classifyProviderArtifactSyncState({
    artifact,
    providerContract,
    visibleArtifactIds,
    blockedArtifactIds: blockedArtifactIdSet,
    proofRequiredIds: proofRequiredIdSet,
    syncableArtifactIds,
    overflowArtifactIds: overflowArtifactIdSet,
    validationByArtifact,
    externalBlocked
  }));
  const stateCounts = records.reduce((counts, record) => ({
    ...counts,
    [record.state]: (counts[record.state] || 0) + 1
  }), {});

  return {
    records,
    stateCounts,
    capabilityGapsByArtifact: records
      .filter((record) => record.missingCapabilities.length > 0)
      .map((record) => ({
        artifactId: record.artifactId,
        missingCapabilities: record.missingCapabilities
      }))
  };
}

function buildProviderSyncContract(input, providerContract, artifacts, validation, acceptance, boundaryContext, operationalHealth, requestContext, now) {
  const visibleArtifacts = artifacts.filter((artifact) => boundaryContext.visibleArtifactIds.includes(artifact.id));
  const blockedArtifactIds = validation.byArtifact
    .filter((entry) => entry.issues.some((issue) => issue.severity === 'error'))
    .map((entry) => entry.artifactId);
  const syncableArtifacts = visibleArtifacts
    .filter((artifact) => !blockedArtifactIds.includes(artifact.id))
    .slice(0, providerContract.maxBatchSize);
  const overflowArtifactIds = visibleArtifacts
    .filter((artifact) => !syncableArtifacts.some((syncable) => syncable.id === artifact.id))
    .map((artifact) => artifact.id);
  const proofRequiredIds = visibleArtifacts
    .filter((artifact) => artifact.proof.verified !== true)
    .map((artifact) => artifact.id);
  const negotiationRequired = providerContract.missingCapabilities.length > 0 || !providerContract.valid;
  const externalBlocked = negotiationRequired
    || !providerContract.supportsExternalHandoff
    || operationalHealth.state === 'failing'
    || operationalHealth.providerHealth?.circuitBreaker?.open === true
    || boundaryContext.quarantinedArtifactIds.length > 0;
  const handoffAction = acceptance.complete
    ? 'publish_audit_proof'
    : proofRequiredIds.length > 0
      ? 'request_provider_proof_recording'
      : 'sync_acceptance_snapshot';
  const providerHandoff = buildProviderHandoffState({
    input,
    now,
    providerContract,
    syncableArtifacts,
    blockedArtifactIds,
    proofRequiredIds,
    overflowArtifactIds,
    externalBlocked,
    handoffAction,
    acceptance,
    operationalHealth,
    requestContext,
    boundaryContext
  });
  const artifactSync = buildProviderArtifactSyncRecords({
    artifacts,
    providerContract,
    validation,
    boundaryContext,
    syncableArtifacts,
    blockedArtifactIds,
    proofRequiredIds,
    overflowArtifactIds,
    externalBlocked
  });
  const negotiationPayload = {
    providerId: providerContract.providerId,
    requiredCapabilities: REQUIRED_PROVIDER_CAPABILITIES,
    acceptedCapabilities: providerContract.capabilities
      .filter((capability) => REQUIRED_PROVIDER_CAPABILITIES.includes(capability))
      .sort(),
    missingCapabilities: providerContract.missingCapabilities,
    artifactCapabilityGaps: artifactSync.capabilityGapsByArtifact
  };

  return {
    contract: PROVIDER_CONTRACT_VERSION,
    generatedAt: now,
    provider: providerContract,
    negotiation: {
      required: negotiationRequired,
      status: negotiationRequired ? 'blocked' : 'negotiated',
      missingCapabilities: providerContract.missingCapabilities,
      acceptedCapabilities: providerContract.capabilities
        .filter((capability) => REQUIRED_PROVIDER_CAPABILITIES.includes(capability)),
      capabilityGapsByArtifact: artifactSync.capabilityGapsByArtifact,
      negotiationDigest: `${DEFAULT_ALGORITHM}:${sha256Base64Url(stableManifestJson(negotiationPayload))}`,
      boundaryContract: BOUNDARY_CONTRACT_VERSION
    },
    syncMetadata: {
      cursor: providerContract.syncCursor,
      lastSyncedAt: providerContract.lastSyncedAt,
      nextCursor: `${requestContext.workspaceId}:${Date.parse(now) || 0}:${syncableArtifacts.length}`,
      batchSize: syncableArtifacts.length,
      batchLimit: providerContract.maxBatchSize,
      overflowArtifactIds,
      sourceRequestId: requestContext.requestId
    },
    artifactSync: {
      contract: `${PROVIDER_CONTRACT_VERSION}.artifact-sync.v1`,
      stateCounts: artifactSync.stateCounts,
      records: artifactSync.records
    },
    externalHandoff: {
      state: providerHandoff.state === 'acknowledged'
        ? 'acknowledged'
        : providerHandoff.state === 'retry_exhausted'
          ? 'blocked'
          : providerHandoff.state === 'retry_wait'
            ? 'retry_wait'
            : externalBlocked
              ? 'blocked'
              : acceptance.complete
                ? 'ready'
                : 'pending',
      action: handoffAction,
      endpoint: providerContract.supportsExternalHandoff ? providerContract.endpoint : null,
      method: 'POST',
      contract: PROVIDER_HANDOFF_CONTRACT_VERSION,
      tenantId: requestContext.tenantId,
      workspaceId: requestContext.workspaceId,
      handoffId: providerHandoff.handoffId,
      idempotencyKey: providerHandoff.idempotencyKey,
      payloadDigest: providerHandoff.payloadDigest,
      acknowledged: providerHandoff.acknowledged,
      requiredAckBy: providerHandoff.requiredAckBy,
      retryAfter: providerHandoff.retryAfter,
      retryAttempt: providerHandoff.retryAttempt,
      retryExhausted: providerHandoff.retryExhausted,
      retryPlan: providerHandoff.retryPlan,
      degradedMode: providerHandoff.degradedMode,
      actionableError: providerHandoff.actionableError,
      blockedBy: providerHandoff.blockedBy
    },
    handoffState: providerHandoff,
    proofRequests: proofRequiredIds.map((artifactId) => ({
      artifactId,
      providerId: providerContract.providerId,
      operation: 'record_proof',
      enabled: providerContract.supportsProofRecording && !externalBlocked
    })),
    artifactBatch: syncableArtifacts.map((artifact) => ({
      artifactId: artifact.id,
      path: artifact.path,
      contentAddress: artifact.contentAddress,
      algorithm: artifact.algorithm,
      digest: artifact.digest,
      digestEncoding: artifact.digestEncoding,
      scopeBinding: artifact.scopeBinding,
      addressFormatIssues: artifact.addressFormatIssues,
      expectedDigestBytes: artifact.expectedDigestBytes,
      expectedDigestLength: artifact.expectedDigestLength,
      addressVerifiedByInlineContent: artifact.addressVerifiedByInlineContent,
      tamperSignals: artifact.tamperSignals,
      bytes: artifact.bytes,
      accepted: artifact.accepted,
      proofVerified: artifact.proof.verified === true
    }))
  };
}

function buildCommandReplayKey(command) {
  if (!command.present || !command.commandId) {
    return null;
  }

  return `${DEFAULT_ALGORITHM}:${sha256Base64Url(stableManifestJson({
    contract: COMMAND_CONTRACT_VERSION,
    commandId: command.commandId,
    idempotencyKey: command.idempotencyKey || null,
    type: command.type,
    artifactIds: [...command.artifactIds].sort(),
    verifiedAt: command.verifiedAt,
    scheduledFor: command.scheduledFor,
    lifecyclePatch: command.lifecyclePatch
  }))}`;
}

function findRecoveredCommandRecord(command, replayKey, persistedState, now) {
  if (!command.present || !command.commandId) {
    return {
      contract: COMMAND_RECOVERY_CONTRACT_VERSION,
      state: 'not_applicable',
      safeToApply: true,
      priorReceipt: null,
      activeLock: null,
      expiredLocks: []
    };
  }

  const receipts = asArray(persistedState?.commandReceipts);
  const locks = asArray(persistedState?.commandLocks);
  const priorReceipt = receipts.find((receipt) => receipt.commandId === command.commandId)
    || (replayKey ? receipts.find((receipt) => receipt.replayKey === replayKey) : null)
    || null;
  const sameCommandLocks = locks.filter((lock) => lock.commandId === command.commandId);
  const expiredLocks = locks.filter((lock) => lock.expired === true);
  const expiredSameCommandLock = sameCommandLocks.find((lock) => lock.expired === true) || null;
  const liveSameCommandLocks = sameCommandLocks.filter((lock) => lock.expired !== true);
  const matchingLock = liveSameCommandLocks.find((lock) => !lock.replayKey || lock.replayKey === replayKey) || null;
  const conflictingLock = liveSameCommandLocks.find((lock) => lock.replayKey && lock.replayKey !== replayKey) || null;
  const activeLock = matchingLock || null;
  const restartResume = asRecord(persistedState?.restartResume);
  const restartReferencesCommand = restartResume.lastCommandId === command.commandId
    || asRecord(restartResume.commandReplay).commandId === command.commandId;
  const state = priorReceipt
    ? 'receipt_replay'
    : conflictingLock
      ? 'lock_replay_mismatch'
      : activeLock
        ? activeLock.state === 'mismatch'
          ? 'lock_replay_mismatch'
          : activeLock.state === 'blocked'
            ? 'blocked_lock_requires_recovery'
            : 'recovering_lock'
        : expiredSameCommandLock
          ? 'expired_lock_requires_receipt'
        : restartReferencesCommand && restartResume.restartSafe === false
          ? 'unsafe_restart_requires_receipt'
          : 'new_command';

  return {
    contract: COMMAND_RECOVERY_CONTRACT_VERSION,
    state,
    safeToApply: state === 'new_command' || state === 'recovering_lock',
    priorReceipt,
    activeLock,
    conflictingLock,
    expiredSameCommandLock,
    expiredLocks,
    restartResume: {
      present: restartResume.present === true,
      status: restartResume.status || 'unknown',
      resumeMode: restartResume.resumeMode || 'resume_preview',
      resumeToken: restartResume.resumeToken || null,
      restartSafe: restartResume.restartSafe !== false,
      referencesCommand: restartReferencesCommand
    }
  };
}

function applyIdempotentCommand(artifacts, command, now, boundaryContext, lifecycleSettings, persistedState = null) {
  if (!command.present) {
    return { artifacts, result: { applied: false, code: 'no_command' } };
  }

  const replayKey = buildCommandReplayKey(command);
  const recoveredCommand = findRecoveredCommandRecord(command, replayKey, persistedState, now);
  const priorReceipt = recoveredCommand.priorReceipt;

  if (priorReceipt && (!priorReceipt.replayKey || priorReceipt.replayKey === replayKey)) {
    return {
      artifacts,
      result: {
        applied: false,
        code: 'duplicate_command',
        commandId: command.commandId,
        type: command.type,
        artifactIds: priorReceipt.artifactIds,
        priorCode: priorReceipt.code,
        priorApplied: priorReceipt.applied,
        replayKey,
        resultDigest: priorReceipt.resultDigest,
        idempotent: true,
        replayedFromPersistedReceipt: true,
        recoveredCommand
      }
    };
  }

  if (priorReceipt && priorReceipt.replayKey && priorReceipt.replayKey !== replayKey) {
    return {
      artifacts,
      result: {
        applied: false,
        code: 'command_id_replay_mismatch',
        commandId: command.commandId,
        type: command.type,
        priorType: priorReceipt.commandType,
        replayKey,
        priorReplayKey: priorReceipt.replayKey,
        artifactIds: command.artifactIds,
        idempotent: false,
        recoveredCommand
      }
    };
  }

  if (recoveredCommand.state === 'lock_replay_mismatch') {
    return {
      artifacts,
      result: {
        applied: false,
        code: 'command_lock_replay_mismatch',
        commandId: command.commandId,
        type: command.type,
        replayKey,
        priorReplayKey: recoveredCommand.conflictingLock?.replayKey || recoveredCommand.activeLock?.replayKey || null,
        artifactIds: command.artifactIds,
        idempotent: false,
        recoveredCommand
      }
    };
  }

  if (recoveredCommand.state === 'unsafe_restart_requires_receipt') {
    return {
      artifacts,
      result: {
        applied: false,
        code: 'unsafe_restart_command_recovery',
        commandId: command.commandId,
        type: command.type,
        replayKey,
        artifactIds: command.artifactIds,
        idempotent: false,
        recoveredCommand
      }
    };
  }

  if (recoveredCommand.state === 'expired_lock_requires_receipt') {
    return {
      artifacts,
      result: {
        applied: false,
        code: 'expired_command_lock_requires_recovery',
        commandId: command.commandId,
        type: command.type,
        replayKey,
        artifactIds: command.artifactIds,
        expiredLockDigest: recoveredCommand.expiredSameCommandLock?.lockDigest || null,
        expiredLockRecoveryAction: recoveredCommand.expiredSameCommandLock?.recoveryAction || null,
        idempotent: false,
        recoveredCommand
      }
    };
  }

  if (recoveredCommand.state === 'blocked_lock_requires_recovery') {
    return {
      artifacts,
      result: {
        applied: false,
        code: 'blocked_command_lock_requires_recovery',
        commandId: command.commandId,
        type: command.type,
        replayKey,
        artifactIds: command.artifactIds,
        activeLockDigest: recoveredCommand.activeLock?.lockDigest || null,
        activeLockRecoveryAction: recoveredCommand.activeLock?.recoveryAction || null,
        idempotent: false,
        recoveredCommand
      }
    };
  }

  if (
    command.type === 'enable_lifecycle'
    || command.type === 'disable_lifecycle'
    || command.type === 'schedule_lifecycle_scan'
    || command.type === 'update_lifecycle_settings'
  ) {
    const lifecyclePatch = normalizeLifecyclePatch(command);
    const requiresLifecycleControl = !boundaryContext?.grants?.includes('audit');
    const missingScheduleTime = command.type === 'schedule_lifecycle_scan' && !command.scheduledFor;
    const pastScheduleTime = command.type === 'schedule_lifecycle_scan'
      && command.scheduledFor
      && Date.parse(command.scheduledFor) <= Date.parse(now);
    const emptySettingsPatch = command.type === 'update_lifecycle_settings' && !lifecyclePatch.present;
    const schedulePatchDisablesWithoutTime = command.type === 'update_lifecycle_settings'
      && lifecyclePatch.values.scheduledScanEnabled === true
      && lifecyclePatch.values.nextRunAt === undefined
      && lifecycleSettings.nextRunAt === null;
    const invalidSettingsPatch = lifecyclePatch.issues.some((issue) => issue.severity === 'error');
    const rejectedCode = requiresLifecycleControl
      ? 'permission_denied'
      : missingScheduleTime
        ? 'missing_schedule_time'
        : pastScheduleTime
          ? 'schedule_time_not_future'
          : schedulePatchDisablesWithoutTime
            ? 'missing_next_scan_time'
            : emptySettingsPatch
              ? 'empty_lifecycle_settings_patch'
              : invalidSettingsPatch
                ? 'invalid_lifecycle_settings_patch'
                : null;
    const schedulePlan = command.type === 'schedule_lifecycle_scan'
      ? buildLifecycleSchedulePlan(lifecycleSettings, now, {
          scheduledScanEnabled: true,
          scanIntervalMinutes: lifecycleSettings.scanIntervalMinutes,
          nextRunAt: command.scheduledFor
        })
      : command.type === 'update_lifecycle_settings' && lifecyclePatch.scheduleRequested
        ? buildLifecycleSchedulePlan(lifecycleSettings, now, lifecyclePatch.values)
        : null;

    return {
      artifacts,
      result: rejectedCode
        ? {
            applied: false,
            code: rejectedCode,
            commandId: command.commandId,
            type: command.type,
            requiredAction: requiresLifecycleControl ? 'audit' : null,
            actorRoles: boundaryContext?.actorRoles || [],
            replayKey,
            settingsIssues: lifecyclePatch.issues.map((issue) => issue.code),
            schedulePlan,
            recoveredCommand
          }
        : {
            applied: true,
            code: command.type,
            commandId: command.commandId,
            lifecycleEnabled: command.type === 'enable_lifecycle'
              ? true
              : command.type === 'disable_lifecycle'
                ? false
                : lifecycleSettings.enabled,
            scheduledFor: command.type === 'schedule_lifecycle_scan' ? command.scheduledFor : lifecycleSettings.nextRunAt,
            settingsPatch: command.type === 'update_lifecycle_settings' ? lifecyclePatch.values : null,
            settingsIssueCodes: lifecyclePatch.issues.map((issue) => issue.code),
            schedulePlan,
            replayKey,
            idempotent: command.type === 'schedule_lifecycle_scan'
              ? lifecycleSettings.nextRunAt === command.scheduledFor
              : command.type === 'update_lifecycle_settings'
                ? Object.keys(lifecyclePatch.values).every((key) => lifecycleSettings[key] === lifecyclePatch.values[key])
                : lifecycleSettings.enabled === (command.type === 'enable_lifecycle'),
            recoveredCommand
          }
    };
  }

  if (lifecycleSettings.enabled === false || lifecycleSettings.valid === false) {
    return {
      artifacts,
      result: {
        applied: false,
        code: lifecycleSettings.enabled === false ? 'lifecycle_disabled' : 'invalid_lifecycle_settings',
        commandId: command.commandId,
        type: command.type,
        replayKey,
        settingsIssues: lifecycleSettings.issues.map((issue) => issue.code),
        recoveredCommand
      }
    };
  }

  if (command.type === 'accept_artifacts' && lifecycleSettings.manualAcceptanceEnabled === false) {
    return {
      artifacts,
      result: {
        applied: false,
        code: 'manual_acceptance_disabled',
        commandId: command.commandId,
        type: command.type,
        replayKey,
        recoveredCommand
      }
    };
  }

  if (command.type === 'record_proof' && lifecycleSettings.proofRecordingEnabled === false) {
    return {
      artifacts,
      result: {
        applied: false,
        code: 'proof_recording_disabled',
        commandId: command.commandId,
        type: command.type,
        replayKey,
        recoveredCommand
      }
    };
  }

  const targetIds = command.artifactIds.length > 0
    ? command.artifactIds
    : artifacts.map((artifact) => artifact.id);
  const targetIdSet = new Set(targetIds);
  const commandTargetScope = buildCommandTargetScope(artifacts, command, boundaryContext);
  const deniedByBoundary = commandTargetScope.deniedTargets.map((entry) => entry.artifactId);
  const unknownArtifactIds = commandTargetScope.unknownArtifactIds;
  const commandIntegrityGate = buildCommandIntegrityGate(artifacts, command, commandTargetScope);
  const duplicateCommandIds = artifacts
    .filter((artifact) => targetIdSet.has(artifact.id) && artifact.recovery?.lastCommandId === command.commandId)
    .map((artifact) => artifact.id);

  if (command.commandId && duplicateCommandIds.length === targetIds.length && targetIds.length > 0) {
    return {
      artifacts,
      result: {
        applied: false,
        code: 'duplicate_command',
        commandId: command.commandId,
        artifactIds: duplicateCommandIds,
        replayKey,
        commandTargetScope,
        commandIntegrityGate,
        idempotent: true,
        replayedFromArtifactSnapshot: true,
        recoveredCommand
      }
    };
  }

  if (boundaryContext && !boundaryContext.commandAuthorized) {
    return {
      artifacts,
      result: {
        applied: false,
        code: 'permission_denied',
        commandId: command.commandId,
        type: command.type,
        replayKey,
        requiredAction: boundaryContext.requestedAction,
        actorRoles: boundaryContext.actorRoles,
        commandTargetScope,
        commandIntegrityGate,
        recoveredCommand
      }
    };
  }

  if (!commandTargetScope.allowed) {
    return {
      artifacts,
      result: {
        applied: false,
        code: deniedByBoundary.length > 0
          ? 'artifact_boundary_denied'
          : unknownArtifactIds.length > 0
            ? 'unknown_artifact_target'
            : 'no_artifact_targets',
        commandId: command.commandId,
        type: command.type,
        replayKey,
        deniedArtifactIds: deniedByBoundary,
        unknownArtifactIds,
        blockedReasonCodes: commandTargetScope.blockedReasonCodes,
        commandTargetScope,
        commandIntegrityGate,
        recoveredCommand
      }
    };
  }

  if (!commandIntegrityGate.allowed) {
    return {
      artifacts,
      result: {
        applied: false,
        code: 'artifact_integrity_evidence_blocked',
        commandId: command.commandId,
        type: command.type,
        replayKey,
        artifactIds: commandIntegrityGate.targetIds,
        deniedArtifactIds: commandIntegrityGate.blockedTargetIds,
        blockedReasonCodes: commandIntegrityGate.blockedReasonCodes,
        commandTargetScope,
        commandIntegrityGate,
        recoveredCommand
      }
    };
  }

  if (command.type !== 'accept_artifacts' && command.type !== 'record_proof') {
    return {
      artifacts,
      result: {
        applied: false,
        code: 'unsupported_command',
        commandId: command.commandId,
        type: command.type,
        replayKey,
        unknownArtifactIds,
        commandTargetScope,
        commandIntegrityGate,
        recoveredCommand
      }
    };
  }

  const nextArtifacts = artifacts.map((artifact) => {
    if (!targetIdSet.has(artifact.id)) {
      return artifact;
    }

    const nextProof = command.type === 'record_proof'
      ? {
          ...artifact.proof,
          verified: true,
          verifiedAt: command.verifiedAt || artifact.proof.verifiedAt || now
        }
      : artifact.proof;

    return {
      ...artifact,
      accepted: command.type === 'accept_artifacts' ? true : artifact.accepted,
      proof: nextProof,
      recovery: {
        ...artifact.recovery,
        lastCommandId: command.commandId || artifact.recovery?.lastCommandId || null
      }
    };
  });

  return {
    artifacts: nextArtifacts,
    result: {
      applied: true,
      code: command.type,
      commandId: command.commandId,
      artifactIds: targetIds.filter((artifactId) => !unknownArtifactIds.includes(artifactId)),
      unknownArtifactIds,
      commandTargetScope,
      commandIntegrityGate,
      replayKey,
      idempotent: duplicateCommandIds.length > 0 || recoveredCommand.state === 'recovering_lock',
      recoveredCommand
    }
  };
}

function validateArtifact(artifact, boundaryAccess = null) {
  const issues = [];
  const integrityEvidence = buildArtifactIntegrityEvidence(artifact);
  const addressFormatIssueMessages = {
    unsupported_content_address_algorithm: `${artifact.label} uses a content-address algorithm outside the supported digest profile set.`,
    missing_digest: `${artifact.label} has a content address without a digest payload.`,
    unsupported_digest_encoding: `${artifact.label} uses a digest encoding that cannot be decoded for integrity checks.`,
    digest_length_mismatch: `${artifact.label} digest length does not match the selected content-address algorithm.`
  };
  if (boundaryAccess?.denialCode) {
    const boundaryMessage = boundaryAccess.denialCode === 'inherited_scope_mutation_denied'
      ? `${artifact.label} inherited tenant/workspace scope and cannot be mutated without an audited scope override.`
      : `${artifact.label} is outside the active tenant/workspace or role boundary.`;
    issues.push({
      code: boundaryAccess.denialCode,
      severity: 'error',
      message: boundaryMessage
    });
  }

  if (!artifact.contentAddress) {
    issues.push({ code: 'missing_content_address', severity: 'error', message: `${artifact.label} has no content address.` });
  } else if (!CONTENT_ADDRESS_PATTERN.test(artifact.contentAddress)) {
    issues.push({ code: 'invalid_content_address', severity: 'error', message: `${artifact.label} has an invalid content-address format.` });
  }

  artifact.addressFormatIssues
    .filter((code) => code !== 'missing_content_address')
    .forEach((code) => {
      issues.push({
        code,
        severity: 'error',
        message: addressFormatIssueMessages[code] || `${artifact.label} content address cannot be validated.`
      });
    });

  if (
    artifact.computedContentAddress
    && !contentAddressesEquivalent(artifact.computedContentAddress, artifact.contentAddress, artifact.algorithm)
  ) {
    issues.push({
      code: 'computed_digest_mismatch',
      severity: 'error',
      message: `${artifact.label} content bytes do not match the supplied content address.`
    });
  }

  if (
    artifact.expectedContentAddresses.length > 0
    && !artifact.expectedContentAddresses.some((expectedAddress) => (
      contentAddressesEquivalent(expectedAddress, artifact.contentAddress, artifact.algorithm)
    ))
  ) {
    issues.push({
      code: 'expected_digest_mismatch',
      severity: 'error',
      message: `${artifact.label} content address does not match the expected digest.`
    });
  }

  if (artifact.recovery?.staleSnapshot && artifact.tamperSignals.includes('recovered_snapshot_digest_mismatch')) {
    issues.push({
      code: 'recovered_snapshot_digest_mismatch',
      severity: 'error',
      message: `${artifact.label} recovered state digest does not match the current artifact snapshot.`
    });
  }

  if (!artifact.bytes && artifact.bytes !== 0) {
    issues.push({ code: 'missing_size', severity: 'warning', message: `${artifact.label} has no byte size for preview and audit display.` });
  }

  if (artifact.proof.verified === false) {
    issues.push({ code: 'proof_failed', severity: 'error', message: `${artifact.label} has an explicit failed verification proof.` });
  }

  if (artifact.accepted && !integrityEvidence.canAccept) {
    issues.push({
      code: 'accepted_without_integrity_evidence',
      severity: 'error',
      message: `${artifact.label} is accepted without inline, expected-digest, or recorded-proof evidence.`
    });
  }

  if (!artifact.proof.verifiedAt) {
    issues.push({ code: 'proof_timestamp_missing', severity: 'warning', message: `${artifact.label} proof has no verification timestamp.` });
  }

  return issues.filter((issue, index, allIssues) => (
    allIssues.findIndex((candidate) => candidate.code === issue.code) === index
  ));
}

function normalizeRetryPolicy(input) {
  const retry = asRecord(input.retryPolicy || input.healthRetryPolicy);
  const baseDelayMs = Number.isFinite(retry.baseDelayMs)
    ? Math.max(100, Math.trunc(retry.baseDelayMs))
    : DEFAULT_RETRY_POLICY.baseDelayMs;
  const maxDelayMs = Number.isFinite(retry.maxDelayMs)
    ? Math.max(baseDelayMs, Math.trunc(retry.maxDelayMs))
    : DEFAULT_RETRY_POLICY.maxDelayMs;
  const maxAttempts = Number.isFinite(retry.maxAttempts)
    ? Math.max(1, Math.trunc(retry.maxAttempts))
    : DEFAULT_RETRY_POLICY.maxAttempts;

  return { baseDelayMs, maxDelayMs, maxAttempts };
}

function normalizeRetryAttempt(value, fallback = 0) {
  const rawAttempt = Number(value);
  return Number.isFinite(rawAttempt) ? Math.max(0, Math.trunc(rawAttempt)) : fallback;
}

function buildProviderReceiptRetryState(receipt, retryPolicy, now) {
  if (!receipt || receipt.state !== 'failed') {
    return {
      retryable: false,
      attempt: 0,
      maxAttempts: retryPolicy.maxAttempts,
      exhausted: false,
      delayMs: null,
      nextRetryAt: null,
      degradedMode: null,
      reasonCode: null
    };
  }

  const attempt = Math.max(1, normalizeRetryAttempt(
    receipt.retryAttempt
      ?? receipt.attempt
      ?? receipt.failureCount
      ?? receipt.consecutiveFailures,
    1
  ));
  const exhausted = attempt >= retryPolicy.maxAttempts;
  const delayMs = exhausted
    ? null
    : Math.min(
        retryPolicy.maxDelayMs,
        retryPolicy.baseDelayMs * (2 ** Math.max(0, attempt - 1))
      );
  const explicitRetryAt = normalizeIsoTimestamp(receipt.retryAfter || receipt.nextRetryAt);
  const nextRetryAt = exhausted
    ? null
    : explicitRetryAt || new Date(Date.parse(now) + delayMs).toISOString();

  return {
    retryable: !exhausted,
    attempt,
    maxAttempts: retryPolicy.maxAttempts,
    exhausted,
    delayMs,
    nextRetryAt,
    degradedMode: exhausted ? 'provider_handoff_retry_exhausted' : 'provider_handoff_retry_wait',
    reasonCode: receipt.errorCode || 'provider_handoff_failed'
  };
}

function normalizeOperationalFailureSignals(input, now, providerContract) {
  const persisted = asRecord(input.persistedState || input.stateSnapshot || input.recoveredState);
  const priorHealth = asRecord(input.operationalHealth || input.health || persisted.operationalHealth);
  const providerHealth = asRecord(
    input.providerHealth
    || asRecord(input.provider).health
    || asRecord(input.contentAddressProvider).health
    || priorHealth.provider
  );
  const circuit = asRecord(priorHealth.circuitBreaker || priorHealth.providerCircuitBreaker);
  const lastSyncedAtMs = providerContract.lastSyncedAt ? Date.parse(providerContract.lastSyncedAt) : null;
  const rawStaleMinutes = Number(providerHealth.staleAfterMinutes ?? priorHealth.staleAfterMinutes);
  const staleAfterMinutes = Number.isFinite(rawStaleMinutes)
    ? Math.max(5, Math.trunc(rawStaleMinutes))
    : 120;
  const providerStatusIncident = ['offline', 'unavailable', 'failing', 'failed', 'error'].includes(providerContract.status)
    ? [{
        code: 'provider_unavailable',
        severity: 'error',
        message: `Content-address provider ${providerContract.providerId} reported ${providerContract.status}.`,
        source: 'provider_status'
      }]
    : providerContract.status !== 'ready' && providerContract.status !== 'negotiation_required'
      ? [{
          code: 'provider_status_degraded',
          severity: 'warning',
          message: `Content-address provider ${providerContract.providerId} is ${providerContract.status}.`,
          source: 'provider_status'
        }]
      : [];
  const staleSyncIncident = lastSyncedAtMs
    && Date.parse(now) - lastSyncedAtMs > staleAfterMinutes * 60 * 1000
    ? [{
        code: 'provider_sync_stale',
        severity: 'warning',
        message: `Content-address provider sync is older than ${staleAfterMinutes} minutes.`,
        source: 'provider_sync'
      }]
    : [];
  const rawIncidents = [
    ...asArray(priorHealth.incidents),
    ...asArray(providerHealth.incidents),
    ...providerStatusIncident,
    ...staleSyncIncident
  ];
  const incidents = rawIncidents
    .map((incident) => asRecord(incident))
    .map((incident, index) => {
      const code = typeof incident.code === 'string' && incident.code
        ? incident.code
        : `provider_incident_${index + 1}`;
      const severity = incident.severity === 'error'
        ? 'error'
        : incident.severity === 'info'
          ? 'info'
          : 'warning';

      return {
        artifactId: typeof incident.artifactId === 'string' && incident.artifactId
          ? incident.artifactId
          : 'provider',
        code,
        severity,
        message: typeof incident.message === 'string' && incident.message
          ? incident.message
          : `Content-address provider reported ${code}.`,
        source: typeof incident.source === 'string' && incident.source ? incident.source : 'operational_health',
        observedAt: normalizeIsoTimestamp(incident.observedAt || incident.lastObservedAt) || now
      };
    });
  const consecutiveFailures = Number.isFinite(providerHealth.consecutiveFailures)
    ? Math.max(0, Math.trunc(providerHealth.consecutiveFailures))
    : Number.isFinite(circuit.consecutiveFailures)
      ? Math.max(0, Math.trunc(circuit.consecutiveFailures))
      : incidents.filter((incident) => incident.severity === 'error').length;
  const openedUntil = normalizeIsoTimestamp(circuit.openedUntil || providerHealth.circuitOpenedUntil);
  const open = Boolean(
    (openedUntil && Date.parse(openedUntil) > Date.parse(now))
    || consecutiveFailures >= DEFAULT_RETRY_POLICY.maxAttempts
  );

  return {
    incidents,
    staleAfterMinutes,
    circuitBreaker: {
      state: open ? 'open' : consecutiveFailures > 0 ? 'half_open' : 'closed',
      open,
      consecutiveFailures,
      openedUntil,
      lastFailureAt: normalizeIsoTimestamp(
        providerHealth.lastFailureAt
        || circuit.lastFailureAt
        || incidents.find((incident) => incident.severity === 'error')?.observedAt
      ),
      reasonCodes: incidents
        .filter((incident) => incident.severity === 'error')
        .map((incident) => incident.code)
    }
  };
}

function classifyIssueForOperation(issue) {
  if (issue.artifactId === 'provider' || issue.code.startsWith('provider_')) {
    return {
      operation: issue.code === 'provider_sync_stale' ? 'refresh_provider_sync' : 'recover_provider_handoff',
      retryable: issue.severity !== 'error' || issue.code === 'provider_unavailable',
      route: DEFAULT_AUDIT_ROUTE,
      degradedMode: issue.severity === 'error' ? 'provider_handoff_paused' : 'provider_handoff_delayed'
    };
  }

  if (
    issue.code === 'computed_digest_mismatch'
    || issue.code === 'expected_digest_mismatch'
    || issue.code === 'recovered_snapshot_digest_mismatch'
  ) {
    return {
      operation: 'quarantine_tampered_artifact',
      retryable: false,
      route: DEFAULT_AUDIT_ROUTE,
      degradedMode: 'tamper_review_required'
    };
  }

  if (issue.code === 'missing_content_address' || issue.code === 'invalid_content_address') {
    return {
      operation: 'resolve_digest_metadata',
      retryable: false,
      route: DEFAULT_PREVIEW_ROUTE,
      degradedMode: 'metadata_repair_required'
    };
  }

  if (
    issue.code === 'unsupported_content_address_algorithm'
    || issue.code === 'missing_digest'
    || issue.code === 'unsupported_digest_encoding'
    || issue.code === 'digest_length_mismatch'
  ) {
    return {
      operation: 'resolve_digest_metadata',
      retryable: false,
      route: DEFAULT_PREVIEW_ROUTE,
      degradedMode: 'metadata_repair_required'
    };
  }

  if (issue.code === 'proof_failed' || issue.code === 'proof_timestamp_missing') {
    return {
      operation: 'record_proof',
      retryable: issue.code !== 'proof_failed',
      route: DEFAULT_ACCEPTANCE_ROUTE,
      degradedMode: 'proof_review_required'
    };
  }

  if (
    issue.code === 'tenant_boundary_mismatch'
    || issue.code === 'workspace_boundary_mismatch'
    || issue.code === 'artifact_role_denied'
    || issue.code === 'inherited_scope_mutation_denied'
  ) {
    return {
      operation: 'request_boundary_access',
      retryable: false,
      route: DEFAULT_PREVIEW_ROUTE,
      degradedMode: 'quarantined_artifacts_hidden'
    };
  }

  if (issue.code === 'integrity_manifest_mismatch' || issue.code === 'expected_manifest_digest_invalid') {
    return {
      operation: 'rebuild_integrity_manifest',
      retryable: false,
      route: DEFAULT_AUDIT_ROUTE,
      degradedMode: 'audit_manifest_review_required'
    };
  }

  if (issue.code === 'accepted_without_integrity_evidence') {
    return {
      operation: 'record_proof',
      retryable: false,
      route: DEFAULT_ACCEPTANCE_ROUTE,
      degradedMode: 'acceptance_evidence_required'
    };
  }

  return {
    operation: 'inspect_content_address',
    retryable: issue.severity !== 'error',
    route: DEFAULT_PREVIEW_ROUTE,
    degradedMode: 'preview_only'
  };
}

function buildRetryPlan(issue, retryPolicy, now, index) {
  const classification = classifyIssueForOperation(issue);
  if (!classification.retryable) {
    return null;
  }

  const attempt = Math.min(index + 1, retryPolicy.maxAttempts);
  const delayMs = Math.min(
    retryPolicy.maxDelayMs,
    retryPolicy.baseDelayMs * (2 ** Math.max(0, attempt - 1))
  );
  const nextRetryAt = new Date(Date.parse(now) + delayMs).toISOString();

  return {
    operation: classification.operation,
    attempt,
    maxAttempts: retryPolicy.maxAttempts,
    delayMs,
    nextRetryAt,
    backoff: 'exponential'
  };
}

function buildOperationalHealth(input, now, validation, acceptance, boundaryContext, recovery, commandResult, lifecycleSettings, providerContract, integrityManifest = null) {
  const retryPolicy = normalizeRetryPolicy(input);
  const operationalSignals = normalizeOperationalFailureSignals(input, now, providerContract);
  const commandFailed = commandResult.applied === false
    && commandResult.code !== 'no_command'
    && commandResult.code !== 'duplicate_command';
  const staleRecovery = recovery.staleArtifactIds.length > 0;
  const boundaryQuarantine = boundaryContext.quarantinedArtifactIds.length > 0;
  const lifecycleBlocked = lifecycleSettings.enabled === false || lifecycleSettings.valid === false;
  const manifestIssue = integrityManifest?.issue
    ? {
        artifactId: 'integrity-manifest',
        ...integrityManifest.issue
      }
    : null;
  const blockingIssues = [
    ...validation.issues.filter((issue) => issue.severity === 'error'),
    ...operationalSignals.incidents.filter((issue) => issue.severity === 'error'),
    ...(manifestIssue ? [manifestIssue] : [])
  ];
  const warningIssues = [
    ...validation.issues.filter((issue) => issue.severity === 'warning'),
    ...operationalSignals.incidents.filter((issue) => issue.severity === 'warning')
  ];
  const actionableErrors = blockingIssues.map((issue, index) => {
    const classification = classifyIssueForOperation(issue);

    return {
      id: `${issue.artifactId}:${issue.code}`,
      artifactId: issue.artifactId,
      code: issue.code,
      severity: issue.severity,
      message: issue.message,
      route: classification.route,
      operation: classification.operation,
      retryable: classification.retryable,
      degradedMode: classification.degradedMode,
      retryPlan: buildRetryPlan(issue, retryPolicy, now, index)
    };
  });
  const retryableWarnings = warningIssues
    .map((issue, index) => ({
      issue,
      classification: classifyIssueForOperation(issue),
      retryPlan: buildRetryPlan(issue, retryPolicy, now, actionableErrors.length + index)
    }))
    .filter((entry) => entry.classification.retryable && entry.retryPlan);
  const degradedReasons = [
    ...(staleRecovery ? ['stale_recovered_snapshot'] : []),
    ...(boundaryQuarantine ? ['artifact_boundary_quarantine'] : []),
    ...(operationalSignals.circuitBreaker.open ? ['provider_circuit_breaker_open'] : []),
    ...(operationalSignals.incidents.some((incident) => incident.code === 'provider_sync_stale') ? ['provider_sync_stale'] : []),
    ...(lifecycleSettings.enabled === false ? ['lifecycle_disabled'] : []),
    ...(lifecycleSettings.valid === false ? ['invalid_lifecycle_settings'] : []),
    ...(lifecycleSettings.scheduleDue ? ['scheduled_scan_due'] : []),
    ...(warningIssues.length > 0 ? ['validation_warnings_present'] : []),
    ...(validation.checkedArtifacts === 0 ? ['no_artifacts_attached'] : [])
  ];
  const state = commandFailed || blockingIssues.length > 0 || lifecycleSettings.valid === false || operationalSignals.circuitBreaker.open
    ? 'failing'
    : lifecycleBlocked || degradedReasons.length > 0 || !acceptance.complete
      ? 'degraded'
      : 'healthy';

  return {
    contract: HEALTH_CONTRACT_VERSION,
    checkedAt: now,
    state,
    healthy: state === 'healthy',
    degraded: state === 'degraded',
    retryPolicy,
    degradedReasons,
    failureState: {
      blocked: blockingIssues.length > 0,
      commandFailed,
      lifecycleBlocked,
      lifecycleIssueCodes: lifecycleSettings.issues.map((issue) => issue.code),
      validationErrorCount: validation.errorCount,
      validationWarningCount: validation.warningCount,
      quarantinedArtifactIds: boundaryContext.quarantinedArtifactIds,
      staleArtifactIds: recovery.staleArtifactIds,
      lastCommandCode: commandResult.code || null,
      providerIncidentCodes: operationalSignals.incidents.map((incident) => incident.code),
      providerCircuitOpen: operationalSignals.circuitBreaker.open
    },
    providerHealth: {
      providerId: providerContract.providerId,
      status: providerContract.status,
      lastSyncedAt: providerContract.lastSyncedAt,
      staleAfterMinutes: operationalSignals.staleAfterMinutes,
      incidents: operationalSignals.incidents,
      circuitBreaker: operationalSignals.circuitBreaker
    },
    actionableErrors,
    retryQueue: [
      ...actionableErrors.filter((error) => error.retryPlan).map((error) => error.retryPlan),
      ...retryableWarnings.map((entry) => ({
        ...entry.retryPlan,
        artifactId: entry.issue.artifactId,
        code: entry.issue.code
      }))
    ],
    degradedMode: state === 'healthy'
      ? null
      : {
          active: true,
          readOnlyPreview: !acceptance.canAccept || blockingIssues.length > 0,
          acceptanceDisabled: !acceptance.canAccept,
          auditProofDisabled: !acceptance.complete,
          visibleArtifactIds: boundaryContext.visibleArtifactIds
        }
  };
}

function buildArtifactState(artifact, validation, boundaryContext) {
  const issues = validation.byArtifact.find((entry) => entry.artifactId === artifact.id)?.issues || [];
  const boundaryAccess = boundaryContext.artifactAccess.find((entry) => entry.artifactId === artifact.id) || null;
  const redacted = boundaryAccess?.readable === false;
  const blockers = issues.filter((issue) => issue.severity === 'error');
  const warnings = issues.filter((issue) => issue.severity === 'warning');
  const proofVerified = artifact.proof.verified === true;
  const integrityEvidence = redacted ? null : buildArtifactIntegrityEvidence(artifact);

  return {
    artifactId: artifact.id,
    path: redacted ? null : artifact.path,
    contentAddress: redacted ? null : artifact.contentAddress,
    tenantId: boundaryAccess?.tenantId || artifact.tenantId,
    workspaceId: boundaryAccess?.workspaceId || artifact.workspaceId,
    boundary: boundaryAccess
      ? {
          readable: boundaryAccess.readable,
          writable: boundaryAccess.writable,
          quarantine: boundaryAccess.quarantine,
          denialCode: boundaryAccess.denialCode
        }
      : null,
    digestAlgorithm: redacted ? null : artifact.algorithm,
    digest: redacted ? null : artifact.digest,
    digestEncoding: redacted ? null : artifact.digestEncoding,
    addressFormatIssues: redacted ? [] : artifact.addressFormatIssues,
    expectedDigestBytes: redacted ? null : artifact.expectedDigestBytes,
    expectedDigestLength: redacted ? null : artifact.expectedDigestLength,
    computedContentAddress: redacted ? null : artifact.computedContentAddress,
    expectedContentAddresses: redacted ? [] : artifact.expectedContentAddresses,
    addressVerifiedByInlineContent: !redacted && artifact.addressVerifiedByInlineContent,
    integrityEvidence,
    tamperSignals: redacted ? [] : artifact.tamperSignals,
    byteSizeKnown: !redacted && artifact.bytes !== null,
    proofVerified: !redacted && proofVerified,
    accepted: !redacted && artifact.accepted,
    status: blockers.length > 0
      ? 'blocked'
      : artifact.accepted
        ? 'accepted'
        : proofVerified
          ? 'verified_pending_acceptance'
          : 'needs_proof_review',
    issueCodes: issues.map((issue) => issue.code),
    warningCount: warnings.length,
    blockerCount: blockers.length
  };
}

function buildClientRuntimeState(
  artifacts,
  validation,
  acceptance,
  requestContext,
  boundaryContext,
  operationalHealth,
  analytics = null,
  lifecycleControls = null,
  providerSync = null,
  integrityManifest = null,
  validationSummary = null,
  nextSteps = [],
  routeReadiness = null,
  boundaryAuditHandoff = null,
  workflowHandoffState = null,
  previewAcceptanceContract = null,
  clientHandoffQueue = null
) {
  const artifactStates = artifacts.map((artifact) => buildArtifactState(artifact, validation, boundaryContext));
  const selectedArtifactState = artifactStates.find((artifact) => (
    artifact.artifactId === requestContext.selectedArtifactId
  )) || null;
  const visibleRoute = acceptance.complete
    ? DEFAULT_AUDIT_ROUTE
    : validation.ok
      ? DEFAULT_ACCEPTANCE_ROUTE
      : DEFAULT_PREVIEW_ROUTE;
  const workflowAction = acceptance.complete
    ? 'publish_audit_proof'
    : validation.ok
      ? 'request_artifact_acceptance'
      : 'resolve_content_address_blockers';
  const workflowHandoffId = `${requestContext.requestId}:${workflowAction}`;
  const completed = workflowHandoffState?.completedHandoffIds?.includes(workflowHandoffId) === true;
  const acknowledged = completed
    || workflowHandoffState?.acknowledgedHandoffIds?.includes(workflowHandoffId) === true;
  const pinnedArtifactVisible = workflowHandoffState?.pinnedArtifactId
    && artifactStates.some((artifact) => artifact.artifactId === workflowHandoffState.pinnedArtifactId);
  const dismissedIssueCodes = new Set(workflowHandoffState?.dismissedIssueCodes || []);
  const visibleBlockingIssueCodes = validation.issues
    .filter((issue) => issue.severity === 'error')
    .map((issue) => issue.code)
    .filter((code) => !dismissedIssueCodes.has(code));

  return {
    requestId: requestContext.requestId,
    sessionId: requestContext.sessionId,
    actor: requestContext.actor,
    tenantId: requestContext.tenantId,
    workspaceId: requestContext.workspaceId,
    sourceRoute: requestContext.sourceRoute,
    visibleRoute,
    selectedArtifactId: selectedArtifactState ? selectedArtifactState.artifactId : null,
    selectionIssue: requestContext.hasSelectionMismatch
      ? {
          code: 'selected_artifact_not_found',
          requestedArtifactId: requestContext.requestedArtifactId,
          fallbackArtifactId: requestContext.selectedArtifactId
        }
      : null,
    artifactStates,
    counters: {
      total: artifacts.length,
      accepted: acceptance.accepted,
      blocked: artifactStates.filter((artifact) => artifact.status === 'blocked').length,
      pendingAcceptance: artifactStates.filter((artifact) => artifact.status === 'verified_pending_acceptance').length,
      needsProofReview: artifactStates.filter((artifact) => artifact.status === 'needs_proof_review').length
    },
    boundary: {
      contract: BOUNDARY_CONTRACT_VERSION,
      visibleArtifactIds: boundaryContext.visibleArtifactIds,
      quarantinedArtifactIds: boundaryContext.quarantinedArtifactIds,
      actorRoles: boundaryContext.actorRoles,
      grants: boundaryContext.grants,
      commandTargetScope: boundaryAuditHandoff?.commandTargetScope
        ? {
            contract: boundaryAuditHandoff.commandTargetScope.contract,
            commandId: boundaryAuditHandoff.commandTargetScope.commandId,
            commandType: boundaryAuditHandoff.commandTargetScope.commandType,
            allowed: boundaryAuditHandoff.commandTargetScope.allowed,
            implicitAllArtifacts: boundaryAuditHandoff.commandTargetScope.implicitAllArtifacts,
            scopeDigest: boundaryAuditHandoff.commandTargetScope.scopeDigest,
            targetIds: boundaryAuditHandoff.commandTargetScope.targetIds,
            writableArtifactIds: boundaryAuditHandoff.commandTargetScope.writableArtifactIds,
            deniedTargetIds: boundaryAuditHandoff.commandTargetScope.deniedTargets.map((record) => record.artifactId),
            unknownArtifactIds: boundaryAuditHandoff.commandTargetScope.unknownArtifactIds,
            blockedReasonCodes: boundaryAuditHandoff.commandTargetScope.blockedReasonCodes
          }
        : null,
      auditHandoff: boundaryAuditHandoff
        ? {
            contract: boundaryAuditHandoff.contract,
            handoffId: boundaryAuditHandoff.handoffId,
            required: boundaryAuditHandoff.required,
            state: boundaryAuditHandoff.state,
            route: boundaryAuditHandoff.route,
            evidenceDigest: boundaryAuditHandoff.safeEvidence.digest,
            deniedArtifactIds: boundaryAuditHandoff.deniedRecords.map((record) => record.artifactId),
            denialCounts: boundaryAuditHandoff.denialCounts,
            redactionPolicy: boundaryAuditHandoff.redactionPolicy
          }
        : null
    },
    operationalHealth: {
      contract: HEALTH_CONTRACT_VERSION,
      state: operationalHealth.state,
      degradedReasons: operationalHealth.degradedReasons,
      actionableErrorCount: operationalHealth.actionableErrors.length,
      retryableOperationCount: operationalHealth.retryQueue.length,
      readOnlyPreview: operationalHealth.degradedMode?.readOnlyPreview === true,
      providerCircuitState: operationalHealth.providerHealth?.circuitBreaker?.state || 'closed',
      providerIncidentCodes: asArray(operationalHealth.providerHealth?.incidents).map((incident) => incident.code)
    },
    validationSummary: validationSummary
      ? {
          contract: validationSummary.contract,
          headline: validationSummary.headline,
          state: validationSummary.state,
          checkedArtifacts: validationSummary.checkedArtifacts,
          blockingCount: validationSummary.blockingCount,
          warningCount: validationSummary.warningCount,
          selectedArtifactStatus: validationSummary.selectedArtifactStatus,
          routeHighlights: validationSummary.routeHighlights
        }
      : null,
    nextStepContracts: nextSteps.map((step) => ({
      contract: step.contract,
      id: step.id,
      priority: step.priority,
      route: step.route,
      action: step.action,
      enabled: step.enabled,
      disabledReasonCodes: step.disabledReasonCodes,
      command: step.command
    })),
    routeReadiness: routeReadiness
      ? {
          contract: routeReadiness.contract,
          state: routeReadiness.state,
          ready: routeReadiness.ready,
          currentRoute: routeReadiness.currentRoute,
          primaryActionId: routeReadiness.primaryAction?.id || null,
          primaryActionEnabled: routeReadiness.primaryAction?.enabled === true,
          routePanels: routeReadiness.routePanels.map((panel) => ({
            route: panel.route,
            state: panel.state,
            enabled: panel.enabled,
            headline: panel.headline,
            ctaAction: panel.ctaAction
          })),
          validationSummary: routeReadiness.validationSummary,
          acceptanceDecision: routeReadiness.acceptanceDecision,
          proofOutputs: routeReadiness.proofOutputs
        }
      : null,
    previewAcceptance: previewAcceptanceContract
      ? {
          contract: previewAcceptanceContract.contract,
          generatedAt: previewAcceptanceContract.generatedAt,
          state: previewAcceptanceContract.state,
          selectedArtifactId: previewAcceptanceContract.selectedArtifactId,
          currentRoute: previewAcceptanceContract.currentRoute,
          preview: previewAcceptanceContract.preview,
          acceptance: previewAcceptanceContract.acceptance,
          readiness: previewAcceptanceContract.readiness,
          proof: previewAcceptanceContract.proof,
          nextSteps: previewAcceptanceContract.nextSteps
        }
      : null,
    clientHandoffQueue: clientHandoffQueue
      ? {
          contract: clientHandoffQueue.contract,
          state: clientHandoffQueue.state,
          queueDigest: clientHandoffQueue.queueDigest,
          activeItemId: clientHandoffQueue.activeItemId,
          counts: clientHandoffQueue.counts,
          reconciliation: clientHandoffQueue.reconciliation,
          items: clientHandoffQueue.items.map((item) => ({
            id: item.id,
            source: item.source,
            route: item.route,
            action: item.action,
            state: item.state,
            enabled: item.enabled,
            acknowledged: item.acknowledged,
            completed: item.completed,
            clientQueueState: item.clientQueueState,
            clientQueueIssueCodes: item.clientQueueIssueCodes,
            artifactIds: item.artifactIds,
            disabledReasonCodes: item.disabledReasonCodes,
            evidenceRefs: item.evidenceRefs,
            command: item.command
          }))
        }
      : null,
    reporting: analytics
      ? {
          contract: analytics.contract,
          exportReady: analytics.exportSummary.exportReady,
          suggestedFilename: analytics.exportSummary.suggestedFilename,
          timelineSnapshotCount: analytics.timeline.snapshots.length,
          timelineEventCount: analytics.reportingHistory.events.length,
          latestTimelineEvent: analytics.reportingHistory.latestEvent
            ? {
                type: analytics.reportingHistory.latestEvent.type,
                observedAt: analytics.reportingHistory.latestEvent.observedAt,
                digest: analytics.reportingHistory.latestEvent.digest
              }
            : null,
          reportState: analytics.reportingHistory.reportState,
          countersDigest: analytics.reportingHistory.countersDigest,
          timelineDigest: analytics.reportingHistory.timelineDigest,
          proofCoverageRatio: analytics.proofCoverage.ratio,
          tamperSummary: {
            tamperedArtifactIds: analytics.tamperSummary.tamperedArtifactIds,
            signalCounts: analytics.tamperSummary.signalCounts,
            reportableRiskCount: analytics.tamperSummary.reportableRiskCount
          },
          exportRiskCount: analytics.exportSummary.riskSummary.exportRiskByArtifact.length,
          proofRequiredArtifactIds: analytics.exportSummary.riskSummary.proofRequiredArtifactIds,
          counters: analytics.counters
        }
      : null,
    lifecycle: lifecycleControls
      ? {
          contract: lifecycleControls.contract,
          enabled: lifecycleControls.enabled,
          valid: lifecycleControls.valid,
          nextAction: lifecycleControls.nextAction,
          disabledReasonCodes: lifecycleControls.disabledReasonCodes,
          schedule: lifecycleControls.schedule
        }
      : null,
    providerSync: providerSync
      ? {
          contract: providerSync.contract,
          providerId: providerSync.provider.providerId,
          negotiationStatus: providerSync.negotiation.status,
          missingCapabilities: providerSync.negotiation.missingCapabilities,
          capabilityGapsByArtifact: providerSync.negotiation.capabilityGapsByArtifact,
          negotiationDigest: providerSync.negotiation.negotiationDigest,
          handoffState: providerSync.externalHandoff.state,
          handoffAction: providerSync.externalHandoff.action,
          handoffId: providerSync.externalHandoff.handoffId,
          handoffAcknowledged: providerSync.externalHandoff.acknowledged,
          payloadDigest: providerSync.externalHandoff.payloadDigest,
          requiredAckBy: providerSync.externalHandoff.requiredAckBy,
          retryAfter: providerSync.externalHandoff.retryAfter,
          retryAttempt: providerSync.externalHandoff.retryAttempt,
          retryExhausted: providerSync.externalHandoff.retryExhausted,
          degradedMode: providerSync.externalHandoff.degradedMode,
          actionableErrorCode: providerSync.externalHandoff.actionableError?.code || null,
          batchSize: providerSync.syncMetadata.batchSize,
          overflowArtifactIds: providerSync.syncMetadata.overflowArtifactIds,
          artifactSync: {
            contract: providerSync.artifactSync.contract,
            stateCounts: providerSync.artifactSync.stateCounts,
            records: providerSync.artifactSync.records.map((record) => ({
              artifactId: record.artifactId,
              state: record.state,
              operation: record.operation,
              visible: record.visible,
              requiresProof: record.requiresProof,
              blockedReasonCodes: record.blockedReasonCodes,
              syncRecordDigest: record.syncRecordDigest
            }))
          }
      }
      : null,
    integrityManifest: integrityManifest
      ? {
          contract: integrityManifest.contract,
          digest: integrityManifest.digest,
          expectedDigest: integrityManifest.expectedDigest,
          expectedDigestSource: integrityManifest.expectedDigestSource,
          expectedDigestFormat: integrityManifest.expectedDigestFormat,
          matchesExpected: integrityManifest.matchesExpected,
          validForAudit: integrityManifest.validForAudit,
          entryCount: integrityManifest.entryCount,
          hiddenArtifactIds: integrityManifest.hiddenArtifactIds,
          proofEnvelope: integrityManifest.validForAudit ? integrityManifest.proofEnvelope : null,
          issueCode: integrityManifest.issue?.code || null
        }
      : null,
    workflowHandoff: {
      contract: WORKFLOW_HANDOFF_STATE_CONTRACT_VERSION,
      handoffId: workflowHandoffId,
      action: workflowAction,
      status: completed
        ? 'completed'
        : acknowledged
          ? 'acknowledged'
          : 'pending',
      acknowledged,
      completed,
      staleClientAction: workflowHandoffState?.lastSeenAction
        ? workflowHandoffState.lastSeenAction !== workflowAction
        : false,
      resumeRoute: visibleRoute,
      returnToRoute: workflowHandoffState?.returnToRoute || requestContext.sourceRoute,
      focusArtifactId: pinnedArtifactVisible
        ? workflowHandoffState.pinnedArtifactId
        : selectedArtifactState?.artifactId || null,
      clientRevision: workflowHandoffState?.clientRevision || null,
      lastSeenRoute: workflowHandoffState?.lastSeenRoute || requestContext.sourceRoute,
      visibleBlockingIssueCodes,
      dismissedIssueCodes: workflowHandoffState?.dismissedIssueCodes || []
    },
    routeIntents: {
      preview: {
        route: DEFAULT_PREVIEW_ROUTE,
        enabled: artifacts.length > 0,
        selectedArtifactId: selectedArtifactState ? selectedArtifactState.artifactId : null
      },
      acceptance: {
        route: DEFAULT_ACCEPTANCE_ROUTE,
        enabled: acceptance.canAccept,
        pendingArtifactIds: artifactStates
          .filter((artifact) => artifact.status === 'verified_pending_acceptance' || artifact.status === 'needs_proof_review')
          .map((artifact) => artifact.artifactId)
      },
      auditProof: {
        route: DEFAULT_AUDIT_ROUTE,
        enabled: acceptance.complete
          && providerSync?.externalHandoff?.state !== 'retry_wait'
          && providerSync?.externalHandoff?.state !== 'blocked',
        artifactCount: artifacts.length
      },
      lifecycleSettings: {
        route: DEFAULT_PREVIEW_ROUTE,
        enabled: boundaryContext.grants.includes('audit'),
        commandTypes: ['enable_lifecycle', 'disable_lifecycle', 'schedule_lifecycle_scan']
      },
      providerHandoff: {
        route: DEFAULT_AUDIT_ROUTE,
        enabled: providerSync?.externalHandoff?.state === 'ready'
          || providerSync?.externalHandoff?.state === 'acknowledged',
        state: providerSync?.externalHandoff?.state || 'unavailable',
        action: providerSync?.externalHandoff?.action || null,
        handoffId: providerSync?.externalHandoff?.handoffId || null,
        acknowledged: providerSync?.externalHandoff?.acknowledged === true
      },
      returnToCaller: {
        route: workflowHandoffState?.returnToRoute || requestContext.sourceRoute,
        enabled: Boolean(workflowHandoffState?.returnToRoute || requestContext.sourceRoute),
        handoffStatus: completed ? 'completed' : acknowledged ? 'acknowledged' : 'pending'
      }
    }
  };
}

function buildWorkflowHandoff(
  validation,
  acceptance,
  requestContext,
  clientRuntime,
  boundaryContext,
  providerSync = null,
  workflowHandoffState = null
) {
  const blockedIssues = validation.issues.filter((issue) => issue.severity === 'error');
  const action = acceptance.complete
    ? 'publish_audit_proof'
    : validation.ok
      ? 'request_artifact_acceptance'
      : 'resolve_content_address_blockers';
  const handoffId = `${requestContext.requestId}:${action}`;
  const completed = workflowHandoffState?.completedHandoffIds?.includes(handoffId) === true;
  const acknowledged = completed || workflowHandoffState?.acknowledgedHandoffIds?.includes(handoffId) === true;
  const staleAcknowledgements = [
    ...asArray(workflowHandoffState?.acknowledgedHandoffIds),
    ...asArray(workflowHandoffState?.completedHandoffIds)
  ].filter((id) => typeof id === 'string' && id.startsWith(`${requestContext.requestId}:`) && id !== handoffId);

  return {
    id: handoffId,
    contract: WORKFLOW_HANDOFF_STATE_CONTRACT_VERSION,
    intent: requestContext.intent,
    action,
    route: clientRuntime.visibleRoute,
    readyForUser: validation.checkedArtifacts > 0 && !completed,
    selectedArtifactId: clientRuntime.selectedArtifactId,
    acknowledgement: {
      status: completed ? 'completed' : acknowledged ? 'acknowledged' : 'pending',
      acknowledged,
      acknowledgedAt: acknowledged ? workflowHandoffState?.acknowledgedAt || null : null,
      completed,
      completedAt: completed ? workflowHandoffState?.completedAt || null : null,
      staleAcknowledgementIds: staleAcknowledgements,
      clientRevision: workflowHandoffState?.clientRevision || null,
      returnToRoute: workflowHandoffState?.returnToRoute || requestContext.sourceRoute
    },
    requiredUserDecision: validation.ok && !acceptance.complete
      ? 'accept_validated_artifacts'
      : null,
    blockedBy: blockedIssues.map((issue) => ({
      artifactId: issue.artifactId,
      code: issue.code,
      route: DEFAULT_PREVIEW_ROUTE,
      message: issue.message
    })),
    proofDestination: acceptance.complete
      ? {
          route: DEFAULT_AUDIT_ROUTE,
          method: 'POST',
          contract: 'content-address-audit-proof.v1',
          tenantId: requestContext.tenantId,
          workspaceId: requestContext.workspaceId,
          boundaryContract: boundaryContext.contract
        }
      : null,
    providerDestination: providerSync
      ? {
          providerId: providerSync.provider.providerId,
          state: providerSync.externalHandoff.state,
          action: providerSync.externalHandoff.action,
          endpoint: providerSync.externalHandoff.endpoint,
          contract: providerSync.externalHandoff.contract,
          blockedBy: providerSync.externalHandoff.blockedBy,
          syncCursor: providerSync.syncMetadata.nextCursor,
          handoffId: providerSync.externalHandoff.handoffId,
          idempotencyKey: providerSync.externalHandoff.idempotencyKey,
          payloadDigest: providerSync.externalHandoff.payloadDigest,
          requiredAckBy: providerSync.externalHandoff.requiredAckBy,
          retryAfter: providerSync.externalHandoff.retryAfter,
          retryAttempt: providerSync.externalHandoff.retryAttempt,
          retryExhausted: providerSync.externalHandoff.retryExhausted,
          degradedMode: providerSync.externalHandoff.degradedMode,
          actionableError: providerSync.externalHandoff.actionableError,
          acknowledged: providerSync.externalHandoff.acknowledged
        }
      : null
  };
}

function summarizeValidation(artifacts, boundaryContext) {
  const artifactIssues = artifacts.map((artifact) => ({
    artifactId: artifact.id,
    issues: validateArtifact(
      artifact,
      boundaryContext.artifactAccess.find((entry) => entry.artifactId === artifact.id) || null
    )
  }));
  const issues = artifactIssues.flatMap(({ artifactId, issues: localIssues }) => (
    localIssues.map((issue) => ({ artifactId, ...issue }))
  ));
  const errors = issues.filter((issue) => issue.severity === 'error');
  const warnings = issues.filter((issue) => issue.severity === 'warning');

  return {
    ok: errors.length === 0,
    checkedArtifacts: artifacts.length,
    errorCount: errors.length,
    warningCount: warnings.length,
    issues,
    byArtifact: artifactIssues
  };
}

function stableManifestJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableManifestJson(entry)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableManifestJson(value[key])}`
    )).join(',')}}`;
  }

  return JSON.stringify(value);
}

function sha256Base64Url(value) {
  return createHash('sha256').update(value).digest('base64url');
}

function pickExpectedManifestDigestCandidate(input) {
  const request = asRecord(input.request || input.requestContext);
  const persisted = asRecord(input.persistedState || input.stateSnapshot || input.recoveredState);
  const manifest = asRecord(input.integrityManifest || input.contentAddressManifest || request.integrityManifest);
  const persistedManifest = asRecord(persisted.integrityManifest || persisted.contentAddressManifest);
  const persistedProofEnvelope = asRecord(persistedManifest.proofEnvelope);
  const candidates = [
    ['input.integrityManifest.digest', manifest.digest],
    ['input.integrityManifest.manifestDigest', manifest.manifestDigest],
    ['input.integrityManifest.contentAddress', manifest.contentAddress],
    ['request.expectedManifestDigest', request.expectedManifestDigest],
    ['input.expectedManifestDigest', input.expectedManifestDigest],
    ['persisted.integrityManifest.digest', persistedManifest.digest],
    ['persisted.integrityManifest.manifestDigest', persistedManifest.manifestDigest],
    ['persisted.integrityManifest.proofEnvelope.digest', persistedProofEnvelope.digest]
  ];
  const selected = candidates.find(([, value]) => typeof value === 'string' && value.trim());

  return selected
    ? { source: selected[0], raw: selected[1].trim() }
    : { source: null, raw: null };
}

function normalizeExpectedManifestReference(input) {
  const candidate = pickExpectedManifestDigestCandidate(input);

  if (!candidate.raw) {
    return {
      present: false,
      source: null,
      raw: null,
      digest: null,
      algorithm: DEFAULT_ALGORITHM,
      digestEncoding: 'unknown',
      validFormat: false,
      formatIssues: [],
      expectedDigestBytes: getDigestAlgorithmProfile(DEFAULT_ALGORITHM)?.digestBytes || null,
      expectedDigestLength: null
    };
  }

  const parsed = parseContentAddress(candidate.raw, DEFAULT_ALGORITHM);
  const formatIssues = parsed.validFormat
    ? []
    : parsed.formatIssues.length > 0
      ? parsed.formatIssues
      : ['invalid_expected_manifest_digest'];

  return {
    present: true,
    source: candidate.source,
    raw: candidate.raw,
    digest: parsed.normalized || candidate.raw,
    algorithm: parsed.algorithm,
    digestEncoding: parsed.digestEncoding,
    validFormat: parsed.validFormat,
    formatIssues: [...new Set(formatIssues)],
    expectedDigestBytes: parsed.expectedDigestBytes,
    expectedDigestLength: parsed.expectedDigestLength
  };
}

function buildIntegrityManifest(input, now, artifacts, validation, acceptance, boundaryContext, requestContext) {
  const visibleArtifactIds = new Set(boundaryContext.visibleArtifactIds);
  const expectedManifest = normalizeExpectedManifestReference(input);
  const visibleArtifacts = artifacts
    .filter((artifact) => visibleArtifactIds.has(artifact.id))
    .sort((left, right) => left.id.localeCompare(right.id));
  const entries = visibleArtifacts.map((artifact) => {
    const issues = validation.byArtifact.find((entry) => entry.artifactId === artifact.id)?.issues || [];

    return {
      artifactId: artifact.id,
      path: artifact.path,
      contentAddress: artifact.contentAddress,
      algorithm: artifact.algorithm,
      digest: artifact.digest,
      digestEncoding: artifact.digestEncoding,
      addressFormatIssues: artifact.addressFormatIssues,
      expectedDigestBytes: artifact.expectedDigestBytes,
      expectedDigestLength: artifact.expectedDigestLength,
      computedContentAddress: artifact.computedContentAddress,
      expectedContentAddresses: artifact.expectedContentAddresses,
      integrityEvidence: buildArtifactIntegrityEvidence(artifact),
      tamperSignals: artifact.tamperSignals,
      bytes: artifact.bytes,
      accepted: artifact.accepted,
      proofVerified: artifact.proof.verified === true,
      verifiedAt: artifact.proof.verifiedAt || null,
      issueCodes: issues.map((issue) => issue.code).sort()
    };
  });
  const manifestPayload = {
    contract: INTEGRITY_MANIFEST_CONTRACT_VERSION,
    tenantId: requestContext.tenantId,
    workspaceId: requestContext.workspaceId,
    artifactCount: entries.length,
    entries
  };
  const canonicalJson = stableManifestJson(manifestPayload);
  const digest = `${DEFAULT_ALGORITHM}:${sha256Base64Url(canonicalJson)}`;
  const expectedDigest = expectedManifest.digest;
  const expectedFormatInvalid = expectedManifest.present && expectedManifest.validFormat === false;
  const mismatch = Boolean(
    expectedManifest.present
    && expectedManifest.validFormat
    && !contentAddressesEquivalent(expectedDigest, digest, DEFAULT_ALGORITHM)
  );
  const expectedDigestIssue = expectedFormatInvalid
    ? {
        code: 'expected_manifest_digest_invalid',
        severity: 'error',
        expectedDigest,
        actualDigest: digest,
        source: expectedManifest.source,
        route: DEFAULT_AUDIT_ROUTE,
        message: 'The expected content-address manifest digest is malformed or uses an unsupported digest profile.'
      }
    : null;
  const mismatchIssue = mismatch
    ? {
        code: 'integrity_manifest_mismatch',
        severity: 'error',
        expectedDigest,
        actualDigest: digest,
        source: expectedManifest.source,
        route: DEFAULT_AUDIT_ROUTE,
        message: 'The recovered or requested content-address manifest digest does not match the visible artifact set.'
      }
    : null;
  const manifestIssue = expectedDigestIssue || mismatchIssue;

  return {
    contract: INTEGRITY_MANIFEST_CONTRACT_VERSION,
    generatedAt: now,
    tenantId: requestContext.tenantId,
    workspaceId: requestContext.workspaceId,
    algorithm: DEFAULT_ALGORITHM,
    digest,
    expectedDigest,
    expectedDigestSource: expectedManifest.source,
    expectedDigestFormat: {
      present: expectedManifest.present,
      valid: expectedManifest.present ? expectedManifest.validFormat : null,
      algorithm: expectedManifest.algorithm,
      digestEncoding: expectedManifest.digestEncoding,
      expectedDigestBytes: expectedManifest.expectedDigestBytes,
      expectedDigestLength: expectedManifest.expectedDigestLength,
      issueCodes: expectedManifest.formatIssues
    },
    matchesExpected: expectedManifest.present ? !expectedFormatInvalid && !mismatch : null,
    validForAudit: validation.ok && acceptance.complete && !expectedFormatInvalid && !mismatch && entries.length > 0,
    canonicalByteLength: Buffer.byteLength(canonicalJson),
    entryCount: entries.length,
    hiddenArtifactIds: artifacts
      .filter((artifact) => !visibleArtifactIds.has(artifact.id))
      .map((artifact) => artifact.id),
    issue: manifestIssue,
    mismatchIssue,
    expectedDigestIssue,
    proofEnvelope: {
      contract: 'content-address.integrity-proof-envelope.v1',
      subject: `${requestContext.tenantId}/${requestContext.workspaceId}`,
      digest,
      artifactIds: entries.map((entry) => entry.artifactId),
      acceptedArtifactIds: entries.filter((entry) => entry.accepted).map((entry) => entry.artifactId),
      generatedAt: now
    },
    entries
  };
}

function summarizeValidationForClients(validation, artifacts, acceptance, boundaryContext, requestContext, lifecycleControls, operationalHealth) {
  const selectedArtifactId = requestContext.selectedArtifactId;
  const selectedIssues = selectedArtifactId
    ? validation.byArtifact.find((entry) => entry.artifactId === selectedArtifactId)?.issues || []
    : [];
  const visibleArtifactIds = new Set(boundaryContext.visibleArtifactIds);
  const visibleArtifacts = artifacts.filter((artifact) => visibleArtifactIds.has(artifact.id));
  const issueCountsByCode = validation.issues.reduce((counts, issue) => ({
    ...counts,
    [issue.code]: (counts[issue.code] || 0) + 1
  }), {});
  const routeHighlights = [
    {
      route: DEFAULT_PREVIEW_ROUTE,
      state: validation.ok ? 'complete' : 'needs_attention',
      artifactIds: validation.issues
        .filter((issue) => issue.severity === 'error')
        .map((issue) => issue.artifactId),
      label: validation.ok ? 'Preview validation passed' : 'Resolve preview blockers'
    },
    {
      route: DEFAULT_ACCEPTANCE_ROUTE,
      state: acceptance.complete
        ? 'complete'
        : acceptance.canAccept
          ? 'ready'
          : 'blocked',
      artifactIds: visibleArtifacts
        .filter((artifact) => !artifact.accepted)
        .map((artifact) => artifact.id),
      label: acceptance.complete ? 'Acceptance complete' : 'Acceptance pending'
    },
    {
      route: DEFAULT_AUDIT_ROUTE,
      state: acceptance.complete && operationalHealth.state !== 'failing' ? 'ready' : 'blocked',
      artifactIds: visibleArtifacts.map((artifact) => artifact.id),
      label: acceptance.complete ? 'Audit proof can be published' : 'Audit proof waiting on acceptance'
    }
  ];
  const selectedArtifactStatus = selectedArtifactId
    ? {
        artifactId: selectedArtifactId,
        visible: visibleArtifactIds.has(selectedArtifactId),
        errorCodes: selectedIssues.filter((issue) => issue.severity === 'error').map((issue) => issue.code),
        warningCodes: selectedIssues.filter((issue) => issue.severity === 'warning').map((issue) => issue.code)
      }
    : null;

  return {
    contract: VALIDATION_SUMMARY_CONTRACT_VERSION,
    headline: validation.checkedArtifacts === 0
      ? 'No artifacts attached for validation.'
      : validation.ok
        ? `${visibleArtifacts.length} visible artifact${visibleArtifacts.length === 1 ? '' : 's'} passed content-address validation.`
        : `${validation.errorCount} blocking content-address issue${validation.errorCount === 1 ? '' : 's'} need attention.`,
    state: validation.ok
      ? acceptance.complete
        ? 'accepted'
        : 'valid_pending_acceptance'
      : 'blocked',
    checkedArtifacts: validation.checkedArtifacts,
    visibleArtifacts: visibleArtifacts.length,
    blockingCount: validation.errorCount,
    warningCount: validation.warningCount,
    issueCountsByCode,
    selectedArtifactStatus,
    routeHighlights,
    lifecycleGate: {
      enabled: lifecycleControls.enabled,
      valid: lifecycleControls.valid,
      nextAction: lifecycleControls.nextAction,
      disabledReasonCodes: lifecycleControls.disabledReasonCodes
    },
    healthGate: {
      state: operationalHealth.state,
      degradedReasons: operationalHealth.degradedReasons,
      retryableOperationCount: operationalHealth.retryQueue.length
    }
  };
}

function buildPreview(artifacts, boundaryContext) {
  return {
    title: 'Content-addressed artifact preview',
    empty: artifacts.length === 0,
    items: artifacts.map((artifact) => {
      const boundaryAccess = boundaryContext.artifactAccess.find((entry) => entry.artifactId === artifact.id) || {};
      const redacted = boundaryAccess.readable === false;

      return {
        artifactId: artifact.id,
        label: redacted ? 'Quarantined artifact' : artifact.label,
        path: redacted ? null : artifact.path,
        mediaType: redacted ? null : artifact.mediaType,
        bytes: redacted ? null : artifact.bytes,
        contentAddress: redacted ? null : artifact.contentAddress,
        algorithm: redacted ? null : artifact.algorithm,
        digest: redacted ? null : artifact.digest,
        digestEncoding: redacted ? null : artifact.digestEncoding,
        addressFormatIssues: redacted ? [] : artifact.addressFormatIssues,
        expectedDigestBytes: redacted ? null : artifact.expectedDigestBytes,
        expectedDigestLength: redacted ? null : artifact.expectedDigestLength,
        computedContentAddress: redacted ? null : artifact.computedContentAddress,
        expectedContentAddresses: redacted ? [] : artifact.expectedContentAddresses,
        addressVerifiedByInlineContent: !redacted && artifact.addressVerifiedByInlineContent,
        integrityEvidence: redacted ? null : buildArtifactIntegrityEvidence(artifact),
        tamperSignals: redacted ? [] : artifact.tamperSignals,
        tenantId: boundaryAccess.tenantId || artifact.tenantId,
        workspaceId: boundaryAccess.workspaceId || artifact.workspaceId,
        boundaryStatus: redacted ? boundaryAccess.denialCode : 'visible',
        verified: !redacted && artifact.proof.verified === true,
        accepted: !redacted && artifact.accepted
      };
    })
  };
}

function buildAcceptance(validation, artifacts, boundaryContext, lifecycleSettings) {
  const visibleArtifacts = artifacts.filter((artifact) => boundaryContext.visibleArtifactIds.includes(artifact.id));
  const visibleEvidence = visibleArtifacts.map(buildArtifactIntegrityEvidence);
  const acceptanceEvidenceBlocked = visibleEvidence.filter((evidence) => !evidence.canAccept);
  const acceptedCount = visibleArtifacts
    .filter((artifact) => artifact.accepted && buildArtifactIntegrityEvidence(artifact).canAccept)
    .length;
  const complete = visibleArtifacts.length > 0
    && acceptedCount === visibleArtifacts.length
    && validation.ok
    && acceptanceEvidenceBlocked.length === 0;
  const lifecycleAccepts = lifecycleSettings.enabled
    && lifecycleSettings.valid
    && lifecycleSettings.manualAcceptanceEnabled;

  return {
    required: visibleArtifacts.length,
    accepted: acceptedCount,
    pending: Math.max(0, visibleArtifacts.length - acceptedCount),
    complete,
    canAccept: lifecycleAccepts
      && validation.ok
      && visibleArtifacts.length > 0
      && acceptanceEvidenceBlocked.length === 0
      && boundaryContext.grants.includes('accept'),
    lifecycleBlocked: !lifecycleAccepts,
    boundaryBlocked: boundaryContext.quarantinedArtifactIds.length > 0,
    integrityEvidenceBlockedArtifactIds: acceptanceEvidenceBlocked.map((evidence) => evidence.artifactId),
    integrityEvidenceBlockedReasonCodes: [...new Set(acceptanceEvidenceBlocked.flatMap((evidence) => [
      ...evidence.blockerCodes,
      ...evidence.acceptanceRequires
    ]))],
    blockedBy: validation.issues
      .filter((issue) => issue.severity === 'error')
      .map((issue) => ({ artifactId: issue.artifactId, code: issue.code, message: issue.message }))
  };
}

function buildLifecycleControls(lifecycleSettings, command, commandResult, validation, acceptance, boundaryContext, now) {
  const lifecycleCommandPending = command.present
    && ['enable_lifecycle', 'disable_lifecycle', 'schedule_lifecycle_scan'].includes(command.type);
  const disabledReasonCodes = [
    ...(lifecycleSettings.enabled ? [] : ['lifecycle_disabled']),
    ...(lifecycleSettings.manualAcceptanceEnabled ? [] : ['manual_acceptance_disabled']),
    ...(lifecycleSettings.proofRecordingEnabled ? [] : ['proof_recording_disabled']),
    ...lifecycleSettings.issues.map((issue) => issue.code)
  ];
  const scheduleDue = lifecycleSettings.scheduledScanEnabled
    && lifecycleSettings.nextRunAt
    && Date.parse(lifecycleSettings.nextRunAt) <= Date.parse(now);
  const schedulePlan = buildLifecycleSchedulePlan(lifecycleSettings, now);
  const canManageLifecycle = boundaryContext.grants.includes('audit');
  const scheduleDisabledReasonCodes = [
    ...(lifecycleSettings.enabled ? [] : ['lifecycle_disabled']),
    ...(lifecycleSettings.valid ? [] : ['invalid_lifecycle_settings']),
    ...(canManageLifecycle ? [] : ['audit_permission_denied']),
    ...(lifecycleSettings.scheduledScanEnabled ? [] : ['scheduled_scan_disabled'])
  ];
  const nextAction = lifecycleSettings.valid === false
    ? 'fix_lifecycle_settings'
    : lifecycleSettings.enabled === false
      ? 'enable_lifecycle'
      : schedulePlan.due
        ? 'run_scheduled_content_address_scan'
        : validation.ok && !acceptance.complete
          ? 'accept_validated_artifacts'
          : acceptance.complete
            ? 'publish_audit_proof'
            : 'resolve_content_address_blockers';

  return {
    contract: LIFECYCLE_CONTRACT_VERSION,
    enabled: lifecycleSettings.enabled,
    valid: lifecycleSettings.valid,
    issues: lifecycleSettings.issues,
    disabledReasonCodes,
    nextAction,
    controls: {
      canEnable: !lifecycleSettings.enabled && canManageLifecycle,
      canDisable: lifecycleSettings.enabled && canManageLifecycle,
      canScheduleScan: lifecycleSettings.enabled && lifecycleSettings.valid && canManageLifecycle,
      canRunDueScan: schedulePlan.due
        && lifecycleSettings.enabled
        && lifecycleSettings.valid
        && canManageLifecycle,
      canAcceptArtifacts: acceptance.canAccept,
      canRecordProof: lifecycleSettings.enabled
        && lifecycleSettings.valid
        && lifecycleSettings.proofRecordingEnabled
        && boundaryContext.grants.includes('record_proof')
    },
    schedule: {
      enabled: lifecycleSettings.scheduledScanEnabled,
      intervalMinutes: lifecycleSettings.scanIntervalMinutes,
      nextRunAt: lifecycleSettings.nextRunAt,
      due: Boolean(scheduleDue),
      state: schedulePlan.state,
      overdueByMs: schedulePlan.overdueByMs,
      nextSuggestedRunAt: schedulePlan.nextSuggestedRunAt,
      disabledReasonCodes: scheduleDisabledReasonCodes,
      commandScheduledFor: command.type === 'schedule_lifecycle_scan' ? command.scheduledFor : null,
      commandRejectedForSchedule: command.type === 'schedule_lifecycle_scan'
        && commandResult.applied === false
        && [
          'missing_schedule_time',
          'schedule_time_not_future'
        ].includes(commandResult.code)
    },
    commandState: lifecycleCommandPending
      ? {
          commandId: command.commandId,
          type: command.type,
          applied: commandResult.applied === true,
          code: commandResult.code,
          idempotent: commandResult.idempotent === true
        }
      : null
  };
}

function makeNextStep({
  id,
  label,
  reason,
  route,
  action,
  priority,
  enabled,
  disabledReasonCodes = [],
  artifactIds = [],
  command = null,
  evidenceRefs = []
}) {
  return {
    contract: NEXT_STEP_CONTRACT_VERSION,
    id,
    label,
    reason,
    route,
    action,
    priority,
    enabled,
    disabledReasonCodes,
    artifactIds,
    command,
    evidenceRefs
  };
}

function buildNextSteps(validation, acceptance, boundaryContext = null, lifecycleControls = null, providerSync = null, operationalHealth = null, integrityManifest = null) {
  if (lifecycleControls?.valid === false) {
    return [makeNextStep({
      id: 'fix-lifecycle-settings',
      label: 'Fix content-address lifecycle settings',
      reason: lifecycleControls.issues.map((issue) => issue.message).join(' '),
      route: DEFAULT_PREVIEW_ROUTE,
      action: 'update_lifecycle_settings',
      priority: 10,
      enabled: lifecycleControls.controls.canScheduleScan || lifecycleControls.controls.canEnable,
      disabledReasonCodes: lifecycleControls.disabledReasonCodes,
      evidenceRefs: lifecycleControls.issues.map((issue) => `lifecycle:${issue.code}`)
    })];
  }

  if (lifecycleControls?.enabled === false) {
    return [makeNextStep({
      id: 'enable-lifecycle',
      label: 'Enable content-address lifecycle',
      reason: 'Lifecycle controls are disabled, so artifact acceptance and proof recording are paused.',
      route: DEFAULT_PREVIEW_ROUTE,
      action: 'enable_lifecycle',
      priority: 20,
      enabled: lifecycleControls.controls.canEnable,
      disabledReasonCodes: lifecycleControls.disabledReasonCodes,
      command: lifecycleControls.controls.canEnable
        ? { type: 'enable_lifecycle' }
        : null,
      evidenceRefs: ['lifecycle:lifecycle_disabled']
    })];
  }

  if (lifecycleControls?.schedule?.due) {
    return [makeNextStep({
      id: 'run-scheduled-content-address-scan',
      label: 'Run scheduled content-address scan',
      reason: 'The configured lifecycle scan is due for this workspace.',
      route: DEFAULT_PREVIEW_ROUTE,
      action: 'run_scheduled_scan',
      priority: 30,
      enabled: lifecycleControls.controls.canRunDueScan,
      disabledReasonCodes: lifecycleControls.controls.canRunDueScan ? [] : lifecycleControls.schedule.disabledReasonCodes,
      command: lifecycleControls.controls.canRunDueScan
        ? {
            type: 'schedule_lifecycle_scan',
            scheduledFor: lifecycleControls.schedule.nextSuggestedRunAt,
            previousDueAt: lifecycleControls.schedule.nextRunAt
          }
        : null,
      evidenceRefs: ['lifecycle:scheduled_scan_due']
    })];
  }

  if (validation.checkedArtifacts === 0) {
    return [makeNextStep({
      id: 'attach-artifacts',
      label: 'Attach artifacts for content-address validation',
      reason: 'No artifacts were provided to the content-address surface.',
      route: DEFAULT_PREVIEW_ROUTE,
      action: 'attach_artifacts',
      priority: 40,
      enabled: true,
      evidenceRefs: ['validation:no_artifacts_attached']
    })];
  }

  if (integrityManifest?.issue) {
    return [makeNextStep({
      id: 'rebuild-integrity-manifest',
      label: 'Rebuild content-address integrity manifest',
      reason: integrityManifest.issue.message,
      route: DEFAULT_AUDIT_ROUTE,
      action: 'rebuild_integrity_manifest',
      priority: 45,
      enabled: boundaryContext?.grants?.includes('audit') === true,
      disabledReasonCodes: boundaryContext?.grants?.includes('audit') === true ? [] : ['audit_permission_denied'],
      artifactIds: boundaryContext?.visibleArtifactIds || [],
      evidenceRefs: [
        `manifest:expected:${integrityManifest.expectedDigest}`,
        `manifest:actual:${integrityManifest.digest}`
      ]
    })];
  }

  if (!validation.ok) {
    return validation.issues
      .filter((issue) => issue.severity === 'error')
      .map((issue, index) => makeNextStep({
        id: `resolve-${issue.code}`,
        artifactId: issue.artifactId,
        label: 'Resolve blocking content-address validation issue',
        reason: issue.message,
        route: classifyIssueForOperation(issue).route,
        action: classifyIssueForOperation(issue).operation,
        priority: 50 + index,
        enabled: true,
        artifactIds: [issue.artifactId],
        evidenceRefs: [`validation:${issue.artifactId}:${issue.code}`]
      }));
  }

  if (!acceptance.canAccept && boundaryContext?.grants && !boundaryContext.grants.includes('accept')) {
    return [makeNextStep({
      id: 'request-acceptance-role',
      label: 'Request artifact acceptance permission',
      reason: 'The current actor can preview artifacts but cannot accept the validated content-address set.',
      route: DEFAULT_ACCEPTANCE_ROUTE,
      action: 'request_acceptance_role',
      priority: 60,
      enabled: true,
      disabledReasonCodes: ['accept_permission_denied'],
      evidenceRefs: ['boundary:missing_accept_grant']
    })];
  }

  if (!acceptance.complete) {
    if (acceptance.integrityEvidenceBlockedArtifactIds?.length > 0) {
      return [makeNextStep({
        id: 'record-integrity-evidence',
        label: 'Record content-address integrity evidence',
        reason: 'Artifact acceptance requires inline digest match, expected digest match, or recorded proof evidence.',
        route: DEFAULT_ACCEPTANCE_ROUTE,
        action: 'record_proof',
        priority: 65,
        enabled: lifecycleControls?.controls?.canRecordProof === true,
        disabledReasonCodes: lifecycleControls?.controls?.canRecordProof === true
          ? []
          : ['proof_recording_not_available'],
        artifactIds: acceptance.integrityEvidenceBlockedArtifactIds,
        command: lifecycleControls?.controls?.canRecordProof === true
          ? { type: 'record_proof', artifactIds: acceptance.integrityEvidenceBlockedArtifactIds }
          : null,
        evidenceRefs: acceptance.integrityEvidenceBlockedArtifactIds.map((artifactId) => (
          `integrity-evidence:${artifactId}`
        ))
      })];
    }

    return [makeNextStep({
      id: 'accept-verified-artifacts',
      label: 'Accept validated artifact set',
      reason: `${acceptance.pending} artifact${acceptance.pending === 1 ? '' : 's'} still need acceptance.`,
      route: DEFAULT_ACCEPTANCE_ROUTE,
      action: 'accept_artifacts',
      priority: 70,
      enabled: acceptance.canAccept,
      disabledReasonCodes: acceptance.canAccept ? [] : ['acceptance_not_available'],
      artifactIds: boundaryContext?.visibleArtifactIds || [],
      command: acceptance.canAccept
        ? { type: 'accept_artifacts', artifactIds: boundaryContext?.visibleArtifactIds || [] }
        : null,
      evidenceRefs: ['acceptance:pending']
    })];
  }

  return [makeNextStep({
    id: 'publish-audit-proof',
    label: 'Publish content-address audit proof',
    reason: providerSync?.externalHandoff?.state === 'blocked'
      ? 'All artifacts are accepted, but provider handoff must be negotiated before external sync.'
      : providerSync?.externalHandoff?.state === 'retry_wait'
        ? 'All artifacts are accepted, but provider handoff is waiting for retry backoff.'
        : 'All artifacts are validated and accepted.',
    route: DEFAULT_AUDIT_ROUTE,
    action: providerSync?.externalHandoff?.action || 'publish_audit_proof',
    priority: 80,
    enabled: operationalHealth?.state !== 'failing'
      && providerSync?.externalHandoff?.state !== 'blocked'
      && providerSync?.externalHandoff?.state !== 'retry_wait',
    disabledReasonCodes: [
      ...(operationalHealth?.state === 'failing' ? ['operational_health_failing'] : []),
      ...(providerSync?.externalHandoff?.state === 'retry_wait' ? ['provider_handoff_retry_wait'] : []),
      ...asArray(providerSync?.externalHandoff?.blockedBy)
    ],
    artifactIds: boundaryContext?.visibleArtifactIds || [],
    evidenceRefs: ['audit:accepted_artifacts']
  })];
}

function buildRouteReadinessContract({
  now,
  preview,
  validation,
  acceptance,
  validationSummary,
  nextSteps,
  boundaryContext,
  lifecycleControls,
  providerSync,
  integrityManifest,
  operationalHealth,
  requestContext
}) {
  const primaryAction = nextSteps.find((step) => step.enabled) || nextSteps[0] || null;
  const blockedIssueCodes = validation.issues
    .filter((issue) => issue.severity === 'error')
    .map((issue) => issue.code);
  const visibleArtifactIds = boundaryContext.visibleArtifactIds;
  const acceptanceDisabledReasonCodes = [
    ...(acceptance.canAccept ? [] : ['acceptance_not_ready']),
    ...(lifecycleControls.enabled ? [] : ['lifecycle_disabled']),
    ...(lifecycleControls.valid ? [] : ['invalid_lifecycle_settings']),
    ...(boundaryContext.grants.includes('accept') ? [] : ['accept_permission_denied']),
    ...acceptance.integrityEvidenceBlockedReasonCodes,
    ...blockedIssueCodes,
    ...acceptance.blockedBy.map((issue) => issue.code)
  ];
  const uniqueAcceptanceDisabledReasons = [...new Set(acceptanceDisabledReasonCodes)];
  const auditDisabledReasonCodes = [
    ...(acceptance.complete ? [] : ['acceptance_incomplete']),
    ...(integrityManifest.validForAudit ? [] : ['integrity_manifest_not_audit_ready']),
    ...(operationalHealth.state === 'failing' ? ['operational_health_failing'] : []),
    ...(providerSync.externalHandoff.state === 'retry_wait' ? ['provider_handoff_retry_wait'] : []),
    ...asArray(providerSync.externalHandoff.blockedBy)
  ];
  const providerHandoffPaused = acceptance.complete
    && (
      providerSync.externalHandoff.state === 'retry_wait'
      || providerSync.externalHandoff.state === 'blocked'
    );
  const routePanels = [
    {
      route: DEFAULT_PREVIEW_ROUTE,
      state: validation.ok ? 'complete' : 'needs_attention',
      enabled: preview.empty === false,
      headline: preview.empty
        ? 'Attach artifacts to start content-address preview.'
        : validationSummary.headline,
      ctaAction: validation.ok ? 'continue_to_acceptance' : 'resolve_validation_issues',
      artifactIds: preview.items.map((item) => item.artifactId),
      issueCodes: blockedIssueCodes
    },
    {
      route: DEFAULT_ACCEPTANCE_ROUTE,
      state: acceptance.complete
        ? 'complete'
        : acceptance.canAccept
          ? 'ready'
          : 'blocked',
      enabled: acceptance.canAccept || acceptance.complete,
      headline: acceptance.complete
        ? 'All visible artifacts are accepted.'
        : `${acceptance.pending} artifact${acceptance.pending === 1 ? '' : 's'} pending acceptance.`,
      ctaAction: acceptance.complete ? 'view_audit_proof' : 'accept_artifacts',
      artifactIds: visibleArtifactIds,
      disabledReasonCodes: acceptance.canAccept ? [] : uniqueAcceptanceDisabledReasons
    },
    {
      route: DEFAULT_AUDIT_ROUTE,
      state: acceptance.complete
        && integrityManifest.validForAudit
        && !providerHandoffPaused
        ? 'ready'
        : 'blocked',
      enabled: acceptance.complete
        && integrityManifest.validForAudit
        && operationalHealth.state !== 'failing'
        && !providerHandoffPaused,
      headline: integrityManifest.validForAudit
        ? 'Integrity manifest is ready for audit proof.'
        : 'Audit proof is waiting on validation, acceptance, or manifest repair.',
      ctaAction: providerSync.externalHandoff.action,
      artifactIds: visibleArtifactIds,
      disabledReasonCodes: [...new Set(auditDisabledReasonCodes)]
    }
  ];
  const currentRoute = acceptance.complete
    ? DEFAULT_AUDIT_ROUTE
    : validation.ok
      ? DEFAULT_ACCEPTANCE_ROUTE
      : DEFAULT_PREVIEW_ROUTE;

  return {
    contract: ROUTE_READINESS_CONTRACT_VERSION,
    generatedAt: now,
    state: operationalHealth.state === 'failing'
      ? 'blocked'
      : providerHandoffPaused
        ? 'blocked'
      : acceptance.complete
        ? 'audit_ready'
        : validation.ok
          ? 'acceptance_ready'
          : 'preview_blocked',
    ready: acceptance.complete
      && integrityManifest.validForAudit
      && operationalHealth.state !== 'failing'
      && !providerHandoffPaused,
    currentRoute,
    request: {
      requestId: requestContext.requestId,
      tenantId: requestContext.tenantId,
      workspaceId: requestContext.workspaceId,
      selectedArtifactId: requestContext.selectedArtifactId
    },
    validationSummary: {
      contract: validationSummary.contract,
      state: validationSummary.state,
      headline: validationSummary.headline,
      blockingCount: validationSummary.blockingCount,
      warningCount: validationSummary.warningCount,
      selectedArtifactStatus: validationSummary.selectedArtifactStatus
    },
    acceptanceDecision: {
      required: acceptance.required,
      accepted: acceptance.accepted,
      pending: acceptance.pending,
      canAccept: acceptance.canAccept,
      command: acceptance.canAccept
        ? { type: 'accept_artifacts', artifactIds: visibleArtifactIds }
        : null,
      integrityEvidenceBlockedArtifactIds: acceptance.integrityEvidenceBlockedArtifactIds,
      integrityEvidenceBlockedReasonCodes: acceptance.integrityEvidenceBlockedReasonCodes,
      disabledReasonCodes: acceptance.canAccept ? [] : uniqueAcceptanceDisabledReasons
    },
    proofOutputs: {
      route: DEFAULT_AUDIT_ROUTE,
      exportReady: integrityManifest.validForAudit
        && operationalHealth.state !== 'failing'
        && !providerHandoffPaused,
      manifestDigest: integrityManifest.digest,
      proofEnvelope: integrityManifest.validForAudit ? integrityManifest.proofEnvelope : null,
      providerHandoffState: providerSync.externalHandoff.state,
      providerHandoffAction: providerSync.externalHandoff.action,
      providerBlockedBy: providerSync.externalHandoff.blockedBy,
      providerRetryAfter: providerSync.externalHandoff.retryAfter,
      providerRetryAttempt: providerSync.externalHandoff.retryAttempt,
      providerRetryExhausted: providerSync.externalHandoff.retryExhausted
    },
    primaryAction,
    routePanels,
    nextStepQueue: nextSteps.map((step) => ({
      id: step.id,
      route: step.route,
      action: step.action,
      enabled: step.enabled,
      priority: step.priority,
      disabledReasonCodes: step.disabledReasonCodes,
      evidenceRefs: step.evidenceRefs
    }))
  };
}

function buildPreviewAcceptanceClientContract({
  now,
  preview,
  acceptance,
  validationSummary,
  routeReadiness,
  nextSteps,
  boundaryAuditHandoff,
  providerSync,
  integrityManifest,
  requestContext
}) {
  const selectedArtifact = preview.items.find((item) => (
    item.artifactId === requestContext.selectedArtifactId
  )) || preview.items[0] || null;
  const previewRows = preview.items.map((item) => ({
    artifactId: item.artifactId,
    label: item.label,
    path: item.path,
    mediaType: item.mediaType,
    bytes: item.bytes,
    digestAlgorithm: item.algorithm,
    digest: item.digest,
    digestEncoding: item.digestEncoding,
    addressFormatIssues: item.addressFormatIssues,
    expectedDigestBytes: item.expectedDigestBytes,
    expectedDigestLength: item.expectedDigestLength,
    contentAddress: item.contentAddress,
    computedContentAddress: item.computedContentAddress,
    expectedContentAddresses: item.expectedContentAddresses,
    addressVerifiedByInlineContent: item.addressVerifiedByInlineContent,
    integrityEvidence: item.integrityEvidence,
    tamperSignals: item.tamperSignals,
    visible: item.boundaryStatus === 'visible',
    boundaryStatus: item.boundaryStatus,
    proofState: item.verified ? 'verified' : 'missing_or_pending',
    acceptanceState: item.accepted ? 'accepted' : 'pending'
  }));
  const primaryNextStep = nextSteps.find((step) => step.enabled) || nextSteps[0] || null;
  const acceptanceDisabledReasonCodes = routeReadiness.acceptanceDecision.disabledReasonCodes;
  const proofOutput = routeReadiness.proofOutputs;

  return {
    contract: PREVIEW_ACCEPTANCE_CONTRACT_VERSION,
    generatedAt: now,
    state: routeReadiness.state,
    currentRoute: routeReadiness.currentRoute,
    selectedArtifactId: selectedArtifact?.artifactId || null,
    request: {
      requestId: requestContext.requestId,
      tenantId: requestContext.tenantId,
      workspaceId: requestContext.workspaceId,
      actor: requestContext.actor,
      sourceRoute: requestContext.sourceRoute
    },
    preview: {
      route: DEFAULT_PREVIEW_ROUTE,
      title: preview.title,
      empty: preview.empty,
      visibleCount: previewRows.filter((row) => row.visible).length,
      hiddenCount: previewRows.filter((row) => !row.visible).length,
      selected: selectedArtifact
        ? {
            artifactId: selectedArtifact.artifactId,
            label: selectedArtifact.label,
            path: selectedArtifact.path,
            contentAddress: selectedArtifact.contentAddress,
            digestAlgorithm: selectedArtifact.algorithm,
            digest: selectedArtifact.digest,
            digestEncoding: selectedArtifact.digestEncoding,
            addressFormatIssues: selectedArtifact.addressFormatIssues,
            expectedDigestBytes: selectedArtifact.expectedDigestBytes,
            expectedDigestLength: selectedArtifact.expectedDigestLength,
            computedContentAddress: selectedArtifact.computedContentAddress,
            addressVerifiedByInlineContent: selectedArtifact.addressVerifiedByInlineContent,
            integrityEvidence: selectedArtifact.integrityEvidence,
            tamperSignals: selectedArtifact.tamperSignals,
            verified: selectedArtifact.verified,
            accepted: selectedArtifact.accepted,
            boundaryStatus: selectedArtifact.boundaryStatus
          }
        : null,
      rows: previewRows
    },
    validation: {
      contract: validationSummary.contract,
      state: validationSummary.state,
      headline: validationSummary.headline,
      checkedArtifacts: validationSummary.checkedArtifacts,
      visibleArtifacts: validationSummary.visibleArtifacts,
      blockingCount: validationSummary.blockingCount,
      warningCount: validationSummary.warningCount,
      selectedArtifactStatus: validationSummary.selectedArtifactStatus,
      issueCountsByCode: validationSummary.issueCountsByCode,
      routeHighlights: validationSummary.routeHighlights
    },
    acceptance: {
      route: DEFAULT_ACCEPTANCE_ROUTE,
      required: acceptance.required,
      accepted: acceptance.accepted,
      pending: acceptance.pending,
      complete: acceptance.complete,
      canAccept: acceptance.canAccept,
      command: routeReadiness.acceptanceDecision.command,
      disabledReasonCodes: acceptanceDisabledReasonCodes,
      integrityEvidenceBlockedArtifactIds: acceptance.integrityEvidenceBlockedArtifactIds,
      integrityEvidenceBlockedReasonCodes: acceptance.integrityEvidenceBlockedReasonCodes,
      decisionSummary: acceptance.complete
        ? 'accepted'
        : acceptance.canAccept
          ? 'ready_for_user_acceptance'
          : 'blocked'
    },
    readiness: {
      contract: routeReadiness.contract,
      ready: routeReadiness.ready,
      state: routeReadiness.state,
      primaryActionId: routeReadiness.primaryAction?.id || null,
      primaryActionEnabled: routeReadiness.primaryAction?.enabled === true,
      routePanels: routeReadiness.routePanels.map((panel) => ({
        route: panel.route,
        state: panel.state,
        enabled: panel.enabled,
        ctaAction: panel.ctaAction,
        disabledReasonCodes: panel.disabledReasonCodes || []
      }))
    },
    proof: {
      route: DEFAULT_AUDIT_ROUTE,
      exportReady: proofOutput.exportReady,
      manifestDigest: proofOutput.manifestDigest,
      manifestContract: integrityManifest.contract,
      providerHandoffState: proofOutput.providerHandoffState,
      providerHandoffAction: proofOutput.providerHandoffAction,
      providerBlockedBy: proofOutput.providerBlockedBy,
      providerRetryAfter: proofOutput.providerRetryAfter,
      providerRetryAttempt: proofOutput.providerRetryAttempt,
      providerRetryExhausted: proofOutput.providerRetryExhausted,
      providerHandoffId: providerSync.externalHandoff.handoffId,
      boundaryHandoffRequired: boundaryAuditHandoff.required,
      boundaryEvidenceDigest: boundaryAuditHandoff.safeEvidence.digest
    },
    nextSteps: nextSteps.map((step) => ({
      contract: step.contract,
      id: step.id,
      label: step.label,
      reason: step.reason,
      route: step.route,
      action: step.action,
      priority: step.priority,
      enabled: step.enabled,
      disabledReasonCodes: step.disabledReasonCodes,
      artifactIds: step.artifactIds,
      command: step.command,
      evidenceRefs: step.evidenceRefs,
      primary: primaryNextStep?.id === step.id
    }))
  };
}

function buildClientWorkflowHandoffQueue({
  input,
  now,
  requestContext,
  workflowHandoffState,
  routeReadiness,
  nextSteps,
  boundaryAuditHandoff,
  providerSync,
  operationalHealth
}) {
  const clientQueueState = normalizeClientHandoffQueueState(input, requestContext);
  const priorItemsById = new Map(clientQueueState.items.map((item) => [item.id, item]));
  const acknowledgedIds = new Set(workflowHandoffState?.acknowledgedHandoffIds || []);
  const completedIds = new Set(workflowHandoffState?.completedHandoffIds || []);
  const baseItems = nextSteps.map((step) => ({
    id: `${requestContext.requestId}:next-step:${step.id}`,
    source: 'next_step',
    route: step.route,
    action: step.action,
    priority: step.priority,
    enabled: step.enabled,
    state: step.enabled ? 'ready' : 'blocked',
    artifactIds: step.artifactIds,
    disabledReasonCodes: step.disabledReasonCodes,
    evidenceRefs: step.evidenceRefs,
    command: step.command
  }));
  const boundaryItem = boundaryAuditHandoff?.required
    ? {
        id: boundaryAuditHandoff.handoffId,
        source: 'boundary_audit',
        route: boundaryAuditHandoff.route,
        action: 'review_boundary_quarantine',
        priority: 15,
        enabled: true,
        state: boundaryAuditHandoff.state,
        artifactIds: boundaryAuditHandoff.deniedRecords.map((record) => record.artifactId),
        disabledReasonCodes: [],
        evidenceRefs: [`boundary:${boundaryAuditHandoff.safeEvidence.digest}`],
        command: null
      }
    : null;
  const providerHandoff = providerSync?.externalHandoff;
  const providerItem = providerHandoff
    ? {
        id: providerHandoff.handoffId,
        source: 'provider_handoff',
        route: DEFAULT_AUDIT_ROUTE,
        action: providerHandoff.action,
        priority: providerHandoff.state === 'ready' ? 85 : 95,
        enabled: providerHandoff.state === 'ready' || providerHandoff.state === 'acknowledged',
        state: providerHandoff.state,
        artifactIds: providerSync.handoffState?.artifactIds || [],
        disabledReasonCodes: providerHandoff.blockedBy,
        evidenceRefs: [
          `provider:${providerSync.provider.providerId}`,
          `payload:${providerHandoff.payloadDigest}`
        ],
        command: providerHandoff.state === 'ready'
          ? {
              type: 'sync_provider_handoff',
              handoffId: providerHandoff.handoffId,
              idempotencyKey: providerHandoff.idempotencyKey
            }
          : null
      }
    : null;
  const items = [...baseItems, boundaryItem, providerItem]
    .filter(Boolean)
    .map((item) => {
      const priorItem = priorItemsById.get(item.id) || null;
      const completed = completedIds.has(item.id) || priorItem?.completed === true;
      const acknowledged = completed
        || acknowledgedIds.has(item.id)
        || priorItem?.acknowledged === true
        || item.state === 'acknowledged';
      const clientRouteChanged = Boolean(priorItem?.route && priorItem.route !== item.route);
      const clientActionChanged = Boolean(priorItem?.action && priorItem.action !== item.action);
      const priorEvidenceRefs = new Set(priorItem?.evidenceRefs || []);
      const missingEvidenceRefs = item.evidenceRefs.filter((ref) => !priorEvidenceRefs.has(ref));

      return {
        ...item,
        acknowledged,
        completed,
        clientQueueState: priorItem
          ? completed
            ? 'completed'
            : acknowledged
              ? 'acknowledged'
              : clientRouteChanged || clientActionChanged || missingEvidenceRefs.length > 0
                ? 'stale'
                : 'current'
          : clientQueueState.present
            ? 'missing_from_client'
            : 'new',
        clientQueueIssueCodes: [
          ...(clientRouteChanged ? ['client_route_changed'] : []),
          ...(clientActionChanged ? ['client_action_changed'] : []),
          ...(missingEvidenceRefs.length > 0 ? ['client_evidence_refs_stale'] : [])
        ],
        resumeRoute: acknowledged && !completed
          ? priorItem?.route || workflowHandoffState?.lastSeenRoute || item.route
          : item.route,
        returnToRoute: priorItem?.returnToRoute || workflowHandoffState?.returnToRoute || requestContext.sourceRoute,
        clientUpdatedAt: priorItem?.updatedAt || null
      };
    })
    .sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id));
  const activeItem = items.find((item) => item.enabled && !item.completed)
    || items.find((item) => !item.completed)
    || null;
  const currentItemIds = new Set(items.map((item) => item.id));
  const unexpectedClientItems = clientQueueState.items
    .filter((item) => !currentItemIds.has(item.id))
    .map((item) => ({
      id: item.id,
      source: item.source,
      route: item.route,
      action: item.action,
      state: item.state,
      acknowledged: item.acknowledged,
      completed: item.completed,
      artifactIds: item.artifactIds,
      evidenceRefs: item.evidenceRefs
    }));
  const staleItems = items.filter((item) => (
    item.clientQueueState === 'stale' || item.clientQueueState === 'missing_from_client'
  ));
  const queueDigest = `${DEFAULT_ALGORITHM}:${sha256Base64Url(stableManifestJson(items.map((item) => ({
    id: item.id,
    source: item.source,
    state: item.state,
    acknowledged: item.acknowledged,
    completed: item.completed,
    clientQueueState: item.clientQueueState,
    evidenceRefs: item.evidenceRefs
  }))))}`;
  const digestChanged = Boolean(clientQueueState.queueDigest && clientQueueState.queueDigest !== queueDigest);

  return {
    contract: CLIENT_HANDOFF_QUEUE_CONTRACT_VERSION,
    generatedAt: now,
    requestId: requestContext.requestId,
    tenantId: requestContext.tenantId,
    workspaceId: requestContext.workspaceId,
    currentRoute: routeReadiness.currentRoute,
    healthState: operationalHealth.state,
    queueDigest,
    activeItemId: activeItem?.id || null,
    state: activeItem
      ? activeItem.enabled
        ? 'action_required'
        : 'blocked'
      : 'complete',
    counts: {
      total: items.length,
      ready: items.filter((item) => item.enabled && !item.completed).length,
      blocked: items.filter((item) => !item.enabled && !item.completed).length,
      acknowledged: items.filter((item) => item.acknowledged).length,
      completed: items.filter((item) => item.completed).length
    },
    reconciliation: {
      contract: CLIENT_HANDOFF_QUEUE_RECONCILIATION_CONTRACT_VERSION,
      clientQueuePresent: clientQueueState.present,
      clientQueueDigest: clientQueueState.queueDigest,
      serverQueueDigest: queueDigest,
      digestChanged,
      activeItemChanged: clientQueueState.activeItemId !== null && clientQueueState.activeItemId !== activeItem?.id,
      clientActiveItemId: clientQueueState.activeItemId,
      serverActiveItemId: activeItem?.id || null,
      staleItemIds: staleItems.map((item) => item.id),
      missingClientItemIds: items
        .filter((item) => item.clientQueueState === 'missing_from_client')
        .map((item) => item.id),
      unexpectedClientItemIds: unexpectedClientItems.map((item) => item.id),
      issueCodes: [
        ...(digestChanged ? ['client_queue_digest_changed'] : []),
        ...(staleItems.length > 0 ? ['client_queue_items_stale'] : []),
        ...(unexpectedClientItems.length > 0 ? ['client_queue_has_retired_items'] : []),
        ...(clientQueueState.activeItemId !== null && clientQueueState.activeItemId !== activeItem?.id
          ? ['client_active_handoff_changed']
          : [])
      ],
      unexpectedClientItems
    },
    items
  };
}

function buildRecoveryReport(persistedState, artifacts) {
  const restoredArtifactIds = artifacts
    .filter((artifact) => artifact.recovery?.restored)
    .map((artifact) => artifact.id);
  const staleArtifactIds = artifacts
    .filter((artifact) => artifact.recovery?.staleSnapshot)
    .map((artifact) => artifact.id);

  return {
    contract: STATE_CONTRACT_VERSION,
    restored: restoredArtifactIds.length > 0,
    restoredArtifactIds,
    staleArtifactIds,
    restartSafe: staleArtifactIds.length === 0
      && persistedState.restartResume.restartSafe !== false
      && persistedState.commandLocks.every((lock) => lock.restartSafe !== false && lock.state !== 'mismatch'),
    generation: persistedState.generation,
    recoveredAt: persistedState.recoveredAt,
    restartResume: persistedState.restartResume,
    commandLockRecovery: {
      contract: COMMAND_RECOVERY_CONTRACT_VERSION,
      total: persistedState.commandLocks.length,
      restartSafe: persistedState.commandLocks.filter((lock) => lock.restartSafe).length,
      expired: persistedState.commandLocks.filter((lock) => lock.expired).length,
      blocked: persistedState.commandLocks.filter((lock) => lock.recoveryAction === 'require_operator_review').length,
      receiptResolved: persistedState.commandLockReconciliation?.receiptResolved || 0,
      awaitingReceipt: persistedState.commandLockReconciliation?.awaitingReceipt || 0,
      reconciliationIssueCodes: persistedState.commandLockReconciliation?.issueCodes || [],
      resolvedCommandIds: persistedState.commandLockReconciliation?.resolvedCommandIds || [],
      recoveryRequiredCommandIds: persistedState.commandLocks
        .filter((lock) => lock.restartSafe === false)
        .map((lock) => lock.commandId)
    },
    resolvedCommandLocks: asArray(persistedState.resolvedCommandLocks).map((lock) => ({
      contract: lock.contract,
      commandId: lock.commandId,
      commandType: lock.commandType,
      replayKey: lock.replayKey,
      artifactIds: lock.artifactIds,
      expired: lock.expired,
      restartSafe: lock.restartSafe,
      recoveryAction: lock.recoveryAction,
      recoveryIssueCodes: lock.recoveryIssueCodes,
      lockDigest: lock.lockDigest,
      receiptReconciliation: lock.receiptReconciliation,
      source: lock.source
    })),
    pendingCommandLocks: persistedState.commandLocks.map((lock) => ({
      contract: lock.contract,
      commandId: lock.commandId,
      commandType: lock.commandType,
      state: lock.state,
      replayKey: lock.replayKey,
      artifactIds: lock.artifactIds,
      expired: lock.expired,
      restartSafe: lock.restartSafe,
      recoveryAction: lock.recoveryAction,
      recoveryIssueCodes: lock.recoveryIssueCodes,
      lockDigest: lock.lockDigest,
      receiptReconciliation: lock.receiptReconciliation,
      expiresAt: lock.expiresAt,
      source: lock.source
    }))
  };
}

function normalizePriorAnalyticsSnapshots(input, requestContext) {
  const persisted = asRecord(input.persistedState || input.stateSnapshot || input.recoveredState);
  const analytics = asRecord(persisted.analytics || persisted.reporting);
  const rawSnapshots = [
    ...asArray(input.analyticsSnapshots || input.analyticsHistory),
    ...asArray(analytics.snapshots || analytics.timeline),
    ...asArray(persisted.analyticsSnapshots)
  ];

  return rawSnapshots
    .map((snapshot) => asRecord(snapshot))
    .filter((snapshot) => typeof snapshot.checkedAt === 'string' || typeof snapshot.generatedAt === 'string')
    .map((snapshot, index) => ({
      snapshotId: typeof snapshot.snapshotId === 'string' && snapshot.snapshotId
        ? snapshot.snapshotId
        : `${requestContext.requestId}:recovered-${index + 1}`,
      checkedAt: snapshot.checkedAt || snapshot.generatedAt,
      tenantId: normalizeScopedId(snapshot.tenantId, requestContext.tenantId),
      workspaceId: normalizeScopedId(snapshot.workspaceId, requestContext.workspaceId),
      totalArtifacts: Number.isFinite(snapshot.totalArtifacts) ? Math.max(0, Math.trunc(snapshot.totalArtifacts)) : 0,
      acceptedArtifacts: Number.isFinite(snapshot.acceptedArtifacts) ? Math.max(0, Math.trunc(snapshot.acceptedArtifacts)) : 0,
      verifiedArtifacts: Number.isFinite(snapshot.verifiedArtifacts) ? Math.max(0, Math.trunc(snapshot.verifiedArtifacts)) : 0,
      blockedArtifacts: Number.isFinite(snapshot.blockedArtifacts) ? Math.max(0, Math.trunc(snapshot.blockedArtifacts)) : 0,
      quarantinedArtifacts: Number.isFinite(snapshot.quarantinedArtifacts) ? Math.max(0, Math.trunc(snapshot.quarantinedArtifacts)) : 0,
      tamperedArtifacts: Number.isFinite(snapshot.tamperedArtifacts) ? Math.max(0, Math.trunc(snapshot.tamperedArtifacts)) : 0,
      inlineVerifiedArtifacts: Number.isFinite(snapshot.inlineVerifiedArtifacts)
        ? Math.max(0, Math.trunc(snapshot.inlineVerifiedArtifacts))
        : 0,
      expectedDigestMatchedArtifacts: Number.isFinite(snapshot.expectedDigestMatchedArtifacts)
        ? Math.max(0, Math.trunc(snapshot.expectedDigestMatchedArtifacts))
        : 0,
      proofRequiredArtifacts: Number.isFinite(snapshot.proofRequiredArtifacts)
        ? Math.max(0, Math.trunc(snapshot.proofRequiredArtifacts))
        : 0,
      missingSizeArtifacts: Number.isFinite(snapshot.missingSizeArtifacts)
        ? Math.max(0, Math.trunc(snapshot.missingSizeArtifacts))
        : 0,
      validationErrors: Number.isFinite(snapshot.validationErrors) ? Math.max(0, Math.trunc(snapshot.validationErrors)) : 0,
      validationWarnings: Number.isFinite(snapshot.validationWarnings) ? Math.max(0, Math.trunc(snapshot.validationWarnings)) : 0,
      exportReady: snapshot.exportReady === true,
      healthState: typeof snapshot.healthState === 'string' ? snapshot.healthState : 'unknown'
    }))
    .filter((snapshot) => (
      snapshot.tenantId === requestContext.tenantId
      && snapshot.workspaceId === requestContext.workspaceId
    ))
    .slice(-6);
}

function normalizePriorReportingHistory(input, requestContext) {
  const persisted = asRecord(input.persistedState || input.stateSnapshot || input.recoveredState);
  const analytics = asRecord(persisted.analytics || persisted.reporting);
  const rawEvents = [
    ...asArray(input.reportingEvents || input.analyticsEvents),
    ...asArray(analytics.reportingEvents || analytics.historyEvents),
    ...asArray(persisted.reportingEvents)
  ];

  return rawEvents
    .map((event) => asRecord(event))
    .filter((event) => typeof event.observedAt === 'string' || typeof event.generatedAt === 'string')
    .map((event, index) => {
      const counters = asRecord(event.counters);

      return {
        eventId: typeof event.eventId === 'string' && event.eventId
          ? event.eventId
          : `${requestContext.requestId}:history-${index + 1}`,
        type: typeof event.type === 'string' && event.type ? event.type : 'recovered_reporting_event',
        observedAt: normalizeIsoTimestamp(event.observedAt || event.generatedAt) || null,
        tenantId: normalizeScopedId(event.tenantId, requestContext.tenantId),
        workspaceId: normalizeScopedId(event.workspaceId, requestContext.workspaceId),
        artifactIds: normalizeStringList(event.artifactIds),
        counters: {
          acceptedArtifacts: Number.isFinite(counters.acceptedArtifacts)
            ? Math.max(0, Math.trunc(counters.acceptedArtifacts))
            : null,
          blockedArtifacts: Number.isFinite(counters.blockedArtifacts)
            ? Math.max(0, Math.trunc(counters.blockedArtifacts))
            : null,
          tamperedArtifacts: Number.isFinite(counters.tamperedArtifacts)
            ? Math.max(0, Math.trunc(counters.tamperedArtifacts))
            : null,
          inlineVerifiedArtifacts: Number.isFinite(counters.inlineVerifiedArtifacts)
            ? Math.max(0, Math.trunc(counters.inlineVerifiedArtifacts))
            : null,
          proofRequiredArtifacts: Number.isFinite(counters.proofRequiredArtifacts)
            ? Math.max(0, Math.trunc(counters.proofRequiredArtifacts))
            : null,
          validationErrors: Number.isFinite(counters.validationErrors)
            ? Math.max(0, Math.trunc(counters.validationErrors))
            : null,
          quarantinedArtifacts: Number.isFinite(counters.quarantinedArtifacts)
            ? Math.max(0, Math.trunc(counters.quarantinedArtifacts))
            : null
        },
        digest: typeof event.digest === 'string' && event.digest ? event.digest : null
      };
    })
    .filter((event) => (
      event.observedAt
      && event.tenantId === requestContext.tenantId
      && event.workspaceId === requestContext.workspaceId
    ))
    .slice(-12);
}

function buildReportingHistory({
  input,
  now,
  currentSnapshot,
  previousSnapshot,
  visibleArtifacts,
  validation,
  acceptance,
  boundaryContext,
  recovery,
  commandResult,
  operationalHealth,
  integrityManifest,
  exportReady,
  requestContext
}) {
  const priorEvents = normalizePriorReportingHistory(input, requestContext);
  const transitionCounters = {
    totalArtifacts: currentSnapshot.totalArtifacts,
    visibleArtifacts: currentSnapshot.visibleArtifacts,
    acceptedArtifacts: currentSnapshot.acceptedArtifacts,
    verifiedArtifacts: currentSnapshot.verifiedArtifacts,
    blockedArtifacts: currentSnapshot.blockedArtifacts,
    quarantinedArtifacts: currentSnapshot.quarantinedArtifacts,
    tamperedArtifacts: currentSnapshot.tamperedArtifacts,
    inlineVerifiedArtifacts: currentSnapshot.inlineVerifiedArtifacts,
    expectedDigestMatchedArtifacts: currentSnapshot.expectedDigestMatchedArtifacts,
    proofRequiredArtifacts: currentSnapshot.proofRequiredArtifacts,
    missingSizeArtifacts: currentSnapshot.missingSizeArtifacts,
    validationErrors: currentSnapshot.validationErrors,
    validationWarnings: currentSnapshot.validationWarnings,
    exportReady: exportReady ? 1 : 0
  };
  const transitionEvent = {
    eventId: `${currentSnapshot.snapshotId}:state`,
    type: previousSnapshot ? 'content_address_snapshot_delta' : 'content_address_snapshot_created',
    observedAt: now,
    tenantId: requestContext.tenantId,
    workspaceId: requestContext.workspaceId,
    artifactIds: visibleArtifacts.map((artifact) => artifact.id),
    counters: transitionCounters,
    deltas: previousSnapshot
      ? {
          acceptedArtifacts: currentSnapshot.acceptedArtifacts - previousSnapshot.acceptedArtifacts,
          verifiedArtifacts: currentSnapshot.verifiedArtifacts - previousSnapshot.verifiedArtifacts,
          blockedArtifacts: currentSnapshot.blockedArtifacts - previousSnapshot.blockedArtifacts,
          quarantinedArtifacts: currentSnapshot.quarantinedArtifacts - previousSnapshot.quarantinedArtifacts,
          tamperedArtifacts: currentSnapshot.tamperedArtifacts - previousSnapshot.tamperedArtifacts,
          inlineVerifiedArtifacts: currentSnapshot.inlineVerifiedArtifacts - previousSnapshot.inlineVerifiedArtifacts,
          expectedDigestMatchedArtifacts: currentSnapshot.expectedDigestMatchedArtifacts
            - previousSnapshot.expectedDigestMatchedArtifacts,
          proofRequiredArtifacts: currentSnapshot.proofRequiredArtifacts - previousSnapshot.proofRequiredArtifacts,
          missingSizeArtifacts: currentSnapshot.missingSizeArtifacts - previousSnapshot.missingSizeArtifacts,
          validationErrors: currentSnapshot.validationErrors - previousSnapshot.validationErrors,
          validationWarnings: currentSnapshot.validationWarnings - previousSnapshot.validationWarnings
        }
      : null,
    digest: `${DEFAULT_ALGORITHM}:${sha256Base64Url(stableManifestJson({
      snapshotId: currentSnapshot.snapshotId,
      counters: transitionCounters,
      healthState: operationalHealth.state,
      manifestDigest: integrityManifest?.digest || null
    }))}`
  };
  const commandEvent = commandResult.code && commandResult.code !== 'no_command'
    ? {
        eventId: `${currentSnapshot.snapshotId}:command:${commandResult.code}`,
        type: commandResult.applied === true ? 'content_address_command_applied' : 'content_address_command_rejected',
        observedAt: now,
        tenantId: requestContext.tenantId,
        workspaceId: requestContext.workspaceId,
        artifactIds: normalizeStringList(commandResult.artifactIds || commandResult.deniedArtifactIds),
        counters: {
          commandApplied: commandResult.applied === true ? 1 : 0,
          commandRejected: commandResult.applied === false ? 1 : 0,
          unknownArtifacts: asArray(commandResult.unknownArtifactIds).length
        },
        commandCode: commandResult.code,
        commandId: commandResult.commandId || null,
        digest: `${DEFAULT_ALGORITHM}:${sha256Base64Url(stableManifestJson(commandResult))}`
      }
    : null;
  const auditEvent = {
    eventId: `${currentSnapshot.snapshotId}:audit-readiness`,
    type: exportReady ? 'content_address_export_ready' : 'content_address_export_blocked',
    observedAt: now,
    tenantId: requestContext.tenantId,
    workspaceId: requestContext.workspaceId,
    artifactIds: boundaryContext.visibleArtifactIds,
    counters: {
      acceptedArtifacts: acceptance.accepted,
      blockedArtifacts: currentSnapshot.blockedArtifacts,
      tamperedArtifacts: currentSnapshot.tamperedArtifacts,
      proofRequiredArtifacts: currentSnapshot.proofRequiredArtifacts,
      validationErrors: validation.errorCount,
      quarantinedArtifacts: boundaryContext.quarantinedArtifactIds.length,
      restoredArtifacts: recovery.restoredArtifactIds.length,
      staleRecoveredArtifacts: recovery.staleArtifactIds.length
    },
    blockedBy: [
      ...(acceptance.complete ? [] : ['acceptance_incomplete']),
      ...(validation.ok ? [] : ['validation_blocked']),
      ...(boundaryContext.quarantinedArtifactIds.length > 0 ? ['boundary_quarantine_present'] : []),
      ...(operationalHealth.state === 'failing' ? ['operational_health_failing'] : []),
      ...(integrityManifest?.validForAudit === false ? ['integrity_manifest_not_audit_ready'] : [])
    ],
    digest: `${DEFAULT_ALGORITHM}:${sha256Base64Url(stableManifestJson({
      exportReady,
      blockedBy: validation.issues.map((issue) => `${issue.artifactId}:${issue.code}`),
      manifestDigest: integrityManifest?.digest || null
    }))}`
  };
  const events = [...priorEvents, transitionEvent, commandEvent, auditEvent].filter(Boolean).slice(-15);
  const latestEvent = events[events.length - 1] || null;
  const countersDigest = `${DEFAULT_ALGORITHM}:${sha256Base64Url(stableManifestJson(transitionCounters))}`;
  const timelineDigest = `${DEFAULT_ALGORITHM}:${sha256Base64Url(stableManifestJson(events.map((event) => ({
    eventId: event.eventId,
    type: event.type,
    observedAt: event.observedAt,
    digest: event.digest
  }))))}`;

  return {
    contract: REPORTING_HISTORY_CONTRACT_VERSION,
    generatedAt: now,
    events,
    latestEvent,
    countersDigest,
    timelineDigest,
    exportColumns: [
      'artifactId',
      'path',
      'contentAddress',
      'digest',
      'digestEncoding',
      'addressFormatIssues',
      'expectedDigestBytes',
      'expectedDigestLength',
      'algorithm',
      'bytes',
      'addressVerifiedByInlineContent',
      'integrityVerificationState',
      'tamperSignals',
      'exportRiskCodes',
      'accepted',
      'verified',
      'verifiedAt'
    ],
    reportState: exportReady
      ? 'export_ready'
      : operationalHealth.state === 'failing'
        ? 'blocked_by_health'
        : validation.ok
          ? 'waiting_for_acceptance_or_manifest'
          : 'blocked_by_validation'
  };
}

function normalizeMailchimpHandoffSettings(input, requestContext) {
  const analytics = asRecord(input.analytics);
  const source = asRecord(
    input.mailchimp
    || input.mailchimpExport
    || input.marketingExport
    || analytics.mailchimp
  );
  const enabled = normalizeBoolean(
    source.enabled ?? source.requested ?? source.syncRequested,
    false
  );
  const audienceId = normalizeScopedId(
    source.audienceId || source.listId || source.audienceRef,
    null
  );
  const segmentId = normalizeScopedId(source.segmentId || source.segmentRef, null);
  const route = typeof source.route === 'string' && source.route.trim()
    ? source.route.trim()
    : '/integrations/mailchimp/content-address/export';
  const externalCursor = normalizeScopedId(source.cursor || source.externalCursor, null);
  const tagPrefix = typeof source.tagPrefix === 'string' && source.tagPrefix.trim()
    ? source.tagPrefix.trim().slice(0, 24)
    : 'aios-content';
  const includeRiskTags = source.includeRiskTags !== false;

  return {
    enabled,
    audienceId,
    segmentId,
    listRef: audienceId ? `mailchimp:${audienceId}` : null,
    route,
    externalCursor,
    tagPrefix,
    includeRiskTags,
    workspaceTag: `${tagPrefix}:workspace:${requestContext.workspaceId}`.slice(0, 96)
  };
}

function buildMailchimpContentAddressHandoff({
  input,
  now,
  requestContext,
  visibleArtifacts,
  validation,
  acceptance,
  boundaryContext,
  operationalHealth,
  integrityManifest,
  exportReady,
  currentSnapshot,
  reportingHistory,
  exportRiskByArtifact
}) {
  const settings = normalizeMailchimpHandoffSettings(input, requestContext);
  const riskByArtifact = new Map(exportRiskByArtifact.map((entry) => [entry.artifactId, entry.riskCodes]));
  const blockedReasonCodes = [
    ...(!settings.enabled ? ['mailchimp_export_not_requested'] : []),
    ...(settings.enabled && !settings.audienceId ? ['mailchimp_audience_missing'] : []),
    ...(settings.enabled && !exportReady ? ['content_address_export_not_ready'] : []),
    ...(validation.errorCount > 0 ? ['validation_errors_present'] : []),
    ...(acceptance.complete ? [] : ['artifact_acceptance_incomplete']),
    ...(boundaryContext.quarantinedArtifactIds.length ? ['boundary_quarantine_present'] : []),
    ...(operationalHealth.state === 'failing' ? ['operational_health_failing'] : []),
    ...(integrityManifest && integrityManifest.validForAudit !== true ? ['integrity_manifest_not_audit_ready'] : [])
  ];
  const rows = visibleArtifacts.map((artifact, index) => {
    const riskCodes = riskByArtifact.get(artifact.id) || [];
    const ready = blockedReasonCodes.length === 0 && riskCodes.length === 0;
    const tags = [
      settings.workspaceTag,
      `${settings.tagPrefix}:algorithm:${artifact.algorithm}`.slice(0, 96),
      artifact.accepted ? `${settings.tagPrefix}:accepted` : `${settings.tagPrefix}:pending`,
      artifact.proof.verified === true ? `${settings.tagPrefix}:proof-verified` : `${settings.tagPrefix}:proof-missing`,
      ...(settings.includeRiskTags ? riskCodes.slice(0, 5).map((code) => `${settings.tagPrefix}:risk:${code}`.slice(0, 96)) : [])
    ];
    const mergeFields = {
      ARTIFACT: artifact.id.slice(0, 64),
      WORKSPACE: requestContext.workspaceId.slice(0, 64),
      ALGORITHM: artifact.algorithm.slice(0, 16),
      DIGESTENC: artifact.digestEncoding.slice(0, 16),
      VERIFIED: artifact.proof.verified === true ? 'yes' : 'no',
      ACCEPTED: artifact.accepted === true ? 'yes' : 'no',
      RISKS: riskCodes.length
    };

    return {
      rowId: `${requestContext.workspaceId}:content-address:mailchimp:${index + 1}`,
      artifactId: artifact.id,
      externalId: sha256Base64Url(stableManifestJson({
        tenantId: requestContext.tenantId,
        workspaceId: requestContext.workspaceId,
        artifactId: artifact.id,
        contentAddress: artifact.contentAddress
      })),
      status: ready ? 'ready' : 'blocked',
      blockedReasonCodes: ready ? [] : [...new Set([...blockedReasonCodes, ...riskCodes])],
      tags: [...new Set(tags)],
      mergeFields,
      contentAddressDigest: artifact.digest,
      contentAddressAlgorithm: artifact.algorithm,
      updatedAt: now
    };
  });
  const readyRows = rows.filter((row) => row.status === 'ready');
  const state = !settings.enabled
    ? 'not-requested'
    : blockedReasonCodes.length
      ? 'blocked'
      : readyRows.length === rows.length
        ? 'ready'
        : 'attention';
  const exportDigest = `${DEFAULT_ALGORITHM}:${sha256Base64Url(stableManifestJson({
    settings,
    state,
    blockedReasonCodes,
    rows,
    snapshotId: currentSnapshot.snapshotId,
    reportingDigest: reportingHistory.timelineDigest
  }))}`;

  return {
    contract: 'content-address.mailchimp-handoff.v1',
    generatedAt: now,
    state,
    enabled: settings.enabled,
    route: settings.route,
    listRef: settings.listRef,
    audienceId: settings.audienceId,
    segmentId: settings.segmentId,
    externalCursor: settings.externalCursor,
    rowCount: rows.length,
    readyRowCount: readyRows.length,
    blockedRowCount: rows.length - readyRows.length,
    blockedReasonCodes: [...new Set(blockedReasonCodes)],
    cursor: `${requestContext.workspaceId}:${currentSnapshot.snapshotId}`,
    exportDigest,
    rows
  };
}

function buildContentAddressAnalytics(input, now, artifacts, validation, acceptance, boundaryContext, recovery, commandResult, requestContext, operationalHealth, integrityManifest = null) {
  const visibleArtifacts = artifacts.filter((artifact) => boundaryContext.visibleArtifactIds.includes(artifact.id));
  const blockedArtifactIds = validation.byArtifact
    .filter((entry) => entry.issues.some((issue) => issue.severity === 'error'))
    .map((entry) => entry.artifactId);
  const verifiedArtifactIds = visibleArtifacts
    .filter((artifact) => artifact.proof.verified === true)
    .map((artifact) => artifact.id);
  const integrityEvidenceByArtifactId = new Map(
    visibleArtifacts.map((artifact) => [artifact.id, buildArtifactIntegrityEvidence(artifact)])
  );
  const tamperedArtifactIds = visibleArtifacts
    .filter((artifact) => artifact.tamperSignals.length > 0)
    .map((artifact) => artifact.id);
  const inlineVerifiedArtifactIds = visibleArtifacts
    .filter((artifact) => artifact.addressVerifiedByInlineContent)
    .map((artifact) => artifact.id);
  const expectedDigestMatchedArtifactIds = visibleArtifacts
    .filter((artifact) => integrityEvidenceByArtifactId.get(artifact.id)?.expectedAddressMatched === true)
    .map((artifact) => artifact.id);
  const proofRequiredArtifactIds = visibleArtifacts
    .filter((artifact) => integrityEvidenceByArtifactId.get(artifact.id)?.canRecordProof === true
      && artifact.proof.verified !== true)
    .map((artifact) => artifact.id);
  const missingSizeArtifactIds = visibleArtifacts
    .filter((artifact) => artifact.bytes === null)
    .map((artifact) => artifact.id);
  const tamperSignalCounts = visibleArtifacts.reduce((counts, artifact) => {
    artifact.tamperSignals.forEach((signal) => {
      counts[signal] = (counts[signal] || 0) + 1;
    });
    return counts;
  }, {});
  const exportRiskByArtifact = visibleArtifacts
    .map((artifact) => {
      const evidence = integrityEvidenceByArtifactId.get(artifact.id);
      const riskCodes = [
        ...artifact.tamperSignals,
        ...(artifact.bytes === null ? ['missing_size'] : []),
        ...(artifact.proof.verified !== true ? ['proof_not_verified'] : []),
        ...(artifact.accepted !== true ? ['acceptance_pending'] : []),
        ...(evidence?.verificationState === 'address_format_only' ? ['address_format_only'] : []),
        ...(evidence?.verificationState === 'unverified' ? ['integrity_unverified'] : []),
        ...asArray(evidence?.blockerCodes)
      ];

      return {
        artifactId: artifact.id,
        riskCodes: [...new Set(riskCodes.filter(Boolean))]
      };
    })
    .filter((entry) => entry.riskCodes.length > 0);
  const byteSummary = visibleArtifacts.reduce((summary, artifact) => {
    if (artifact.bytes === null) {
      summary.unknownArtifactIds.push(artifact.id);
    } else {
      summary.knownBytes += artifact.bytes;
      summary.knownArtifactCount += 1;
    }
    return summary;
  }, { knownBytes: 0, knownArtifactCount: 0, unknownArtifactIds: [] });
  const algorithmCounts = visibleArtifacts.reduce((counts, artifact) => ({
    ...counts,
    [artifact.algorithm]: (counts[artifact.algorithm] || 0) + 1
  }), {});
  const manifestReady = integrityManifest ? integrityManifest.validForAudit : true;
  const exportReady = acceptance.complete
    && validation.ok
    && manifestReady
    && boundaryContext.quarantinedArtifactIds.length === 0
    && operationalHealth.state !== 'failing';
  const currentSnapshot = {
    snapshotId: `${requestContext.requestId}:${Date.parse(now) || now}`,
    checkedAt: now,
    tenantId: requestContext.tenantId,
    workspaceId: requestContext.workspaceId,
    totalArtifacts: artifacts.length,
    visibleArtifacts: visibleArtifacts.length,
    acceptedArtifacts: acceptance.accepted,
    verifiedArtifacts: verifiedArtifactIds.length,
    blockedArtifacts: blockedArtifactIds.length,
    quarantinedArtifacts: boundaryContext.quarantinedArtifactIds.length,
    tamperedArtifacts: tamperedArtifactIds.length,
    inlineVerifiedArtifacts: inlineVerifiedArtifactIds.length,
    expectedDigestMatchedArtifacts: expectedDigestMatchedArtifactIds.length,
    proofRequiredArtifacts: proofRequiredArtifactIds.length,
    missingSizeArtifacts: missingSizeArtifactIds.length,
    validationErrors: validation.errorCount,
    validationWarnings: validation.warningCount,
    exportReady,
    healthState: operationalHealth.state
  };
  const priorSnapshots = normalizePriorAnalyticsSnapshots(input, requestContext);
  const previousSnapshot = priorSnapshots.length > 0 ? priorSnapshots[priorSnapshots.length - 1] : null;
  const timeline = [...priorSnapshots, currentSnapshot].slice(-7);
  const reportingHistory = buildReportingHistory({
    input,
    now,
    currentSnapshot,
    previousSnapshot,
    visibleArtifacts,
    validation,
    acceptance,
    boundaryContext,
    recovery,
    commandResult,
    operationalHealth,
    integrityManifest,
    exportReady,
    requestContext
  });
  const mailchimpHandoff = buildMailchimpContentAddressHandoff({
    input,
    now,
    requestContext,
    visibleArtifacts,
    validation,
    acceptance,
    boundaryContext,
    operationalHealth,
    integrityManifest,
    exportReady,
    currentSnapshot,
    reportingHistory,
    exportRiskByArtifact
  });

  return {
    contract: ANALYTICS_CONTRACT_VERSION,
    generatedAt: now,
    counters: {
      totalArtifacts: artifacts.length,
      visibleArtifacts: visibleArtifacts.length,
      acceptedArtifacts: acceptance.accepted,
      pendingAcceptance: acceptance.pending,
      verifiedArtifacts: verifiedArtifactIds.length,
      blockedArtifacts: blockedArtifactIds.length,
      quarantinedArtifacts: boundaryContext.quarantinedArtifactIds.length,
      validationErrors: validation.errorCount,
      validationWarnings: validation.warningCount,
      restoredArtifacts: recovery.restoredArtifactIds.length,
      staleRecoveredArtifacts: recovery.staleArtifactIds.length,
      tamperedArtifacts: tamperedArtifactIds.length,
      inlineVerifiedArtifacts: inlineVerifiedArtifactIds.length,
      expectedDigestMatchedArtifacts: expectedDigestMatchedArtifactIds.length,
      proofRequiredArtifacts: proofRequiredArtifactIds.length,
      missingSizeArtifacts: missingSizeArtifactIds.length,
      commandApplied: commandResult.applied === true ? 1 : 0,
      commandRejected: commandResult.applied === false && commandResult.code !== 'no_command' ? 1 : 0
    },
    tamperSummary: {
      tamperedArtifactIds,
      signalCounts: tamperSignalCounts,
      cleanArtifactIds: visibleArtifacts
        .filter((artifact) => artifact.tamperSignals.length === 0)
        .map((artifact) => artifact.id),
      exportRiskByArtifact,
      reportableRiskCount: exportRiskByArtifact.length
    },
    byteSummary,
    algorithmCounts,
    proofCoverage: {
      verifiedArtifactIds,
      missingProofArtifactIds: visibleArtifacts
        .filter((artifact) => artifact.proof.verified !== true)
        .map((artifact) => artifact.id),
      ratio: visibleArtifacts.length === 0 ? 0 : verifiedArtifactIds.length / visibleArtifacts.length
    },
    exportSummary: {
      contract: EXPORT_CONTRACT_VERSION,
      exportReady,
      suggestedFilename: `${requestContext.workspaceId}-content-address-${now.slice(0, 10)}.json`,
      route: DEFAULT_AUDIT_ROUTE,
      mailchimp: {
        state: mailchimpHandoff.state,
        listRef: mailchimpHandoff.listRef,
        rowCount: mailchimpHandoff.rowCount,
        readyRowCount: mailchimpHandoff.readyRowCount,
        blockedReasonCodes: mailchimpHandoff.blockedReasonCodes,
        exportDigest: mailchimpHandoff.exportDigest
      },
      manifestDigest: integrityManifest?.digest || null,
      manifestContract: integrityManifest?.contract || null,
      riskSummary: {
        tamperedArtifactIds,
        proofRequiredArtifactIds,
        missingSizeArtifactIds,
        exportRiskByArtifact,
        tamperSignalCounts
      },
      report: {
        contract: REPORTING_HISTORY_CONTRACT_VERSION,
        state: reportingHistory.reportState,
        countersDigest: reportingHistory.countersDigest,
        timelineDigest: reportingHistory.timelineDigest,
        eventCount: reportingHistory.events.length,
        latestEventType: reportingHistory.latestEvent?.type || null,
        columns: reportingHistory.exportColumns
      },
      rows: visibleArtifacts.map((artifact) => ({
        artifactId: artifact.id,
        path: artifact.path,
        contentAddress: artifact.contentAddress,
        algorithm: artifact.algorithm,
        digest: artifact.digest,
        digestEncoding: artifact.digestEncoding,
        addressFormatIssues: artifact.addressFormatIssues,
        expectedDigestBytes: artifact.expectedDigestBytes,
        expectedDigestLength: artifact.expectedDigestLength,
        computedContentAddress: artifact.computedContentAddress,
        expectedContentAddresses: artifact.expectedContentAddresses,
        addressVerifiedByInlineContent: artifact.addressVerifiedByInlineContent,
        integrityEvidence: integrityEvidenceByArtifactId.get(artifact.id),
        tamperSignals: artifact.tamperSignals,
        exportRiskCodes: exportRiskByArtifact.find((entry) => entry.artifactId === artifact.id)?.riskCodes || [],
        bytes: artifact.bytes,
        accepted: artifact.accepted,
        verified: artifact.proof.verified === true,
        verifiedAt: artifact.proof.verifiedAt || null
      }))
    },
    mailchimpHandoff,
    reportingHistory,
    timeline: {
      snapshots: timeline,
      trend: previousSnapshot
        ? {
            acceptedDelta: currentSnapshot.acceptedArtifacts - previousSnapshot.acceptedArtifacts,
            verifiedDelta: currentSnapshot.verifiedArtifacts - previousSnapshot.verifiedArtifacts,
            blockedDelta: currentSnapshot.blockedArtifacts - previousSnapshot.blockedArtifacts,
            tamperedDelta: currentSnapshot.tamperedArtifacts - previousSnapshot.tamperedArtifacts,
            proofRequiredDelta: currentSnapshot.proofRequiredArtifacts - previousSnapshot.proofRequiredArtifacts,
            errorDelta: currentSnapshot.validationErrors - previousSnapshot.validationErrors,
            exportReadinessChanged: currentSnapshot.exportReady !== previousSnapshot.exportReady
          }
        : null
    }
  };
}

function buildRestartResumeCheckpoint({
  now,
  artifacts,
  validation,
  acceptance,
  commandResult,
  requestContext,
  boundaryContext,
  operationalHealth,
  lifecycleControls,
  providerSync,
  integrityManifest,
  clientHandoffQueue
}) {
  const staleArtifactIds = artifacts
    .filter((artifact) => artifact.recovery?.staleSnapshot)
    .map((artifact) => artifact.id);
  const pendingArtifactIds = artifacts
    .filter((artifact) => (
      boundaryContext.visibleArtifactIds.includes(artifact.id)
      && artifact.accepted !== true
    ))
    .map((artifact) => artifact.id);
  const blockedArtifactIds = validation.byArtifact
    .filter((entry) => entry.issues.some((issue) => issue.severity === 'error'))
    .map((entry) => entry.artifactId);
  const exportReady = acceptance.complete
    && validation.ok
    && integrityManifest?.validForAudit === true
    && operationalHealth.state !== 'failing';
  const resumeMode = operationalHealth.state === 'failing'
    ? 'recover_operational_health'
    : boundaryContext.quarantinedArtifactIds.length > 0
      ? 'review_boundary_quarantine'
      : staleArtifactIds.length > 0
        ? 'repair_stale_recovery'
        : exportReady
          ? 'publish_audit_proof'
          : validation.ok
            ? 'resume_acceptance'
            : 'resume_preview';
  const status = exportReady
    ? 'complete'
    : operationalHealth.state === 'failing' || blockedArtifactIds.length > 0
      ? 'blocked'
      : clientHandoffQueue?.state === 'action_required'
        ? 'action_required'
        : 'resumable';
  const resumeRoute = exportReady
    ? DEFAULT_AUDIT_ROUTE
    : validation.ok
      ? DEFAULT_ACCEPTANCE_ROUTE
      : DEFAULT_PREVIEW_ROUTE;
  const payload = {
    contract: RESTART_RESUME_CONTRACT_VERSION,
    requestId: requestContext.requestId,
    tenantId: requestContext.tenantId,
    workspaceId: requestContext.workspaceId,
    status,
    resumeMode,
    resumeRoute,
    visibleArtifactIds: boundaryContext.visibleArtifactIds,
    pendingArtifactIds,
    blockedArtifactIds,
    staleArtifactIds,
    activeHandoffId: clientHandoffQueue?.activeItemId || null,
    providerHandoffId: providerSync?.externalHandoff?.handoffId || null,
    manifestDigest: integrityManifest?.digest || null,
    lastCommandId: commandResult.commandId || null,
    lastCommandCode: commandResult.code || null
  };
  const resumeToken = `${DEFAULT_ALGORITHM}:${sha256Base64Url(stableManifestJson(payload))}`;

  return {
    ...payload,
    generatedAt: now,
    resumeToken,
    restartSafe: staleArtifactIds.length === 0
      && commandResult.code !== 'command_id_replay_mismatch'
      && commandResult.code !== 'command_lock_replay_mismatch'
      && commandResult.code !== 'unsafe_restart_command_recovery'
      && commandResult.code !== 'expired_command_lock_requires_recovery'
      && commandResult.code !== 'blocked_command_lock_requires_recovery'
      && lifecycleControls.valid === true,
    commandReplay: {
      contract: COMMAND_RECOVERY_CONTRACT_VERSION,
      commandId: commandResult.commandId || null,
      replayKey: commandResult.replayKey || null,
      idempotent: commandResult.idempotent === true,
      replayedFromPersistedReceipt: commandResult.replayedFromPersistedReceipt === true,
      replayedFromArtifactSnapshot: commandResult.replayedFromArtifactSnapshot === true,
      mismatch: commandResult.code === 'command_id_replay_mismatch'
        || commandResult.code === 'command_lock_replay_mismatch',
      recoveryState: commandResult.recoveredCommand?.state || 'not_applicable',
      restartReference: commandResult.recoveredCommand?.restartResume || null,
      targetScope: commandResult.commandTargetScope
        ? {
            contract: commandResult.commandTargetScope.contract,
            allowed: commandResult.commandTargetScope.allowed,
            scopeDigest: commandResult.commandTargetScope.scopeDigest,
            targetIds: commandResult.commandTargetScope.targetIds,
            deniedTargetIds: commandResult.commandTargetScope.deniedTargets.map((record) => record.artifactId),
            unknownArtifactIds: commandResult.commandTargetScope.unknownArtifactIds,
            blockedReasonCodes: commandResult.commandTargetScope.blockedReasonCodes
          }
        : null,
      integrityGate: commandResult.commandIntegrityGate
        ? {
            contract: commandResult.commandIntegrityGate.contract,
            allowed: commandResult.commandIntegrityGate.allowed,
            blockedTargetIds: commandResult.commandIntegrityGate.blockedTargetIds,
            blockedReasonCodes: commandResult.commandIntegrityGate.blockedReasonCodes,
            evidenceDigest: `${DEFAULT_ALGORITHM}:${sha256Base64Url(stableManifestJson(
              commandResult.commandIntegrityGate.targetEvidence || []
            ))}`
          }
        : null
    },
    routeRecovery: {
      preview: {
        route: DEFAULT_PREVIEW_ROUTE,
        enabled: artifacts.length > 0,
        issueCodes: validation.issues.map((issue) => issue.code)
      },
      acceptance: {
        route: DEFAULT_ACCEPTANCE_ROUTE,
        enabled: validation.ok && acceptance.canAccept,
        pendingArtifactIds
      },
      auditProof: {
        route: DEFAULT_AUDIT_ROUTE,
        enabled: exportReady,
        manifestDigest: integrityManifest?.digest || null,
        providerHandoffState: providerSync?.externalHandoff?.state || 'unavailable'
      }
    }
  };
}

function buildPersistableState(
  now,
  artifacts,
  validation,
  acceptance,
  commandResult,
  requestContext,
  boundaryContext,
  operationalHealth,
  analytics,
  lifecycleControls,
  providerSync,
  integrityManifest,
  boundaryAuditHandoff,
  lifecycleMutation = null,
  workflowHandoffState = null,
  workflowHandoff = null,
  clientHandoffQueue = null,
  persistedState = null
) {
  const artifactStates = artifacts.map((artifact) => {
    const issues = validation.byArtifact.find((entry) => entry.artifactId === artifact.id)?.issues || [];
    const boundaryAccess = boundaryContext.artifactAccess.find((entry) => entry.artifactId === artifact.id) || null;
    const hasBlocker = issues.some((issue) => issue.severity === 'error');
    const status = hasBlocker
      ? 'blocked'
      : artifact.accepted
        ? 'accepted'
        : artifact.proof.verified === true
          ? 'verified_pending_acceptance'
          : 'needs_proof_review';

    return {
      artifactId: artifact.id,
      contentAddress: artifact.contentAddress,
      digest: artifact.digest,
      digestEncoding: artifact.digestEncoding,
      addressFormatIssues: artifact.addressFormatIssues,
      expectedDigestBytes: artifact.expectedDigestBytes,
      expectedDigestLength: artifact.expectedDigestLength,
      computedContentAddress: artifact.computedContentAddress,
      expectedContentAddresses: artifact.expectedContentAddresses,
      addressVerifiedByInlineContent: artifact.addressVerifiedByInlineContent,
      integrityEvidence: buildArtifactIntegrityEvidence(artifact),
      tamperSignals: artifact.tamperSignals,
      status,
      accepted: artifact.accepted,
      tenantId: boundaryAccess?.tenantId || artifact.tenantId || requestContext.tenantId,
      workspaceId: boundaryAccess?.workspaceId || artifact.workspaceId || requestContext.workspaceId,
      boundaryStatus: boundaryAccess?.denialCode || 'in_scope',
      proofVerified: artifact.proof.verified === true,
      verifiedAt: artifact.proof.verifiedAt || null,
      lastCommandId: artifact.recovery?.lastCommandId || commandResult.commandId || null,
      issueCodes: issues.map((issue) => issue.code),
      snapshotDigest: `${DEFAULT_ALGORITHM}:${sha256Base64Url(stableManifestJson({
        artifactId: artifact.id,
        contentAddress: artifact.contentAddress,
        accepted: artifact.accepted,
        proofVerified: artifact.proof.verified === true
      }))}`
    };
  });

  const restartResume = buildRestartResumeCheckpoint({
    now,
    artifacts,
    validation,
    acceptance,
    commandResult,
    requestContext,
    boundaryContext,
    operationalHealth,
    lifecycleControls,
    providerSync,
    integrityManifest,
    clientHandoffQueue
  });
  const commandReceipt = commandResult.commandId
    ? {
        commandId: commandResult.commandId,
        commandType: commandResult.type || commandResult.code || null,
        replayKey: commandResult.replayKey || null,
        applied: commandResult.applied === true,
        code: commandResult.code || null,
        artifactIds: normalizeStringList(commandResult.artifactIds || commandResult.deniedArtifactIds),
        recordedAt: now,
        idempotent: commandResult.idempotent === true,
        recoveryState: commandResult.recoveredCommand?.state || 'not_applicable',
        recoveredFromLock: commandResult.recoveredCommand?.state === 'recovering_lock',
        restartResumeToken: commandResult.recoveredCommand?.restartResume?.resumeToken || null,
        targetScopeDigest: commandResult.commandTargetScope?.scopeDigest || null,
        integrityGateDigest: commandResult.commandIntegrityGate
          ? `${DEFAULT_ALGORITHM}:${sha256Base64Url(stableManifestJson(commandResult.commandIntegrityGate.targetEvidence || []))}`
          : null,
        deniedArtifactIds: normalizeStringList(commandResult.deniedArtifactIds),
        unknownArtifactIds: normalizeStringList(commandResult.unknownArtifactIds),
        blockedReasonCodes: normalizeStringList(commandResult.blockedReasonCodes),
        resultDigest: `${DEFAULT_ALGORITHM}:${sha256Base64Url(stableManifestJson({
          code: commandResult.code,
          applied: commandResult.applied === true,
          artifactIds: commandResult.artifactIds || [],
          deniedArtifactIds: commandResult.deniedArtifactIds || [],
          unknownArtifactIds: commandResult.unknownArtifactIds || [],
          targetScopeDigest: commandResult.commandTargetScope?.scopeDigest || null,
          integrityGateDigest: commandResult.commandIntegrityGate
            ? `${DEFAULT_ALGORITHM}:${sha256Base64Url(stableManifestJson(commandResult.commandIntegrityGate.targetEvidence || []))}`
            : null,
          replayKey: commandResult.replayKey || null
        }))}`
      }
    : null;
  const priorCommandReceipts = asArray(persistedState?.commandReceipts);
  const shouldPersistCommandReceipt = commandReceipt
    && commandResult.code !== 'command_id_replay_mismatch'
    && commandResult.code !== 'command_lock_replay_mismatch'
    && commandResult.code !== 'unsafe_restart_command_recovery'
    && commandResult.code !== 'expired_command_lock_requires_recovery'
    && commandResult.code !== 'blocked_command_lock_requires_recovery'
    && commandResult.replayedFromPersistedReceipt !== true;
  const commandReceipts = shouldPersistCommandReceipt
    ? [
        ...priorCommandReceipts.filter((receipt) => receipt.commandId !== commandReceipt.commandId),
        commandReceipt
      ].slice(-25)
    : priorCommandReceipts.slice(-25);
  const priorCommandLocks = asArray(persistedState?.commandLocks);
  const activeCommandLockPayload = commandResult.commandId
    && (
      commandResult.code === 'command_lock_replay_mismatch'
      || commandResult.code === 'command_id_replay_mismatch'
      || commandResult.code === 'unsafe_restart_command_recovery'
      || commandResult.code === 'expired_command_lock_requires_recovery'
      || commandResult.code === 'blocked_command_lock_requires_recovery'
    )
    ? {
        contract: COMMAND_RECOVERY_CONTRACT_VERSION,
        commandId: commandResult.commandId,
        commandType: commandResult.type || commandResult.code || null,
        replayKey: commandResult.replayKey || null,
        state: 'blocked',
        artifactIds: normalizeStringList(commandResult.artifactIds || commandResult.deniedArtifactIds),
        lockedAt: commandResult.recoveredCommand?.activeLock?.lockedAt
          || commandResult.recoveredCommand?.expiredSameCommandLock?.lockedAt
          || now,
        expiresAt: commandResult.applied === true ? null : addMinutesIso(now, 15),
        source: commandResult.recoveredCommand?.state === 'recovering_lock'
          ? 'recovered_lock'
          : commandResult.recoveredCommand?.state === 'expired_lock_requires_receipt'
            ? 'expired_lock_recovery'
            : commandResult.recoveredCommand?.state === 'blocked_lock_requires_recovery'
              ? 'blocked_lock_recovery'
          : 'current_command',
        expiredLockDigest: commandResult.recoveredCommand?.expiredSameCommandLock?.lockDigest || null,
        recoveryIssueCodes: [
          ...(commandResult.recoveredCommand?.expiredSameCommandLock?.recoveryIssueCodes || []),
          commandResult.code
        ],
        resultDigest: commandReceipt?.resultDigest || null
      }
    : null;
  const normalizedActiveCommandLock = activeCommandLockPayload
    ? normalizeCommandLockRecord(activeCommandLockPayload, now)
    : null;
  const activeCommandLock = normalizedActiveCommandLock
    ? {
        ...normalizedActiveCommandLock,
        expiredLockDigest: activeCommandLockPayload.expiredLockDigest || null,
        recoveryIssueCodes: [...new Set([
          ...normalizedActiveCommandLock.recoveryIssueCodes,
          ...normalizeStringList(activeCommandLockPayload.recoveryIssueCodes)
        ])]
      }
    : null;
  const commandLocks = [
    ...priorCommandLocks.filter((lock) => (
      lock.commandId !== commandResult.commandId
      && lock.state !== 'completed'
    )),
    ...(activeCommandLock ? [activeCommandLock] : [])
  ].slice(-10);
  const nextGeneration = Math.max(1, (persistedState?.generation || 0) + 1);

  return {
    contract: STATE_CONTRACT_VERSION,
    persistedAt: now,
    generation: nextGeneration,
    requestId: requestContext.requestId,
    tenantId: requestContext.tenantId,
    workspaceId: requestContext.workspaceId,
    complete: acceptance.complete,
    restartStatus: restartResume.resumeMode,
    restartResume,
    commandRecovery: {
      contract: COMMAND_RECOVERY_CONTRACT_VERSION,
      state: commandResult.recoveredCommand?.state || 'not_applicable',
      safeToApply: commandResult.recoveredCommand?.safeToApply !== false,
      recoveredFromLock: commandResult.recoveredCommand?.state === 'recovering_lock',
      replayedFromReceipt: commandResult.replayedFromPersistedReceipt === true,
      blockedByRecovery: commandResult.code === 'command_lock_replay_mismatch'
        || commandResult.code === 'command_id_replay_mismatch'
        || commandResult.code === 'unsafe_restart_command_recovery'
        || commandResult.code === 'expired_command_lock_requires_recovery'
        || commandResult.code === 'blocked_command_lock_requires_recovery',
      expiredLockCommandIds: asArray(commandResult.recoveredCommand?.expiredLocks)
        .map((lock) => lock.commandId),
      expiredSameCommandLock: commandResult.recoveredCommand?.expiredSameCommandLock
        ? {
            commandId: commandResult.recoveredCommand.expiredSameCommandLock.commandId,
            lockDigest: commandResult.recoveredCommand.expiredSameCommandLock.lockDigest,
            recoveryAction: commandResult.recoveredCommand.expiredSameCommandLock.recoveryAction,
            recoveryIssueCodes: commandResult.recoveredCommand.expiredSameCommandLock.recoveryIssueCodes
          }
        : null,
      restartResume: commandResult.recoveredCommand?.restartResume || persistedState?.restartResume || null
    },
    commandReceipts,
    commandLocks,
    workflowHandoff: workflowHandoff
      ? {
          contract: WORKFLOW_HANDOFF_STATE_CONTRACT_VERSION,
          activeHandoffId: workflowHandoff.id,
          activeAction: workflowHandoff.action,
          status: workflowHandoff.acknowledgement.status,
          route: workflowHandoff.route,
          returnToRoute: workflowHandoff.acknowledgement.returnToRoute,
          acknowledgedHandoffIds: workflowHandoffState?.acknowledgedHandoffIds || [],
          completedHandoffIds: workflowHandoffState?.completedHandoffIds || [],
          dismissedIssueCodes: workflowHandoffState?.dismissedIssueCodes || [],
          lastSeenAction: workflowHandoff.action,
          lastSeenRoute: workflowHandoff.route,
          pinnedArtifactId: workflowHandoff.selectedArtifactId,
          clientRevision: workflowHandoff.acknowledgement.clientRevision,
          updatedAt: now
        }
      : null,
    clientHandoffQueue: clientHandoffQueue
      ? {
          contract: clientHandoffQueue.contract,
          generatedAt: clientHandoffQueue.generatedAt,
          state: clientHandoffQueue.state,
          queueDigest: clientHandoffQueue.queueDigest,
          activeItemId: clientHandoffQueue.activeItemId,
          counts: clientHandoffQueue.counts,
          reconciliation: clientHandoffQueue.reconciliation,
          items: clientHandoffQueue.items.map((item) => ({
            id: item.id,
            source: item.source,
            route: item.route,
            action: item.action,
            state: item.state,
            enabled: item.enabled,
            acknowledged: item.acknowledged,
            completed: item.completed,
            clientQueueState: item.clientQueueState,
            clientQueueIssueCodes: item.clientQueueIssueCodes,
            returnToRoute: item.returnToRoute,
            evidenceRefs: item.evidenceRefs
          }))
        }
      : null,
    artifacts: artifactStates,
    boundary: {
      contract: BOUNDARY_CONTRACT_VERSION,
      quarantinedArtifactIds: boundaryContext.quarantinedArtifactIds,
      visibleArtifactIds: boundaryContext.visibleArtifactIds,
      actorRoles: boundaryContext.actorRoles,
      lastCommandTargetScope: commandResult.commandTargetScope
        ? {
            contract: commandResult.commandTargetScope.contract,
            commandId: commandResult.commandTargetScope.commandId,
            commandType: commandResult.commandTargetScope.commandType,
            allowed: commandResult.commandTargetScope.allowed,
            implicitAllArtifacts: commandResult.commandTargetScope.implicitAllArtifacts,
            scopeDigest: commandResult.commandTargetScope.scopeDigest,
            writableArtifactIds: commandResult.commandTargetScope.writableArtifactIds,
            deniedTargetIds: commandResult.commandTargetScope.deniedTargets.map((record) => record.artifactId),
            unknownArtifactIds: commandResult.commandTargetScope.unknownArtifactIds,
            blockedReasonCodes: commandResult.commandTargetScope.blockedReasonCodes
          }
        : null,
      auditHandoff: boundaryAuditHandoff
        ? {
            contract: boundaryAuditHandoff.contract,
            handoffId: boundaryAuditHandoff.handoffId,
            required: boundaryAuditHandoff.required,
            state: boundaryAuditHandoff.state,
            evidenceDigest: boundaryAuditHandoff.safeEvidence.digest,
            deniedArtifactIds: boundaryAuditHandoff.deniedRecords.map((record) => record.artifactId),
            denialCounts: boundaryAuditHandoff.denialCounts,
            redactionPolicy: boundaryAuditHandoff.redactionPolicy,
            auditEvent: boundaryAuditHandoff.auditEvent
          }
        : null
    },
    operationalHealth: {
      contract: HEALTH_CONTRACT_VERSION,
      state: operationalHealth.state,
      degradedReasons: operationalHealth.degradedReasons,
      failureState: operationalHealth.failureState,
      retryQueue: operationalHealth.retryQueue,
      providerHealth: operationalHealth.providerHealth
    },
    lifecycle: {
      contract: lifecycleControls.contract,
      enabled: lifecycleControls.enabled,
      valid: lifecycleControls.valid,
      nextAction: lifecycleControls.nextAction,
      disabledReasonCodes: lifecycleControls.disabledReasonCodes,
      controls: lifecycleControls.controls,
      schedule: lifecycleControls.schedule,
      issues: lifecycleControls.issues,
      mutation: lifecycleMutation?.present
        ? {
            contract: lifecycleMutation.contract,
            applied: lifecycleMutation.applied,
            code: lifecycleMutation.code,
            commandId: lifecycleMutation.commandId,
            commandType: lifecycleMutation.commandType,
            fieldsChanged: lifecycleMutation.fieldsChanged,
            auditDigest: lifecycleMutation.auditDigest,
            schedulePlan: lifecycleMutation.schedulePlan,
            validationIssueCodes: lifecycleMutation.validationIssues.map((issue) => issue.code)
          }
        : null
    },
    providerSync: providerSync
      ? {
          contract: providerSync.contract,
          providerId: providerSync.provider.providerId,
          status: providerSync.provider.status,
          negotiatedAt: providerSync.provider.negotiatedAt,
          capabilities: providerSync.provider.capabilities,
          missingCapabilities: providerSync.provider.missingCapabilities,
          syncCursor: providerSync.syncMetadata.nextCursor,
          lastSyncedAt: providerSync.syncMetadata.lastSyncedAt,
          batchSize: providerSync.syncMetadata.batchSize,
          overflowArtifactIds: providerSync.syncMetadata.overflowArtifactIds,
          externalHandoff: providerSync.externalHandoff,
          handoffState: {
            contract: providerSync.handoffState.contract,
            handoffId: providerSync.handoffState.handoffId,
            state: providerSync.handoffState.state,
            idempotencyKey: providerSync.handoffState.idempotencyKey,
            payloadDigest: providerSync.handoffState.payloadDigest,
            acknowledged: providerSync.handoffState.acknowledged,
            requiredAckBy: providerSync.handoffState.requiredAckBy,
            retryAfter: providerSync.handoffState.retryAfter,
            retryPolicy: providerSync.handoffState.retryPolicy,
            retryAttempt: providerSync.handoffState.retryAttempt,
            retryExhausted: providerSync.handoffState.retryExhausted,
            retryPlan: providerSync.handoffState.retryPlan,
            degradedMode: providerSync.handoffState.degradedMode,
            actionableError: providerSync.handoffState.actionableError,
            receipt: providerSync.handoffState.receipt,
            receiptHistory: providerSync.handoffState.receiptHistory,
            artifactIds: providerSync.handoffState.artifactIds,
            proofRequiredIds: providerSync.handoffState.proofRequiredIds,
            blockedArtifactIds: providerSync.handoffState.blockedArtifactIds,
            blockedBy: providerSync.handoffState.blockedBy
          },
          handoffReceipts: providerSync.handoffState.receiptHistory,
          proofRequestCount: providerSync.proofRequests.length
        }
      : null,
    integrityManifest: integrityManifest
      ? {
          contract: integrityManifest.contract,
          digest: integrityManifest.digest,
          expectedDigest: integrityManifest.expectedDigest,
          expectedDigestSource: integrityManifest.expectedDigestSource,
          expectedDigestFormat: integrityManifest.expectedDigestFormat,
          matchesExpected: integrityManifest.matchesExpected,
          validForAudit: integrityManifest.validForAudit,
          entryCount: integrityManifest.entryCount,
          canonicalByteLength: integrityManifest.canonicalByteLength,
          proofEnvelope: integrityManifest.proofEnvelope,
          issue: integrityManifest.issue,
          expectedDigestIssue: integrityManifest.expectedDigestIssue,
          mismatchIssue: integrityManifest.mismatchIssue
        }
      : null,
    analytics: {
      contract: analytics.contract,
      generatedAt: analytics.generatedAt,
      counters: analytics.counters,
      tamperSummary: analytics.tamperSummary,
      byteSummary: analytics.byteSummary,
      algorithmCounts: analytics.algorithmCounts,
      exportSummary: {
        contract: analytics.exportSummary.contract,
        exportReady: analytics.exportSummary.exportReady,
        suggestedFilename: analytics.exportSummary.suggestedFilename,
        rowCount: analytics.exportSummary.rows.length,
        route: analytics.exportSummary.route,
        riskSummary: analytics.exportSummary.riskSummary,
        report: analytics.exportSummary.report
      },
      snapshots: analytics.timeline.snapshots,
      reportingEvents: analytics.reportingHistory.events,
      reportingHistory: {
        contract: analytics.reportingHistory.contract,
        generatedAt: analytics.reportingHistory.generatedAt,
        reportState: analytics.reportingHistory.reportState,
        countersDigest: analytics.reportingHistory.countersDigest,
        timelineDigest: analytics.reportingHistory.timelineDigest,
        latestEvent: analytics.reportingHistory.latestEvent,
        exportColumns: analytics.reportingHistory.exportColumns
      }
    }
  };
}

export function describeContentAddressSurface(input = {}) {
  const now = input.now || new Date().toISOString();
  const rawArtifacts = asArray(input.artifacts).map(normalizeArtifact);
  const persistedState = normalizePersistedState(input, rawArtifacts, now);
  const recoveredArtifacts = applyRecoveredState(rawArtifacts, persistedState);
  const command = normalizeCommand(input);
  const lifecycleSettings = normalizeLifecycleSettings(input, now);
  const providerContract = normalizeProviderContract(input);
  const requestContext = normalizeRequestContext(input, recoveredArtifacts);
  const workflowHandoffState = normalizeWorkflowHandoffState(input, requestContext);
  const commandBoundary = buildBoundaryContext(recoveredArtifacts, requestContext, command);
  const commandApplication = applyIdempotentCommand(
    recoveredArtifacts,
    command,
    now,
    commandBoundary,
    lifecycleSettings,
    persistedState
  );
  const lifecycleMutation = buildLifecycleMutation(
    command,
    commandApplication.result,
    lifecycleSettings,
    commandBoundary,
    now
  );
  const effectiveLifecycleSettings = lifecycleMutation.effectiveSettings;
  const artifacts = commandApplication.artifacts;
  const boundaryContext = buildBoundaryContext(artifacts, requestContext, command);
  const validation = summarizeValidation(artifacts, boundaryContext);
  const boundaryAuditHandoff = buildBoundaryAuditHandoff(
    now,
    artifacts,
    boundaryContext,
    requestContext,
    commandApplication.result,
    validation
  );
  const preview = buildPreview(artifacts, boundaryContext);
  const acceptance = buildAcceptance(validation, artifacts, boundaryContext, effectiveLifecycleSettings);
  const recovery = buildRecoveryReport(persistedState, artifacts);
  const integrityManifest = buildIntegrityManifest(
    input,
    now,
    artifacts,
    validation,
    acceptance,
    boundaryContext,
    requestContext
  );
  const operationalHealth = buildOperationalHealth(
    input,
    now,
    validation,
    acceptance,
    boundaryContext,
    recovery,
    commandApplication.result,
    effectiveLifecycleSettings,
    providerContract,
    integrityManifest
  );
  const lifecycleControls = buildLifecycleControls(
    effectiveLifecycleSettings,
    command,
    commandApplication.result,
    validation,
    acceptance,
    boundaryContext,
    now
  );
  const analytics = buildContentAddressAnalytics(
    input,
    now,
    artifacts,
    validation,
    acceptance,
    boundaryContext,
    recovery,
    commandApplication.result,
    requestContext,
    operationalHealth,
    integrityManifest
  );
  const providerSync = buildProviderSyncContract(
    input,
    providerContract,
    artifacts,
    validation,
    acceptance,
    boundaryContext,
    operationalHealth,
    requestContext,
    now
  );
  const nextSteps = buildNextSteps(
    validation,
    acceptance,
    boundaryContext,
    lifecycleControls,
    providerSync,
    operationalHealth,
    integrityManifest
  );
  const validationSummary = summarizeValidationForClients(
    validation,
    artifacts,
    acceptance,
    boundaryContext,
    requestContext,
    lifecycleControls,
    operationalHealth
  );
  const routeReadiness = buildRouteReadinessContract({
    now,
    preview,
    validation,
    acceptance,
    validationSummary,
    nextSteps,
    boundaryContext,
    lifecycleControls,
    providerSync,
    integrityManifest,
    operationalHealth,
    requestContext
  });
  const previewAcceptance = buildPreviewAcceptanceClientContract({
    now,
    preview,
    acceptance,
    validationSummary,
    routeReadiness,
    nextSteps,
    boundaryAuditHandoff,
    providerSync,
    integrityManifest,
    requestContext
  });
  const clientHandoffQueue = buildClientWorkflowHandoffQueue({
    input,
    now,
    requestContext,
    workflowHandoffState,
    routeReadiness,
    nextSteps,
    boundaryAuditHandoff,
    providerSync,
    operationalHealth
  });
  const clientRuntime = buildClientRuntimeState(
    artifacts,
    validation,
    acceptance,
    requestContext,
    boundaryContext,
    operationalHealth,
    analytics,
    lifecycleControls,
    providerSync,
    integrityManifest,
    validationSummary,
    nextSteps,
    routeReadiness,
    boundaryAuditHandoff,
    workflowHandoffState,
    previewAcceptance,
    clientHandoffQueue
  );
  const workflowHandoff = buildWorkflowHandoff(
    validation,
    acceptance,
    requestContext,
    clientRuntime,
    boundaryContext,
    providerSync,
    workflowHandoffState
  );
  const readiness = routeReadiness;
  const persistableState = buildPersistableState(
    now,
    artifacts,
    validation,
    acceptance,
    commandApplication.result,
    requestContext,
    boundaryContext,
    operationalHealth,
    analytics,
    lifecycleControls,
    providerSync,
    integrityManifest,
    boundaryAuditHandoff,
    lifecycleMutation,
    workflowHandoffState,
    workflowHandoff,
    clientHandoffQueue,
    persistedState
  );

  return {
    ok: validation.ok,
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: 'hosted-kernel content-address preview and acceptance contract',
    routeContracts: {
      preview: DEFAULT_PREVIEW_ROUTE,
      acceptance: DEFAULT_ACCEPTANCE_ROUTE,
      auditProof: DEFAULT_AUDIT_ROUTE
    },
    requestContext,
    workflowHandoffState,
    boundary: boundaryContext,
    boundaryAuditHandoff,
    preview,
    acceptance,
    previewAcceptance,
    clientRuntime,
    workflowHandoff,
    clientHandoffQueue,
    validationSummary,
    persistedState: persistableState,
    restartResume: persistableState.restartResume,
    recovery,
    lifecycleMutation,
    lifecycleControls,
    providerSync,
    integrityManifest,
    operationalHealth,
    analytics,
    commandResult: {
      contract: COMMAND_CONTRACT_VERSION,
      ...commandApplication.result,
      lifecycleMutation: lifecycleMutation.present
        ? {
            contract: lifecycleMutation.contract,
            applied: lifecycleMutation.applied,
            code: lifecycleMutation.code,
            fieldsChanged: lifecycleMutation.fieldsChanged,
            auditDigest: lifecycleMutation.auditDigest,
            effectiveSettings: lifecycleMutation.effectiveSettings,
            schedulePlan: lifecycleMutation.schedulePlan
          }
        : null
    },
    readiness,
    validation,
    nextSteps,
    auditProof: {
      generatedAt: now,
      algorithm: DEFAULT_ALGORITHM,
      tenantId: requestContext.tenantId,
      workspaceId: requestContext.workspaceId,
      boundaryContract: BOUNDARY_CONTRACT_VERSION,
      artifactCount: boundaryContext.visibleArtifactIds.length,
      acceptedCount: acceptance.accepted,
      valid: validation.ok,
      analyticsSnapshotId: analytics.timeline.snapshots.length > 0
        ? analytics.timeline.snapshots[analytics.timeline.snapshots.length - 1].snapshotId
        : null,
      manifestDigest: integrityManifest.digest,
      manifestContract: integrityManifest.contract,
      proofEnvelope: integrityManifest.validForAudit ? integrityManifest.proofEnvelope : null,
      exportReady: analytics.exportSummary.exportReady,
      entries: artifacts
        .filter((artifact) => boundaryContext.visibleArtifactIds.includes(artifact.id))
        .map((artifact) => ({
          artifactId: artifact.id,
          contentAddress: artifact.contentAddress,
          algorithm: artifact.algorithm,
          digest: artifact.digest,
          digestEncoding: artifact.digestEncoding,
          scopeBinding: artifact.scopeBinding,
          addressFormatIssues: artifact.addressFormatIssues,
          expectedDigestBytes: artifact.expectedDigestBytes,
          expectedDigestLength: artifact.expectedDigestLength,
          addressVerifiedByInlineContent: artifact.addressVerifiedByInlineContent,
          tamperSignals: artifact.tamperSignals,
          verified: artifact.proof.verified === true,
          verifiedAt: artifact.proof.verifiedAt || null
        }))
    },
    evidence: asArray(input.evidence)
  };
}

export default describeContentAddressSurface;
