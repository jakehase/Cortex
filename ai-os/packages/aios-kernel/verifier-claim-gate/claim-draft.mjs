export const surfaceId = "aios_verifier-claim-gate_claim-draft_063";
export const surfaceGroup = "verifier-claim-gate";
export const surfaceName = "claim-draft";

const DEFAULT_REQUIRED_CAPABILITIES = Object.freeze([
  'claim-draft:v1',
  'provider-attestation:v1',
  'audit-proof:v1'
]);

const HANDOFF_STATES = Object.freeze({
  READY: 'ready_for_verifier',
  BLOCKED: 'blocked_by_contract',
  NEEDS_PROVIDER_SYNC: 'needs_provider_sync',
  DEGRADED: 'degraded_provider_mode'
});

const DEFAULT_REQUIRED_ROLES = Object.freeze([
  'claim-draft-editor',
  'verifier-handoff-author'
]);

function asText(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function stableToken(value) {
  return asText(value)
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function uniqueList(values = []) {
  return [...new Set(values.map((value) => stableToken(value)).filter(Boolean))];
}

function asNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function epochMs(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function secondsUntil(value, now) {
  const target = epochMs(value);
  const baseline = epochMs(now);
  if (!target || !baseline || target <= baseline) {
    return 0;
  }
  return Math.ceil((target - baseline) / 1000);
}

function secondsSince(value, now) {
  const source = epochMs(value);
  const baseline = epochMs(now);
  if (!source || !baseline || source >= baseline) {
    return 0;
  }
  return Math.ceil((baseline - source) / 1000);
}

function parseBoolean(value, fallback = false) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const token = stableToken(value);
    if (['true', 'yes', 'enabled', 'on'].includes(token)) {
      return true;
    }
    if (['false', 'no', 'disabled', 'off'].includes(token)) {
      return false;
    }
  }
  return fallback;
}

function normalizeProvider(input = {}) {
  const provider = input.provider && typeof input.provider === 'object' ? input.provider : {};
  const capabilities = uniqueList([
    ...(Array.isArray(provider.capabilities) ? provider.capabilities : []),
    ...(Array.isArray(input.capabilities) ? input.capabilities : [])
  ]);
  return {
    providerId: stableToken(provider.providerId || input.providerId || 'unbound-provider'),
    serviceId: stableToken(provider.serviceId || input.serviceId || 'claim-draft-service'),
    contractVersion: asText(provider.contractVersion || input.contractVersion, '2026-07-claim-draft-v1'),
    capabilities,
    endpoint: asText(provider.endpoint || input.endpoint, null),
    syncCursor: asText(provider.syncCursor || input.syncCursor, null),
    contractEndpoint: asText(provider.contractEndpoint || input.contractEndpoint, null),
    supportedContractVersions: uniqueList(provider.supportedContractVersions || input.supportedContractVersions || []),
    handoffModes: uniqueList(provider.handoffModes || input.handoffModes || ['verifier-intake'])
  };
}

function normalizeClaim(input = {}) {
  const claim = input.claim && typeof input.claim === 'object' ? input.claim : input;
  const claimId = stableToken(claim.claimId || claim.id || input.claimId || `draft-${surfaceName}`);
  const evidence = Array.isArray(claim.evidence)
    ? claim.evidence
    : Array.isArray(input.evidence)
      ? input.evidence
      : [];
  return {
    claimId,
    tenantId: stableToken(claim.tenantId || input.tenantId || ''),
    workspaceId: stableToken(claim.workspaceId || input.workspaceId || ''),
    subject: asText(claim.subject || input.subject, 'unscoped-subject'),
    predicate: asText(claim.predicate || input.predicate, 'requires-verifier-claim-review'),
    evidence: evidence.map((item, index) => ({
      evidenceId: stableToken(item?.evidenceId || item?.id || `evidence-${index + 1}`),
      kind: stableToken(item?.kind || item?.type || 'supporting-record'),
      uri: asText(item?.uri || item?.url, null),
      digest: asText(item?.digest || item?.hash, null),
      tenantId: stableToken(item?.tenantId || item?.sourceTenantId || claim.tenantId || input.tenantId || ''),
      workspaceId: stableToken(item?.workspaceId || item?.sourceWorkspaceId || claim.workspaceId || input.workspaceId || ''),
      accessMode: stableToken(item?.accessMode || item?.visibility || 'workspace-bound') || 'workspace-bound',
      delegationId: stableToken(item?.delegationId || item?.grantId || item?.workspaceGrantId || '')
    }))
  };
}

function normalizeDraftRevisionContract(input = {}, claim, boundary, now) {
  const claimInput = input.claim && typeof input.claim === 'object' ? input.claim : {};
  const source = input.draftRevision && typeof input.draftRevision === 'object'
    ? input.draftRevision
    : claimInput.draftRevision && typeof claimInput.draftRevision === 'object'
      ? claimInput.draftRevision
      : input.revisionContract && typeof input.revisionContract === 'object'
        ? input.revisionContract
        : {};
  const request = input.request && typeof input.request === 'object' ? input.request : {};
  const client = input.client && typeof input.client === 'object'
    ? input.client
    : input.clientState && typeof input.clientState === 'object'
      ? input.clientState
      : {};
  const persisted = input.persistedState && typeof input.persistedState === 'object'
    ? input.persistedState
    : input.state && typeof input.state === 'object'
      ? input.state
      : {};
  const revision = Math.max(1, Math.floor(asNumber(
    source.revision ?? claimInput.revision ?? input.claimRevision ?? input.revision,
    1
  )));
  const baseRevision = Math.max(0, Math.floor(asNumber(source.baseRevision ?? source.parentRevision, Math.max(0, revision - 1))));
  const expectedRevision = source.expectedRevision === undefined
    && request.expectedRevision === undefined
    && client.expectedRevision === undefined
    ? null
    : Math.max(0, Math.floor(asNumber(source.expectedRevision ?? request.expectedRevision ?? client.expectedRevision, 0)));
  const persistedRevision = persisted.claimRevision === undefined && persisted.draftRevision === undefined
    ? null
    : Math.max(0, Math.floor(asNumber(persisted.claimRevision ?? persisted.draftRevision, 0)));
  const authorId = stableToken(source.authorId || source.editedBy || claimInput.authorId || input.authorId || boundary.actor.actorId);
  const updatedAt = asText(source.updatedAt || source.editedAt || claimInput.updatedAt || input.updatedAt, now);
  const updatedInFuture = secondsUntil(updatedAt, now) > 0;
  const sourceRefs = uniqueList([
    ...(Array.isArray(source.sourceRefs) ? source.sourceRefs : []),
    ...(Array.isArray(source.sources) ? source.sources : []),
    ...(Array.isArray(claimInput.sourceRefs) ? claimInput.sourceRefs : [])
  ]);
  const evidenceDigest = claim.evidence
    .map((item) => `${item.evidenceId}:${item.digest || item.uri || 'unsealed'}`)
    .join('|');
  const provenanceHash = stableToken([
    claim.claimId,
    revision,
    baseRevision,
    authorId || 'anonymous-actor',
    updatedAt,
    evidenceDigest || 'no-evidence'
  ].join(':')).slice(0, 120);
  const validationIssues = [
    ...(baseRevision >= revision ? [{
      code: 'claim_revision_base_not_prior',
      severity: 'error',
      message: 'Claim draft base revision must be lower than the current revision.',
      field: 'draftRevision.baseRevision',
      baseRevision,
      revision
    }] : []),
    ...(expectedRevision !== null && expectedRevision !== revision ? [{
      code: expectedRevision < revision ? 'claim_revision_stale_client' : 'claim_revision_future_client',
      severity: 'error',
      message: expectedRevision < revision
        ? 'Client is editing an older claim draft revision and must refresh before handoff.'
        : 'Client expected revision is ahead of the hosted-kernel claim draft revision.',
      field: 'draftRevision.expectedRevision',
      expectedRevision,
      revision
    }] : []),
    ...(persistedRevision !== null && persistedRevision > revision ? [{
      code: 'claim_revision_persisted_ahead',
      severity: 'error',
      message: 'Persisted claim draft revision is newer than the hydrated draft.',
      field: 'persistedState.claimRevision',
      persistedRevision,
      revision
    }] : []),
    ...(updatedInFuture ? [{
      code: 'claim_revision_timestamp_future',
      severity: 'warning',
      message: 'Claim draft revision timestamp is in the future relative to evaluation time.',
      field: 'draftRevision.updatedAt',
      updatedAt
    }] : []),
    ...(!authorId || authorId === 'anonymous-actor' ? [{
      code: 'claim_revision_author_missing',
      severity: 'warning',
      message: 'Claim draft revision should identify the editing actor for audit replay.',
      field: 'draftRevision.authorId'
    }] : [])
  ];
  return {
    contractType: 'verifier-claim-gate.claim-draft.revision-contract',
    contractVersion: 1,
    claimId: claim.claimId,
    revision,
    baseRevision,
    expectedRevision,
    persistedRevision,
    authorId: authorId || null,
    updatedAt,
    sourceRefs,
    provenanceHash,
    staleClient: expectedRevision !== null && expectedRevision < revision,
    savePrecondition: {
      method: 'If-Match',
      expectedRevision: revision,
      previousRevision: baseRevision,
      idempotencyScope: `claim-draft-revision-${stableToken(`${claim.claimId}:${revision}:${provenanceHash}`)}`
    },
    auditTrail: {
      eventType: 'claim-draft.revision.normalized',
      actorId: authorId || null,
      revision,
      baseRevision,
      provenanceHash,
      sourceRefs
    },
    validationIssues
  };
}

function normalizeBoundary(input = {}, claim, provider) {
  const actor = input.actor && typeof input.actor === 'object' ? input.actor : {};
  const policy = input.permissionPolicy && typeof input.permissionPolicy === 'object'
    ? input.permissionPolicy
    : {};
  const providerInput = input.provider && typeof input.provider === 'object' ? input.provider : {};
  const tenantId = stableToken(
    claim.tenantId
    || providerInput.tenantId
    || input.tenantId
    || policy.tenantId
    || ''
  );
  const workspaceId = stableToken(
    claim.workspaceId
    || providerInput.workspaceId
    || input.workspaceId
    || policy.workspaceId
    || ''
  );
  const actorTenantIds = uniqueList([
    ...(Array.isArray(actor.tenantIds) ? actor.tenantIds : []),
    ...(Array.isArray(input.actorTenantIds) ? input.actorTenantIds : []),
    actor.tenantId,
    input.actorTenantId
  ]);
  const actorWorkspaceIds = uniqueList([
    ...(Array.isArray(actor.workspaceIds) ? actor.workspaceIds : []),
    ...(Array.isArray(input.actorWorkspaceIds) ? input.actorWorkspaceIds : []),
    actor.workspaceId,
    input.actorWorkspaceId
  ]);
  const providerTenantIds = uniqueList([
    ...(Array.isArray(providerInput.allowedTenantIds) ? providerInput.allowedTenantIds : []),
    ...(Array.isArray(providerInput.tenantIds) ? providerInput.tenantIds : []),
    ...(Array.isArray(input.providerTenantIds) ? input.providerTenantIds : []),
    providerInput.tenantId,
    input.providerTenantId,
    tenantId
  ]);
  const providerWorkspaceIds = uniqueList([
    ...(Array.isArray(providerInput.allowedWorkspaceIds) ? providerInput.allowedWorkspaceIds : []),
    ...(Array.isArray(providerInput.workspaceIds) ? providerInput.workspaceIds : []),
    ...(Array.isArray(input.providerWorkspaceIds) ? input.providerWorkspaceIds : []),
    providerInput.workspaceId,
    input.providerWorkspaceId,
    workspaceId
  ]);
  const requiredRoles = uniqueList(
    policy.requiredRoles
    || input.requiredRoles
    || providerInput.requiredRoles
    || DEFAULT_REQUIRED_ROLES
  );
  const actorRoles = uniqueList([
    ...(Array.isArray(actor.roles) ? actor.roles : []),
    ...(Array.isArray(input.actorRoles) ? input.actorRoles : [])
  ]);
  return {
    tenantId,
    workspaceId,
    actor: {
      actorId: stableToken(actor.actorId || actor.id || input.actorId || 'anonymous-actor'),
      roles: actorRoles,
      tenantIds: actorTenantIds,
      workspaceIds: actorWorkspaceIds
    },
    providerScope: {
      providerId: provider.providerId,
      allowedTenantIds: providerTenantIds,
      allowedWorkspaceIds: providerWorkspaceIds
    },
    requiredRoles,
    isolationMode: stableToken(policy.isolationMode || input.isolationMode || 'strict') || 'strict'
  };
}

function evaluateBoundary(boundary) {
  const missingRoles = boundary.requiredRoles.filter((role) => !boundary.actor.roles.includes(role));
  const tenantScoped = Boolean(boundary.tenantId);
  const workspaceScoped = Boolean(boundary.workspaceId);
  const actorTenantAllowed = !tenantScoped
    || boundary.actor.tenantIds.length === 0
    || boundary.actor.tenantIds.includes(boundary.tenantId);
  const actorWorkspaceAllowed = !workspaceScoped
    || boundary.actor.workspaceIds.length === 0
    || boundary.actor.workspaceIds.includes(boundary.workspaceId);
  const providerTenantAllowed = tenantScoped
    && boundary.providerScope.allowedTenantIds.includes(boundary.tenantId);
  const providerWorkspaceAllowed = workspaceScoped
    && boundary.providerScope.allowedWorkspaceIds.includes(boundary.workspaceId);
  const permissionIssues = [
    ...(!tenantScoped ? ['tenant_scope_missing'] : []),
    ...(!workspaceScoped ? ['workspace_scope_missing'] : []),
    ...(missingRoles.length ? ['actor_role_missing'] : []),
    ...(!actorTenantAllowed ? ['actor_tenant_forbidden'] : []),
    ...(!actorWorkspaceAllowed ? ['actor_workspace_forbidden'] : []),
    ...(!providerTenantAllowed ? ['provider_tenant_forbidden'] : []),
    ...(!providerWorkspaceAllowed ? ['provider_workspace_forbidden'] : [])
  ];
  return {
    scoped: tenantScoped && workspaceScoped,
    allowed: permissionIssues.length === 0,
    missingScopeFields: [
      ...(!tenantScoped ? ['tenantId'] : []),
      ...(!workspaceScoped ? ['workspaceId'] : [])
    ],
    missingRoles,
    actorTenantAllowed,
    actorWorkspaceAllowed,
    providerTenantAllowed,
    providerWorkspaceAllowed,
    permissionIssues,
    handoffGuard: permissionIssues.length
      ? 'deny_verifier_handoff'
      : 'allow_verifier_handoff'
  };
}

function normalizeWorkspaceScopeContract(input = {}, claim, provider, boundary, boundarySummary, now) {
  const policy = input.permissionPolicy && typeof input.permissionPolicy === 'object'
    ? input.permissionPolicy
    : {};
  const scopeSource = input.workspaceScope && typeof input.workspaceScope === 'object'
    ? input.workspaceScope
    : input.scopeContract && typeof input.scopeContract === 'object'
      ? input.scopeContract
      : {};
  const rawDelegations = Array.isArray(scopeSource.delegations)
    ? scopeSource.delegations
    : Array.isArray(policy.workspaceDelegations)
      ? policy.workspaceDelegations
      : Array.isArray(input.workspaceDelegations)
        ? input.workspaceDelegations
        : [];
  const requiredDelegationRoles = uniqueList(
    scopeSource.requiredDelegationRoles
    || policy.requiredDelegationRoles
    || ['claim-draft-cross-workspace-review']
  );
  const providerAllowedWorkspaces = new Set(boundary.providerScope.allowedWorkspaceIds);
  const providerAllowedTenants = new Set(boundary.providerScope.allowedTenantIds);
  const delegations = rawDelegations.slice(0, 24).map((entry, index) => {
    const tenantId = stableToken(entry?.tenantId || entry?.sourceTenantId || boundary.tenantId);
    const workspaceId = stableToken(entry?.workspaceId || entry?.sourceWorkspaceId || entry?.fromWorkspaceId);
    const actorId = stableToken(entry?.actorId || entry?.grantedToActorId || boundary.actor.actorId);
    const providerId = stableToken(entry?.providerId || entry?.grantedToProviderId || provider.providerId);
    const roles = uniqueList(entry?.roles || entry?.scopes || entry?.permissions || []);
    const expiresAt = asText(entry?.expiresAt || entry?.validUntil, null);
    const expired = expiresAt ? secondsUntil(expiresAt, now) === 0 : false;
    return {
      delegationId: stableToken(entry?.delegationId || entry?.grantId || `workspace-delegation-${index + 1}`),
      tenantId,
      workspaceId,
      actorId,
      providerId,
      roles,
      expiresAt,
      expired
    };
  });
  const evidenceScopes = claim.evidence.map((item) => {
    const sameTenant = Boolean(boundary.tenantId && item.tenantId === boundary.tenantId);
    const sameWorkspace = Boolean(boundary.workspaceId && item.workspaceId === boundary.workspaceId);
    const providerTenantAllowed = providerAllowedTenants.has(item.tenantId);
    const providerWorkspaceAllowed = providerAllowedWorkspaces.has(item.workspaceId);
    const matchingDelegation = delegations.find((delegation) => {
      const tenantMatches = delegation.tenantId === item.tenantId;
      const workspaceMatches = delegation.workspaceId === item.workspaceId;
      const actorMatches = !delegation.actorId || delegation.actorId === boundary.actor.actorId;
      const providerMatches = !delegation.providerId || delegation.providerId === provider.providerId;
      const roleMatches = requiredDelegationRoles.length === 0
        || requiredDelegationRoles.some((role) => delegation.roles.includes(role));
      return tenantMatches
        && workspaceMatches
        && actorMatches
        && providerMatches
        && roleMatches
        && !delegation.expired;
    }) || null;
    const needsDelegation = sameTenant && !sameWorkspace;
    const authorized = sameTenant
      && providerTenantAllowed
      && (sameWorkspace || Boolean(matchingDelegation))
      && (sameWorkspace || providerWorkspaceAllowed);
    return {
      evidenceId: item.evidenceId,
      tenantId: item.tenantId || null,
      workspaceId: item.workspaceId || null,
      accessMode: item.accessMode,
      delegationId: matchingDelegation?.delegationId || null,
      presentedDelegationId: item.delegationId || null,
      delegationAuthorized: Boolean(matchingDelegation),
      sameTenant,
      sameWorkspace,
      providerTenantAllowed,
      providerWorkspaceAllowed,
      needsDelegation,
      authorized
    };
  });
  const validationIssues = evidenceScopes.flatMap((scope) => [
    ...(!scope.sameTenant ? [{
      code: 'evidence_tenant_boundary_mismatch',
      severity: 'error',
      field: 'claim.evidence.tenantId',
      evidenceId: scope.evidenceId,
      expectedTenantId: boundary.tenantId || null,
      actualTenantId: scope.tenantId,
      message: 'Evidence belongs to a different tenant than the claim draft boundary.'
    }] : []),
    ...(scope.sameTenant && scope.needsDelegation && !scope.delegationId ? [{
      code: scope.presentedDelegationId
        ? 'evidence_workspace_delegation_invalid'
        : 'evidence_workspace_delegation_missing',
      severity: 'error',
      field: 'claim.evidence.workspaceId',
      evidenceId: scope.evidenceId,
      expectedWorkspaceId: boundary.workspaceId || null,
      actualWorkspaceId: scope.workspaceId,
      presentedDelegationId: scope.presentedDelegationId,
      message: scope.presentedDelegationId
        ? 'Cross-workspace evidence delegation does not match an active claim-draft workspace grant.'
        : 'Cross-workspace evidence requires an explicit claim-draft workspace delegation.'
    }] : []),
    ...(!scope.providerTenantAllowed ? [{
      code: 'evidence_provider_tenant_scope_missing',
      severity: 'error',
      field: 'provider.allowedTenantIds',
      evidenceId: scope.evidenceId,
      tenantId: scope.tenantId,
      message: 'Provider scope does not include the evidence tenant.'
    }] : []),
    ...(scope.sameTenant && !scope.sameWorkspace && !scope.providerWorkspaceAllowed ? [{
      code: 'evidence_provider_workspace_scope_missing',
      severity: 'error',
      field: 'provider.allowedWorkspaceIds',
      evidenceId: scope.evidenceId,
      workspaceId: scope.workspaceId,
      message: 'Provider scope does not include delegated cross-workspace evidence.'
    }] : [])
  ]);
  const expiredDelegations = delegations.filter((delegation) => delegation.expired);
  return {
    contractType: 'verifier-claim-gate.claim-draft.workspace-scope-contract',
    contractVersion: 1,
    tenantId: boundary.tenantId || null,
    workspaceId: boundary.workspaceId || null,
    isolationMode: boundary.isolationMode,
    boundaryAllowed: boundarySummary.allowed,
    requiredDelegationRoles,
    evidenceScopes,
    delegations,
    crossWorkspaceEvidenceIds: evidenceScopes
      .filter((scope) => scope.needsDelegation)
      .map((scope) => scope.evidenceId),
    unauthorizedEvidenceIds: evidenceScopes
      .filter((scope) => !scope.authorized)
      .map((scope) => scope.evidenceId),
    expiredDelegationIds: expiredDelegations.map((delegation) => delegation.delegationId),
    allowed: boundarySummary.allowed
      && validationIssues.every((issue) => issue.severity !== 'error')
      && expiredDelegations.length === 0,
    handoffGuard: validationIssues.some((issue) => issue.severity === 'error') || expiredDelegations.length
      ? 'deny_cross_workspace_handoff'
      : boundarySummary.handoffGuard,
    auditTrail: {
      eventType: 'claim-draft.workspace-scope.evaluated',
      actorId: boundary.actor.actorId,
      providerId: provider.providerId,
      evidenceCount: evidenceScopes.length,
      crossWorkspaceEvidenceIds: evidenceScopes.filter((scope) => scope.needsDelegation).map((scope) => scope.evidenceId),
      unauthorizedEvidenceIds: evidenceScopes.filter((scope) => !scope.authorized).map((scope) => scope.evidenceId)
    },
    validationIssues: [
      ...validationIssues,
      ...expiredDelegations.map((delegation) => ({
        code: 'workspace_delegation_expired',
        severity: 'error',
        field: 'workspaceScope.delegations.expiresAt',
        delegationId: delegation.delegationId,
        workspaceId: delegation.workspaceId,
        message: 'Workspace delegation for claim-draft evidence has expired.'
      }))
    ]
  };
}

function normalizeVerifierHandoffAuthorization(input = {}, claim, provider, boundary, workspaceScope, draftRevision, now) {
  const verifierInput = input.verifier && typeof input.verifier === 'object'
    ? input.verifier
    : input.externalVerifier && typeof input.externalVerifier === 'object'
      ? input.externalVerifier
      : {};
  const source = input.verifierHandoffAuthorization && typeof input.verifierHandoffAuthorization === 'object'
    ? input.verifierHandoffAuthorization
    : input.verifierPolicy && typeof input.verifierPolicy === 'object'
      ? input.verifierPolicy
      : verifierInput.authorization && typeof verifierInput.authorization === 'object'
        ? verifierInput.authorization
        : {};
  const verifierId = stableToken(source.verifierId || verifierInput.verifierId || verifierInput.id || provider.providerId || 'verifier-intake');
  const recipientTenantIds = uniqueList([
    ...(Array.isArray(source.allowedTenantIds) ? source.allowedTenantIds : []),
    ...(Array.isArray(verifierInput.allowedTenantIds) ? verifierInput.allowedTenantIds : []),
    source.tenantId,
    verifierInput.tenantId,
    boundary.tenantId
  ]);
  const recipientWorkspaceIds = uniqueList([
    ...(Array.isArray(source.allowedWorkspaceIds) ? source.allowedWorkspaceIds : []),
    ...(Array.isArray(verifierInput.allowedWorkspaceIds) ? verifierInput.allowedWorkspaceIds : []),
    source.workspaceId,
    verifierInput.workspaceId,
    boundary.workspaceId
  ]);
  const recipientRoles = uniqueList([
    ...(Array.isArray(source.roles) ? source.roles : []),
    ...(Array.isArray(verifierInput.roles) ? verifierInput.roles : []),
    ...(Array.isArray(boundary.actor.roles) ? boundary.actor.roles : [])
  ]);
  const requiredRecipientRoles = uniqueList(source.requiredRoles || verifierInput.requiredRoles || []);
  const requestedActions = uniqueList(source.actions || verifierInput.actions || [
    'receive-claim-draft',
    'read-evidence-digest',
    'write-handoff-receipt'
  ]);
  const allowedActions = uniqueList(source.allowedActions || verifierInput.allowedActions || requestedActions);
  const missingActions = requestedActions.filter((action) => !allowedActions.includes(action));
  const missingRoles = requiredRecipientRoles.filter((role) => !recipientRoles.includes(role));
  const tenantAllowed = Boolean(boundary.tenantId && recipientTenantIds.includes(boundary.tenantId));
  const workspaceAllowed = Boolean(boundary.workspaceId && recipientWorkspaceIds.includes(boundary.workspaceId));
  const rawEvidenceRequested = parseBoolean(source.allowRawEvidence ?? verifierInput.allowRawEvidence, false);
  const discloseRawEvidence = rawEvidenceRequested
    && workspaceScope.allowed
    && workspaceScope.unauthorizedEvidenceIds.length === 0
    && workspaceScope.expiredDelegationIds.length === 0;
  const evidenceDisclosure = claim.evidence.map((item) => {
    const scope = workspaceScope.evidenceScopes.find((entry) => entry.evidenceId === item.evidenceId);
    const visible = Boolean(scope?.authorized && (item.digest || item.uri));
    return {
      evidenceId: item.evidenceId,
      tenantId: item.tenantId || null,
      workspaceId: item.workspaceId || null,
      disclosureMode: discloseRawEvidence && scope?.sameWorkspace ? 'raw-evidence' : 'digest-only',
      verifierVisible: visible,
      redacted: !visible || !discloseRawEvidence || !scope?.sameWorkspace,
      delegationId: scope?.delegationId || null
    };
  });
  const validationIssues = [
    ...(!tenantAllowed ? [{
      code: 'verifier_recipient_tenant_forbidden',
      severity: 'error',
      field: 'verifierHandoffAuthorization.allowedTenantIds',
      verifierId,
      expectedTenantId: boundary.tenantId || null,
      message: 'Verifier recipient is not authorized for the claim draft tenant.'
    }] : []),
    ...(!workspaceAllowed ? [{
      code: 'verifier_recipient_workspace_forbidden',
      severity: 'error',
      field: 'verifierHandoffAuthorization.allowedWorkspaceIds',
      verifierId,
      expectedWorkspaceId: boundary.workspaceId || null,
      message: 'Verifier recipient is not authorized for the claim draft workspace.'
    }] : []),
    ...(missingRoles.length ? [{
      code: 'verifier_recipient_role_missing',
      severity: 'error',
      field: 'verifierHandoffAuthorization.roles',
      verifierId,
      missingRoles,
      message: 'Verifier recipient lacks required roles for claim-draft handoff.'
    }] : []),
    ...(missingActions.length ? [{
      code: 'verifier_recipient_action_forbidden',
      severity: 'error',
      field: 'verifierHandoffAuthorization.allowedActions',
      verifierId,
      missingActions,
      message: 'Verifier recipient is not authorized for all requested handoff actions.'
    }] : []),
    ...(rawEvidenceRequested && !discloseRawEvidence ? [{
      code: 'verifier_raw_evidence_redacted',
      severity: 'warning',
      field: 'verifierHandoffAuthorization.allowRawEvidence',
      verifierId,
      message: 'Raw evidence disclosure was requested but the workspace boundary requires digest-only verifier handoff.'
    }] : [])
  ];
  const allowed = validationIssues.every((issue) => issue.severity !== 'error');
  return {
    contractType: 'verifier-claim-gate.claim-draft.verifier-handoff-authorization',
    contractVersion: 1,
    authorizationId: `verifier-auth-${stableToken(`${claim.claimId}:${verifierId}:${draftRevision.revision}:${boundary.tenantId}:${boundary.workspaceId}`)}`,
    verifierId,
    generatedAt: now,
    allowed,
    handoffGuard: allowed ? 'allow_verifier_recipient_handoff' : 'deny_verifier_recipient_handoff',
    scope: {
      tenantId: boundary.tenantId || null,
      workspaceId: boundary.workspaceId || null,
      recipientTenantIds,
      recipientWorkspaceIds,
      tenantAllowed,
      workspaceAllowed
    },
    permissions: {
      requestedActions,
      allowedActions,
      missingActions,
      requiredRoles: requiredRecipientRoles,
      recipientRoles,
      missingRoles
    },
    disclosure: {
      rawEvidenceRequested,
      rawEvidenceAllowed: discloseRawEvidence,
      defaultMode: discloseRawEvidence ? 'raw-evidence' : 'digest-only',
      redactedEvidenceIds: evidenceDisclosure.filter((entry) => entry.redacted).map((entry) => entry.evidenceId),
      evidence: evidenceDisclosure
    },
    auditTrail: {
      eventType: 'claim-draft.verifier-handoff.authorization.evaluated',
      actorId: boundary.actor.actorId,
      verifierId,
      claimId: claim.claimId,
      claimRevision: draftRevision.revision,
      tenantId: boundary.tenantId || null,
      workspaceId: boundary.workspaceId || null,
      allowed,
      disclosureMode: discloseRawEvidence ? 'raw-evidence' : 'digest-only'
    },
    validationIssues
  };
}

function negotiateCapabilities(providerCapabilities, requiredCapabilities) {
  const providerSet = new Set(providerCapabilities);
  const accepted = requiredCapabilities.filter((capability) => providerSet.has(capability));
  const missing = requiredCapabilities.filter((capability) => !providerSet.has(capability));
  return {
    accepted,
    missing,
    satisfied: missing.length === 0
  };
}

function buildProviderServiceContract(input, provider, claim, boundary, negotiation, boundarySummary, now) {
  const providerInput = input.provider && typeof input.provider === 'object' ? input.provider : {};
  const source = input.providerServiceContract && typeof input.providerServiceContract === 'object'
    ? input.providerServiceContract
    : input.serviceContract && typeof input.serviceContract === 'object'
      ? input.serviceContract
      : providerInput.serviceContract && typeof providerInput.serviceContract === 'object'
        ? providerInput.serviceContract
        : {};
  const requestedVersion = asText(source.requestedVersion || source.version || input.requiredContractVersion, provider.contractVersion);
  const supportedVersions = uniqueList([
    ...provider.supportedContractVersions,
    ...(Array.isArray(source.supportedVersions) ? source.supportedVersions : []),
    ...(Array.isArray(source.contractVersions) ? source.contractVersions : []),
    provider.contractVersion
  ]);
  const versionAccepted = !requestedVersion || supportedVersions.includes(stableToken(requestedVersion));
  const staleAfterSeconds = Math.max(60, Math.floor(asNumber(source.staleAfterSeconds ?? source.syncTtlSeconds, 900)));
  const lastSyncedAt = asText(source.lastSyncedAt || source.syncedAt || providerInput.lastSyncedAt, null);
  const lastSyncAgeSeconds = lastSyncedAt ? secondsSince(lastSyncedAt, now) : null;
  const cursor = asText(source.cursor || source.syncCursor || provider.syncCursor, null);
  const watermark = asText(source.watermark || source.syncWatermark || providerInput.syncWatermark, cursor);
  const pendingCursor = asText(source.pendingCursor || source.nextCursor, null);
  const requiredHandoffMode = stableToken(source.handoffMode || source.requiredHandoffMode || 'verifier-intake') || 'verifier-intake';
  const handoffModeAccepted = provider.handoffModes.length === 0 || provider.handoffModes.includes(requiredHandoffMode);
  const syncStale = lastSyncAgeSeconds === null || lastSyncAgeSeconds > staleAfterSeconds;
  const dispatchAllowed = versionAccepted
    && handoffModeAccepted
    && negotiation.satisfied
    && boundarySummary.allowed
    && !syncStale;
  const validationIssues = [
    ...(!versionAccepted ? [{
      code: 'provider_contract_version_unsupported',
      severity: 'error',
      message: 'Provider service contract does not support the requested claim-draft contract version.',
      field: 'provider.serviceContract.supportedVersions',
      requestedVersion,
      supportedVersions
    }] : []),
    ...(!handoffModeAccepted ? [{
      code: 'provider_handoff_mode_unsupported',
      severity: 'error',
      message: 'Provider service contract cannot dispatch claim drafts to the requested external handoff mode.',
      field: 'provider.serviceContract.handoffMode',
      requiredHandoffMode,
      supportedHandoffModes: provider.handoffModes
    }] : []),
    ...(syncStale ? [{
      code: 'provider_sync_metadata_stale',
      severity: lastSyncedAt ? 'warning' : 'error',
      message: lastSyncedAt
        ? 'Provider sync metadata is stale for claim-draft verifier handoff.'
        : 'Provider sync metadata is missing for claim-draft verifier handoff.',
      field: 'provider.serviceContract.lastSyncedAt',
      lastSyncedAt,
      staleAfterSeconds
    }] : [])
  ];
  return {
    contractType: 'verifier-claim-gate.claim-draft.provider-service-contract',
    contractVersion: 1,
    providerId: provider.providerId,
    serviceId: provider.serviceId,
    claimId: claim.claimId,
    negotiatedVersion: {
      requestedVersion,
      activeVersion: provider.contractVersion,
      supportedVersions,
      accepted: versionAccepted
    },
    capabilityProfile: {
      required: negotiation.accepted.concat(negotiation.missing),
      accepted: negotiation.accepted,
      missing: negotiation.missing,
      satisfied: negotiation.satisfied
    },
    syncMetadata: {
      cursor,
      watermark,
      pendingCursor,
      lastSyncedAt,
      lastSyncAgeSeconds,
      staleAfterSeconds,
      stale: syncStale,
      status: syncStale ? 'sync_required' : pendingCursor ? 'incremental_sync_available' : 'current'
    },
    handoffContract: {
      requiredMode: requiredHandoffMode,
      supportedModes: provider.handoffModes,
      endpoint: provider.endpoint,
      contractEndpoint: provider.contractEndpoint || provider.endpoint,
      boundaryGuard: boundarySummary.handoffGuard,
      dispatchAllowed,
      dispatchBlockers: [
        ...(!versionAccepted ? ['contract_version'] : []),
        ...(!handoffModeAccepted ? ['handoff_mode'] : []),
        ...(!negotiation.satisfied ? ['capabilities'] : []),
        ...(!boundarySummary.allowed ? ['tenant_workspace_boundary'] : []),
        ...(syncStale ? ['sync_metadata'] : [])
      ],
      scope: {
        tenantId: boundary.tenantId || null,
        workspaceId: boundary.workspaceId || null
      }
    },
    validationIssues
  };
}

function buildProof(claim, provider, negotiation, boundary, boundarySummary, draftRevision, workspaceScope, generatedAt) {
  const proofSubject = [
    surfaceId,
    claim.claimId,
    `rev-${draftRevision.revision}`,
    `base-${draftRevision.baseRevision}`,
    draftRevision.provenanceHash,
    boundary.tenantId || 'tenant-unscoped',
    boundary.workspaceId || 'workspace-unscoped',
    provider.providerId,
    provider.serviceId,
    provider.contractVersion,
    boundary.actor.actorId,
    boundary.requiredRoles.join('+'),
    negotiation.accepted.join('+'),
    workspaceScope.allowed ? 'workspace-scope-allowed' : 'workspace-scope-denied',
    workspaceScope.crossWorkspaceEvidenceIds.join('+'),
    workspaceScope.unauthorizedEvidenceIds.join('+'),
    claim.evidence.map((item) => `${item.evidenceId}:${item.digest || 'no-digest'}`).join('|')
  ].join('::');
  return {
    proofType: 'hosted-kernel-claim-draft-proof',
    proofVersion: 1,
    generatedAt,
    proofId: `proof-${stableToken(proofSubject).slice(0, 96)}`,
    subject: claim.subject,
    predicate: claim.predicate,
    evidenceCount: claim.evidence.length,
    revision: draftRevision.revision,
    baseRevision: draftRevision.baseRevision,
    provenanceHash: draftRevision.provenanceHash,
    tenantId: boundary.tenantId || null,
    workspaceId: boundary.workspaceId || null,
    actorId: boundary.actor.actorId,
    requiresExternalVerifier: !negotiation.satisfied || claim.evidence.length === 0,
    boundaryGuard: workspaceScope.handoffGuard || boundarySummary.handoffGuard,
    workspaceScope: {
      allowed: workspaceScope.allowed,
      crossWorkspaceEvidenceIds: workspaceScope.crossWorkspaceEvidenceIds,
      unauthorizedEvidenceIds: workspaceScope.unauthorizedEvidenceIds,
      expiredDelegationIds: workspaceScope.expiredDelegationIds
    }
  };
}

function summarizeValidation(claim, provider, negotiation, boundarySummary) {
  const issues = [];
  if (!claim.claimId || claim.claimId === `draft-${surfaceName}`) {
    issues.push({
      code: 'claim_id_missing',
      severity: 'error',
      message: 'Claim draft needs a stable claim id before verifier handoff.',
      field: 'claim.claimId'
    });
  }
  if (claim.subject === 'unscoped-subject') {
    issues.push({
      code: 'subject_unscoped',
      severity: 'error',
      message: 'Claim draft needs a scoped subject for verifier review.',
      field: 'claim.subject'
    });
  }
  if (!claim.evidence.length) {
    issues.push({
      code: 'evidence_missing',
      severity: 'error',
      message: 'At least one evidence record is required for verifier readiness.',
      field: 'claim.evidence'
    });
  }
  const undigestedEvidence = claim.evidence
    .filter((item) => !item.digest)
    .map((item) => item.evidenceId);
  if (undigestedEvidence.length) {
    issues.push({
      code: 'evidence_digest_missing',
      severity: 'warning',
      message: 'Evidence without digests can be previewed but should be sealed before acceptance.',
      field: 'claim.evidence.digest',
      evidenceIds: undigestedEvidence
    });
  }
  if (negotiation.missing.length) {
    issues.push({
      code: 'provider_capability_missing',
      severity: 'error',
      message: 'Provider does not satisfy the claim-draft verifier contract.',
      field: 'provider.capabilities',
      missingCapabilities: negotiation.missing
    });
  }
  if (!boundarySummary.scoped) {
    issues.push({
      code: 'workspace_scope_missing',
      severity: 'error',
      message: 'Claim draft needs tenant and workspace scope before verifier handoff.',
      field: 'scope.workspaceId',
      missing: boundarySummary.missingScopeFields
    });
  }
  if (boundarySummary.missingRoles.length) {
    issues.push({
      code: 'actor_role_missing',
      severity: 'error',
      message: 'Actor lacks required claim-draft handoff roles.',
      field: 'actor.roles',
      missingRoles: boundarySummary.missingRoles
    });
  }
  if (!boundarySummary.actorTenantAllowed || !boundarySummary.actorWorkspaceAllowed) {
    issues.push({
      code: 'actor_scope_forbidden',
      severity: 'error',
      message: 'Actor is not authorized for the claim draft tenant or workspace.',
      field: 'actor.scope'
    });
  }
  if (!boundarySummary.providerTenantAllowed || !boundarySummary.providerWorkspaceAllowed) {
    issues.push({
      code: 'provider_scope_forbidden',
      severity: 'error',
      message: 'Provider is not authorized to service this tenant workspace claim draft.',
      field: 'provider.scope'
    });
  }
  if (!provider.endpoint) {
    issues.push({
      code: 'provider_endpoint_missing',
      severity: 'warning',
      message: 'Provider endpoint is missing; route clients cannot deep-link to provider sync.',
      field: 'provider.endpoint'
    });
  }

  const errorCount = issues.filter((issue) => issue.severity === 'error').length;
  const warningCount = issues.filter((issue) => issue.severity === 'warning').length;
  return {
    valid: errorCount === 0,
    errorCount,
    warningCount,
    issues,
    summary: errorCount
      ? `${errorCount} blocking issue${errorCount === 1 ? '' : 's'} before verifier handoff`
      : warningCount
        ? `${warningCount} non-blocking warning${warningCount === 1 ? '' : 's'} before acceptance`
        : 'Claim draft contract is ready for verifier handoff'
  };
}

function mergeValidationIssues(baseSummary, additionalIssues = []) {
  const issues = [...baseSummary.issues, ...additionalIssues];
  const errorCount = issues.filter((issue) => issue.severity === 'error').length;
  const warningCount = issues.filter((issue) => issue.severity === 'warning').length;
  return {
    ...baseSummary,
    valid: errorCount === 0,
    errorCount,
    warningCount,
    issues,
    summary: errorCount
      ? `${errorCount} blocking issue${errorCount === 1 ? '' : 's'} before verifier handoff`
      : warningCount
        ? `${warningCount} non-blocking warning${warningCount === 1 ? '' : 's'} before acceptance`
        : baseSummary.summary
  };
}

function normalizeClientWorkflowIntent(input = {}, claim, boundary, draftRevision, proof, lifecycleSettings, serviceContract, now) {
  const request = input.request && typeof input.request === 'object' ? input.request : {};
  const client = input.client && typeof input.client === 'object'
    ? input.client
    : input.clientState && typeof input.clientState === 'object'
      ? input.clientState
      : {};
  const route = input.route && typeof input.route === 'object'
    ? input.route
    : request.route && typeof request.route === 'object'
      ? request.route
      : {};
  const params = route.params && typeof route.params === 'object'
    ? route.params
    : request.params && typeof request.params === 'object'
      ? request.params
      : {};
  const source = request.workflowIntent && typeof request.workflowIntent === 'object'
    ? request.workflowIntent
    : client.workflowIntent && typeof client.workflowIntent === 'object'
      ? client.workflowIntent
      : {};
  const requestedAction = stableToken(
    source.action
    || request.action
    || client.action
    || request.intent
    || client.intent
    || 'review'
  ) || 'review';
  const allowedActions = new Set([
    'review',
    'save-draft',
    'accept-draft',
    'provider-sync',
    'lifecycle-control',
    'verifier-handoff'
  ]);
  const requestedClaimRevision = source.claimRevision === undefined
    && request.claimRevision === undefined
    && client.claimRevision === undefined
    && params.claimRevision === undefined
    ? draftRevision.revision
    : Math.max(0, Math.floor(asNumber(
      source.claimRevision ?? request.claimRevision ?? client.claimRevision ?? params.claimRevision,
      0
    )));
  const requestedBaseRevision = source.claimBaseRevision === undefined && request.claimBaseRevision === undefined
    ? draftRevision.baseRevision
    : Math.max(0, Math.floor(asNumber(source.claimBaseRevision ?? request.claimBaseRevision, 0)));
  const requestedProofId = asText(source.proofId || request.proofId || client.proofId || params.proofId, proof.proofId);
  const requestedStateKey = stableToken(source.stateKey || request.stateKey || client.stateKey || params.stateKey || '');
  const confirmedProofId = asText(source.confirmedProofId || request.confirmedProofId || client.confirmedProofId, null);
  const confirmedProvenanceHash = asText(source.confirmedProvenanceHash || request.confirmedProvenanceHash, null);
  const acknowledgedIssueCodes = uniqueList([
    ...(Array.isArray(source.acknowledgedIssueCodes) ? source.acknowledgedIssueCodes : []),
    ...(Array.isArray(request.acknowledgedIssueCodes) ? request.acknowledgedIssueCodes : []),
    ...(Array.isArray(client.acknowledgedIssueCodes) ? client.acknowledgedIssueCodes : [])
  ]);
  const requiresSubmitConfirmation = ['accept-draft', 'verifier-handoff'].includes(requestedAction);
  const staleRevision = requestedClaimRevision !== draftRevision.revision;
  const staleBaseRevision = requestedBaseRevision !== draftRevision.baseRevision;
  const staleProof = requestedProofId !== proof.proofId;
  const proofUnconfirmed = requiresSubmitConfirmation && confirmedProofId !== proof.proofId;
  const provenanceUnconfirmed = requiresSubmitConfirmation && confirmedProvenanceHash !== draftRevision.provenanceHash;
  const lifecycleBlocksSubmit = ['accept-draft', 'verifier-handoff'].includes(requestedAction)
    && lifecycleSettings.blocksHandoff;
  const providerSyncRequired = requestedAction === 'verifier-handoff'
    && serviceContract.syncMetadata.stale;
  const validationIssues = [
    ...(!allowedActions.has(requestedAction) ? [{
      code: 'client_workflow_action_unknown',
      severity: 'error',
      field: 'request.workflowIntent.action',
      action: requestedAction,
      message: 'Client workflow intent action is not supported for claim-draft handoff.'
    }] : []),
    ...(staleRevision ? [{
      code: requestedClaimRevision < draftRevision.revision
        ? 'client_workflow_revision_stale'
        : 'client_workflow_revision_ahead',
      severity: 'error',
      field: 'request.workflowIntent.claimRevision',
      expected: draftRevision.revision,
      actual: requestedClaimRevision,
      message: 'Client workflow intent revision does not match the hosted claim-draft revision.'
    }] : []),
    ...(staleBaseRevision ? [{
      code: 'client_workflow_base_revision_mismatch',
      severity: 'error',
      field: 'request.workflowIntent.claimBaseRevision',
      expected: draftRevision.baseRevision,
      actual: requestedBaseRevision,
      message: 'Client workflow intent base revision does not match the current draft lineage.'
    }] : []),
    ...(staleProof ? [{
      code: 'client_workflow_proof_stale',
      severity: 'error',
      field: 'request.workflowIntent.proofId',
      expected: proof.proofId,
      actual: requestedProofId,
      message: 'Client workflow intent proof id is stale and cannot be used for verifier handoff.'
    }] : []),
    ...(proofUnconfirmed ? [{
      code: 'client_workflow_proof_confirmation_missing',
      severity: 'error',
      field: 'request.workflowIntent.confirmedProofId',
      expected: proof.proofId,
      actual: confirmedProofId,
      message: 'Submit workflow requires explicit confirmation of the current claim-draft proof id.'
    }] : []),
    ...(provenanceUnconfirmed ? [{
      code: 'client_workflow_provenance_confirmation_missing',
      severity: 'error',
      field: 'request.workflowIntent.confirmedProvenanceHash',
      expected: draftRevision.provenanceHash,
      actual: confirmedProvenanceHash,
      message: 'Submit workflow requires explicit confirmation of the current claim-draft provenance hash.'
    }] : []),
    ...(lifecycleBlocksSubmit ? [{
      code: 'client_workflow_lifecycle_gate_blocked',
      severity: 'error',
      field: 'request.workflowIntent.action',
      action: requestedAction,
      message: 'Client workflow cannot submit while claim-draft lifecycle controls block handoff.'
    }] : []),
    ...(providerSyncRequired ? [{
      code: 'client_workflow_provider_sync_required',
      severity: 'error',
      field: 'request.workflowIntent.action',
      action: requestedAction,
      message: 'Client workflow requested verifier handoff before provider sync metadata was current.'
    }] : [])
  ];
  const blockers = validationIssues.filter((issue) => issue.severity === 'error');
  const intentId = `intent-${stableToken([
    claim.claimId,
    requestedAction,
    draftRevision.revision,
    proof.proofId,
    requestedStateKey || 'no-state-key'
  ].join(':')).slice(0, 96)}`;
  return {
    contractType: 'verifier-claim-gate.claim-draft.client-workflow-intent',
    contractVersion: 1,
    intentId,
    requestedAction,
    hydratedAt: now,
    claimRef: {
      claimId: claim.claimId,
      tenantId: boundary.tenantId || null,
      workspaceId: boundary.workspaceId || null,
      claimRevision: draftRevision.revision,
      claimBaseRevision: draftRevision.baseRevision,
      provenanceHash: draftRevision.provenanceHash,
      proofId: proof.proofId,
      requestedStateKey: requestedStateKey || null
    },
    confirmation: {
      required: requiresSubmitConfirmation,
      proofConfirmed: !requiresSubmitConfirmation || confirmedProofId === proof.proofId,
      provenanceConfirmed: !requiresSubmitConfirmation || confirmedProvenanceHash === draftRevision.provenanceHash,
      acknowledgedIssueCodes
    },
    handoffGate: {
      allowed: blockers.length === 0,
      blockers: blockers.map((issue) => issue.code),
      route: blockers.length
        ? '/verifier-claim-gate/claim-draft/review'
        : requestedAction === 'verifier-handoff'
          ? '/verifier-claim-gate/verifier-intake'
          : requestedAction === 'provider-sync'
            ? '/verifier-claim-gate/provider-sync'
            : requestedAction === 'lifecycle-control'
              ? '/verifier-claim-gate/claim-draft/lifecycle'
              : '/verifier-claim-gate/claim-draft/review',
      method: ['save-draft', 'accept-draft', 'provider-sync', 'lifecycle-control', 'verifier-handoff'].includes(requestedAction)
        ? 'POST'
        : 'GET'
    },
    validationIssues
  };
}

function normalizeLifecycleSettings(input = {}, claim, boundary, now) {
  const source = input.lifecycle && typeof input.lifecycle === 'object'
    ? input.lifecycle
    : input.lifecycleSettings && typeof input.lifecycleSettings === 'object'
      ? input.lifecycleSettings
      : input.settings && typeof input.settings === 'object'
        ? input.settings.lifecycle || {}
        : {};
  const rawSchedule = source.schedule && typeof source.schedule === 'object' ? source.schedule : {};
  const enabled = parseBoolean(source.enabled, true);
  const requestedCommand = stableToken(source.command || source.requestedCommand || input.lifecycleCommand || '') || null;
  const mode = stableToken(source.mode || source.state || (enabled ? 'enabled' : 'disabled')) || 'enabled';
  const scheduleMode = stableToken(rawSchedule.mode || source.scheduleMode || (source.paused ? 'paused' : 'immediate')) || 'immediate';
  const runAt = asText(rawSchedule.runAt || source.runAt || source.scheduledAt, null);
  const runInSeconds = secondsUntil(runAt, now);
  const rawRunAtMs = runAt ? epochMs(runAt) : null;
  const nowMs = epochMs(now);
  const cadence = stableToken(rawSchedule.cadence || source.cadence || 'manual') || 'manual';
  const timezone = asText(rawSchedule.timezone || source.timezone, 'UTC');
  const disabledReason = asText(source.disabledReason || source.reason, null);
  const minLeadSeconds = Math.max(0, Math.floor(asNumber(rawSchedule.minLeadSeconds ?? source.minLeadSeconds, 0)));
  const maxLeadSeconds = Math.max(minLeadSeconds, Math.floor(asNumber(rawSchedule.maxLeadSeconds ?? source.maxLeadSeconds, 2592000)));
  const operatorNote = asText(source.operatorNote || source.note, null);
  const commandActorId = stableToken(source.commandActorId || source.operatorId || source.requestedBy || boundary.actor.actorId);
  const commandReason = asText(source.commandReason || source.reason || source.operatorReason || disabledReason, null);
  const commandRequestId = stableToken(source.commandRequestId || source.requestId || input.requestId || '');
  const commandRevision = source.commandRevision === undefined && source.expectedRevision === undefined
    ? null
    : Math.max(0, Math.floor(asNumber(source.commandRevision ?? source.expectedRevision, 0)));
  const commandAllowed = !requestedCommand || [
    'enable',
    'disable',
    'pause',
    'resume',
    'schedule',
    'run-now'
  ].includes(requestedCommand);
  const mutatingCommands = new Set(['enable', 'disable', 'pause', 'resume', 'schedule', 'run-now']);
  const reasonRequiredCommands = new Set(['disable', 'pause', 'schedule']);
  const commandRequiresReason = Boolean(requestedCommand && reasonRequiredCommands.has(requestedCommand));
  const commandActorAuthorized = Boolean(commandActorId && commandActorId === boundary.actor.actorId);
  const paused = !enabled || mode === 'paused' || scheduleMode === 'paused';
  const scheduled = scheduleMode === 'scheduled' || Boolean(runAt);
  const scheduleDue = !scheduled || runInSeconds === 0 || requestedCommand === 'run-now';
  const scheduleExpired = Boolean(runAt && rawRunAtMs && nowMs && rawRunAtMs <= nowMs);
  const scheduleTooSoon = Boolean(requestedCommand !== 'run-now' && runAt && !scheduleExpired && runInSeconds < minLeadSeconds);
  const scheduleTooFar = Boolean(requestedCommand !== 'run-now' && runAt && runInSeconds > maxLeadSeconds);
  const scheduleValid = !scheduled
    || requestedCommand === 'run-now'
    || (Boolean(runAt) && !scheduleTooSoon && !scheduleTooFar);
  const commandTransitionErrors = [
    ...(requestedCommand === 'enable' && enabled ? [{
      code: 'lifecycle_enable_noop',
      severity: 'warning',
      message: 'Claim-draft lifecycle is already enabled.',
      field: 'lifecycle.command'
    }] : []),
    ...(requestedCommand === 'disable' && !enabled ? [{
      code: 'lifecycle_disable_noop',
      severity: 'warning',
      message: 'Claim-draft lifecycle is already disabled.',
      field: 'lifecycle.command'
    }] : []),
    ...(requestedCommand === 'disable' && !disabledReason ? [{
      code: 'lifecycle_disable_reason_missing',
      severity: 'error',
      message: 'Disable command requires an operator reason for audit replay.',
      field: 'lifecycle.disabledReason'
    }] : []),
    ...(requestedCommand === 'pause' && paused ? [{
      code: 'lifecycle_pause_noop',
      severity: 'warning',
      message: 'Claim-draft lifecycle is already paused.',
      field: 'lifecycle.command'
    }] : []),
    ...(requestedCommand === 'resume' && !paused ? [{
      code: 'lifecycle_resume_noop',
      severity: 'warning',
      message: 'Claim-draft lifecycle is not paused.',
      field: 'lifecycle.command'
    }] : []),
    ...(requestedCommand === 'run-now' && !enabled ? [{
      code: 'lifecycle_run_now_disabled',
      severity: 'error',
      message: 'Run-now cannot execute while claim-draft lifecycle is disabled.',
      field: 'lifecycle.command'
    }] : []),
    ...(requestedCommand === 'run-now' && paused && enabled ? [{
      code: 'lifecycle_run_now_paused',
      severity: 'error',
      message: 'Run-now cannot execute while claim-draft lifecycle is paused.',
      field: 'lifecycle.command'
    }] : []),
    ...(requestedCommand === 'schedule' && !runAt ? [{
      code: 'lifecycle_schedule_command_missing_run_at',
      severity: 'error',
      message: 'Schedule command requires a target runAt timestamp.',
      field: 'lifecycle.schedule.runAt'
    }] : []),
    ...(requestedCommand && !commandActorAuthorized ? [{
      code: 'lifecycle_command_actor_mismatch',
      severity: 'error',
      message: 'Lifecycle command actor must match the hydrated claim-draft actor for audit replay.',
      field: 'lifecycle.commandActorId',
      expectedActorId: boundary.actor.actorId,
      actualActorId: commandActorId || null
    }] : []),
    ...(requestedCommand && commandRequiresReason && !commandReason ? [{
      code: 'lifecycle_command_reason_missing',
      severity: 'error',
      message: 'Lifecycle command requires an operator reason before it can be persisted.',
      field: 'lifecycle.commandReason',
      command: requestedCommand
    }] : []),
    ...(requestedCommand && commandRevision !== null && commandRevision < 1 ? [{
      code: 'lifecycle_command_revision_invalid',
      severity: 'error',
      message: 'Lifecycle command expected revision must be a positive persisted-state revision.',
      field: 'lifecycle.commandRevision',
      commandRevision
    }] : [])
  ];
  const scheduleWindowIssues = [
    ...(scheduleTooSoon ? [{
      code: 'lifecycle_schedule_too_soon',
      severity: 'error',
      message: 'Scheduled claim-draft handoff is earlier than the configured minimum lead time.',
      field: 'lifecycle.schedule.runAt',
      minLeadSeconds,
      runInSeconds
    }] : []),
    ...(scheduleTooFar ? [{
      code: 'lifecycle_schedule_too_far',
      severity: 'error',
      message: 'Scheduled claim-draft handoff is beyond the configured maximum lead time.',
      field: 'lifecycle.schedule.runAt',
      maxLeadSeconds,
      runInSeconds
    }] : [])
  ];
  const validationIssues = [
    ...(!enabled && !disabledReason ? [{
      code: 'lifecycle_disabled_reason_missing',
      severity: 'error',
      message: 'Disabled claim-draft lifecycle controls require an operator reason.',
      field: 'lifecycle.disabledReason'
    }] : []),
    ...(!commandAllowed ? [{
      code: 'lifecycle_command_unknown',
      severity: 'error',
      message: 'Lifecycle command is not supported for claim-draft handoff control.',
      field: 'lifecycle.command',
      command: requestedCommand
    }] : []),
    ...(scheduled && !runAt ? [{
      code: 'lifecycle_schedule_missing_run_at',
      severity: 'error',
      message: 'Scheduled claim-draft handoff requires a runAt timestamp.',
      field: 'lifecycle.schedule.runAt'
    }] : []),
    ...(runAt && runInSeconds === 0 && requestedCommand !== 'run-now' ? [{
      code: 'lifecycle_schedule_expired',
      severity: 'warning',
      message: 'Scheduled claim-draft handoff time has elapsed; run now or reschedule.',
      field: 'lifecycle.schedule.runAt'
    }] : []),
    ...scheduleWindowIssues,
    ...(!['manual', 'once', 'hourly', 'daily', 'weekly'].includes(cadence) ? [{
      code: 'lifecycle_cadence_invalid',
      severity: 'error',
      message: 'Claim-draft lifecycle cadence must be manual, once, hourly, daily, or weekly.',
      field: 'lifecycle.schedule.cadence',
      cadence
    }] : []),
    ...commandTransitionErrors
  ];
  const commandSeed = `${claim.claimId}:${boundary.tenantId || 'tenant'}:${boundary.workspaceId || 'workspace'}`;
  const lifecycleBlocked = !enabled || paused || (scheduled && !scheduleDue) || validationIssues.some((issue) => issue.severity === 'error');
  const nextLifecycleAction = validationIssues.some((issue) => issue.severity === 'error')
    ? 'repair_lifecycle_settings'
    : !enabled
      ? 'enable_claim_draft_lifecycle'
      : paused
        ? 'resume_claim_draft_lifecycle'
        : scheduled && !scheduleDue
          ? 'wait_for_scheduled_handoff'
          : requestedCommand === 'run-now'
            ? 'execute_handoff_now'
            : 'lifecycle_clear';
  const commandValidationCodes = validationIssues
    .filter((issue) => issue.field?.startsWith('lifecycle.'))
    .map((issue) => issue.code);
  const commandAccepted = Boolean(
    requestedCommand
    && commandAllowed
    && mutatingCommands.has(requestedCommand)
    && !commandValidationCodes.length
  );
  const commandId = requestedCommand
    ? `cmd-${stableToken(`${commandSeed}:lifecycle:${requestedCommand}:${commandRequestId || 'request'}:${runAt || 'now'}`)}`
    : null;
  const commandVersion = requestedCommand
    ? `lifecycle-command-${stableToken(`${claim.claimId}:${requestedCommand}:${runAt || cadence}:${commandActorId || 'actor'}`).slice(0, 80)}`
    : null;
  const commandBodyContract = requestedCommand ? {
    commandId,
    command: requestedCommand,
    claimId: claim.claimId,
    tenantId: boundary.tenantId || 'required-tenant-id',
    workspaceId: boundary.workspaceId || 'required-workspace-id',
    actorId: boundary.actor.actorId,
    commandActorId: commandActorId || 'required-actor-id',
    commandReason,
    commandRequestId: commandRequestId || null,
    expectedRevision: commandRevision,
    enabled,
    mode: enabled ? mode : 'disabled',
    schedule: {
      mode: scheduleMode,
      runAt,
      cadence,
      timezone
    },
    generatedAt: now
  } : null;
  const commandEffects = {
    enable: { nextMode: 'enabled', clearsDisabledReason: true, requiresAuditReason: false },
    disable: { nextMode: 'disabled', requiresAuditReason: true, clearsSchedule: false },
    pause: { nextMode: 'paused', preservesSchedule: true, requiresAuditReason: true },
    resume: { nextMode: scheduled ? 'scheduled' : 'enabled', preservesSchedule: scheduled, requiresAuditReason: false },
    schedule: { nextMode: 'scheduled', runAt, cadence, timezone, requiresAuditReason: true },
    runNow: { nextMode: 'enabled', dispatchIntent: 'immediate_verifier_handoff', bypassesSchedule: true }
  };
  return {
    contractType: 'verifier-claim-gate.claim-draft.lifecycle-settings',
    contractVersion: 1,
    enabled,
    mode: enabled ? mode : 'disabled',
    requestedCommand,
    operatorNote,
    paused,
    scheduled,
    disabledReason,
    blocksHandoff: lifecycleBlocked,
    commandRequest: {
      present: Boolean(requestedCommand),
      command: requestedCommand,
      commandId,
      commandVersion,
      requestId: commandRequestId || null,
      actorId: commandActorId || null,
      actorAuthorized: commandActorAuthorized,
      reason: commandReason,
      reasonRequired: commandRequiresReason,
      expectedRevision: commandRevision,
      accepted: commandAccepted,
      rejected: Boolean(requestedCommand && !commandAccepted),
      rejectionCodes: commandAccepted ? [] : commandValidationCodes,
      method: requestedCommand ? 'POST' : null,
      route: requestedCommand ? '/verifier-claim-gate/claim-draft/lifecycle' : null,
      idempotencyKey: requestedCommand
        ? `claim-draft-lifecycle-${stableToken(`${commandSeed}:${requestedCommand}:${commandRequestId || commandVersion}`)}`
        : null,
      bodyContract: commandBodyContract
    },
    schedule: {
      mode: scheduleMode,
      runAt,
      runInSeconds,
      cadence,
      timezone,
      minLeadSeconds,
      maxLeadSeconds,
      valid: scheduleValid,
      due: scheduleDue,
      expired: scheduleExpired,
      holdReason: scheduled && !scheduleDue ? 'scheduled_run_window_pending' : null
    },
    nextAction: {
      action: nextLifecycleAction,
      route: '/verifier-claim-gate/claim-draft/lifecycle',
      runnable: nextLifecycleAction === 'execute_handoff_now' || nextLifecycleAction === 'lifecycle_clear',
      blocked: lifecycleBlocked,
      reason: validationIssues.find((issue) => issue.severity === 'error')?.message
        || (scheduled && !scheduleDue ? 'Claim-draft handoff is waiting for the scheduled run window.' : null),
      retryAfterMs: scheduled && !scheduleDue ? runInSeconds * 1000 : null
    },
    controls: {
      enable: { enabled: !enabled, commandId: `cmd-${stableToken(`${commandSeed}:lifecycle:enable`)}`, requiresReason: false },
      disable: { enabled, commandId: `cmd-${stableToken(`${commandSeed}:lifecycle:disable`)}`, requiresReason: true },
      pause: { enabled: enabled && !paused, commandId: `cmd-${stableToken(`${commandSeed}:lifecycle:pause`)}`, requiresReason: true },
      resume: { enabled: paused && enabled, commandId: `cmd-${stableToken(`${commandSeed}:lifecycle:resume`)}`, requiresReason: false },
      schedule: { enabled: enabled && scheduleValid, commandId: `cmd-${stableToken(`${commandSeed}:lifecycle:schedule`)}`, requiresRunAt: true, requiresReason: true },
      runNow: { enabled: enabled && !paused && scheduleValid, commandId: `cmd-${stableToken(`${commandSeed}:lifecycle:run-now`)}`, bypassesSchedule: true }
    },
    commandEffects,
    validationIssues
  };
}

function buildPreview(claim, provider, validationSummary) {
  const evidenceRows = claim.evidence.map((item) => ({
    evidenceId: item.evidenceId,
    label: `${item.kind}${item.digest ? ' / sealed' : ' / digest pending'}`,
    uri: item.uri,
    digest: item.digest,
    verifierVisible: Boolean(item.digest || item.uri)
  }));
  return {
    title: `${claim.subject} -> ${claim.predicate}`,
    subtitle: `Provider ${provider.providerId} via ${provider.serviceId}`,
    statusLabel: validationSummary.valid ? 'Ready for verifier preview' : 'Needs draft fixes',
    evidenceRows,
    emptyState: evidenceRows.length
      ? null
      : 'No evidence is attached to this draft yet.',
    badges: [
      validationSummary.valid ? 'contract-ready' : 'contract-blocked',
      evidenceRows.some((row) => !row.digest) ? 'digest-review' : 'sealed-evidence',
      provider.endpoint ? 'provider-linked' : 'provider-unlinked'
    ]
  };
}

function buildReadiness(claim, provider, negotiation, validationSummary, boundarySummary, lifecycleSettings, serviceContract, workspaceScope, verifierAuthorization, operationalHealth, clientWorkflowIntent) {
  const checks = [
    { key: 'capabilities', ready: negotiation.satisfied, weight: 20 },
    { key: 'evidence', ready: claim.evidence.length > 0, weight: 20 },
    { key: 'digests', ready: claim.evidence.length > 0 && claim.evidence.every((item) => item.digest), weight: 10 },
    { key: 'subject', ready: claim.subject !== 'unscoped-subject', weight: 10 },
    { key: 'tenantWorkspaceBoundary', ready: boundarySummary.allowed, weight: 5 },
    { key: 'workspaceScopeContract', ready: workspaceScope.allowed, weight: 3 },
    { key: 'verifierRecipientAuthorization', ready: verifierAuthorization.allowed, weight: 5 },
    { key: 'lifecycleControls', ready: !lifecycleSettings.blocksHandoff, weight: 7 },
    { key: 'clientWorkflowIntent', ready: clientWorkflowIntent?.handoffGate.allowed === true, weight: 5 },
    { key: 'providerEndpoint', ready: Boolean(provider.endpoint), weight: 5 },
    { key: 'providerServiceContract', ready: serviceContract?.handoffContract.dispatchAllowed === true, weight: 5 },
    { key: 'providerOperationalHealth', ready: operationalHealth?.canProceed === true, weight: 5 }
  ];
  const score = checks.reduce((total, check) => total + (check.ready ? check.weight : 0), 0);
  return {
    score,
    level: validationSummary.valid && !lifecycleSettings.blocksHandoff && score >= 85
      ? 'ready'
      : validationSummary.errorCount || lifecycleSettings.blocksHandoff
        ? 'blocked'
        : 'review',
    checks
  };
}

function buildAcceptance(input, readiness, proof, validationSummary, lifecycleSettings, generatedAt) {
  const acceptance = input.acceptance && typeof input.acceptance === 'object' ? input.acceptance : {};
  const decision = stableToken(acceptance.decision || acceptance.status || 'pending') || 'pending';
  const accepted = ['accepted', 'approved', 'confirmed'].includes(decision);
  const canAccept = validationSummary.valid && readiness.score >= 60 && !lifecycleSettings.blocksHandoff;
  return {
    status: accepted && canAccept ? 'accepted' : canAccept ? 'awaiting_acceptance' : 'not_acceptable',
    canAccept,
    accepted,
    acceptedBy: asText(acceptance.acceptedBy || acceptance.actor, null),
    acceptedAt: accepted ? asText(acceptance.acceptedAt, generatedAt) : null,
    decision,
    proofId: proof.proofId,
    requiredAction: canAccept
      ? accepted
        ? 'submit_claim_draft'
        : 'collect_user_acceptance'
      : 'resolve_validation_issues'
  };
}

function buildExternalHandoffEnvelope(claim, provider, boundary, draftRevision, serviceContract, readiness, acceptance, handoffState, proof, persistenceState, operationalHealth, clientWorkflowIntent, verifierAuthorization, now) {
  const dispatchable = acceptance.accepted
    && readiness.level === 'ready'
    && serviceContract.handoffContract.dispatchAllowed
    && persistenceState.recovery.restartSafe
    && operationalHealth.canProceed
    && clientWorkflowIntent.handoffGate.allowed
    && verifierAuthorization.allowed
    && handoffState === HANDOFF_STATES.READY;
  const holdReasons = [
    ...serviceContract.handoffContract.dispatchBlockers,
    ...clientWorkflowIntent.handoffGate.blockers,
    ...(!acceptance.accepted ? ['acceptance_pending'] : []),
    ...(readiness.level !== 'ready' ? ['readiness_not_ready'] : []),
    ...(!persistenceState.recovery.restartSafe ? ['persistence_recovery'] : []),
    ...(!operationalHealth.canProceed ? ['provider_health'] : []),
    ...(!clientWorkflowIntent.handoffGate.allowed ? ['client_workflow_intent'] : []),
    ...(!verifierAuthorization.allowed ? ['verifier_recipient_authorization'] : []),
    ...(handoffState !== HANDOFF_STATES.READY ? ['handoff_state_not_ready'] : [])
  ];
  const handoffId = `handoff-${stableToken(`${claim.claimId}:${provider.providerId}:${proof.proofId}`)}`;
  return {
    contractType: 'verifier-claim-gate.claim-draft.external-handoff-envelope',
    contractVersion: 1,
    handoffId,
    state: dispatchable
      ? 'dispatchable'
      : serviceContract.syncMetadata.stale
        ? 'waiting_provider_sync'
        : serviceContract.handoffContract.dispatchBlockers.length
          ? 'blocked_by_provider_contract'
          : 'waiting_acceptance',
    target: serviceContract.handoffContract.requiredMode,
    endpoint: serviceContract.handoffContract.endpoint,
    contractEndpoint: serviceContract.handoffContract.contractEndpoint,
    claimRef: {
      claimId: claim.claimId,
      claimRevision: draftRevision.revision,
      provenanceHash: draftRevision.provenanceHash,
      tenantId: boundary.tenantId || null,
      workspaceId: boundary.workspaceId || null,
      providerId: provider.providerId,
      serviceId: provider.serviceId,
      proofId: proof.proofId,
      stateKey: persistenceState.stateKey,
      expectedRevision: persistenceState.revision,
      recoveryStatus: persistenceState.recovery.status,
      restartSafe: persistenceState.recovery.restartSafe
    },
    syncRef: {
      cursor: serviceContract.syncMetadata.cursor,
      watermark: serviceContract.syncMetadata.watermark,
      pendingCursor: serviceContract.syncMetadata.pendingCursor,
      status: serviceContract.syncMetadata.status,
      lastSyncedAt: serviceContract.syncMetadata.lastSyncedAt
    },
    healthRef: {
      status: operationalHealth.status,
      mode: operationalHealth.mode,
      proofId: operationalHealth.healthProof.proofId,
      callbackState: operationalHealth.callbackHealth.state,
      callbackReady: operationalHealth.callbackHealth.ready,
      callbackSubscriptionId: operationalHealth.callbackHealth.subscriptionId,
      callbackIssueCodes: operationalHealth.callbackHealth.issueCodes,
      retryAttempt: operationalHealth.retryPolicy.attempt,
      maxAttempts: operationalHealth.retryPolicy.maxAttempts,
      retryAfterSeconds: operationalHealth.retryPolicy.retryAfterSeconds,
      retryBlockedReason: operationalHealth.retryBlockedReason,
      failureCodes: operationalHealth.failureState.failures.map((failure) => failure.code),
      degradedFallbackEnabled: operationalHealth.degradedFallback.enabled
    },
    clientWorkflowRef: {
      intentId: clientWorkflowIntent.intentId,
      requestedAction: clientWorkflowIntent.requestedAction,
      allowed: clientWorkflowIntent.handoffGate.allowed,
      blockers: clientWorkflowIntent.handoffGate.blockers,
      confirmationRequired: clientWorkflowIntent.confirmation.required,
      proofConfirmed: clientWorkflowIntent.confirmation.proofConfirmed,
      provenanceConfirmed: clientWorkflowIntent.confirmation.provenanceConfirmed
    },
    verifierAuthorizationRef: {
      authorizationId: verifierAuthorization.authorizationId,
      verifierId: verifierAuthorization.verifierId,
      allowed: verifierAuthorization.allowed,
      handoffGuard: verifierAuthorization.handoffGuard,
      disclosureMode: verifierAuthorization.disclosure.defaultMode,
      redactedEvidenceIds: verifierAuthorization.disclosure.redactedEvidenceIds,
      issueCodes: verifierAuthorization.validationIssues.map((issue) => issue.code)
    },
    dispatchCommand: {
      method: persistenceState.idempotentCommands.verifierHandoff.method,
      route: persistenceState.idempotentCommands.verifierHandoff.route,
      enabled: dispatchable,
      idempotencyKey: persistenceState.idempotentCommands.verifierHandoff.idempotencyKey,
      bodyContract: {
        handoffId,
        claimId: claim.claimId,
        claimRevision: draftRevision.revision,
        claimBaseRevision: draftRevision.baseRevision,
        provenanceHash: draftRevision.provenanceHash,
        tenantId: boundary.tenantId || 'required-tenant-id',
        workspaceId: boundary.workspaceId || 'required-workspace-id',
        providerId: provider.providerId,
        serviceId: provider.serviceId,
        proofId: proof.proofId,
        acceptedAt: acceptance.acceptedAt,
        syncCursor: serviceContract.syncMetadata.cursor,
        syncWatermark: serviceContract.syncMetadata.watermark,
        providerHealthProofId: operationalHealth.healthProof.proofId,
        providerHealthMode: operationalHealth.mode,
        providerCallbackState: operationalHealth.callbackHealth.state,
        providerCallbackSubscriptionId: operationalHealth.callbackHealth.subscriptionId,
        clientWorkflowIntentId: clientWorkflowIntent.intentId,
        clientRequestedAction: clientWorkflowIntent.requestedAction,
        verifierAuthorizationId: verifierAuthorization.authorizationId,
        verifierId: verifierAuthorization.verifierId,
        evidenceDisclosureMode: verifierAuthorization.disclosure.defaultMode,
        redactedEvidenceIds: verifierAuthorization.disclosure.redactedEvidenceIds,
        stateKey: persistenceState.stateKey,
        expectedRevision: persistenceState.revision,
        recoveryStatus: persistenceState.recovery.status
      }
    },
    degradedFallbackCommand: {
      method: 'POST',
      route: operationalHealth.degradedFallback.route,
      enabled: operationalHealth.degradedFallback.enabled && !dispatchable,
      commandId: operationalHealth.degradedFallback.commandId,
      requiresOperatorAck: operationalHealth.degradedFallback.requiresOperatorAck,
      bodyContract: {
        handoffId,
        claimId: claim.claimId,
        claimRevision: draftRevision.revision,
        tenantId: boundary.tenantId || 'required-tenant-id',
        workspaceId: boundary.workspaceId || 'required-workspace-id',
        providerId: provider.providerId,
        serviceId: provider.serviceId,
        proofId: proof.proofId,
        providerHealthProofId: operationalHealth.healthProof.proofId,
        providerCallbackState: operationalHealth.callbackHealth.state,
        providerCallbackIssueCodes: operationalHealth.callbackHealth.issueCodes,
        clientWorkflowIntentId: clientWorkflowIntent.intentId,
        verifierAuthorizationId: verifierAuthorization.authorizationId,
        evidenceDisclosureMode: verifierAuthorization.disclosure.defaultMode,
        retryAttempt: operationalHealth.retryPolicy.attempt,
        retryAfterSeconds: operationalHealth.retryPolicy.retryAfterSeconds,
        idempotencyKey: operationalHealth.retryPolicy.idempotencyKey
      }
    },
    holdReasons: [...new Set(holdReasons)],
    generatedAt: now
  };
}

function normalizeProviderHandoffReceipt(input, claim, provider, boundary, serviceContract, externalHandoff, persistenceState, proof, now) {
  const handoffInput = input.externalHandoff && typeof input.externalHandoff === 'object'
    ? input.externalHandoff
    : {};
  const source = input.providerHandoffReceipt && typeof input.providerHandoffReceipt === 'object'
    ? input.providerHandoffReceipt
    : input.handoffReceipt && typeof input.handoffReceipt === 'object'
      ? input.handoffReceipt
      : handoffInput.receipt && typeof handoffInput.receipt === 'object'
        ? handoffInput.receipt
        : {};
  const receiptPresent = Object.keys(source).length > 0;
  const rawStatus = stableToken(source.status || source.state || source.disposition || (receiptPresent ? 'received' : 'pending')) || 'pending';
  const status = ['acknowledged', 'accepted', 'received', 'completed'].includes(rawStatus)
    ? 'acknowledged'
    : ['rejected', 'failed', 'nack', 'denied'].includes(rawStatus)
      ? 'rejected'
      : ['conflict', 'stale', 'out-of-date'].includes(rawStatus)
        ? 'conflict'
        : receiptPresent
          ? rawStatus
          : externalHandoff.dispatchCommand.enabled
            ? 'awaiting_provider_receipt'
            : 'not_dispatched';
  const receiptProviderId = stableToken(source.providerId || provider.providerId);
  const receiptServiceId = stableToken(source.serviceId || provider.serviceId);
  const receiptClaimId = stableToken(source.claimId || claim.claimId);
  const receiptProofId = asText(source.proofId, proof.proofId);
  const receiptStateKey = stableToken(source.stateKey || persistenceState.stateKey);
  const receiptIdempotencyKey = stableToken(source.idempotencyKey || source.key || externalHandoff.dispatchCommand.idempotencyKey);
  const receiptRevision = source.expectedRevision === undefined && source.revision === undefined
    ? persistenceState.revision
    : Math.max(0, Math.floor(asNumber(source.expectedRevision ?? source.revision, 0)));
  const receiptWatermark = asText(source.syncWatermark || source.watermark, serviceContract.syncMetadata.watermark);
  const receiptCursor = asText(source.syncCursor || source.cursor, serviceContract.syncMetadata.cursor);
  const acceptedAt = asText(source.acceptedAt || source.acknowledgedAt || source.receivedAt || source.completedAt, null);
  const rejectedAt = asText(source.rejectedAt || source.failedAt, null);
  const rejectionCode = stableToken(source.rejectionCode || source.errorCode || source.reasonCode || '') || null;
  const rejectionMessage = asText(source.rejectionMessage || source.errorMessage || source.message, null);
  const mismatchIssues = receiptPresent ? [
    ...(receiptProviderId !== provider.providerId ? [{
      code: 'provider_receipt_provider_mismatch',
      severity: 'error',
      field: 'providerHandoffReceipt.providerId',
      expected: provider.providerId,
      actual: receiptProviderId,
      message: 'Provider handoff receipt does not match the negotiated provider.'
    }] : []),
    ...(receiptServiceId !== provider.serviceId ? [{
      code: 'provider_receipt_service_mismatch',
      severity: 'error',
      field: 'providerHandoffReceipt.serviceId',
      expected: provider.serviceId,
      actual: receiptServiceId,
      message: 'Provider handoff receipt does not match the negotiated service.'
    }] : []),
    ...(receiptClaimId !== claim.claimId ? [{
      code: 'provider_receipt_claim_mismatch',
      severity: 'error',
      field: 'providerHandoffReceipt.claimId',
      expected: claim.claimId,
      actual: receiptClaimId,
      message: 'Provider handoff receipt is for a different claim draft.'
    }] : []),
    ...(receiptProofId !== proof.proofId ? [{
      code: 'provider_receipt_proof_stale',
      severity: 'warning',
      field: 'providerHandoffReceipt.proofId',
      expected: proof.proofId,
      actual: receiptProofId,
      message: 'Provider handoff receipt references an older claim-draft proof.'
    }] : []),
    ...(receiptStateKey !== persistenceState.stateKey ? [{
      code: 'provider_receipt_state_key_mismatch',
      severity: 'error',
      field: 'providerHandoffReceipt.stateKey',
      expected: persistenceState.stateKey,
      actual: receiptStateKey,
      message: 'Provider handoff receipt cannot be reconciled with the persisted claim-draft state.'
    }] : []),
    ...(receiptRevision !== persistenceState.revision ? [{
      code: 'provider_receipt_revision_conflict',
      severity: receiptRevision < persistenceState.revision ? 'warning' : 'error',
      field: 'providerHandoffReceipt.expectedRevision',
      expected: persistenceState.revision,
      actual: receiptRevision,
      message: 'Provider handoff receipt revision differs from the current persisted claim-draft revision.'
    }] : []),
    ...(receiptIdempotencyKey !== externalHandoff.dispatchCommand.idempotencyKey ? [{
      code: 'provider_receipt_idempotency_mismatch',
      severity: 'error',
      field: 'providerHandoffReceipt.idempotencyKey',
      expected: externalHandoff.dispatchCommand.idempotencyKey,
      actual: receiptIdempotencyKey,
      message: 'Provider handoff receipt idempotency key does not match the dispatched command.'
    }] : []),
    ...(receiptWatermark !== serviceContract.syncMetadata.watermark ? [{
      code: 'provider_receipt_watermark_drift',
      severity: 'warning',
      field: 'providerHandoffReceipt.syncWatermark',
      expected: serviceContract.syncMetadata.watermark,
      actual: receiptWatermark,
      message: 'Provider receipt sync watermark differs from the current service contract watermark.'
    }] : [])
  ] : [];
  const rejectionIssue = status === 'rejected' ? [{
    code: 'provider_handoff_rejected',
    severity: 'error',
    field: 'providerHandoffReceipt.status',
    rejectionCode,
    message: rejectionMessage || 'Provider rejected the verifier claim-draft handoff.'
  }] : [];
  const conflictIssue = status === 'conflict' ? [{
    code: 'provider_handoff_receipt_conflict',
    severity: 'error',
    field: 'providerHandoffReceipt.status',
    message: 'Provider reported a handoff receipt conflict; refresh sync metadata before retrying.'
  }] : [];
  const validationIssues = [...mismatchIssues, ...rejectionIssue, ...conflictIssue];
  const hasBlockingIssue = validationIssues.some((issue) => issue.severity === 'error');
  const reconciled = receiptPresent && status === 'acknowledged' && !hasBlockingIssue;
  const checkpoint = {
    cursor: receiptCursor,
    watermark: receiptWatermark,
    receivedAt: acceptedAt || rejectedAt || asText(source.receivedAt, null),
    providerReceiptId: asText(source.receiptId || source.ackId || source.id, null),
    providerTraceId: asText(source.traceId || source.requestId, null)
  };
  return {
    contractType: 'verifier-claim-gate.claim-draft.provider-handoff-receipt',
    contractVersion: 1,
    receiptId: `receipt-${stableToken(`${externalHandoff.handoffId}:${receiptIdempotencyKey}:${status}`)}`,
    handoffId: externalHandoff.handoffId,
    state: reconciled
      ? 'reconciled'
      : hasBlockingIssue
        ? 'requires_operator_review'
        : receiptPresent
          ? 'receipt_pending_reconciliation'
          : externalHandoff.dispatchCommand.enabled
            ? 'awaiting_provider_receipt'
            : 'not_dispatched',
    status,
    receiptPresent,
    accepted: reconciled,
    terminal: reconciled || status === 'rejected',
    checkpoint,
    providerAck: {
      providerId: receiptProviderId,
      serviceId: receiptServiceId,
      claimId: receiptClaimId,
      proofId: receiptProofId,
      stateKey: receiptStateKey,
      expectedRevision: receiptRevision,
      idempotencyKey: receiptIdempotencyKey,
      acceptedAt,
      rejectedAt,
      rejectionCode,
      rejectionMessage
    },
    syncReconciliation: {
      required: receiptPresent && (!reconciled || receiptWatermark !== serviceContract.syncMetadata.watermark),
      route: '/verifier-claim-gate/provider-sync/reconcile',
      method: 'POST',
      bodyContract: {
        handoffId: externalHandoff.handoffId,
        receiptId: `receipt-${stableToken(`${externalHandoff.handoffId}:${receiptIdempotencyKey}:${status}`)}`,
        claimId: claim.claimId,
        tenantId: boundary.tenantId || 'required-tenant-id',
        workspaceId: boundary.workspaceId || 'required-workspace-id',
        providerId: provider.providerId,
        serviceId: provider.serviceId,
        proofId: proof.proofId,
        stateKey: persistenceState.stateKey,
        expectedRevision: persistenceState.revision,
        receiptStatus: status,
        receiptCursor,
        receiptWatermark
      }
    },
    validationIssues,
    generatedAt: now
  };
}

function normalizeProviderCallbackContract(input, claim, provider, boundary, draftRevision, serviceContract, proof, now) {
  const providerInput = input.provider && typeof input.provider === 'object' ? input.provider : {};
  const source = input.providerCallbackContract && typeof input.providerCallbackContract === 'object'
    ? input.providerCallbackContract
    : input.callbackContract && typeof input.callbackContract === 'object'
      ? input.callbackContract
      : providerInput.callbackContract && typeof providerInput.callbackContract === 'object'
        ? providerInput.callbackContract
        : {};
  const events = uniqueList(
    source.events
    || source.supportedEvents
    || providerInput.callbackEvents
    || [
      'claim-draft.handoff.accepted',
      'claim-draft.handoff.rejected',
      'claim-draft.sync.watermark-advanced'
    ]
  );
  const requiredEvents = uniqueList(
    source.requiredEvents
    || input.requiredCallbackEvents
    || ['claim-draft.handoff.accepted', 'claim-draft.handoff.rejected']
  );
  const missingEvents = requiredEvents.filter((event) => !events.includes(event));
  const required = parseBoolean(source.required ?? providerInput.callbackRequired, true);
  const callbackEndpoint = asText(source.endpoint || source.callbackEndpoint || providerInput.callbackEndpoint, null);
  const ackEndpoint = asText(source.ackEndpoint || source.acknowledgementEndpoint || providerInput.ackEndpoint, callbackEndpoint);
  const secretRef = asText(source.secretRef || source.signingSecretRef || providerInput.callbackSecretRef, null);
  const signatureHeader = asText(source.signatureHeader || providerInput.signatureHeader, 'x-aios-provider-signature');
  const schemaVersion = stableToken(source.schemaVersion || source.eventSchemaVersion || 'claim-draft-provider-event-v1')
    || 'claim-draft-provider-event-v1';
  const supportedSchemas = uniqueList([
    ...(Array.isArray(source.supportedSchemas) ? source.supportedSchemas : []),
    ...(Array.isArray(source.eventSchemas) ? source.eventSchemas : []),
    schemaVersion
  ]);
  const schemaAccepted = supportedSchemas.includes('claim-draft-provider-event-v1')
    || supportedSchemas.includes(schemaVersion);
  const replayWindowSeconds = Math.max(60, Math.floor(asNumber(source.replayWindowSeconds ?? source.maxReplayAgeSeconds, 300)));
  const lastEventAt = asText(source.lastEventAt || source.lastCallbackAt || providerInput.lastCallbackAt, null);
  const lastEventAgeSeconds = lastEventAt ? secondsSince(lastEventAt, now) : null;
  const expectedWatermark = serviceContract.syncMetadata.watermark;
  const lastWatermark = asText(source.lastWatermark || source.watermark || providerInput.callbackWatermark, expectedWatermark);
  const watermarkAligned = !expectedWatermark || !lastWatermark || lastWatermark === expectedWatermark;
  const enabled = !required || Boolean(callbackEndpoint && ackEndpoint && secretRef && !missingEvents.length && schemaAccepted);
  const validationIssues = [
    ...(required && !callbackEndpoint ? [{
      code: 'provider_callback_endpoint_missing',
      severity: 'error',
      field: 'provider.callbackContract.endpoint',
      message: 'Provider callback endpoint is required to reconcile asynchronous verifier handoff state.'
    }] : []),
    ...(required && !ackEndpoint ? [{
      code: 'provider_callback_ack_endpoint_missing',
      severity: 'error',
      field: 'provider.callbackContract.ackEndpoint',
      message: 'Provider callback acknowledgement endpoint is required for idempotent handoff event processing.'
    }] : []),
    ...(required && !secretRef ? [{
      code: 'provider_callback_secret_missing',
      severity: 'error',
      field: 'provider.callbackContract.secretRef',
      message: 'Provider callback contract needs a signing secret reference before external handoff.'
    }] : []),
    ...(missingEvents.length ? [{
      code: 'provider_callback_event_missing',
      severity: 'error',
      field: 'provider.callbackContract.events',
      missingEvents,
      message: 'Provider callback contract does not cover required claim-draft handoff events.'
    }] : []),
    ...(!schemaAccepted ? [{
      code: 'provider_callback_schema_unsupported',
      severity: 'error',
      field: 'provider.callbackContract.supportedSchemas',
      schemaVersion,
      supportedSchemas,
      message: 'Provider callback schema is not compatible with claim-draft handoff events.'
    }] : []),
    ...(!watermarkAligned ? [{
      code: 'provider_callback_watermark_drift',
      severity: 'warning',
      field: 'provider.callbackContract.watermark',
      expectedWatermark,
      actualWatermark: lastWatermark,
      message: 'Provider callback watermark differs from the negotiated sync watermark.'
    }] : [])
  ];
  const subscriptionId = `callback-${stableToken(`${claim.claimId}:${provider.providerId}:${schemaVersion}:${requiredEvents.join('+')}`)}`;
  return {
    contractType: 'verifier-claim-gate.claim-draft.provider-callback-contract',
    contractVersion: 1,
    subscriptionId,
    required,
    enabled,
    state: enabled
      ? 'subscribed'
      : required
        ? 'subscription_blocked'
        : 'callbacks_optional',
    providerId: provider.providerId,
    serviceId: provider.serviceId,
    claimRef: {
      claimId: claim.claimId,
      claimRevision: draftRevision.revision,
      tenantId: boundary.tenantId || null,
      workspaceId: boundary.workspaceId || null,
      proofId: proof.proofId
    },
    eventContract: {
      schemaVersion,
      supportedSchemas,
      requiredEvents,
      supportedEvents: events,
      missingEvents,
      signatureHeader,
      secretRef,
      replayWindowSeconds,
      idempotencyFields: ['eventId', 'handoffId', 'claimId', 'claimRevision', 'providerId', 'watermark']
    },
    syncBridge: {
      expectedWatermark,
      lastWatermark,
      watermarkAligned,
      lastEventAt,
      lastEventAgeSeconds,
      eventStateField: 'providerHandoffReceipt.status'
    },
    subscribeCommand: {
      method: 'PUT',
      route: '/verifier-claim-gate/provider-callback/subscriptions',
      enabled: required && validationIssues.every((issue) => issue.severity !== 'error'),
      bodyContract: {
        subscriptionId,
        claimId: claim.claimId,
        claimRevision: draftRevision.revision,
        providerId: provider.providerId,
        serviceId: provider.serviceId,
        tenantId: boundary.tenantId || 'required-tenant-id',
        workspaceId: boundary.workspaceId || 'required-workspace-id',
        callbackEndpoint,
        ackEndpoint,
        schemaVersion,
        requiredEvents,
        signatureHeader,
        secretRef,
        syncWatermark: expectedWatermark,
        proofId: proof.proofId
      }
    },
    ackCommandTemplate: {
      method: 'POST',
      route: ackEndpoint || '/verifier-claim-gate/provider-callback/ack',
      enabled,
      bodyContract: {
        subscriptionId,
        eventId: 'required-provider-event-id',
        claimId: claim.claimId,
        claimRevision: draftRevision.revision,
        providerId: provider.providerId,
        serviceId: provider.serviceId,
        acceptedProofId: proof.proofId,
        syncWatermark: expectedWatermark,
        receivedAt: now
      }
    },
    externalStateMap: {
      'claim-draft.handoff.accepted': 'provider_receipt_acknowledged',
      'claim-draft.handoff.rejected': 'provider_receipt_rejected',
      'claim-draft.sync.watermark-advanced': 'provider_sync_reconcile_required'
    },
    validationIssues
  };
}

function buildOperationalHealth(input, claim, provider, validationSummary, providerCallbackContract, now) {
  const providerInput = input.provider && typeof input.provider === 'object' ? input.provider : {};
  const source = input.operationalHealth && typeof input.operationalHealth === 'object'
    ? input.operationalHealth
    : input.health && typeof input.health === 'object'
      ? input.health
      : providerInput.health && typeof providerInput.health === 'object'
        ? providerInput.health
        : {};
  const status = stableToken(source.status || source.state || (provider.endpoint ? 'healthy' : 'degraded')) || 'healthy';
  const knownStatuses = new Set([
    'healthy',
    'degraded',
    'down',
    'offline',
    'unreachable',
    'failed',
    'circuit-open',
    'rate-limited',
    'recovering'
  ]);
  const consecutiveFailures = Math.max(0, Math.floor(asNumber(source.consecutiveFailures ?? source.failureCount, 0)));
  const retryAttempt = Math.max(0, Math.floor(asNumber(source.retryAttempt ?? source.retryCount, consecutiveFailures)));
  const maxAttempts = Math.max(1, Math.floor(asNumber(source.maxAttempts ?? source.retryMaxAttempts, 5)));
  const baseDelayMs = Math.max(250, Math.floor(asNumber(source.baseDelayMs, 1000)));
  const maxDelayMs = Math.max(baseDelayMs, Math.floor(asNumber(source.maxDelayMs, 30000)));
  const retryAfterSeconds = Math.max(0, Math.floor(asNumber(source.retryAfterSeconds ?? source.retryAfter, 0)));
  const circuitOpenSeconds = secondsUntil(source.circuitOpenUntil, now);
  const lastCheckedAt = asText(source.lastCheckedAt || source.checkedAt, now);
  const heartbeatAgeSeconds = secondsSince(lastCheckedAt, now);
  const staleAfterSeconds = Math.max(30, Math.floor(asNumber(source.staleAfterSeconds ?? source.healthTtlSeconds, 300)));
  const heartbeatStale = heartbeatAgeSeconds > staleAfterSeconds;
  const callbackIssueCodes = providerCallbackContract.validationIssues.map((issue) => issue.code);
  const callbackBlockingIssues = providerCallbackContract.validationIssues.filter((issue) => issue.severity === 'error');
  const callbackWatermarkDrift = callbackIssueCodes.includes('provider_callback_watermark_drift');
  const callbackEventStale = providerCallbackContract.syncBridge.lastEventAgeSeconds !== null
    && providerCallbackContract.syncBridge.lastEventAgeSeconds > providerCallbackContract.eventContract.replayWindowSeconds;
  const callbackReady = !providerCallbackContract.required
    || (providerCallbackContract.enabled && callbackBlockingIssues.length === 0 && !callbackEventStale);
  const callbackState = callbackReady
    ? 'callback_reconciliation_ready'
    : callbackEventStale
      ? 'callback_replay_window_stale'
      : providerCallbackContract.state;
  const exponentialDelayMs = Math.min(maxDelayMs, baseDelayMs * (2 ** Math.min(retryAttempt, 6)));
  const retryDelayMs = Math.max(exponentialDelayMs, retryAfterSeconds * 1000, circuitOpenSeconds * 1000);
  const rawFailures = Array.isArray(source.failures)
    ? source.failures
    : source.lastFailure
      ? [source.lastFailure]
      : [];
  const failures = rawFailures.map((failure, index) => {
    const code = stableToken(failure?.code || failure?.reason || `provider_failure_${index + 1}`);
    const category = ['auth_denied', 'permission_denied', 'forbidden'].includes(code)
      ? 'authorization'
      : ['contract_rejected', 'schema_invalid', 'unsupported_version'].includes(code)
        ? 'contract'
        : ['rate_limited', 'quota_exceeded', 'too_many_requests'].includes(code)
          ? 'throttle'
          : ['provider_timeout', 'timeout', 'network_timeout', 'unreachable'].includes(code)
            ? 'transport'
            : 'runtime';
    return {
      code,
      category,
      message: asText(failure?.message, code === 'provider_timeout'
        ? 'Provider sync timed out while preparing verifier handoff.'
        : 'Provider health check reported a claim-draft handoff failure.'),
      occurredAt: asText(failure?.occurredAt || failure?.at, null),
      retryable: failure?.retryable === false ? false : !['authorization', 'contract'].includes(category),
      field: asText(failure?.field, null),
      traceId: asText(failure?.traceId || failure?.requestId, null)
    };
  });
  const providerUnavailable = ['down', 'offline', 'unreachable', 'failed'].includes(status);
  const circuitOpen = circuitOpenSeconds > 0 || status === 'circuit-open';
  const rateLimited = retryAfterSeconds > 0 || status === 'rate-limited';
  const retryExhausted = retryAttempt >= maxAttempts;
  const invalidStatus = !knownStatuses.has(status);
  const callbackBlocking = providerCallbackContract.required && !callbackReady;
  const degraded = providerUnavailable
    || circuitOpen
    || rateLimited
    || heartbeatStale
    || callbackWatermarkDrift
    || callbackEventStale
    || consecutiveFailures > 0
    || !provider.endpoint
    || invalidStatus;
  const nonRetryableFailures = failures.filter((failure) => !failure.retryable);
  const blocking = providerUnavailable || circuitOpen || retryExhausted || nonRetryableFailures.length > 0 || callbackBlocking;
  const canRetry = degraded && !blocking && validationSummary.valid;
  const canProceed = validationSummary.valid && !blocking && !invalidStatus;
  const retryBlockedReason = !validationSummary.valid
    ? 'validation_blocked'
    : nonRetryableFailures.length
      ? 'non_retryable_provider_failure'
      : callbackBlocking
        ? 'provider_callback_contract_blocked'
      : retryExhausted
        ? 'retry_budget_exhausted'
        : circuitOpen
          ? 'provider_circuit_open'
          : providerUnavailable
            ? 'provider_unavailable'
            : null;
  const validationIssues = [
    ...(invalidStatus ? [{
      code: 'provider_health_status_unknown',
      severity: 'error',
      field: 'operationalHealth.status',
      status,
      message: 'Provider health status is not recognized by the claim-draft retry contract.'
    }] : []),
    ...(heartbeatStale ? [{
      code: 'provider_health_heartbeat_stale',
      severity: 'warning',
      field: 'operationalHealth.lastCheckedAt',
      lastCheckedAt,
      heartbeatAgeSeconds,
      staleAfterSeconds,
      message: 'Provider health heartbeat is stale for claim-draft verifier handoff.'
    }] : []),
    ...(retryExhausted ? [{
      code: 'provider_retry_budget_exhausted',
      severity: 'error',
      field: 'operationalHealth.retryAttempt',
      retryAttempt,
      maxAttempts,
      message: 'Provider retry budget is exhausted; operator review is required before another claim-draft sync attempt.'
    }] : []),
    ...nonRetryableFailures.map((failure) => ({
      code: 'provider_failure_non_retryable',
      severity: 'error',
      field: failure.field || 'operationalHealth.failures',
      failureCode: failure.code,
      failureCategory: failure.category,
      message: failure.message
    })),
    ...(callbackBlocking ? [{
      code: 'provider_callback_health_blocked',
      severity: 'error',
      field: 'provider.callbackContract',
      subscriptionId: providerCallbackContract.subscriptionId,
      callbackState,
      issueCodes: callbackIssueCodes,
      message: 'Provider callback reconciliation is not healthy enough for claim-draft verifier handoff.'
    }] : []),
    ...(callbackEventStale ? [{
      code: 'provider_callback_event_stream_stale',
      severity: 'warning',
      field: 'provider.callbackContract.lastEventAt',
      lastEventAt: providerCallbackContract.syncBridge.lastEventAt,
      lastEventAgeSeconds: providerCallbackContract.syncBridge.lastEventAgeSeconds,
      replayWindowSeconds: providerCallbackContract.eventContract.replayWindowSeconds,
      message: 'Provider callback event stream is older than the configured replay window.'
    }] : [])
  ];
  const actionableErrors = [
    ...(!provider.endpoint ? [{
      code: 'provider_endpoint_missing',
      severity: 'warning',
      action: 'link_provider_endpoint',
      route: '/verifier-claim-gate/provider-contract',
      message: 'Provider endpoint is required for live sync and retry commands.'
    }] : []),
    ...(blocking ? [{
      code: retryExhausted
        ? 'provider_retry_budget_exhausted'
        : circuitOpen
          ? 'provider_circuit_open'
          : nonRetryableFailures.length
            ? 'provider_failure_non_retryable'
            : callbackBlocking
              ? 'provider_callback_health_blocked'
            : 'provider_unavailable',
      severity: 'error',
      action: retryExhausted || nonRetryableFailures.length
        ? 'open_provider_incident'
        : callbackBlocking
          ? 'repair_provider_callback_contract'
        : circuitOpen
          ? 'wait_for_retry_window'
          : 'check_provider_status',
      route: callbackBlocking
        ? '/verifier-claim-gate/provider-callback/subscriptions'
        : '/verifier-claim-gate/provider-sync/health',
      retryAfterMs: retryDelayMs,
      message: retryExhausted
        ? 'Provider retry budget is exhausted; an operator must review the failed claim-draft handoff.'
        : circuitOpen
        ? 'Provider circuit is open; verifier handoff must wait for the retry window.'
        : nonRetryableFailures.length
          ? 'Provider returned a non-retryable claim-draft handoff failure.'
        : callbackBlocking
          ? 'Provider callback contract must be repaired before asynchronous handoff can be reconciled.'
        : 'Provider is unavailable for claim-draft verifier handoff.'
    }] : []),
    ...(rateLimited && !blocking ? [{
      code: 'provider_rate_limited',
      severity: 'warning',
      action: 'schedule_provider_retry',
      route: '/verifier-claim-gate/provider-sync/retry',
      retryAfterMs: retryDelayMs,
      message: 'Provider requested delayed claim-draft sync.'
    }] : []),
    ...(heartbeatStale && !blocking ? [{
      code: 'provider_health_heartbeat_stale',
      severity: 'warning',
      action: 'refresh_provider_health',
      route: '/verifier-claim-gate/provider-sync/health',
      retryAfterMs: Math.min(retryDelayMs, staleAfterSeconds * 1000),
      message: 'Refresh provider health before dispatching the claim-draft handoff.'
    }] : []),
    ...(callbackWatermarkDrift && !blocking ? [{
      code: 'provider_callback_watermark_drift',
      severity: 'warning',
      action: 'reconcile_provider_callback_watermark',
      route: '/verifier-claim-gate/provider-callback/reconcile',
      retryAfterMs: retryDelayMs,
      message: 'Reconcile provider callback watermark before dispatching the claim-draft handoff.'
    }] : []),
    ...(callbackEventStale && !blocking ? [{
      code: 'provider_callback_event_stream_stale',
      severity: 'warning',
      action: 'refresh_provider_callback_subscription',
      route: '/verifier-claim-gate/provider-callback/subscriptions',
      retryAfterMs: retryDelayMs,
      message: 'Refresh provider callback subscription because the last event is outside the replay window.'
    }] : [])
  ];
  const mode = blocking ? 'blocked' : degraded ? 'degraded' : 'healthy';
  const degradedFallback = {
    enabled: degraded && !blocking && validationSummary.valid,
    mode: degraded && !blocking ? 'queue_without_live_provider_ack' : 'disabled',
    reason: degraded && !blocking
      ? 'Claim draft can be retained in a durable retry queue while provider health recovers.'
      : retryBlockedReason,
    route: '/verifier-claim-gate/provider-sync/degraded-queue',
    commandId: `cmd-${stableToken(`${claim.claimId}:${provider.providerId}:degraded-queue:${retryAttempt}`)}`,
    requiresOperatorAck: retryAttempt >= Math.max(1, maxAttempts - 1)
  };
  const healthProof = {
    proofType: 'claim-draft.provider-health-proof',
    proofVersion: 1,
    proofId: `health-${stableToken([
      claim.claimId,
      provider.providerId,
      provider.serviceId,
      status,
      mode,
      retryAttempt,
      failures.map((failure) => failure.code).join('+') || 'no-failures',
      callbackState,
      callbackIssueCodes.join('+') || 'callback-clear'
    ].join(':')).slice(0, 96)}`,
    generatedAt: now,
    status,
    mode,
    retryAttempt,
    maxAttempts,
    failureCodes: failures.map((failure) => failure.code),
    callbackState,
    callbackIssueCodes
  };
  return {
    status,
    mode,
    canProceed,
    canRetry,
    degraded,
    retryBlockedReason,
    failureState: {
      consecutiveFailures,
      lastCheckedAt,
      heartbeatAgeSeconds,
      staleAfterSeconds,
      heartbeatStale,
      circuitOpenUntil: asText(source.circuitOpenUntil, null),
      circuitOpen,
      retryExhausted,
      failures
    },
    callbackHealth: {
      subscriptionId: providerCallbackContract.subscriptionId,
      required: providerCallbackContract.required,
      enabled: providerCallbackContract.enabled,
      ready: callbackReady,
      state: callbackState,
      requiredEvents: providerCallbackContract.eventContract.requiredEvents,
      missingEvents: providerCallbackContract.eventContract.missingEvents,
      watermarkAligned: providerCallbackContract.syncBridge.watermarkAligned,
      watermarkDrift: callbackWatermarkDrift,
      lastEventAt: providerCallbackContract.syncBridge.lastEventAt,
      lastEventAgeSeconds: providerCallbackContract.syncBridge.lastEventAgeSeconds,
      replayWindowSeconds: providerCallbackContract.eventContract.replayWindowSeconds,
      eventStreamStale: callbackEventStale,
      issueCodes: callbackIssueCodes
    },
    retryPolicy: {
      strategy: 'exponential_backoff',
      attempt: retryAttempt,
      maxAttempts,
      baseDelayMs,
      maxDelayMs,
      nextDelayMs: retryDelayMs,
      retryAfterSeconds: Math.ceil(retryDelayMs / 1000),
      retryRoute: '/verifier-claim-gate/provider-sync/retry',
      idempotencyKey: `claim-draft-retry-${stableToken(`${claim.claimId}:${provider.providerId}:${retryAttempt}`)}`,
      blockedReason: retryBlockedReason
    },
    degradedFallback,
    recoveryActions: actionableErrors.map((issue) => ({
      action: issue.action,
      route: issue.route,
      severity: issue.severity,
      retryAfterMs: issue.retryAfterMs ?? null,
      enabled: issue.severity !== 'error' || issue.action === 'wait_for_retry_window'
    })),
    validationIssues,
    actionableErrors,
    healthProof
  };
}

function normalizeHistorySnapshots(input, claim, validationSummary, readiness, acceptance, handoffState, proof, operationalHealth, now) {
  const source = input.analytics && typeof input.analytics === 'object'
    ? input.analytics.history || input.analytics.snapshots
    : input.history || input.historySnapshots;
  const snapshots = (Array.isArray(source) ? source : [])
    .slice(-24)
    .map((entry, index) => {
      const observedAt = asText(entry?.observedAt || entry?.generatedAt || entry?.at, null);
      return {
        sequence: Math.max(1, Math.floor(asNumber(entry?.sequence, index + 1))),
        observedAt,
        claimId: stableToken(entry?.claimId || claim.claimId),
        handoffState: stableToken(entry?.handoffState || entry?.state || 'unknown') || 'unknown',
        readinessScore: Math.max(0, Math.min(100, Math.floor(asNumber(entry?.readinessScore ?? entry?.score, 0)))),
        readinessLevel: stableToken(entry?.readinessLevel || entry?.level || 'unknown') || 'unknown',
        validationErrors: Math.max(0, Math.floor(asNumber(entry?.validationErrors ?? entry?.errorCount, 0))),
        validationWarnings: Math.max(0, Math.floor(asNumber(entry?.validationWarnings ?? entry?.warningCount, 0))),
        acceptanceStatus: stableToken(entry?.acceptanceStatus || entry?.acceptance || 'unknown') || 'unknown',
        providerMode: stableToken(entry?.providerMode || entry?.operationalMode || 'unknown') || 'unknown',
        evidenceCount: Math.max(0, Math.floor(asNumber(entry?.evidenceCount, 0))),
        proofId: asText(entry?.proofId, null)
      };
    });
  const current = {
    sequence: snapshots.length + 1,
    observedAt: now,
    claimId: claim.claimId,
    handoffState,
    readinessScore: readiness.score,
    readinessLevel: readiness.level,
    validationErrors: validationSummary.errorCount,
    validationWarnings: validationSummary.warningCount,
    acceptanceStatus: acceptance.status,
    providerMode: operationalHealth.mode,
    evidenceCount: claim.evidence.length,
    proofId: proof.proofId
  };
  const last = snapshots[snapshots.length - 1];
  const shouldAppendCurrent = !last
    || last.proofId !== current.proofId
    || last.handoffState !== current.handoffState
    || last.acceptanceStatus !== current.acceptanceStatus
    || last.readinessScore !== current.readinessScore;
  return shouldAppendCurrent ? [...snapshots, current] : snapshots;
}

function buildHistoryTimelineState(input, snapshots, now) {
  const analyticsInput = input.analytics && typeof input.analytics === 'object' ? input.analytics : {};
  const source = analyticsInput.historyPolicy && typeof analyticsInput.historyPolicy === 'object'
    ? analyticsInput.historyPolicy
    : input.historyPolicy && typeof input.historyPolicy === 'object'
      ? input.historyPolicy
      : {};
  const retentionLimit = Math.max(1, Math.min(100, Math.floor(asNumber(source.retentionLimit ?? source.maxSnapshots, 24))));
  const retentionWindowSeconds = Math.max(60, Math.floor(asNumber(source.retentionWindowSeconds ?? source.maxAgeSeconds, 604800)));
  const retainedSnapshots = snapshots.slice(-retentionLimit);
  const staleSnapshotIds = retainedSnapshots
    .filter((snapshot) => secondsSince(snapshot.observedAt, now) > retentionWindowSeconds)
    .map((snapshot) => snapshot.sequence);
  const transitions = retainedSnapshots.slice(1).map((snapshot, index) => {
    const previous = retainedSnapshots[index];
    const changedFields = [
      ...(previous.handoffState !== snapshot.handoffState ? ['handoffState'] : []),
      ...(previous.readinessLevel !== snapshot.readinessLevel ? ['readinessLevel'] : []),
      ...(previous.acceptanceStatus !== snapshot.acceptanceStatus ? ['acceptanceStatus'] : []),
      ...(previous.providerMode !== snapshot.providerMode ? ['providerMode'] : []),
      ...(previous.validationErrors !== snapshot.validationErrors ? ['validationErrors'] : [])
    ];
    return {
      transitionId: `history-${previous.sequence}-to-${snapshot.sequence}`,
      fromSequence: previous.sequence,
      toSequence: snapshot.sequence,
      fromState: previous.handoffState,
      toState: snapshot.handoffState,
      readinessDelta: snapshot.readinessScore - previous.readinessScore,
      validationErrorDelta: snapshot.validationErrors - previous.validationErrors,
      changedFields,
      stable: changedFields.length === 0
    };
  });
  const latest = retainedSnapshots[retainedSnapshots.length - 1] || null;
  const first = retainedSnapshots[0] || null;
  const readinessScores = retainedSnapshots.map((snapshot) => snapshot.readinessScore);
  const validationErrorTotal = retainedSnapshots.reduce((total, snapshot) => total + snapshot.validationErrors, 0);
  return {
    contractType: 'verifier-claim-gate.claim-draft.history-timeline-state',
    contractVersion: 1,
    generatedAt: now,
    retainedCount: retainedSnapshots.length,
    droppedCount: Math.max(0, snapshots.length - retainedSnapshots.length),
    retention: {
      limit: retentionLimit,
      windowSeconds: retentionWindowSeconds,
      staleSnapshotIds,
      compactionRequired: snapshots.length > retentionLimit || staleSnapshotIds.length > 0
    },
    range: {
      firstObservedAt: first?.observedAt || null,
      latestObservedAt: latest?.observedAt || null,
      firstSequence: first?.sequence || null,
      latestSequence: latest?.sequence || null
    },
    trend: {
      readinessMin: readinessScores.length ? Math.min(...readinessScores) : 0,
      readinessMax: readinessScores.length ? Math.max(...readinessScores) : 0,
      readinessNetDelta: first && latest ? latest.readinessScore - first.readinessScore : 0,
      validationErrorTotal,
      stateTransitionCount: transitions.filter((transition) => transition.fromState !== transition.toState).length,
      acceptanceTransitionCount: transitions.filter((transition) => transition.changedFields.includes('acceptanceStatus')).length
    },
    transitions
  };
}

function buildAnalyticsState(claim, provider, negotiation, boundarySummary, workspaceScope, verifierAuthorization, validationSummary, readiness, acceptance, handoffState, operationalHealth, snapshots, historyTimeline) {
  const issueCounts = validationSummary.issues.reduce((counts, issue) => ({
    ...counts,
    [issue.code]: (counts[issue.code] || 0) + 1
  }), {});
  const stateCounts = snapshots.reduce((counts, snapshot) => ({
    ...counts,
    [snapshot.handoffState]: (counts[snapshot.handoffState] || 0) + 1
  }), {});
  const previous = snapshots.length > 1 ? snapshots[snapshots.length - 2] : null;
  const sealedEvidenceCount = claim.evidence.filter((item) => item.digest).length;
  return {
    counters: {
      claimDraftsEvaluated: 1,
      evidenceTotal: claim.evidence.length,
      evidenceSealed: sealedEvidenceCount,
      evidencePendingDigest: Math.max(0, claim.evidence.length - sealedEvidenceCount),
      capabilityAccepted: negotiation.accepted.length,
      capabilityMissing: negotiation.missing.length,
      validationErrors: validationSummary.errorCount,
      validationWarnings: validationSummary.warningCount,
      permissionIssues: boundarySummary.permissionIssues.length,
      workspaceScopeIssues: workspaceScope.validationIssues.length,
      verifierAuthorizationIssues: verifierAuthorization.validationIssues.length,
      verifierRedactedEvidence: verifierAuthorization.disclosure.redactedEvidenceIds.length,
      crossWorkspaceEvidence: workspaceScope.crossWorkspaceEvidenceIds.length,
      unauthorizedEvidence: workspaceScope.unauthorizedEvidenceIds.length,
      expiredWorkspaceDelegations: workspaceScope.expiredDelegationIds.length,
      providerFailures: operationalHealth.failureState.failures.length,
      retryScheduled: operationalHealth.canRetry ? 1 : 0,
      acceptedDrafts: acceptance.accepted ? 1 : 0,
      verifierReadyDrafts: handoffState === HANDOFF_STATES.READY ? 1 : 0,
      degradedDrafts: handoffState === HANDOFF_STATES.DEGRADED ? 1 : 0,
      historySnapshotsRetained: historyTimeline.retainedCount,
      historySnapshotsDropped: historyTimeline.droppedCount,
      historyTransitions: historyTimeline.trend.stateTransitionCount,
      historyCompactionRequired: historyTimeline.retention.compactionRequired ? 1 : 0
    },
    dimensions: {
      surfaceId,
      providerId: provider.providerId,
      serviceId: provider.serviceId,
      handoffState,
      readinessLevel: readiness.level,
      acceptanceStatus: acceptance.status,
      operationalMode: operationalHealth.mode,
      workspaceScopeGuard: workspaceScope.handoffGuard,
      workspaceScopeAllowed: workspaceScope.allowed,
      verifierId: verifierAuthorization.verifierId,
      verifierAuthorizationGuard: verifierAuthorization.handoffGuard,
      verifierAuthorizationAllowed: verifierAuthorization.allowed,
      verifierDisclosureMode: verifierAuthorization.disclosure.defaultMode
    },
    issueCounts,
    stateCounts,
    history: {
      retention: historyTimeline.retention,
      trend: historyTimeline.trend,
      latestSequence: historyTimeline.range.latestSequence,
      staleSnapshotIds: historyTimeline.retention.staleSnapshotIds
    },
    deltas: {
      readinessScore: previous ? readiness.score - previous.readinessScore : 0,
      validationErrors: previous ? validationSummary.errorCount - previous.validationErrors : 0,
      evidenceCount: previous ? claim.evidence.length - previous.evidenceCount : 0,
      handoffStateChanged: previous ? previous.handoffState !== handoffState : false,
      acceptanceChanged: previous ? previous.acceptanceStatus !== acceptance.status : false
    }
  };
}

function buildReportingState(claim, provider, validationSummary, readiness, acceptance, handoffState, proof, nextSteps, operationalHealth, snapshots, historyTimeline) {
  const timeline = snapshots.map((snapshot) => ({
    at: snapshot.observedAt,
    eventType: snapshot.proofId === proof.proofId
      ? 'claim-draft.current_snapshot'
      : 'claim-draft.history_snapshot',
    label: `${snapshot.handoffState} / ${snapshot.readinessLevel}`,
    state: snapshot.handoffState,
    readinessScore: snapshot.readinessScore,
    acceptanceStatus: snapshot.acceptanceStatus,
    proofId: snapshot.proofId
  }));
  const blockingIssues = validationSummary.issues.filter((issue) => issue.severity === 'error');
  return {
    reportType: 'verifier-claim-gate.claim-draft.timeline',
    title: `${claim.claimId} verifier claim draft report`,
    status: handoffState,
    generatedFor: {
      claimId: claim.claimId,
      providerId: provider.providerId,
      serviceId: provider.serviceId,
      proofId: proof.proofId
    },
    headline: blockingIssues.length
      ? `${blockingIssues.length} blocker${blockingIssues.length === 1 ? '' : 's'} before verifier handoff`
      : acceptance.accepted
        ? 'Accepted claim draft is ready for verifier routing'
        : 'Claim draft is ready for acceptance workflow',
    timeline,
    timelineState: historyTimeline,
    trend: {
      readinessNetDelta: historyTimeline.trend.readinessNetDelta,
      stateTransitionCount: historyTimeline.trend.stateTransitionCount,
      compactionRequired: historyTimeline.retention.compactionRequired
    },
    currentStep: nextSteps[0] || null,
    operationalMode: operationalHealth.mode,
    readinessBand: readiness.score >= 85 ? 'high' : readiness.score >= 60 ? 'medium' : 'low'
  };
}

function buildExportSummary(claim, provider, boundary, draftRevision, validationSummary, readiness, acceptance, handoffState, proof, analyticsState, reportingState) {
  const rows = [
    ['claimId', claim.claimId],
    ['claimRevision', draftRevision.revision],
    ['claimBaseRevision', draftRevision.baseRevision],
    ['provenanceHash', draftRevision.provenanceHash],
    ['tenantId', boundary.tenantId || ''],
    ['workspaceId', boundary.workspaceId || ''],
    ['providerId', provider.providerId],
    ['serviceId', provider.serviceId],
    ['handoffState', handoffState],
    ['readinessScore', readiness.score],
    ['readinessLevel', readiness.level],
    ['acceptanceStatus', acceptance.status],
    ['validationErrors', validationSummary.errorCount],
    ['validationWarnings', validationSummary.warningCount],
    ['evidenceTotal', analyticsState.counters.evidenceTotal],
    ['evidenceSealed', analyticsState.counters.evidenceSealed],
    ['proofId', proof.proofId]
  ].map(([field, value]) => ({ field, value }));
  return {
    exportType: 'claim-draft-verifier-summary',
    schemaVersion: 1,
    ready: validationSummary.valid && readiness.score >= 60,
    fileName: `${claim.claimId || 'claim-draft'}-verifier-summary.json`,
    formats: ['application/json', 'text/csv'],
    csvHeader: rows.map((row) => row.field),
    csvRow: rows.map((row) => String(row.value ?? '')),
    json: {
      summary: rows.reduce((accumulator, row) => ({ ...accumulator, [row.field]: row.value }), {}),
      counters: analyticsState.counters,
      dimensions: analyticsState.dimensions,
      trend: reportingState.trend,
      timelineEvents: reportingState.timeline.length
    }
  };
}

function buildExportDeliveryPlan(input, exportSummary, analyticsState, reportingState, persistenceState, externalHandoff, providerHandoffReceipt, clientRuntimeState, now) {
  const analyticsInput = input.analytics && typeof input.analytics === 'object' ? input.analytics : {};
  const source = analyticsInput.exportRequest && typeof analyticsInput.exportRequest === 'object'
    ? analyticsInput.exportRequest
    : input.exportRequest && typeof input.exportRequest === 'object'
      ? input.exportRequest
      : {};
  const requestedFormats = uniqueList(source.formats || source.accept || exportSummary.formats);
  const allowedFormats = new Set(exportSummary.formats);
  const selectedFormats = requestedFormats.filter((format) => allowedFormats.has(format));
  const unsupportedFormats = requestedFormats.filter((format) => !allowedFormats.has(format));
  const fieldCatalog = [
    'summary',
    'counters',
    'dimensions',
    'trend',
    'timeline',
    'receipt',
    'recovery'
  ];
  const requestedFields = uniqueList(source.fields || fieldCatalog);
  const selectedFields = requestedFields.filter((field) => fieldCatalog.includes(field));
  const omittedFields = requestedFields.filter((field) => !fieldCatalog.includes(field));
  const exportId = `export-${stableToken([
    exportSummary.json.summary.claimId,
    exportSummary.json.summary.claimRevision,
    persistenceState.stateKey,
    externalHandoff.handoffId,
    selectedFormats.join('+') || 'no-format',
    selectedFields.join('+') || 'no-fields'
  ].join(':')).slice(0, 96)}`;
  const validationIssues = [
    ...(selectedFormats.length === 0 ? [{
      code: 'analytics_export_format_missing',
      severity: 'error',
      field: 'analytics.exportRequest.formats',
      requestedFormats,
      supportedFormats: exportSummary.formats,
      message: 'Analytics export request must include at least one supported format.'
    }] : []),
    ...(unsupportedFormats.length ? [{
      code: 'analytics_export_format_unsupported',
      severity: 'warning',
      field: 'analytics.exportRequest.formats',
      unsupportedFormats,
      supportedFormats: exportSummary.formats,
      message: 'Unsupported analytics export formats were ignored.'
    }] : []),
    ...(omittedFields.length ? [{
      code: 'analytics_export_field_unsupported',
      severity: 'warning',
      field: 'analytics.exportRequest.fields',
      omittedFields,
      supportedFields: fieldCatalog,
      message: 'Unsupported analytics export fields were omitted from the manifest.'
    }] : [])
  ];
  return {
    contractType: 'verifier-claim-gate.claim-draft.analytics-export-manifest',
    contractVersion: 1,
    exportId,
    generatedAt: now,
    ready: exportSummary.ready && validationIssues.every((issue) => issue.severity !== 'error'),
    stateKey: persistenceState.stateKey,
    expectedRevision: persistenceState.revision,
    formats: selectedFormats,
    unsupportedFormats,
    selectedFields,
    omittedFields,
    fileName: exportSummary.fileName,
    idempotencyKey: `claim-draft-export-${stableToken(`${exportId}:${persistenceState.revision}`)}`,
    route: '/verifier-claim-gate/claim-draft/analytics/export',
    method: 'POST',
    bodyContract: {
      exportId,
      stateKey: persistenceState.stateKey,
      expectedRevision: persistenceState.revision,
      claimId: exportSummary.json.summary.claimId,
      proofId: exportSummary.json.summary.proofId,
      handoffId: externalHandoff.handoffId,
      receiptId: providerHandoffReceipt.receiptId,
      clientRequestId: clientRuntimeState.requestId,
      formats: selectedFormats,
      fields: selectedFields,
      idempotencyKey: `claim-draft-export-${stableToken(`${exportId}:${persistenceState.revision}`)}`
    },
    payloadPreview: {
      summary: selectedFields.includes('summary') ? exportSummary.json.summary : null,
      counters: selectedFields.includes('counters') ? analyticsState.counters : null,
      dimensions: selectedFields.includes('dimensions') ? analyticsState.dimensions : null,
      trend: selectedFields.includes('trend') ? reportingState.trend : null,
      timelineEventCount: selectedFields.includes('timeline') ? reportingState.timeline.length : 0,
      receiptState: selectedFields.includes('receipt') ? providerHandoffReceipt.state : null,
      recoveryStatus: selectedFields.includes('recovery') ? persistenceState.recovery.status : null
    },
    validationIssues
  };
}

function normalizePersistedCommandLedger(source = []) {
  return (Array.isArray(source) ? source : [])
    .slice(-32)
    .map((entry, index) => {
      const commandId = stableToken(entry?.commandId || entry?.id || `command-${index + 1}`);
      const status = stableToken(entry?.status || entry?.state || 'unknown') || 'unknown';
      const attempt = Math.max(0, Math.floor(asNumber(entry?.attempt ?? entry?.retryAttempt, 0)));
      const issuedAt = asText(entry?.issuedAt || entry?.createdAt || entry?.startedAt || entry?.at, null);
      const updatedAt = asText(entry?.updatedAt || entry?.completedAt || entry?.failedAt || entry?.at, issuedAt);
      return {
        commandId,
        commandType: stableToken(entry?.commandType || entry?.type || 'claim-draft-command') || 'claim-draft-command',
        idempotencyKey: stableToken(entry?.idempotencyKey || entry?.key || commandId),
        status,
        proofId: asText(entry?.proofId, null),
        acceptedAt: asText(entry?.acceptedAt || entry?.completedAt || entry?.at, null),
        stateKey: stableToken(entry?.stateKey || ''),
        expectedRevision: entry?.expectedRevision === undefined && entry?.revision === undefined
          ? null
          : Math.max(0, Math.floor(asNumber(entry?.expectedRevision ?? entry?.revision, 0))),
        attempt,
        issuedAt,
        updatedAt,
        errorCode: stableToken(entry?.errorCode || entry?.failureCode || entry?.reasonCode || '') || null,
        replayable: entry?.replayable === false
          ? false
          : !['completed', 'acknowledged', 'rejected', 'cancelled', 'superseded'].includes(status)
      };
    });
}

function classifyCommandReplay(command, ledger, context) {
  const matching = ledger
    .filter((entry) => entry.commandId === command.commandId || entry.idempotencyKey === command.idempotencyKey)
    .sort((left, right) => epochMs(right.updatedAt) - epochMs(left.updatedAt))[0] || null;
  if (!matching) {
    return {
      commandId: command.commandId,
      idempotencyKey: command.idempotencyKey,
      commandType: command.commandType,
      persistedStatus: 'not_seen',
      restartAction: 'issue_when_enabled',
      safeToIssue: true,
      ledgerMatched: false,
      reason: 'No persisted command ledger entry matches this idempotent command.'
    };
  }
  const terminalSuccess = ['completed', 'acknowledged'].includes(matching.status);
  const terminalFailure = ['rejected', 'cancelled', 'superseded'].includes(matching.status);
  const retryableFailure = ['failed', 'timeout', 'retryable', 'retry_scheduled'].includes(matching.status);
  const inFlight = ['queued', 'pending', 'started', 'in-flight', 'inflight', 'dispatching'].includes(matching.status);
  const revisionMismatch = matching.expectedRevision !== null && matching.expectedRevision !== context.revision;
  const stateKeyMismatch = Boolean(matching.stateKey && matching.stateKey !== context.stateKey);
  const proofMismatch = Boolean(matching.proofId && matching.proofId !== context.proofId);
  const blocked = revisionMismatch || stateKeyMismatch || (proofMismatch && command.commandType !== 'save-draft');
  return {
    commandId: command.commandId,
    idempotencyKey: command.idempotencyKey,
    commandType: command.commandType,
    persistedStatus: matching.status,
    restartAction: blocked
      ? 'operator_reconcile_required'
      : terminalSuccess
        ? 'suppress_duplicate'
        : terminalFailure
          ? 'do_not_replay_terminal'
          : retryableFailure
            ? 'retry_with_same_idempotency_key'
            : inFlight && context.restartDetected
              ? 'resume_after_restart'
              : matching.replayable
                ? 'replay_with_same_idempotency_key'
                : 'hold_for_manual_review',
    safeToIssue: !blocked && !terminalSuccess && !terminalFailure,
    ledgerMatched: true,
    ledgerStatus: matching.status,
    ledgerAttempt: matching.attempt,
    issuedAt: matching.issuedAt,
    updatedAt: matching.updatedAt,
    mismatch: {
      revision: revisionMismatch,
      stateKey: stateKeyMismatch,
      proof: proofMismatch
    },
    reason: blocked
      ? 'Persisted command ledger entry does not match the hydrated claim-draft state.'
      : terminalSuccess
        ? 'Command already completed under the same idempotency key.'
        : terminalFailure
          ? 'Command reached a terminal non-success status and requires a new operator action.'
          : retryableFailure
            ? 'Command failed with a retryable status and can be reissued idempotently.'
            : inFlight && context.restartDetected
              ? 'Restart recovered an in-flight command; resume with the persisted idempotency key.'
              : 'Command can be issued using the stable idempotency key.'
  };
}

function buildCommandReplayPlan(ledger, idempotentCommands, context) {
  const commands = Object.entries(idempotentCommands).map(([slot, command]) => ({
    slot,
    ...classifyCommandReplay({ ...command, commandType: slot }, ledger, context)
  }));
  const unsafeCommands = commands.filter((entry) => !entry.safeToIssue && entry.restartAction !== 'suppress_duplicate');
  const resumableCommands = commands.filter((entry) => [
    'resume_after_restart',
    'retry_with_same_idempotency_key',
    'replay_with_same_idempotency_key'
  ].includes(entry.restartAction));
  return {
    contractType: 'verifier-claim-gate.claim-draft.command-replay-plan',
    contractVersion: 1,
    restartSafe: unsafeCommands.length === 0,
    resumable: resumableCommands.length,
    commands,
    resumableCommandIds: resumableCommands.map((entry) => entry.commandId),
    blockedCommandIds: unsafeCommands.map((entry) => entry.commandId),
    validationIssues: unsafeCommands.map((entry) => ({
      code: 'persisted_command_replay_blocked',
      severity: 'error',
      field: 'persistedState.commandLedger',
      commandId: entry.commandId,
      commandType: entry.commandType,
      restartAction: entry.restartAction,
      message: entry.reason
    }))
  };
}

function normalizePersistedWriteAheadLog(source = []) {
  return (Array.isArray(source) ? source : [])
    .slice(-24)
    .map((entry, index) => {
      const status = stableToken(entry?.status || entry?.state || 'pending') || 'pending';
      const operation = stableToken(entry?.operation || entry?.op || entry?.type || 'claim-draft-state-write')
        || 'claim-draft-state-write';
      const sequence = Math.max(1, Math.floor(asNumber(entry?.sequence ?? entry?.seq, index + 1)));
      return {
        sequence,
        operation,
        status,
        stateKey: stableToken(entry?.stateKey || entry?.key || ''),
        revision: entry?.revision === undefined
          ? null
          : Math.max(0, Math.floor(asNumber(entry.revision, 0))),
        proofId: asText(entry?.proofId, null),
        idempotencyKey: stableToken(entry?.idempotencyKey || entry?.commandKey || `wal-${sequence}-${operation}`),
        preparedAt: asText(entry?.preparedAt || entry?.createdAt || entry?.at, null),
        committedAt: asText(entry?.committedAt || entry?.completedAt, null),
        abortedAt: asText(entry?.abortedAt || entry?.cancelledAt, null),
        errorCode: stableToken(entry?.errorCode || entry?.failureCode || '') || null
      };
    });
}

function buildRecoveryCheckpoint(writeAheadLog, context) {
  const openEntries = writeAheadLog.filter((entry) => ![
    'committed',
    'aborted',
    'cancelled',
    'compacted'
  ].includes(entry.status));
  const matchingOpenEntries = openEntries.filter((entry) => {
    const stateMatches = !entry.stateKey || entry.stateKey === context.stateKey;
    const revisionMatches = entry.revision === null || entry.revision === context.revision;
    const proofMatches = !entry.proofId || entry.proofId === context.proofId;
    return stateMatches && revisionMatches && proofMatches;
  });
  const foreignOpenEntries = openEntries.filter((entry) => !matchingOpenEntries.includes(entry));
  const lastCommitted = writeAheadLog
    .filter((entry) => entry.status === 'committed')
    .sort((left, right) => right.sequence - left.sequence)[0] || null;
  const partialCommit = matchingOpenEntries.some((entry) => ['prepared', 'pending', 'writing', 'flushing'].includes(entry.status));
  const restartAction = foreignOpenEntries.length
    ? 'operator_reconcile_foreign_write_ahead_log'
    : partialCommit
      ? 'complete_or_abort_prepared_snapshot'
      : matchingOpenEntries.length
        ? 'resume_persisted_snapshot_write'
        : 'no_write_ahead_recovery_required';
  return {
    contractType: 'verifier-claim-gate.claim-draft.recovery-checkpoint',
    contractVersion: 1,
    checkpointId: `checkpoint-${stableToken([
      context.stateKey,
      context.revision,
      context.proofId,
      lastCommitted?.sequence || 'no-commit',
      matchingOpenEntries.map((entry) => entry.sequence).join('+') || 'clean'
    ].join(':')).slice(0, 96)}`,
    restartSafe: foreignOpenEntries.length === 0,
    partialCommit,
    openWriteCount: openEntries.length,
    resumableWriteCount: matchingOpenEntries.length,
    foreignWriteCount: foreignOpenEntries.length,
    lastCommittedSequence: lastCommitted?.sequence || null,
    restartAction,
    recoveryRoute: restartAction === 'no_write_ahead_recovery_required'
      ? null
      : '/verifier-claim-gate/claim-draft/recover',
    openEntryIds: matchingOpenEntries.map((entry) => entry.idempotencyKey),
    blockedEntryIds: foreignOpenEntries.map((entry) => entry.idempotencyKey),
    validationIssues: foreignOpenEntries.map((entry) => ({
      code: 'persisted_write_ahead_log_foreign_entry',
      severity: 'error',
      field: 'persistedState.writeAheadLog',
      sequence: entry.sequence,
      stateKey: entry.stateKey || null,
      revision: entry.revision,
      proofId: entry.proofId,
      message: 'Open persisted write-ahead entry belongs to a different claim-draft state and must be reconciled before restart replay.'
    }))
  };
}

function buildPersistenceState(input, claim, provider, boundary, draftRevision, validationSummary, readiness, acceptance, handoffState, proof, operationalHealth, historySnapshots, lifecycleSettings, now) {
  const source = input.persistedState && typeof input.persistedState === 'object'
    ? input.persistedState
    : input.state && typeof input.state === 'object'
      ? input.state
      : input.recovery && typeof input.recovery === 'object'
        ? input.recovery
        : {};
  const stateKey = stableToken(source.stateKey || source.key || [
    surfaceId,
    boundary.tenantId || 'tenant-unscoped',
    boundary.workspaceId || 'workspace-unscoped',
    claim.claimId
  ].join(':'));
  const revision = Math.max(1, Math.floor(asNumber(source.revision ?? source.version, 1)));
  const persistedProofId = asText(source.proofId || source.lastProofId, null);
  const persistedHandoffState = stableToken(source.handoffState || source.status || source.lastHandoffState || '') || null;
  const persistedAcceptanceStatus = stableToken(source.acceptanceStatus || source.acceptance || '') || null;
  const persistedReadinessScore = source.readinessScore === undefined
    ? null
    : Math.max(0, Math.min(100, Math.floor(asNumber(source.readinessScore, 0))));
  const ledger = normalizePersistedCommandLedger(source.commandLedger || source.commands);
  const writeAheadLog = normalizePersistedWriteAheadLog(source.writeAheadLog || source.wal || source.pendingWrites);
  const pendingReplayCommands = ledger.filter((entry) => entry.replayable);
  const latestSnapshot = historySnapshots[historySnapshots.length - 1] || null;
  const proofChanged = Boolean(persistedProofId && persistedProofId !== proof.proofId);
  const statusChanged = Boolean(persistedHandoffState && persistedHandoffState !== handoffState);
  const acceptanceChanged = Boolean(persistedAcceptanceStatus && persistedAcceptanceStatus !== acceptance.status);
  const scoreRegressed = persistedReadinessScore !== null && readiness.score < persistedReadinessScore;
  const restartDetected = source.restored === true
    || source.recoveredFromRestart === true
    || asText(source.loadedAt || source.restoredAt, null) !== null;
  const persistedLockVersion = source.lockVersion === undefined && source.optimisticLockVersion === undefined
    ? null
    : Math.max(0, Math.floor(asNumber(source.lockVersion ?? source.optimisticLockVersion, 0)));
  const staleOptimisticLock = persistedLockVersion !== null && persistedLockVersion > revision;
  const recoveryReasons = [
    ...(proofChanged ? ['proof_changed_since_persisted_snapshot'] : []),
    ...(statusChanged ? ['handoff_state_changed_since_persisted_snapshot'] : []),
    ...(acceptanceChanged ? ['acceptance_status_changed_since_persisted_snapshot'] : []),
    ...(scoreRegressed ? ['readiness_score_regressed'] : []),
    ...(staleOptimisticLock ? ['persisted_optimistic_lock_ahead'] : []),
    ...(pendingReplayCommands.length ? ['pending_idempotent_commands'] : []),
    ...(writeAheadLog.some((entry) => !['committed', 'aborted', 'cancelled', 'compacted'].includes(entry.status))
      ? ['open_write_ahead_entries']
      : [])
  ];
  const durableStatus = validationSummary.valid && acceptance.accepted && operationalHealth.canProceed
    ? handoffState
    : validationSummary.valid
      ? 'recoverable_pending_action'
      : 'recoverable_blocked';
  const commandSeed = `${stateKey}:${proof.proofId}:${revision}`;
  const idempotentCommands = {
    saveDraft: {
      commandId: `cmd-${stableToken(`${commandSeed}:save`)}`,
      idempotencyKey: `claim-draft-save-${stableToken(commandSeed)}`,
      route: '/verifier-claim-gate/claim-draft/state',
      method: 'PUT'
    },
    acceptDraft: {
      commandId: `cmd-${stableToken(`${commandSeed}:accept:${acceptance.status}:rev-${draftRevision.revision}`)}`,
      idempotencyKey: `claim-draft-accept-${stableToken(`${commandSeed}:${acceptance.status}:rev-${draftRevision.revision}`)}`,
      route: '/verifier-claim-gate/claim-draft/accept',
      method: 'POST'
    },
    verifierHandoff: {
      commandId: `cmd-${stableToken(`${commandSeed}:handoff:${handoffState}`)}`,
      idempotencyKey: `claim-draft-handoff-${stableToken(`${commandSeed}:${handoffState}`)}`,
      route: '/verifier-claim-gate/verifier-intake',
      method: 'POST'
    },
    lifecycleControl: {
      commandId: `cmd-${stableToken(`${commandSeed}:lifecycle:${lifecycleSettings.requestedCommand || lifecycleSettings.mode}`)}`,
      idempotencyKey: `claim-draft-lifecycle-${stableToken(`${commandSeed}:${lifecycleSettings.requestedCommand || lifecycleSettings.mode}`)}`,
      route: '/verifier-claim-gate/claim-draft/lifecycle',
      method: 'POST'
    }
  };
  const replayPlan = buildCommandReplayPlan(ledger, idempotentCommands, {
    stateKey,
    revision,
    proofId: proof.proofId,
    restartDetected
  });
  const recoveryCheckpoint = buildRecoveryCheckpoint(writeAheadLog, {
    stateKey,
    revision,
    proofId: proof.proofId
  });
  const sourceClaimId = stableToken(source.claimId || '');
  const sourceTenantId = stableToken(source.tenantId || '');
  const sourceWorkspaceId = stableToken(source.workspaceId || '');
  const snapshotValidationIssues = [
    ...(sourceClaimId && sourceClaimId !== claim.claimId ? [{
      code: 'persisted_snapshot_claim_mismatch',
      severity: 'error',
      field: 'persistedState.claimId',
      expected: claim.claimId,
      actual: sourceClaimId,
      message: 'Persisted claim-draft state belongs to a different claim.'
    }] : []),
    ...(sourceTenantId && sourceTenantId !== boundary.tenantId ? [{
      code: 'persisted_snapshot_tenant_mismatch',
      severity: 'error',
      field: 'persistedState.tenantId',
      expected: boundary.tenantId || null,
      actual: sourceTenantId,
      message: 'Persisted claim-draft tenant does not match the hydrated boundary.'
    }] : []),
    ...(sourceWorkspaceId && sourceWorkspaceId !== boundary.workspaceId ? [{
      code: 'persisted_snapshot_workspace_mismatch',
      severity: 'error',
      field: 'persistedState.workspaceId',
      expected: boundary.workspaceId || null,
      actual: sourceWorkspaceId,
      message: 'Persisted claim-draft workspace does not match the hydrated boundary.'
    }] : []),
    ...(proofChanged && ['ready_for_verifier', 'dispatchable', 'accepted'].includes(persistedHandoffState) ? [{
      code: 'persisted_snapshot_terminal_proof_changed',
      severity: 'error',
      field: 'persistedState.proofId',
      expected: proof.proofId,
      actual: persistedProofId,
      message: 'Persisted verifier-ready state references an older proof and must be reconciled before handoff.'
    }] : []),
    ...(staleOptimisticLock ? [{
      code: 'persisted_snapshot_lock_ahead',
      severity: 'error',
      field: 'persistedState.lockVersion',
      expected: revision,
      actual: persistedLockVersion,
      message: 'Persisted optimistic lock version is ahead of the hydrated claim-draft state.'
    }] : [])
  ];
  const validationIssues = [
    ...snapshotValidationIssues,
    ...replayPlan.validationIssues,
    ...recoveryCheckpoint.validationIssues
  ];
  const recoveryStatus = validationIssues.some((issue) => issue.severity === 'error')
    ? 'recovery_blocked'
    : recoveryCheckpoint.partialCommit
      ? 'restart_snapshot_commit_required'
    : replayPlan.resumable
      ? 'restart_resume_required'
      : restartDetected || recoveryReasons.length
        ? 'restart_safe_recovered'
        : 'current';
  return {
    contractType: 'verifier-claim-gate.claim-draft.persisted-state',
    contractVersion: 1,
    stateKey,
    revision,
    snapshot: {
      persistedAt: now,
      claimId: claim.claimId,
      claimRevision: draftRevision.revision,
      claimBaseRevision: draftRevision.baseRevision,
      provenanceHash: draftRevision.provenanceHash,
      tenantId: boundary.tenantId || null,
      workspaceId: boundary.workspaceId || null,
      providerId: provider.providerId,
      proofId: proof.proofId,
      handoffState,
      durableStatus,
      acceptanceStatus: acceptance.status,
      readinessScore: readiness.score,
      lifecycleMode: lifecycleSettings.mode,
      lifecycleEnabled: lifecycleSettings.enabled,
      lifecycleScheduleRunAt: lifecycleSettings.schedule.runAt,
      latestHistorySequence: latestSnapshot?.sequence || 0,
      storagePartition: stableToken(`${boundary.tenantId || 'tenant-unscoped'}:${boundary.workspaceId || 'workspace-unscoped'}`),
      lockVersion: revision,
      nextRevision: recoveryStatus === 'current' ? revision : revision + 1,
      commitToken: `commit-${stableToken(`${stateKey}:${revision}:${proof.proofId}:${handoffState}`)}`,
      recoveryStatus
    },
    recovery: {
      restartDetected,
      recovered: restartDetected || recoveryReasons.length > 0 || recoveryStatus !== 'current',
      status: recoveryStatus,
      restartSafe: replayPlan.restartSafe
        && recoveryCheckpoint.restartSafe
        && validationIssues.every((issue) => issue.severity !== 'error'),
      replayRequired: replayPlan.resumable > 0
        || proofChanged
        || acceptanceChanged
        || recoveryCheckpoint.partialCommit,
      reasons: recoveryReasons,
      checkpoint: recoveryCheckpoint,
      recoveryPaths: [{
        action: 'persist_current_snapshot',
        route: '/verifier-claim-gate/claim-draft/state',
        method: 'PUT',
        enabled: validationIssues.every((issue) => issue.severity !== 'error'),
        idempotencyKey: idempotentCommands.saveDraft.idempotencyKey
      }, {
        action: recoveryCheckpoint.restartAction,
        route: recoveryCheckpoint.recoveryRoute,
        method: 'POST',
        enabled: recoveryCheckpoint.restartAction !== 'no_write_ahead_recovery_required'
          && recoveryCheckpoint.restartSafe,
        idempotencyKey: `claim-draft-recover-${stableToken(`${stateKey}:${revision}:${recoveryCheckpoint.checkpointId}`)}`
      }],
      previous: {
        proofId: persistedProofId,
        handoffState: persistedHandoffState,
        acceptanceStatus: persistedAcceptanceStatus,
        readinessScore: persistedReadinessScore,
        lockVersion: persistedLockVersion
      }
    },
    idempotentCommands,
    commandReplayPlan: replayPlan,
    commandLedger: ledger,
    writeAheadLog,
    pendingReplayCommands: replayPlan.commands.filter((entry) => [
      'resume_after_restart',
      'retry_with_same_idempotency_key',
      'replay_with_same_idempotency_key'
    ].includes(entry.restartAction)),
    validationIssues
  };
}

function buildClientReviewSession(claim, provider, boundary, draftRevision, preview, validationSummary, readiness, acceptance, handoffState, proof, operationalHealth, nextSteps, lifecycleSettings) {
  const blockingIssues = validationSummary.issues.filter((issue) => issue.severity === 'error');
  const warningIssues = validationSummary.issues.filter((issue) => issue.severity === 'warning');
  const readinessGates = readiness.checks.map((check) => ({
    gateId: `claim-draft.${check.key}`,
    label: check.key,
    passed: check.ready,
    weight: check.weight,
    impact: check.ready ? 'ready' : check.weight >= 25 ? 'blocking' : 'review'
  }));
  const validationCards = validationSummary.issues.map((issue) => ({
    issueId: `claim-draft.${issue.code}`,
    severity: issue.severity,
    title: issue.code.replace(/_/g, ' '),
    message: issue.message,
    field: issue.field,
      remediationRoute: issue.code === 'provider_capability_missing'
      ? '/verifier-claim-gate/provider-contract'
      : issue.code === 'actor_role_missing' || issue.code === 'actor_scope_forbidden'
        ? '/verifier-claim-gate/claim-draft/permissions'
        : issue.code === 'provider_scope_forbidden'
          || issue.code === 'workspace_scope_missing'
          || issue.code === 'evidence_tenant_boundary_mismatch'
          || issue.code === 'evidence_workspace_delegation_missing'
          || issue.code === 'evidence_workspace_delegation_invalid'
          || issue.code === 'evidence_provider_tenant_scope_missing'
          || issue.code === 'evidence_provider_workspace_scope_missing'
          || issue.code === 'workspace_delegation_expired'
          ? '/verifier-claim-gate/claim-draft/workspace-boundary'
          : '/verifier-claim-gate/claim-draft',
    blocksAcceptance: issue.severity === 'error'
  }));
  const evidencePreview = preview.evidenceRows.map((row, index) => ({
    rowId: row.evidenceId,
    ordinal: index + 1,
    label: row.label,
    uri: row.uri,
    digest: row.digest,
    verifierVisible: row.verifierVisible,
    acceptanceRisk: row.digest ? 'sealed' : 'digest_pending'
  }));
  const firstNextStep = nextSteps[0] || null;
  return {
    contractType: 'verifier-claim-gate.claim-draft.client-review-session',
    contractVersion: 1,
    sessionId: `review-${stableToken(`${claim.claimId}:${proof.proofId}:${acceptance.status}`)}`,
    claimRef: {
      claimId: claim.claimId,
      tenantId: boundary.tenantId || null,
      workspaceId: boundary.workspaceId || null,
      providerId: provider.providerId,
      serviceId: provider.serviceId,
      proofId: proof.proofId
    },
    headline: {
      title: preview.title,
      subtitle: preview.subtitle,
      statusLabel: preview.statusLabel,
      handoffState,
      readinessScore: readiness.score,
      readinessLevel: readiness.level
    },
    previewSections: [{
      sectionId: 'claim-summary',
      title: 'Claim summary',
      rows: [
        { label: 'Subject', value: claim.subject },
        { label: 'Predicate', value: claim.predicate },
        { label: 'Revision', value: draftRevision.revision },
        { label: 'Provenance', value: draftRevision.provenanceHash },
        { label: 'Provider', value: `${provider.providerId}/${provider.serviceId}` }
      ]
    }, {
      sectionId: 'evidence',
      title: 'Evidence',
      emptyState: preview.emptyState,
      rows: evidencePreview
    }],
    validationPanel: {
      valid: validationSummary.valid,
      summary: validationSummary.summary,
      blockerCount: blockingIssues.length,
      warningCount: warningIssues.length,
      cards: validationCards
    },
    readinessPanel: {
      score: readiness.score,
      level: readiness.level,
      gates: readinessGates,
      failedGateIds: readinessGates.filter((gate) => !gate.passed).map((gate) => gate.gateId)
    },
    acceptancePanel: {
      status: acceptance.status,
      canAccept: acceptance.canAccept,
      accepted: acceptance.accepted,
      acceptedBy: acceptance.acceptedBy,
      acceptedAt: acceptance.acceptedAt,
      proofId: proof.proofId,
      disabledReason: acceptance.canAccept
        ? null
        : blockingIssues[0]?.message || 'Claim draft is not ready for acceptance.',
      terms: [
        'I reviewed the verifier-visible claim draft.',
        'I confirm the tenant and workspace boundary for this handoff.',
        'I understand the proof id will be submitted with the verifier intake.'
      ]
    },
    lifecyclePanel: {
      enabled: lifecycleSettings.enabled,
      mode: lifecycleSettings.mode,
      paused: lifecycleSettings.paused,
      scheduled: lifecycleSettings.scheduled,
      disabledReason: lifecycleSettings.disabledReason,
      schedule: lifecycleSettings.schedule,
      controls: lifecycleSettings.controls,
      blocksHandoff: lifecycleSettings.blocksHandoff
    },
    nextStepPanel: firstNextStep
      ? {
        action: firstNextStep.action,
        reason: firstNextStep.reason,
        route: firstNextStep.route,
        method: 'POST',
        proofId: firstNextStep.proofId || proof.proofId,
        retryAfterMs: firstNextStep.retryAfterMs ?? null,
        providerMode: operationalHealth.mode
      }
      : null
  };
}

function buildGuidedReviewFlow(claim, provider, boundary, validationSummary, readiness, acceptance, nextSteps, lifecycleSettings, serviceContract, operationalHealth, proof, persistenceState, externalHandoff) {
  const blockingIssues = validationSummary.issues.filter((issue) => issue.severity === 'error');
  const warningIssues = validationSummary.issues.filter((issue) => issue.severity === 'warning');
  const failedReadinessGates = readiness.checks.filter((check) => !check.ready);
  const currentAction = nextSteps[0] || null;
  const hasProviderSyncHold = serviceContract.syncMetadata.stale
    || serviceContract.handoffContract.dispatchBlockers.includes('sync_metadata');
  const acceptedAndReady = acceptance.accepted && readiness.level === 'ready';
  const flowSteps = [{
    stepId: 'preview',
    label: 'Preview claim draft',
    route: '/verifier-claim-gate/claim-draft/review',
    status: claim.evidence.length ? 'complete' : 'needs_input',
    enabled: true,
    issueCodes: claim.evidence.length ? [] : ['evidence_missing'],
    commandRef: null
  }, {
    stepId: 'validation',
    label: 'Resolve validation blockers',
    route: blockingIssues[0]?.field === 'provider.capabilities'
      || blockingIssues[0]?.field?.startsWith('provider.callbackContract.')
      ? '/verifier-claim-gate/provider-contract'
      : '/verifier-claim-gate/claim-draft',
    status: validationSummary.valid ? 'complete' : 'blocked',
    enabled: !validationSummary.valid,
    issueCodes: blockingIssues.map((issue) => issue.code),
    commandRef: currentAction?.action || null
  }, {
    stepId: 'readiness',
    label: 'Confirm readiness gates',
    route: '/verifier-claim-gate/claim-draft/readiness',
    status: readiness.level === 'ready' ? 'complete' : readiness.level,
    enabled: validationSummary.valid,
    issueCodes: failedReadinessGates.map((gate) => `readiness_${gate.key}`),
    commandRef: null
  }, {
    stepId: 'acceptance',
    label: 'Accept verifier handoff',
    route: '/verifier-claim-gate/claim-draft/accept',
    status: acceptance.accepted ? 'complete' : acceptance.canAccept ? 'active' : 'locked',
    enabled: acceptance.canAccept && !acceptance.accepted,
    issueCodes: acceptance.canAccept ? [] : blockingIssues.map((issue) => issue.code),
    commandRef: persistenceState.idempotentCommands.acceptDraft.commandId
  }, {
    stepId: 'provider-sync',
    label: 'Synchronize provider contract',
    route: operationalHealth.canRetry
      ? operationalHealth.retryPolicy.retryRoute
      : '/verifier-claim-gate/provider-sync',
    status: hasProviderSyncHold
      ? 'blocked'
      : operationalHealth.degraded
        ? 'review'
        : 'complete',
    enabled: hasProviderSyncHold || operationalHealth.canRetry,
    issueCodes: [
      ...serviceContract.validationIssues.map((issue) => issue.code),
      ...operationalHealth.actionableErrors.map((issue) => issue.code)
    ],
    commandRef: operationalHealth.canRetry
      ? operationalHealth.retryPolicy.idempotencyKey
      : null
  }, {
    stepId: 'verifier-handoff',
    label: 'Submit to verifier intake',
    route: externalHandoff.dispatchCommand.route,
    status: externalHandoff.dispatchCommand.enabled ? 'active' : acceptedAndReady ? 'waiting' : 'locked',
    enabled: externalHandoff.dispatchCommand.enabled,
    issueCodes: externalHandoff.holdReasons,
    commandRef: externalHandoff.dispatchCommand.idempotencyKey
  }];
  const currentStep = flowSteps.find((step) => ['blocked', 'active', 'needs_input', 'review', 'waiting'].includes(step.status))
    || flowSteps[flowSteps.length - 1];
  const completedWeight = flowSteps.reduce((total, step) => total + (step.status === 'complete' ? 1 : 0), 0);
  return {
    contractType: 'verifier-claim-gate.claim-draft.guided-review-flow',
    contractVersion: 1,
    flowId: `flow-${stableToken(`${claim.claimId}:${proof.proofId}:${persistenceState.revision}`)}`,
    claimRef: {
      claimId: claim.claimId,
      tenantId: boundary.tenantId || null,
      workspaceId: boundary.workspaceId || null,
      providerId: provider.providerId,
      serviceId: provider.serviceId,
      proofId: proof.proofId,
      stateKey: persistenceState.stateKey,
      expectedRevision: persistenceState.revision
    },
    summary: {
      currentStepId: currentStep.stepId,
      currentRoute: currentStep.route,
      progressPercent: Math.round((completedWeight / flowSteps.length) * 100),
      blockers: blockingIssues.length,
      warnings: warningIssues.length,
      nextAction: currentAction?.action || null,
      nextReason: currentAction?.reason || null
    },
    steps: flowSteps,
    validationDigest: {
      valid: validationSummary.valid,
      errorCodes: blockingIssues.map((issue) => issue.code),
      warningCodes: warningIssues.map((issue) => issue.code),
      failedReadinessGateIds: failedReadinessGates.map((gate) => `claim-draft.${gate.key}`),
      lifecycleBlocksHandoff: lifecycleSettings.blocksHandoff,
      providerDispatchAllowed: serviceContract.handoffContract.dispatchAllowed
    },
    routeBindings: {
      preview: '/verifier-claim-gate/claim-draft/review',
      readiness: '/verifier-claim-gate/claim-draft/readiness',
      validation: '/verifier-claim-gate/claim-draft/validation',
      acceptance: '/verifier-claim-gate/claim-draft/accept',
      providerSync: operationalHealth.retryPolicy.retryRoute,
      verifierHandoff: externalHandoff.dispatchCommand.route
    }
  };
}

function normalizeClientRequestState(input = {}, claim, boundary, proof, persistenceState, guidedReviewFlow, externalHandoff, serviceContract, operationalHealth, lifecycleSettings, now) {
  const request = input.request && typeof input.request === 'object' ? input.request : {};
  const route = input.route && typeof input.route === 'object'
    ? input.route
    : request.route && typeof request.route === 'object'
      ? request.route
      : {};
  const client = input.client && typeof input.client === 'object'
    ? input.client
    : input.clientState && typeof input.clientState === 'object'
      ? input.clientState
      : {};
  const params = route.params && typeof route.params === 'object'
    ? route.params
    : request.params && typeof request.params === 'object'
      ? request.params
      : {};
  const requestedClaimId = stableToken(params.claimId || request.claimId || client.claimId || claim.claimId);
  const requestedTenantId = stableToken(params.tenantId || request.tenantId || client.tenantId || boundary.tenantId);
  const requestedWorkspaceId = stableToken(params.workspaceId || request.workspaceId || client.workspaceId || boundary.workspaceId);
  const requestedProofId = asText(params.proofId || request.proofId || client.proofId, proof.proofId);
  const activeRoute = asText(route.path || route.route || request.path, '/verifier-claim-gate/claim-draft/review');
  const returnRoute = asText(client.returnRoute || request.returnRoute, guidedReviewFlow.summary.currentRoute);
  const routeMismatches = [
    ...(requestedClaimId && requestedClaimId !== claim.claimId ? [{
      code: 'client_route_claim_mismatch',
      severity: 'error',
      field: 'route.params.claimId',
      expected: claim.claimId,
      actual: requestedClaimId,
      message: 'Client route claim id does not match the hydrated claim draft.'
    }] : []),
    ...(requestedTenantId && boundary.tenantId && requestedTenantId !== boundary.tenantId ? [{
      code: 'client_route_tenant_mismatch',
      severity: 'error',
      field: 'route.params.tenantId',
      expected: boundary.tenantId,
      actual: requestedTenantId,
      message: 'Client route tenant id does not match the claim draft boundary.'
    }] : []),
    ...(requestedWorkspaceId && boundary.workspaceId && requestedWorkspaceId !== boundary.workspaceId ? [{
      code: 'client_route_workspace_mismatch',
      severity: 'error',
      field: 'route.params.workspaceId',
      expected: boundary.workspaceId,
      actual: requestedWorkspaceId,
      message: 'Client route workspace id does not match the claim draft boundary.'
    }] : []),
    ...(requestedProofId && requestedProofId !== proof.proofId ? [{
      code: 'client_route_proof_stale',
      severity: 'warning',
      field: 'route.params.proofId',
      expected: proof.proofId,
      actual: requestedProofId,
      message: 'Client route proof id is stale for the current claim draft proof.'
    }] : [])
  ];
  const pendingCommands = [
    {
      slot: 'save-draft',
      commandId: persistenceState.idempotentCommands.saveDraft.commandId,
      route: persistenceState.idempotentCommands.saveDraft.route,
      method: persistenceState.idempotentCommands.saveDraft.method,
      enabled: routeMismatches.every((issue) => issue.severity !== 'error')
    },
    {
      slot: 'accept-draft',
      commandId: persistenceState.idempotentCommands.acceptDraft.commandId,
      route: persistenceState.idempotentCommands.acceptDraft.route,
      method: persistenceState.idempotentCommands.acceptDraft.method,
      enabled: guidedReviewFlow.steps.some((step) => step.stepId === 'acceptance' && step.enabled)
    },
    {
      slot: 'provider-sync',
      commandId: operationalHealth.retryPolicy.idempotencyKey,
      route: operationalHealth.retryPolicy.retryRoute,
      method: 'POST',
      enabled: operationalHealth.canRetry || serviceContract.syncMetadata.stale
    },
    {
      slot: 'lifecycle-control',
      commandId: persistenceState.idempotentCommands.lifecycleControl.commandId,
      route: persistenceState.idempotentCommands.lifecycleControl.route,
      method: persistenceState.idempotentCommands.lifecycleControl.method,
      enabled: lifecycleSettings.controls.runNow.enabled || lifecycleSettings.blocksHandoff
    },
    {
      slot: 'verifier-handoff',
      commandId: persistenceState.idempotentCommands.verifierHandoff.commandId,
      route: externalHandoff.dispatchCommand.route,
      method: externalHandoff.dispatchCommand.method,
      enabled: externalHandoff.dispatchCommand.enabled
    }
  ];
  const firstRunnable = pendingCommands.find((command) => command.enabled) || null;
  return {
    contractType: 'verifier-claim-gate.claim-draft.client-runtime-state',
    contractVersion: 1,
    requestId: stableToken(request.requestId || request.id || input.requestId || `request-${claim.claimId}-${persistenceState.revision}`),
    clientSessionId: stableToken(client.sessionId || client.tabId || input.sessionId || `session-${claim.claimId}`),
    hydratedAt: now,
    activeRoute,
    returnRoute,
    routeParams: {
      claimId: requestedClaimId || null,
      tenantId: requestedTenantId || null,
      workspaceId: requestedWorkspaceId || null,
      proofId: requestedProofId || null
    },
    hydration: {
      status: routeMismatches.some((issue) => issue.severity === 'error')
        ? 'blocked_route_mismatch'
        : routeMismatches.length
          ? 'stale_proof_refresh_required'
          : persistenceState.recovery.replayRequired
            ? 'recovered_with_replay'
            : 'current',
      stateKey: persistenceState.stateKey,
      expectedRevision: persistenceState.revision,
      proofId: proof.proofId,
      mismatchCount: routeMismatches.length,
      validationIssues: routeMismatches
    },
    workflowHandoff: {
      currentStepId: guidedReviewFlow.summary.currentStepId,
      currentRoute: guidedReviewFlow.summary.currentRoute,
      returnRoute,
      dispatchState: externalHandoff.state,
      dispatchEnabled: externalHandoff.dispatchCommand.enabled,
      holdReasons: externalHandoff.holdReasons,
      nextCommandSlot: firstRunnable?.slot || null
    },
    commandQueue: pendingCommands,
    routeRefreshCommand: {
      method: 'GET',
      route: '/verifier-claim-gate/claim-draft/review',
      queryContract: {
        claimId: claim.claimId,
        tenantId: boundary.tenantId || 'required-tenant-id',
        workspaceId: boundary.workspaceId || 'required-workspace-id',
        proofId: proof.proofId,
        stateKey: persistenceState.stateKey,
        expectedRevision: persistenceState.revision
      },
      enabled: routeMismatches.length > 0 || persistenceState.recovery.replayRequired
    }
  };
}

function buildNextSteps(handoffState, validationSummary, acceptance, provider, proof, operationalHealth, lifecycleSettings) {
  if (lifecycleSettings.blocksHandoff) {
    const lifecycleIssue = lifecycleSettings.validationIssues.find((issue) => issue.severity === 'error')
      || lifecycleSettings.validationIssues[0]
      || null;
    return [{
      action: lifecycleSettings.enabled
        ? lifecycleSettings.paused
          ? 'resume_claim_draft_lifecycle'
          : lifecycleSettings.scheduled
            ? 'reschedule_claim_draft_handoff'
            : 'repair_claim_draft_lifecycle'
        : 'enable_claim_draft_lifecycle',
      reason: lifecycleIssue?.message
        || (lifecycleSettings.enabled
          ? 'Claim-draft lifecycle controls are holding verifier handoff.'
          : 'Claim-draft lifecycle is disabled and must be enabled before verifier handoff.'),
      route: '/verifier-claim-gate/claim-draft/lifecycle',
      proofId: proof.proofId,
      retryAfterMs: lifecycleSettings.schedule.due ? null : lifecycleSettings.schedule.runInSeconds * 1000,
      field: lifecycleIssue?.field || 'lifecycle.enabled'
    }];
  }
  const blockingHealthError = operationalHealth.actionableErrors.find((issue) => issue.severity === 'error');
  if (blockingHealthError) {
    return [{
      action: blockingHealthError.action,
      reason: blockingHealthError.message,
      route: blockingHealthError.route,
      retryAfterMs: blockingHealthError.retryAfterMs,
      proofId: proof.proofId
    }];
  }
  if (!validationSummary.valid) {
    return validationSummary.issues
      .filter((issue) => issue.severity === 'error')
      .map((issue) => ({
      action: issue.code === 'provider_capability_missing'
        || issue.code === 'provider_contract_version_unsupported'
        || issue.code === 'provider_handoff_mode_unsupported'
        || issue.code.startsWith('provider_callback_')
        ? 'negotiate_provider_contract'
        : issue.code === 'provider_sync_metadata_stale'
          ? 'request_provider_evidence_sync'
        : issue.code === 'actor_role_missing' || issue.code === 'actor_scope_forbidden'
          ? 'request_claim_draft_permission'
          : issue.code === 'provider_scope_forbidden'
            || issue.code === 'workspace_scope_missing'
            || issue.code === 'evidence_tenant_boundary_mismatch'
            || issue.code === 'evidence_workspace_delegation_missing'
            || issue.code === 'evidence_workspace_delegation_invalid'
            || issue.code === 'evidence_provider_tenant_scope_missing'
            || issue.code === 'evidence_provider_workspace_scope_missing'
            || issue.code === 'workspace_delegation_expired'
            ? 'repair_workspace_boundary'
          : 'edit_claim_draft',
      reason: issue.message,
      route: issue.code === 'provider_capability_missing'
        || issue.code === 'provider_contract_version_unsupported'
        || issue.code === 'provider_handoff_mode_unsupported'
        || issue.code.startsWith('provider_callback_')
        ? '/verifier-claim-gate/provider-contract'
        : issue.code === 'provider_sync_metadata_stale'
          ? '/verifier-claim-gate/provider-sync'
        : issue.code === 'actor_role_missing' || issue.code === 'actor_scope_forbidden'
          ? '/verifier-claim-gate/claim-draft/permissions'
          : issue.code === 'provider_scope_forbidden'
            || issue.code === 'workspace_scope_missing'
            || issue.code === 'evidence_tenant_boundary_mismatch'
            || issue.code === 'evidence_workspace_delegation_missing'
            || issue.code === 'evidence_workspace_delegation_invalid'
            || issue.code === 'evidence_provider_tenant_scope_missing'
            || issue.code === 'evidence_provider_workspace_scope_missing'
            || issue.code === 'workspace_delegation_expired'
            ? '/verifier-claim-gate/claim-draft/workspace-boundary'
          : '/verifier-claim-gate/claim-draft',
      field: issue.field
      }));
  }
  if (!acceptance.accepted) {
    return [{
      action: 'collect_user_acceptance',
      reason: 'Claim draft is valid and needs explicit acceptance before verifier handoff.',
      route: '/verifier-claim-gate/claim-draft/accept',
      proofId: proof.proofId
    }];
  }
  return [{
    action: handoffState === HANDOFF_STATES.READY ? 'handoff_to_verifier' : 'request_provider_evidence_sync',
    reason: handoffState === HANDOFF_STATES.READY
      ? 'Accepted claim draft is ready for verifier intake.'
      : handoffState === HANDOFF_STATES.DEGRADED
        ? 'Accepted draft can remain in degraded mode while provider retry is scheduled.'
        : 'Accepted draft still needs provider evidence synchronization.',
    route: handoffState === HANDOFF_STATES.READY
      ? '/verifier-claim-gate/verifier-intake'
      : handoffState === HANDOFF_STATES.DEGRADED
        ? '/verifier-claim-gate/provider-sync/retry'
        : '/verifier-claim-gate/provider-sync',
    endpoint: provider.endpoint,
    retryAfterMs: handoffState === HANDOFF_STATES.DEGRADED
      ? operationalHealth.retryPolicy.nextDelayMs
      : null,
    proofId: proof.proofId
  }];
}

export function describeClaimDraftSurface(input = {}) {
  const now = input.now || new Date().toISOString();
  const provider = normalizeProvider(input);
  const claim = normalizeClaim(input);
  const boundary = normalizeBoundary(input, claim, provider);
  const draftRevision = normalizeDraftRevisionContract(input, claim, boundary, now);
  const boundarySummary = evaluateBoundary(boundary);
  const workspaceScope = normalizeWorkspaceScopeContract(input, claim, provider, boundary, boundarySummary, now);
  const verifierAuthorization = normalizeVerifierHandoffAuthorization(
    input,
    claim,
    provider,
    boundary,
    workspaceScope,
    draftRevision,
    now
  );
  const requiredCapabilities = uniqueList(input.requiredCapabilities || DEFAULT_REQUIRED_CAPABILITIES);
  const negotiation = negotiateCapabilities(provider.capabilities, requiredCapabilities);
  const serviceContract = buildProviderServiceContract(input, provider, claim, boundary, negotiation, boundarySummary, now);
  const hasEvidence = claim.evidence.length > 0;
  const proof = buildProof(claim, provider, negotiation, boundary, boundarySummary, draftRevision, workspaceScope, now);
  const providerCallbackContract = normalizeProviderCallbackContract(input, claim, provider, boundary, draftRevision, serviceContract, proof, now);
  const lifecycleSettings = normalizeLifecycleSettings(input, claim, boundary, now);
  const clientWorkflowIntent = normalizeClientWorkflowIntent(
    input,
    claim,
    boundary,
    draftRevision,
    proof,
    lifecycleSettings,
    serviceContract,
    now
  );
  let validationSummary = mergeValidationIssues(
    summarizeValidation(claim, provider, negotiation, boundarySummary),
    [
      ...draftRevision.validationIssues,
      ...workspaceScope.validationIssues,
      ...verifierAuthorization.validationIssues,
      ...lifecycleSettings.validationIssues,
      ...serviceContract.validationIssues,
      ...providerCallbackContract.validationIssues,
      ...clientWorkflowIntent.validationIssues
    ]
  );
  const operationalHealth = buildOperationalHealth(input, claim, provider, validationSummary, providerCallbackContract, now);
  validationSummary = mergeValidationIssues(validationSummary, operationalHealth.validationIssues);
  const handoffState = negotiation.satisfied
    && boundarySummary.allowed
    && workspaceScope.allowed
    && verifierAuthorization.allowed
    && operationalHealth.canProceed
    && !lifecycleSettings.blocksHandoff
    ? hasEvidence
      ? serviceContract.syncMetadata.stale
        ? HANDOFF_STATES.NEEDS_PROVIDER_SYNC
        : operationalHealth.degraded
        ? HANDOFF_STATES.DEGRADED
        : HANDOFF_STATES.READY
      : HANDOFF_STATES.NEEDS_PROVIDER_SYNC
    : HANDOFF_STATES.BLOCKED;
  const preview = buildPreview(claim, provider, validationSummary);
  const readiness = buildReadiness(claim, provider, negotiation, validationSummary, boundarySummary, lifecycleSettings, serviceContract, workspaceScope, verifierAuthorization, operationalHealth, clientWorkflowIntent);
  const acceptance = buildAcceptance(input, readiness, proof, validationSummary, lifecycleSettings, now);
  const nextSteps = buildNextSteps(handoffState, validationSummary, acceptance, provider, proof, operationalHealth, lifecycleSettings);
  const clientReviewSession = buildClientReviewSession(
    claim,
    provider,
    boundary,
    draftRevision,
    preview,
    validationSummary,
    readiness,
    acceptance,
    handoffState,
    proof,
    operationalHealth,
    nextSteps,
    lifecycleSettings
  );
  const historySnapshots = normalizeHistorySnapshots(
    input,
    claim,
    validationSummary,
    readiness,
    acceptance,
    handoffState,
    proof,
    operationalHealth,
    now
  );
  const historyTimeline = buildHistoryTimelineState(input, historySnapshots, now);
  const persistenceState = buildPersistenceState(
    input,
    claim,
    provider,
    boundary,
    draftRevision,
    validationSummary,
    readiness,
    acceptance,
    handoffState,
    proof,
    operationalHealth,
    historySnapshots,
    lifecycleSettings,
    now
  );
  const analytics = buildAnalyticsState(
    claim,
    provider,
    negotiation,
    boundarySummary,
    workspaceScope,
    verifierAuthorization,
    validationSummary,
    readiness,
    acceptance,
    handoffState,
    operationalHealth,
    historySnapshots,
    historyTimeline
  );
  const reporting = buildReportingState(
    claim,
    provider,
    validationSummary,
    readiness,
    acceptance,
    handoffState,
    proof,
    nextSteps,
    operationalHealth,
    historySnapshots,
    historyTimeline
  );
  const exportSummary = buildExportSummary(
    claim,
    provider,
    boundary,
    draftRevision,
    validationSummary,
    readiness,
    acceptance,
    handoffState,
    proof,
    analytics,
    reporting
  );
  const externalHandoff = buildExternalHandoffEnvelope(
    claim,
    provider,
    boundary,
    draftRevision,
    serviceContract,
    readiness,
    acceptance,
    handoffState,
    proof,
    persistenceState,
    operationalHealth,
    clientWorkflowIntent,
    verifierAuthorization,
    now
  );
  const providerHandoffReceipt = normalizeProviderHandoffReceipt(
    input,
    claim,
    provider,
    boundary,
    serviceContract,
    externalHandoff,
    persistenceState,
    proof,
    now
  );
  const guidedReviewFlow = buildGuidedReviewFlow(
    claim,
    provider,
    boundary,
    validationSummary,
    readiness,
    acceptance,
    nextSteps,
    lifecycleSettings,
    serviceContract,
    operationalHealth,
    proof,
    persistenceState,
    externalHandoff
  );
  const clientRuntimeState = normalizeClientRequestState(
    input,
    claim,
    boundary,
    proof,
    persistenceState,
    guidedReviewFlow,
    externalHandoff,
    serviceContract,
    operationalHealth,
    lifecycleSettings,
    now
  );
  const exportDeliveryPlan = buildExportDeliveryPlan(
    input,
    exportSummary,
    analytics,
    reporting,
    persistenceState,
    externalHandoff,
    providerHandoffReceipt,
    clientRuntimeState,
    now
  );
  const audit = {
    surfaceId,
    eventType: 'claim-draft.contract.evaluated',
    generatedAt: now,
    claimId: claim.claimId,
    tenantId: boundary.tenantId || null,
    workspaceId: boundary.workspaceId || null,
    actorId: boundary.actor.actorId,
    providerId: provider.providerId,
    serviceId: provider.serviceId,
    claimRevision: draftRevision.revision,
    claimBaseRevision: draftRevision.baseRevision,
    claimProvenanceHash: draftRevision.provenanceHash,
    claimRevisionIssueCodes: draftRevision.validationIssues.map((issue) => issue.code),
    missingCapabilities: negotiation.missing,
    evidenceIds: claim.evidence.map((item) => item.evidenceId),
    handoffState,
    boundaryGuard: boundarySummary.handoffGuard,
    permissionIssueCodes: boundarySummary.permissionIssues,
    workspaceScopeGuard: workspaceScope.handoffGuard,
    workspaceScopeAllowed: workspaceScope.allowed,
    workspaceScopeIssueCodes: workspaceScope.validationIssues.map((issue) => issue.code),
    crossWorkspaceEvidenceIds: workspaceScope.crossWorkspaceEvidenceIds,
    unauthorizedEvidenceIds: workspaceScope.unauthorizedEvidenceIds,
    expiredDelegationIds: workspaceScope.expiredDelegationIds,
    verifierAuthorizationId: verifierAuthorization.authorizationId,
    verifierId: verifierAuthorization.verifierId,
    verifierAuthorizationAllowed: verifierAuthorization.allowed,
    verifierAuthorizationGuard: verifierAuthorization.handoffGuard,
    verifierAuthorizationIssueCodes: verifierAuthorization.validationIssues.map((issue) => issue.code),
    verifierEvidenceDisclosureMode: verifierAuthorization.disclosure.defaultMode,
    verifierRedactedEvidenceIds: verifierAuthorization.disclosure.redactedEvidenceIds,
    validationIssueCodes: validationSummary.issues.map((issue) => issue.code),
    readinessLevel: readiness.level,
    acceptanceStatus: acceptance.status,
    operationalMode: operationalHealth.mode,
    providerFailureCodes: operationalHealth.failureState.failures.map((failure) => failure.code),
    providerHealthProofId: operationalHealth.healthProof.proofId,
    providerHealthIssueCodes: operationalHealth.validationIssues.map((issue) => issue.code),
    providerRetryBlockedReason: operationalHealth.retryBlockedReason,
    providerRetryAttempt: operationalHealth.retryPolicy.attempt,
    providerRetryMaxAttempts: operationalHealth.retryPolicy.maxAttempts,
    providerDegradedFallbackEnabled: operationalHealth.degradedFallback.enabled,
    providerCallbackHealthState: operationalHealth.callbackHealth.state,
    providerCallbackHealthReady: operationalHealth.callbackHealth.ready,
    providerCallbackHealthIssueCodes: operationalHealth.callbackHealth.issueCodes,
    providerCallbackWatermarkDrift: operationalHealth.callbackHealth.watermarkDrift,
    providerCallbackEventStreamStale: operationalHealth.callbackHealth.eventStreamStale,
    retryAfterSeconds: operationalHealth.retryPolicy.retryAfterSeconds,
    providerContractAccepted: serviceContract.negotiatedVersion.accepted,
    providerContractVersion: serviceContract.negotiatedVersion.activeVersion,
    providerSyncStatus: serviceContract.syncMetadata.status,
    providerSyncWatermark: serviceContract.syncMetadata.watermark,
    providerCallbackSubscriptionId: providerCallbackContract.subscriptionId,
    providerCallbackState: providerCallbackContract.state,
    providerCallbackEnabled: providerCallbackContract.enabled,
    providerCallbackRequiredEvents: providerCallbackContract.eventContract.requiredEvents,
    providerCallbackMissingEvents: providerCallbackContract.eventContract.missingEvents,
    providerCallbackIssueCodes: providerCallbackContract.validationIssues.map((issue) => issue.code),
    externalHandoffId: externalHandoff.handoffId,
    externalHandoffState: externalHandoff.state,
    lifecycleMode: lifecycleSettings.mode,
    lifecycleEnabled: lifecycleSettings.enabled,
    lifecycleScheduledRunAt: lifecycleSettings.schedule.runAt,
    lifecycleCommand: lifecycleSettings.requestedCommand,
    analyticsCounters: analytics.counters,
    readinessDelta: analytics.deltas.readinessScore,
    historySnapshotCount: historySnapshots.length,
    historyRetainedCount: historyTimeline.retainedCount,
    historyDroppedCount: historyTimeline.droppedCount,
    historyCompactionRequired: historyTimeline.retention.compactionRequired,
    historyReadinessNetDelta: historyTimeline.trend.readinessNetDelta,
    persistenceStateKey: persistenceState.stateKey,
    persistenceRevision: persistenceState.revision,
    durableStatus: persistenceState.snapshot.durableStatus,
    recoveryStatus: persistenceState.recovery.status,
    recoveryRestartSafe: persistenceState.recovery.restartSafe,
    recoveryReplayRequired: persistenceState.recovery.replayRequired,
    recoveryReasons: persistenceState.recovery.reasons,
    recoveryCheckpointId: persistenceState.recovery.checkpoint.checkpointId,
    recoveryCheckpointAction: persistenceState.recovery.checkpoint.restartAction,
    recoveryOpenWriteCount: persistenceState.recovery.checkpoint.openWriteCount,
    recoveryPartialCommit: persistenceState.recovery.checkpoint.partialCommit,
    recoveryBlockedWriteIds: persistenceState.recovery.checkpoint.blockedEntryIds,
    recoveryIssueCodes: persistenceState.validationIssues.map((issue) => issue.code),
    recoveryReplayCommandIds: persistenceState.pendingReplayCommands.map((entry) => entry.commandId),
    exportReady: exportSummary.ready,
    guidedReviewFlowId: guidedReviewFlow.flowId,
    guidedReviewCurrentStep: guidedReviewFlow.summary.currentStepId,
    guidedReviewProgressPercent: guidedReviewFlow.summary.progressPercent,
    clientRequestId: clientRuntimeState.requestId,
    clientSessionId: clientRuntimeState.clientSessionId,
    clientWorkflowIntentId: clientWorkflowIntent.intentId,
    clientWorkflowAction: clientWorkflowIntent.requestedAction,
    clientWorkflowAllowed: clientWorkflowIntent.handoffGate.allowed,
    clientWorkflowIssueCodes: clientWorkflowIntent.validationIssues.map((issue) => issue.code),
    clientHydrationStatus: clientRuntimeState.hydration.status,
    clientRouteMismatchCodes: clientRuntimeState.hydration.validationIssues.map((issue) => issue.code),
    clientNextCommandSlot: clientRuntimeState.workflowHandoff.nextCommandSlot,
    providerHandoffReceiptId: providerHandoffReceipt.receiptId,
    providerHandoffReceiptState: providerHandoffReceipt.state,
    providerHandoffReceiptStatus: providerHandoffReceipt.status,
    providerHandoffReceiptAccepted: providerHandoffReceipt.accepted,
    providerHandoffReceiptIssueCodes: providerHandoffReceipt.validationIssues.map((issue) => issue.code),
    analyticsExportId: exportDeliveryPlan.exportId,
    analyticsExportReady: exportDeliveryPlan.ready,
    analyticsExportFormats: exportDeliveryPlan.formats,
    analyticsExportFields: exportDeliveryPlan.selectedFields,
    analyticsExportIssueCodes: exportDeliveryPlan.validationIssues.map((issue) => issue.code)
  };

  return {
    ok: negotiation.satisfied
      && hasEvidence
      && validationSummary.valid
      && workspaceScope.allowed
      && verifierAuthorization.allowed
      && acceptance.accepted
      && operationalHealth.canProceed
      && persistenceState.recovery.restartSafe
      && !lifecycleSettings.blocksHandoff
      && externalHandoff.state === 'dispatchable'
      && !persistenceState.validationIssues.some((issue) => issue.severity === 'error')
      && !providerHandoffReceipt.validationIssues.some((issue) => issue.severity === 'error')
      && !clientRuntimeState.hydration.validationIssues.some((issue) => issue.severity === 'error'),
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: {
      type: 'verifier-claim-gate.claim-draft',
      version: provider.contractVersion,
      requiredCapabilities,
      provider,
      claim,
      draftRevision,
      boundary,
      workspaceScope,
      verifierAuthorization
    },
    capabilityNegotiation: negotiation,
    providerServiceContract: serviceContract,
    providerCallbackContract,
    tenantBoundary: {
      tenantId: boundary.tenantId || null,
      workspaceId: boundary.workspaceId || null,
      isolationMode: boundary.isolationMode,
      scoped: boundarySummary.scoped,
      allowed: boundarySummary.allowed,
      handoffGuard: boundarySummary.handoffGuard,
      requiredRoles: boundary.requiredRoles,
      actor: boundary.actor,
      providerScope: boundary.providerScope,
      permissionIssues: boundarySummary.permissionIssues
    },
    workspaceScope,
    verifierAuthorization,
    preview,
    lifecycleSettings,
    validationSummary,
    operationalHealth,
    readiness,
    acceptance,
    nextSteps,
    clientContracts: {
      guidedReviewFlow,
      reviewSession: clientReviewSession,
      runtimeState: clientRuntimeState,
      workflowIntent: clientWorkflowIntent,
      routeRefreshCommand: clientRuntimeState.routeRefreshCommand,
      commandQueue: clientRuntimeState.commandQueue,
      reviewSessionCommand: {
        method: 'GET',
        route: '/verifier-claim-gate/claim-draft/review',
        queryContract: {
          claimId: claim.claimId,
          claimRevision: draftRevision.revision,
          tenantId: boundary.tenantId || 'required-tenant-id',
          workspaceId: boundary.workspaceId || 'required-workspace-id',
          proofId: proof.proofId
        },
        responseContract: clientReviewSession.contractType,
        enabled: true
      },
      previewCard: {
        title: preview.title,
        subtitle: preview.subtitle,
        statusLabel: preview.statusLabel,
        badgeCount: preview.badges.length,
        evidenceCount: preview.evidenceRows.length
      },
      acceptanceCommand: {
        method: 'POST',
        route: '/verifier-claim-gate/claim-draft/accept',
        bodyContract: {
          claimId: claim.claimId,
          claimRevision: draftRevision.revision,
          claimBaseRevision: draftRevision.baseRevision,
          provenanceHash: draftRevision.provenanceHash,
          proofId: proof.proofId,
          tenantId: boundary.tenantId || 'required-tenant-id',
          workspaceId: boundary.workspaceId || 'required-workspace-id',
          decision: 'accepted',
          stateKey: persistenceState.stateKey,
          expectedRevision: persistenceState.revision,
          expectedClaimRevision: draftRevision.savePrecondition.expectedRevision,
          idempotencyKey: persistenceState.idempotentCommands.acceptDraft.idempotencyKey,
          acceptedBy: boundary.actor.actorId === 'anonymous-actor'
            ? 'user-or-route-actor'
            : boundary.actor.actorId
        },
        enabled: acceptance.canAccept && !acceptance.accepted
      },
      permissionCommand: {
        method: 'POST',
        route: '/verifier-claim-gate/claim-draft/permissions',
        bodyContract: {
          claimId: claim.claimId,
          tenantId: boundary.tenantId || 'required-tenant-id',
          workspaceId: boundary.workspaceId || 'required-workspace-id',
          actorId: boundary.actor.actorId,
          requiredRoles: boundary.requiredRoles,
          workspaceScopeGuard: workspaceScope.handoffGuard,
          unauthorizedEvidenceIds: workspaceScope.unauthorizedEvidenceIds,
          requiredDelegationRoles: workspaceScope.requiredDelegationRoles,
          verifierAuthorizationId: verifierAuthorization.authorizationId,
          verifierId: verifierAuthorization.verifierId,
          verifierHandoffGuard: verifierAuthorization.handoffGuard,
          verifierMissingRoles: verifierAuthorization.permissions.missingRoles,
          verifierMissingActions: verifierAuthorization.permissions.missingActions,
          verifierRedactedEvidenceIds: verifierAuthorization.disclosure.redactedEvidenceIds
        },
        enabled: !boundarySummary.allowed
          || workspaceScope.unauthorizedEvidenceIds.length > 0
          || workspaceScope.expiredDelegationIds.length > 0
          || !verifierAuthorization.allowed
      },
      providerRetryCommand: {
        method: 'POST',
        route: operationalHealth.retryPolicy.retryRoute,
        bodyContract: {
          claimId: claim.claimId,
          claimRevision: draftRevision.revision,
          proofId: proof.proofId,
          providerId: provider.providerId,
          serviceId: provider.serviceId,
          tenantId: boundary.tenantId || 'required-tenant-id',
          workspaceId: boundary.workspaceId || 'required-workspace-id',
          retryAttempt: operationalHealth.retryPolicy.attempt + 1,
          maxAttempts: operationalHealth.retryPolicy.maxAttempts,
          retryAfterSeconds: operationalHealth.retryPolicy.retryAfterSeconds,
          retryBlockedReason: operationalHealth.retryBlockedReason,
          providerHealthProofId: operationalHealth.healthProof.proofId,
          failureCodes: operationalHealth.failureState.failures.map((failure) => failure.code),
          callbackState: operationalHealth.callbackHealth.state,
          callbackReady: operationalHealth.callbackHealth.ready,
          callbackIssueCodes: operationalHealth.callbackHealth.issueCodes,
          idempotencyKey: operationalHealth.retryPolicy.idempotencyKey
        },
        enabled: operationalHealth.canRetry
      },
      providerServiceContractCommand: {
        method: 'POST',
        route: '/verifier-claim-gate/provider-contract/negotiate',
        bodyContract: {
          claimId: claim.claimId,
          claimRevision: draftRevision.revision,
          provenanceHash: draftRevision.provenanceHash,
          providerId: provider.providerId,
          serviceId: provider.serviceId,
          requestedVersion: serviceContract.negotiatedVersion.requestedVersion,
          activeVersion: serviceContract.negotiatedVersion.activeVersion,
          supportedVersions: serviceContract.negotiatedVersion.supportedVersions,
          requiredCapabilities,
          acceptedCapabilities: serviceContract.capabilityProfile.accepted,
          missingCapabilities: serviceContract.capabilityProfile.missing,
          handoffMode: serviceContract.handoffContract.requiredMode,
          syncCursor: serviceContract.syncMetadata.cursor,
          syncWatermark: serviceContract.syncMetadata.watermark
        },
        enabled: !serviceContract.negotiatedVersion.accepted
          || serviceContract.capabilityProfile.missing.length > 0
          || serviceContract.handoffContract.dispatchBlockers.includes('handoff_mode')
      },
      externalHandoffCommand: externalHandoff.dispatchCommand,
      providerHandoffReceiptCommand: {
        method: providerHandoffReceipt.syncReconciliation.method,
        route: providerHandoffReceipt.syncReconciliation.route,
        bodyContract: providerHandoffReceipt.syncReconciliation.bodyContract,
        responseContract: providerHandoffReceipt.contractType,
        enabled: providerHandoffReceipt.syncReconciliation.required
      },
      providerCallbackSubscriptionCommand: {
        method: providerCallbackContract.subscribeCommand.method,
        route: providerCallbackContract.subscribeCommand.route,
        bodyContract: providerCallbackContract.subscribeCommand.bodyContract,
        responseContract: providerCallbackContract.contractType,
        enabled: providerCallbackContract.subscribeCommand.enabled
      },
      providerCallbackAckTemplate: providerCallbackContract.ackCommandTemplate,
      lifecycleCommand: {
        method: persistenceState.idempotentCommands.lifecycleControl.method,
        route: persistenceState.idempotentCommands.lifecycleControl.route,
        bodyContract: {
          claimId: claim.claimId,
          claimRevision: draftRevision.revision,
          tenantId: boundary.tenantId || 'required-tenant-id',
          workspaceId: boundary.workspaceId || 'required-workspace-id',
          proofId: proof.proofId,
          command: lifecycleSettings.requestedCommand || (lifecycleSettings.enabled ? 'disable' : 'enable'),
          enabled: lifecycleSettings.enabled,
          mode: lifecycleSettings.mode,
          disabledReason: lifecycleSettings.disabledReason || 'required-when-disabling',
          schedule: lifecycleSettings.schedule,
          stateKey: persistenceState.stateKey,
          expectedRevision: persistenceState.revision,
          idempotencyKey: persistenceState.idempotentCommands.lifecycleControl.idempotencyKey
        },
        controls: lifecycleSettings.controls,
        enabled: boundarySummary.allowed
      },
      statePersistenceCommand: {
        method: persistenceState.idempotentCommands.saveDraft.method,
        route: persistenceState.idempotentCommands.saveDraft.route,
        bodyContract: {
          stateKey: persistenceState.stateKey,
          revision: persistenceState.revision,
          claimId: claim.claimId,
          claimRevision: draftRevision.revision,
          claimBaseRevision: draftRevision.baseRevision,
          revisionPrecondition: draftRevision.savePrecondition,
          provenanceHash: draftRevision.provenanceHash,
          tenantId: boundary.tenantId || 'required-tenant-id',
          workspaceId: boundary.workspaceId || 'required-workspace-id',
          proofId: proof.proofId,
          durableStatus: persistenceState.snapshot.durableStatus,
          handoffState,
          acceptanceStatus: acceptance.status,
          readinessScore: readiness.score,
          lifecycleMode: lifecycleSettings.mode,
          lifecycleEnabled: lifecycleSettings.enabled,
          lifecycleSchedule: lifecycleSettings.schedule,
          commandLedger: persistenceState.commandLedger,
          writeAheadLog: persistenceState.writeAheadLog,
          recoveryCheckpoint: persistenceState.recovery.checkpoint,
          recoveryPaths: persistenceState.recovery.recoveryPaths,
          commandReplayPlan: persistenceState.commandReplayPlan,
          recoveryStatus: persistenceState.recovery.status,
          restartSafe: persistenceState.recovery.restartSafe,
          replayRequired: persistenceState.recovery.replayRequired,
          commitToken: persistenceState.snapshot.commitToken,
          nextRevision: persistenceState.snapshot.nextRevision,
          lockVersion: persistenceState.snapshot.lockVersion,
          idempotencyKey: persistenceState.idempotentCommands.saveDraft.idempotencyKey
        },
        enabled: true
      },
      recoveryReplayCommand: {
        method: 'POST',
        route: '/verifier-claim-gate/claim-draft/recover',
        bodyContract: {
          stateKey: persistenceState.stateKey,
          revision: persistenceState.revision,
          claimId: claim.claimId,
          claimRevision: draftRevision.revision,
          claimBaseRevision: draftRevision.baseRevision,
          provenanceHash: draftRevision.provenanceHash,
          proofId: proof.proofId,
          replayCommandIds: persistenceState.pendingReplayCommands.map((entry) => entry.commandId),
          replayPlan: persistenceState.commandReplayPlan,
          checkpoint: persistenceState.recovery.checkpoint,
          recoveryPaths: persistenceState.recovery.recoveryPaths,
          writeAheadEntryIds: persistenceState.recovery.checkpoint.openEntryIds,
          reasons: persistenceState.recovery.reasons,
          validationIssues: persistenceState.validationIssues
        },
        enabled: persistenceState.recovery.replayRequired
      },
      analyticsExportCommand: {
        method: exportDeliveryPlan.method,
        route: exportDeliveryPlan.route,
        bodyContract: exportDeliveryPlan.bodyContract,
        responseContract: exportDeliveryPlan.contractType,
        validationIssues: exportDeliveryPlan.validationIssues,
        enabled: exportDeliveryPlan.ready
      },
      nextStepCommand: nextSteps[0] || null
    },
    analytics,
    history: {
      snapshots: historySnapshots,
      latest: historySnapshots[historySnapshots.length - 1] || null,
      timelineState: historyTimeline
    },
    requestState: clientRuntimeState,
    draftRevision,
    persistence: persistenceState,
    reporting,
    exports: {
      verifierSummary: exportSummary,
      deliveryPlan: exportDeliveryPlan
    },
    sync: {
      cursor: provider.syncCursor,
      providerServiceContract: {
        status: serviceContract.syncMetadata.status,
        watermark: serviceContract.syncMetadata.watermark,
        stale: serviceContract.syncMetadata.stale,
        lastSyncedAt: serviceContract.syncMetadata.lastSyncedAt,
        dispatchAllowed: serviceContract.handoffContract.dispatchAllowed
      },
      providerCallbackContract: {
        state: providerCallbackContract.state,
        enabled: providerCallbackContract.enabled,
        subscriptionId: providerCallbackContract.subscriptionId,
        requiredEvents: providerCallbackContract.eventContract.requiredEvents,
        missingEvents: providerCallbackContract.eventContract.missingEvents,
        expectedWatermark: providerCallbackContract.syncBridge.expectedWatermark,
        lastWatermark: providerCallbackContract.syncBridge.lastWatermark,
        watermarkAligned: providerCallbackContract.syncBridge.watermarkAligned,
        healthState: operationalHealth.callbackHealth.state,
        healthReady: operationalHealth.callbackHealth.ready,
        eventStreamStale: operationalHealth.callbackHealth.eventStreamStale,
        healthIssueCodes: operationalHealth.callbackHealth.issueCodes
      },
      nextAction: nextSteps[0]?.action || (handoffState === HANDOFF_STATES.READY
        ? 'handoff_to_verifier'
        : handoffState === HANDOFF_STATES.DEGRADED
          ? 'schedule_provider_retry'
        : handoffState === HANDOFF_STATES.NEEDS_PROVIDER_SYNC
          ? 'request_provider_evidence_sync'
          : 'negotiate_provider_contract'),
      externalEndpoint: provider.endpoint,
      healthMode: operationalHealth.mode,
      retryPolicy: operationalHealth.retryPolicy,
      externalHandoff,
      providerHandoffReceipt
    },
    audit,
    proof,
    evidence: claim.evidence
  };
}

export default describeClaimDraftSurface;
