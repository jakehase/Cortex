import {
  compileMailchimpMemoryMounts,
  compileRollbackMemoryPlan,
} from '../compiler/memory-mount-compiler.mjs';

const REQUIRED_MAILCHIMP_MOUNTS = Object.freeze([
  'campaignDraft',
  'audienceSnapshot',
  'verifierEvidence',
  'rollbackJournal',
]);

function compactString(value) {
  return String(value ?? '').trim();
}

function stableList(value) {
  const list = Array.isArray(value) ? value : value == null ? [] : String(value).split(',');
  return Array.from(new Set(list.map(compactString).filter(Boolean))).sort();
}

function severityRank(severity) {
  return severity === 'error' ? 3 : severity === 'warning' ? 2 : 1;
}

function normalizeDiagnostics(diagnostics = []) {
  return (Array.isArray(diagnostics) ? diagnostics : [])
    .map((diagnostic, index) => ({
      index,
      severity: compactString(diagnostic.severity || diagnostic.level || 'info'),
      code: compactString(diagnostic.code || 'mailchimp.memory.info'),
      mount: compactString(diagnostic.mount || diagnostic.field),
      message: compactString(diagnostic.message),
    }))
    .sort((left, right) => (
      severityRank(right.severity) - severityRank(left.severity)
      || left.code.localeCompare(right.code)
      || left.index - right.index
    ));
}

function normalizeTenantScope(source = {}, options = {}) {
  const raw = source.tenantScope && typeof source.tenantScope === 'object'
    ? source.tenantScope
    : source.tenant && typeof source.tenant === 'object'
      ? source.tenant
      : {};
  const tenantId = compactString(
    options.tenantId
      || raw.tenantId
      || raw.id
      || source.tenantId
      || source.tenant,
  );
  const workspaceId = compactString(
    options.workspaceId
      || raw.workspaceId
      || raw.workspace
      || source.workspaceId
      || source.workspace,
  );
  const environment = compactString(
    options.environment
      || raw.environment
      || source.environment
      || 'production',
  );
  const isolationKey = compactString(
    options.isolationKey
      || raw.isolationKey
      || [tenantId, workspaceId, environment].filter(Boolean).join(':'),
  );

  return {
    tenantId,
    workspaceId,
    environment,
    isolationKey,
    scoped: Boolean(tenantId && workspaceId && isolationKey),
  };
}

function normalizeRolePermissions(source = {}, options = {}) {
  const raw = source.permissions && typeof source.permissions === 'object'
    ? source.permissions
    : {};
  const roles = stableList(options.roles || raw.roles || source.roles);
  const grants = stableList(options.grants || raw.grants || raw.capabilities || source.grants);
  const denied = stableList(options.denied || raw.denied || raw.deniedCapabilities);
  const requiredGrants = stableList([
    'memory:read',
    'memory:write:local',
    ...(options.localOnly === false ? ['provider:sync:read'] : []),
    ...(source.requiresAudit === false ? [] : ['audit:append']),
    ...(raw.requiredGrants || []),
  ]);
  const missingGrants = requiredGrants.filter((grant) => !grants.includes(grant));
  const deniedRequiredGrants = requiredGrants.filter((grant) => denied.includes(grant));

  return {
    roles,
    grants,
    denied,
    requiredGrants,
    missingGrants,
    deniedRequiredGrants,
    accepted: missingGrants.length === 0 && deniedRequiredGrants.length === 0,
  };
}

function buildBoundaryLedger(source, options, mountLedger) {
  const tenantScope = normalizeTenantScope(source, options);
  const permissionScope = normalizeRolePermissions(source, options);
  const crossTenantMounts = mountLedger.filter((mount) => {
    const path = compactString(mount.path);
    const resource = compactString(mount.providerResource);
    return tenantScope.tenantId
      && (
        (path.includes('/tenants/') && !path.includes(`/tenants/${tenantScope.tenantId}/`))
        || (resource.includes('/tenants/') && !resource.includes(`/tenants/${tenantScope.tenantId}/`))
      );
  });
  const unscopedWorkspaceMounts = mountLedger.filter((mount) => {
    const path = compactString(mount.path);
    return tenantScope.workspaceId
      && path.includes('/workspaces/')
      && !path.includes(`/workspaces/${tenantScope.workspaceId}/`);
  });
  const auditRequired = source.requiresAudit !== false || options.requiresAudit === true;
  const auditReady = !auditRequired
    || permissionScope.grants.includes('audit:append')
    || permissionScope.grants.includes('audit:*');
  const blockedReasons = stableList([
    ...(tenantScope.scoped ? [] : ['missing_tenant_workspace_scope']),
    ...(permissionScope.missingGrants.map((grant) => `missing_grant:${grant}`)),
    ...(permissionScope.deniedRequiredGrants.map((grant) => `denied_grant:${grant}`)),
    ...(crossTenantMounts.length ? ['cross_tenant_mount_scope'] : []),
    ...(unscopedWorkspaceMounts.length ? ['workspace_mount_scope_mismatch'] : []),
    ...(auditReady ? [] : ['audit_append_unavailable']),
  ]);

  return {
    tenantScope,
    permissionScope,
    isolation: {
      accepted: blockedReasons.length === 0,
      crossTenantMounts: crossTenantMounts.map((mount) => mount.name),
      workspaceMismatches: unscopedWorkspaceMounts.map((mount) => mount.name),
      localBoundary: options.localOnly !== false ? 'enforced' : 'provider-sync',
      externalWritesAllowed: false,
    },
    auditHandoff: {
      required: auditRequired,
      accepted: auditReady && blockedReasons.length === 0,
      sink: compactString(options.auditSink || source.auditSink || 'runtime.audit.mailchimp'),
      correlationKey: compactString(
        options.auditCorrelationKey
          || source.auditCorrelationKey
          || tenantScope.isolationKey
          || source.jobId
          || source.id,
      ),
    },
    blockedReasons,
  };
}

function buildMountLedger(memoryContract) {
  return (memoryContract.mounts || []).map((mount) => {
    const provider = mount.providerContract || {};
    return {
      id: mount.id,
      name: mount.name,
      path: mount.path,
      mode: mount.mode,
      sensitivity: mount.sensitivity,
      retentionHours: mount.retentionHours,
      localOnly: mount.localOnly === true,
      externalWritesAllowed: mount.externalWritesAllowed === true,
      providerResource: provider.providerResource || null,
      syncDirection: provider.syncDirection || 'local-only',
      externalHandoff: provider.externalHandoff || 'not-required',
      requiredCapabilities: stableList(provider.negotiatedCapabilities),
      cursorPath: provider.syncMetadata?.cursorPath || null,
      conflictPolicy: provider.syncMetadata?.conflictPolicy || null,
    };
  });
}

function buildMemoryReadiness(mountLedger, diagnostics, options, boundaryLedger) {
  const errorCount = diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length;
  const warningCount = diagnostics.filter((diagnostic) => diagnostic.severity === 'warning').length;
  const presentMounts = new Set(mountLedger.map((mount) => mount.name));
  const missingRequiredMounts = REQUIRED_MAILCHIMP_MOUNTS.filter((mount) => !presentMounts.has(mount));
  const providerSyncMounts = mountLedger.filter((mount) => mount.syncDirection !== 'local-only');
  const externalWriteLeaks = mountLedger.filter((mount) => mount.externalWritesAllowed);
  const boundaryBlocked = (boundaryLedger?.blockedReasons || []).length > 0;
  const localOnly = options.localOnly !== false;
  const acceptedForProviderSync = errorCount === 0
    && missingRequiredMounts.length === 0
    && providerSyncMounts.length > 0
    && externalWriteLeaks.length === 0;
  const blocked = errorCount > 0
    || missingRequiredMounts.length > 0
    || externalWriteLeaks.length > 0
    || boundaryBlocked;

  return {
    status: blocked
      ? 'blocked'
      : warningCount > 0
        ? 'ready_with_warnings'
        : 'ready',
    acceptedForRuntime: errorCount === 0
      && missingRequiredMounts.length === 0
      && externalWriteLeaks.length === 0
      && boundaryBlocked === false,
    acceptedForProviderSync: acceptedForProviderSync && boundaryBlocked === false,
    providerSyncRequired: providerSyncMounts.length > 0,
    missingRequiredMounts,
    boundaryBlocked,
    nextAction: errorCount > 0
      ? 'repair_memory_mount_contract'
      : missingRequiredMounts.length > 0
        ? 'add_required_mailchimp_memory_mounts'
        : externalWriteLeaks.length > 0
          ? 'disable_external_memory_writes'
          : boundaryBlocked
            ? 'repair_tenant_permission_boundary'
          : acceptedForProviderSync
            ? 'handoff_memory_sync_to_adapter'
            : localOnly
              ? 'continue_local_memory_runtime'
              : 'review_provider_sync_scope',
  };
}

export function buildMailchimpMemoryGuideContract(source = {}, options = {}) {
  const memoryContract = compileMailchimpMemoryMounts(source, options);
  const mountLedger = buildMountLedger(memoryContract);
  const diagnostics = normalizeDiagnostics(memoryContract.diagnostics);
  const boundaryLedger = buildBoundaryLedger(source, options, mountLedger);
  const readiness = buildMemoryReadiness(mountLedger, diagnostics, options, boundaryLedger);
  const rollback = compileRollbackMemoryPlan(
    compactString(options.jobId || source.jobId || source.id || 'mailchimp.memory.guide'),
    memoryContract,
  );
  const providerSyncMounts = mountLedger.filter((mount) => mount.syncDirection !== 'local-only');

  return {
    kind: 'aios.docsRuntime.memoryGuide.mailchimp.v1',
    provider: 'mailchimp',
    memoryContract,
    mountLedger,
    boundaryLedger,
    readiness,
    providerSync: {
      providerService: memoryContract.providerServiceContract.providerService,
      required: providerSyncMounts.length > 0,
      mounts: providerSyncMounts.map((mount) => mount.name),
      requiredCapabilities: stableList(providerSyncMounts.flatMap((mount) => mount.requiredCapabilities)),
      externalWritesAllowed: false,
      tenantScope: boundaryLedger.tenantScope,
      auditHandoff: boundaryLedger.auditHandoff,
      handoffStates: memoryContract.providerServiceContract.handoffStates || {},
    },
    rollback,
    diagnostics,
    exportSummary: {
      exportReady: readiness.acceptedForRuntime,
      blockedReasons: diagnostics
        .filter((diagnostic) => diagnostic.severity === 'error')
        .map((diagnostic) => diagnostic.code)
        .concat(boundaryLedger.blockedReasons),
      validationSummary: {
        mounts: mountLedger.length,
        providerSyncMounts: providerSyncMounts.length,
        diagnostics: diagnostics.length,
        missingRequiredMounts: readiness.missingRequiredMounts.length,
        boundaryBlocked: readiness.boundaryBlocked,
        missingPermissionGrants: boundaryLedger.permissionScope.missingGrants.length,
        crossTenantMounts: boundaryLedger.isolation.crossTenantMounts.length,
      },
    },
  };
}

export function assertMailchimpMemoryGuideReady(contract) {
  const target = contract?.kind === 'aios.docsRuntime.memoryGuide.mailchimp.v1'
    ? contract
    : buildMailchimpMemoryGuideContract(contract || {});
  return {
    ok: target.readiness.acceptedForRuntime === true,
    status: target.readiness.status,
    nextAction: target.readiness.nextAction,
    blockedReasons: target.exportSummary.blockedReasons,
    validationSummary: target.exportSummary.validationSummary,
  };
}
