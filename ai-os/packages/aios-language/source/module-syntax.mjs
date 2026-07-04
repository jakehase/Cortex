import {
  buildProfileActivationControlPanel,
  buildProfileBoundaryReleaseDecision,
  buildProfileTenantHandoffBoundaryPacket,
  buildProfileTenantBoundaryIntentPacket,
  buildProfileTenantLaunchGuardContract,
  buildProfileTenantPermissionMatrix,
  buildProfileLifecycleControlState,
  buildProfileClientWorkflowHandoff,
  buildProfilePersistenceEnvelope,
  buildProfileClientRuntimeState,
  buildProfileExportSummary,
  buildProfileAnalyticsExportLedger,
  buildProfileOperationalHealthExport,
  buildProfileOperationalReadinessBrief,
  buildProfileOperationalEscalationEnvelope,
  buildProfileLaunchAcceptanceExport,
  buildProfileClientPreviewRouteContract,
  buildProfileStatusPublicationPacket,
  buildProfileOperationalFailureState,
  buildProfileBoundaryEvidencePacket,
  buildProfilePreviewAcceptanceState,
  buildProfilePreviewNextStepDigest,
  buildProfileProviderServiceContract,
  buildProfileProviderAdoptionContract,
  buildProfileProviderSyncIntent,
  buildProfileProviderSyncHandoffContract,
  buildProfileProviderLaunchHandoffContract,
  buildProfilePrimaryExportPack,
  buildProfileAudienceExportLedger,
  buildProfileClientRuntimeAdoptionPack,
  buildProfileClientResumeHandoffContract,
  buildProfileClientResolutionBrief,
  buildProfilePersistedStateRecoveryManifest,
  buildProfileRequestKernelBinding,
  buildProfileRestartRecoveryPacket,
  buildProfileRestartReplayDecisionEnvelope,
  buildProfileRestartStatusLedger,
  buildProfileLifecycleClientControlPacket,
  buildProfileLifecycleScheduleCheckpoint,
  buildProfileLifecycleNextActionState,
  buildProfileLifecycleSettingsControlContract,
  buildProfileLaunchControlContract,
  compileProfileDeclaration,
  deriveProfileRuntimeContract
} from './profile-declaration.mjs';
import {
  buildFeatureGateAnalyticsReport,
  buildFeatureGateAnalyticsPublicationSummary,
  buildFeatureGateClientAcceptancePackage,
  buildFeatureGateClientActionQueue,
  buildFeatureGateClientWorkflowHandoff,
  buildFeatureGateBoundaryControlPlan,
  buildFeatureGateBoundaryReleaseDecision,
  buildFeatureGateTenantHandoffBoundaryPacket,
  buildFeatureGateReleaseEvidencePack,
  buildFeatureGateLifecycleCommandPlan,
  buildFeatureGateLifecycleReadinessContract,
  buildFeatureGateKernelHandoffManifest,
  buildFeatureGateOperationalLedger,
  buildFeatureGateProviderSyncAcceptance,
  buildFeatureGateProviderLaunchAcceptance,
  buildFeatureGateProviderHandoffState,
  buildFeatureGatePublicationTimeline,
  buildFeatureGateProviderPreviewAcceptance,
  buildFeatureGateClientReadinessContract,
  buildFeatureGateResumeStateEnvelope,
  buildFeatureGateProviderControlPacket,
  buildFeatureGateClientPreviewRouteContract,
  buildFeatureGateLaunchPreviewContract,
  buildFeatureGateClientNextStepDigest,
  buildFeatureGateLaunchReadinessLedger,
  buildFeatureGateOperationalControlPacket,
  buildFeatureGateStateSnapshot,
  deriveFeatureGateRecovery,
  evaluateFeatureGateContract
} from './feature-gates.mjs';
import {
  buildImportAnalyticsSnapshot,
  buildImportAnalyticsRecoveryDigest,
  buildImportOperationalEscalationEnvelope,
  buildImportProviderOperationalBrief,
  buildImportBoundaryReleaseDecision,
  buildImportTenantHandoffBoundaryPacket,
  buildImportClientAcceptancePackage,
  buildImportClientActionQueue,
  buildImportClientWorkflowHandoff,
  buildImportGateLifecycleControlPlan,
  buildImportLifecycleCommandSurface,
  buildImportHistoryExport,
  buildImportStatusJournal,
  buildImportTimelineReport,
  buildImportKernelHandoffManifest,
  buildImportLifecycleControlState,
  buildImportPreviewAcceptanceState,
  buildImportTenantBoundaryAcceptance,
  buildImportProviderContract,
  buildImportProviderReadinessPlan,
  buildImportProviderAdoptionContract,
  buildImportProviderSyncCheckpoint,
  buildImportProviderSyncBridge,
  buildImportProviderSyncPublication,
  buildImportProviderSyncStateEnvelope,
  buildImportProviderLaunchGate,
  buildImportProviderLaunchStateEnvelope,
  buildImportTenantAuditReadinessContract,
  buildImportRuntimeAdoptionHandoff,
  buildImportRuntimeClientContract,
  buildImportRuntimeResumeEnvelope,
  buildImportRuntimeHandoffState,
  buildImportRuntimeClientControlPacket,
  buildImportRuntimeRequestAdoptionCheckpoint,
  buildImportClientReadinessBrief,
  buildImportClientPreviewDigest,
  buildImportClientEvidenceManifest,
  buildImportClientResolutionBrief,
  buildImportClientLaunchReadinessLedger,
  buildImportClientPreviewRouteContract,
  buildImportTenantScopedPreviewRoute,
  buildImportWorkspaceBoundaryManifest,
  buildImportOperationalLedger,
  assessImportOperationalHealth,
  buildImportRecoveryHandoff,
  resolveImportSyntax
} from './import-syntax.mjs';

export const MODULE_SYNTAX_SCHEMA_VERSION = 'aios.module-syntax.v1';

const DEFAULT_MODULE_BOUNDARY = Object.freeze({
  tenantId: 'mailchimp.default',
  workspaceId: 'mailchimp.workspace.default',
  role: 'campaign_operator',
  permissionMode: 'least_privilege'
});

const ROLE_CAPABILITIES = Object.freeze({
  campaign_operator: Object.freeze(['mailchimp.read', 'mailchimp.campaign.plan', 'kernel.status.write']),
  audience_operator: Object.freeze(['mailchimp.read', 'mailchimp.audience.segment', 'kernel.status.write']),
  auditor: Object.freeze(['mailchimp.read', 'mailchimp.webhook.inspect'])
});

export function parseModuleSyntaxSource(source = '', options = {}) {
  const sections = { imports: [], profiles: [], gates: [], effects: [], boundaries: [] };
  const diagnostics = [];
  String(source ?? '').split(/\r?\n/).forEach((rawLine, offset) => {
    const line = rawLine.replace(/#.*/, '').trim();
    if (!line) return;
    if (line.startsWith('import ')) sections.imports.push(line);
    else if (line.startsWith('profile ')) sections.profiles.push(line);
    else if (line.startsWith('gate ')) sections.gates.push(line);
    else if (line.startsWith('effect ')) sections.effects.push(line.slice('effect '.length).trim());
    else if (line.startsWith('tenant ') || line.startsWith('workspace ')) sections.boundaries.push(line);
    else diagnostics.push({ level: 'error', code: 'unknown_module_directive', subject: `line:${offset + 1}` });
  });
  return {
    schemaVersion: MODULE_SYNTAX_SCHEMA_VERSION,
    sourceName: clean(options.sourceName) || 'inline.module.aios',
    sections,
    diagnostics
  };
}

export function compileModuleSyntax(input = {}, options = {}) {
  const parsed = typeof input === 'string' ? parseModuleSyntaxSource(input, options) : normalizeModuleInput(input);
  const profileSource = parsed.sections.profiles.join('\n');
  const gateSource = parsed.sections.gates.join('\n');
  const importSource = parsed.sections.imports.join('\n');
  const profile = compileProfileDeclaration(profileSource || options.profile || {}, options);
  const runtime = deriveProfileRuntimeContract(profileSource || options.profile || {}, options);
  const clientRuntime = buildProfileClientRuntimeState(profileSource || options.profile || {}, options);
  const profilePersistence = buildProfilePersistenceEnvelope(profileSource || options.profile || {}, {
    ...options,
    previousState: options.previousProfileState,
    persistedMemory: options.persistedMemory,
    command: options.profileCommand
  });
  const profileFailure = buildProfileOperationalFailureState(profileSource || options.profile || {}, {
    ...options,
    previousState: options.previousProfileState,
    persistedMemory: options.persistedMemory,
    command: options.profileCommand,
    attempt: options.profileAttempt,
    maxAttempts: options.maxProfileAttempts
  });
  const profileProviderService = buildProfileProviderServiceContract(profileSource || options.profile || {}, {
    ...options,
    previousProviderState: options.previousProfileProviderState,
    requestedProviderCapabilities: options.profileProviderCapabilities ?? options.requestedProviderCapabilities,
    providerCommandKey: options.profileProviderCommandKey,
    syncCursor: options.profileSyncCursor
  });
  const profileLifecycle = buildProfileLifecycleControlState(profileSource || options.profile || {}, {
    ...options,
    previousState: options.previousProfileState,
    previousLifecycle: options.previousProfileLifecycle,
    persistedMemory: options.persistedMemory,
    lifecycleCommand: options.profileLifecycleCommand,
    profileCommand: options.profileCommand,
    settings: options.profileLifecycleSettings,
    attempt: options.profileAttempt,
    maxAttempts: options.maxProfileAttempts
  });
  const imports = resolveImportSyntax(importSource, options);
  const importHandoff = buildImportRecoveryHandoff(importSource, options);
  const importHealth = assessImportOperationalHealth(imports, {
    attempt: options.importAttempt,
    maxAttempts: options.maxImportAttempts
  });
  const importAnalytics = buildImportAnalyticsSnapshot(imports, {
    ...options,
    health: importHealth,
    previousAnalytics: options.previousImportAnalytics
  });
  const importHistoryExport = buildImportHistoryExport(imports, {
    ...options,
    health: importHealth,
    previousAnalytics: options.previousImportAnalytics,
    previousHistoryExport: options.previousImportHistoryExport,
    historyLimit: options.importHistoryLimit ?? options.historyLimit,
    now: options.now ?? options.timestamp
  });
  const importLifecycle = buildImportLifecycleControlState(imports, {
    ...options,
    health: importHealth,
    previousLifecycle: options.previousImportLifecycle,
    command: options.importCommand,
    settings: options.importSettings
  });
  const importPreviewAcceptance = buildImportPreviewAcceptanceState(imports, {
    ...options,
    health: importHealth,
    previousLifecycle: options.previousImportLifecycle,
    lifecycleCommand: options.importCommand,
    lifecycleSettings: options.importSettings,
    acceptance: {
      requireExplicitAcceptance: options.requireImportAcceptance === true,
      ...(options.importAcceptance && typeof options.importAcceptance === 'object' ? options.importAcceptance : {})
    },
    requiredAliases: options.requiredImportAliases
  });
  const importBoundaryAcceptance = buildImportTenantBoundaryAcceptance(imports, {
    ...options,
    health: importHealth,
    requestedCapabilities: options.importRequestedCapabilities ?? imports.capabilityRefs,
    importScopes: options.importScopes,
    scope: {
      tenantId: options.tenantId,
      workspaceId: options.workspaceId,
      requestedTenantId: options.requestedTenantId ?? options.requestTenantId,
      requestedWorkspaceId: options.requestedWorkspaceId ?? options.requestWorkspaceId,
      role: options.role,
      permissionMode: options.permissionMode
    },
    acceptance: {
      requireExplicitAcceptance: options.requireImportBoundaryAcceptance === true,
      ...(options.importBoundaryAcceptance && typeof options.importBoundaryAcceptance === 'object'
        ? options.importBoundaryAcceptance
      : {})
    }
  });
  const importWorkspaceBoundaryManifest = buildImportWorkspaceBoundaryManifest(imports, {
    ...options,
    health: importHealth,
    requestedCapabilities: options.importRequestedCapabilities ?? imports.capabilityRefs,
    requestedPermissions: options.importRequestedPermissions ?? options.requestedPermissions,
    importScopes: options.importScopes,
    previousManifest: options.previousImportWorkspaceBoundaryManifest,
    scope: {
      tenantId: options.tenantId,
      workspaceId: options.workspaceId,
      requestedTenantId: options.requestedTenantId ?? options.requestTenantId,
      requestedWorkspaceId: options.requestedWorkspaceId ?? options.requestWorkspaceId,
      role: options.role,
      permissionMode: options.permissionMode
    },
    acceptance: {
      requireExplicitAcceptance: options.requireImportBoundaryAcceptance === true,
      ...(options.importBoundaryAcceptance && typeof options.importBoundaryAcceptance === 'object'
        ? options.importBoundaryAcceptance
        : {})
    }
  });
  const importProviderContract = buildImportProviderContract(imports, {
    ...options,
    health: importHealth,
    requestedCapabilities: options.importRequestedCapabilities ?? imports.capabilityRefs
  });
  const importProviderReadiness = buildImportProviderReadinessPlan(importProviderContract, {
    ...options,
    previousReadinessPlan: options.previousImportProviderReadiness,
    acceptance: options.importProviderReadinessAcceptance,
    requiredAliases: options.requiredImportAliases,
    now: options.now ?? options.timestamp
  });
  const importRuntimeAdoption = buildImportRuntimeAdoptionHandoff(imports, {
    ...options,
    health: importHealth,
    previousAdoption: options.previousImportRuntimeAdoption,
    previousLifecycle: options.previousImportLifecycle,
    previousAnalytics: options.previousImportAnalytics,
    command: options.importCommand,
    settings: options.importSettings,
    acceptance: options.importAcceptance,
    boundaryAcceptance: options.importBoundaryAcceptance,
    requiredAliases: options.requiredImportAliases,
    requestedCapabilities: options.importRequestedCapabilities ?? imports.capabilityRefs,
    importScopes: options.importScopes,
    scope: {
      tenantId: options.tenantId,
      workspaceId: options.workspaceId,
      requestedTenantId: options.requestedTenantId ?? options.requestTenantId,
      requestedWorkspaceId: options.requestedWorkspaceId ?? options.requestWorkspaceId,
      role: options.role,
      permissionMode: options.permissionMode
    }
  });
  const importRuntimeClientContract = buildImportRuntimeClientContract(imports, {
    ...options,
    health: importHealth,
    previousLifecycle: options.previousImportLifecycle,
    previousAdoption: options.previousImportRuntimeAdoption,
    previousClientContract: options.previousImportRuntimeClientContract,
    command: options.importCommand,
    settings: options.importSettings,
    acceptance: options.importAcceptance,
    boundaryAcceptance: options.importBoundaryAcceptance,
    providerReadinessAcceptance: options.importProviderReadinessAcceptance,
    requiredAliases: options.requiredImportAliases,
    requestedCapabilities: options.importRequestedCapabilities,
    importScopes: options.importScopes,
    scope: {
      tenantId: options.tenantId,
      workspaceId: options.workspaceId,
      requestedTenantId: options.requestedTenantId ?? options.requestTenantId,
      requestedWorkspaceId: options.requestedWorkspaceId ?? options.requestWorkspaceId,
      role: options.role,
      permissionMode: options.permissionMode
    }
  });
  const importProviderAdoption = buildImportProviderAdoptionContract(imports, {
    ...options,
    health: importHealth,
    previousProviderAdoption: options.previousImportProviderAdoption,
    previousRuntimeAdoption: options.previousImportRuntimeAdoption,
    previousLifecycle: options.previousImportLifecycle,
    command: options.importCommand,
    settings: options.importSettings,
    acceptance: options.importProviderAdoptionAcceptance,
    requiredAliases: options.requiredImportAliases,
    requestedCapabilities: options.importRequestedCapabilities ?? imports.capabilityRefs
  });
  const operation = profile.profile?.operation ?? options.operation ?? 'campaign.sync';
  const requestedEffects = [...parsed.sections.effects, ...(options.requestedEffects ?? [])];
  const gate = evaluateFeatureGateContract({
    operation,
    requestedEffects,
    gates: gateSource || options.gates || {}
  });
  const gateState = buildFeatureGateStateSnapshot(gateSource || options.gates || {}, {
    operation,
    requestedEffects,
    previousState: options.previousGateState,
    generation: options.gateGeneration
  });
  const gateAnalytics = buildFeatureGateAnalyticsReport(gateSource || options.gates || {}, {
    operation,
    requestedEffects,
    previousAnalytics: options.previousGateAnalytics,
    now: options.now ?? options.timestamp
  });
  const featureBoundaryControls = buildFeatureGateBoundaryControlPlan(gateSource || options.gates || {}, {
    ...options,
    operation,
    requestedEffects,
    previousState: options.previousGateState,
    generation: options.gateGeneration,
    scope: {
      tenantId: options.tenantId,
      workspaceId: options.workspaceId,
      requestedTenantId: options.requestedTenantId ?? options.requestTenantId,
      requestedWorkspaceId: options.requestedWorkspaceId ?? options.requestWorkspaceId,
      role: options.role,
      permissionMode: options.permissionMode
    }
  });
  const importGateLifecycle = buildImportGateLifecycleControlPlan(imports, {
    ...options,
    health: importHealth,
    previousLifecycle: options.previousImportLifecycle,
    command: options.importCommand,
    settings: options.importSettings,
    featureBoundary: {
      ...featureBoundaryControls,
      gates: gateState.gates
    },
    gateControlSettings: options.importGateControlSettings,
    requiredGateBySpecifier: options.importRequiredGateBySpecifier
  });
  const profileBoundaryIntent = buildProfileTenantBoundaryIntentPacket(profileSource || options.profile || {}, {
    ...options,
    previousPacket: options.previousProfileTenantHandoffBoundary,
    requestedCapabilities: options.profileRequestedCapabilities ?? options.requestedCapabilities,
    requestedPermissions: options.profileRequestedPermissions,
    acceptance: options.profileBoundaryIntentAcceptance,
    tenantId: options.tenantId,
    workspaceId: options.workspaceId,
    requestedTenantId: options.requestedTenantId ?? options.requestTenantId,
    requestedWorkspaceId: options.requestedWorkspaceId ?? options.requestWorkspaceId,
    role: options.role,
    permissionMode: options.permissionMode
  });
  const featureOperationalControls = buildFeatureGateOperationalControlPacket(gateSource || options.gates || {}, {
    ...options,
    operation,
    requestedEffects,
    previousState: options.previousGateState,
    previousCheckpoint: options.previousFeatureGateRuntimeCheckpoint,
    checkpointAcceptance: options.featureGateControlAcceptance,
    providerService: profileProviderService.contract,
    attempt: options.gateAttempt,
    maxAttempts: options.maxGateAttempts
  });
  const importLifecycleCommandSurface = buildImportLifecycleCommandSurface(imports, {
    ...options,
    health: importHealth,
    previousLifecycle: options.previousImportLifecycle,
    command: options.importCommand,
    settings: options.importSettings,
    featureBoundary: {
      ...featureBoundaryControls,
      gates: gateState.gates
    },
    gateControlSettings: options.importGateControlSettings,
    requiredAliases: options.requiredImportAliases
  });
  const providerGatePreview = buildFeatureGateProviderPreviewAcceptance(gateSource || options.gates || {}, {
    operation,
    requestedEffects,
    providerService: profileProviderService.contract,
    previousGateState: options.previousGateState,
    acceptance: options.providerPreviewAcceptance,
    requireExplicitProviderAcceptance: options.requireExplicitProviderAcceptance,
    requiredProviderCapabilities: profileProviderService.negotiation?.requestedCapabilities
  });
  const profileClientWorkflow = buildProfileClientWorkflowHandoff(profileSource || options.profile || {}, {
    ...options,
    previousState: options.previousProfileState,
    previousLifecycle: options.previousProfileLifecycle,
    previousExport: options.previousProfileExport,
    persistedMemory: options.persistedMemory,
    profileCommand: options.profileCommand,
    lifecycleCommand: options.profileLifecycleCommand,
    settings: options.profileLifecycleSettings,
    attempt: options.profileAttempt,
    maxAttempts: options.maxProfileAttempts,
    acceptance: options.profilePreviewAcceptance,
    requiredPreviewItems: options.requiredProfilePreviewItems
  });
  const featureClientWorkflow = buildFeatureGateClientWorkflowHandoff(gateSource || options.gates || {}, {
    ...options,
    operation,
    requestedEffects,
    previousState: options.previousGateState,
    previousAnalytics: options.previousGateAnalytics,
    generation: options.gateGeneration,
    providerService: profileProviderService.contract,
    providerPreviewAcceptance: options.providerPreviewAcceptance,
    requiredProviderCapabilities: profileProviderService.negotiation?.requestedCapabilities
  });
  const featureClientAcceptance = buildFeatureGateClientAcceptancePackage(gateSource || options.gates || {}, {
    ...options,
    operation,
    requestedEffects,
    previousState: options.previousGateState,
    previousAnalytics: options.previousGateAnalytics,
    providerService: profileProviderService.contract,
    acceptance: options.featureClientAcceptance ?? options.providerPreviewAcceptance,
    requireExplicitAcceptance: options.requireFeatureClientAcceptance === true,
    requiredProviderCapabilities: profileProviderService.negotiation?.requestedCapabilities
  });
  const featureClientActionQueue = buildFeatureGateClientActionQueue(gateSource || options.gates || {}, {
    ...options,
    operation,
    requestedEffects,
    previousState: options.previousGateState,
    previousAnalytics: options.previousGateAnalytics,
    providerService: profileProviderService.contract,
    acceptance: options.featureClientAcceptance ?? options.providerPreviewAcceptance,
    providerPreviewAcceptance: options.providerPreviewAcceptance,
    requiredProviderCapabilities: profileProviderService.negotiation?.requestedCapabilities
  });
  const featureCommandPlan = buildFeatureGateLifecycleCommandPlan(gateSource || options.gates || {}, {
    ...options,
    operation,
    requestedEffects,
    previousState: options.previousGateState,
    previousPlan: options.previousFeatureGateCommandPlan,
    generation: options.gateGeneration,
    commands: options.featureGateCommands ?? options.gateCommands,
    now: options.now ?? options.timestamp
  });
  const featureLifecycleReadiness = buildFeatureGateLifecycleReadinessContract(gateSource || options.gates || {}, {
    ...options,
    operation,
    requestedEffects,
    previousState: options.previousGateState,
    previousReadiness: options.previousFeatureLifecycleReadiness,
    generation: options.gateGeneration,
    commandPlan: featureCommandPlan,
    featureBoundary: featureBoundaryControls,
    profileLifecycle,
    importLifecycle,
    importGateLifecycle,
    providerPreview: providerGatePreview,
    readinessSettings: options.featureLifecycleReadinessSettings
  });
  const featureReleaseEvidence = buildFeatureGateReleaseEvidencePack(gateSource || options.gates || {}, {
    ...options,
    operation,
    requestedEffects,
    previousState: options.previousGateState,
    previousAnalytics: options.previousGateAnalytics,
    previousEvidencePack: options.previousFeatureGateReleaseEvidence,
    generation: options.gateGeneration,
    commandPlan: featureCommandPlan,
    lifecycleReadiness: featureLifecycleReadiness,
    now: options.now ?? options.timestamp
  });
  const importClientWorkflow = buildImportClientWorkflowHandoff(imports, {
    ...options,
    health: importHealth,
    previousLifecycle: options.previousImportLifecycle,
    previousAnalytics: options.previousImportAnalytics,
    command: options.importCommand,
    settings: options.importSettings,
    acceptance: options.importAcceptance,
    boundaryAcceptance: options.importBoundaryAcceptance,
    requiredAliases: options.requiredImportAliases,
    requestedCapabilities: options.importRequestedCapabilities ?? imports.capabilityRefs,
    importScopes: options.importScopes,
    scope: {
      tenantId: options.tenantId,
      workspaceId: options.workspaceId,
      requestedTenantId: options.requestedTenantId ?? options.requestTenantId,
      requestedWorkspaceId: options.requestedWorkspaceId ?? options.requestWorkspaceId,
      role: options.role,
      permissionMode: options.permissionMode
    }
  });
  const importClientAcceptance = buildImportClientAcceptancePackage(imports, {
    ...options,
    health: importHealth,
    previousLifecycle: options.previousImportLifecycle,
    previousAdoption: options.previousImportRuntimeAdoption,
    previousAnalytics: options.previousImportAnalytics,
    command: options.importCommand,
    settings: options.importSettings,
    acceptance: options.importClientAcceptance ?? options.importAcceptance,
    boundaryAcceptance: options.importBoundaryAcceptance,
    requiredAliases: options.requiredImportAliases,
    requestedCapabilities: options.importRequestedCapabilities ?? imports.capabilityRefs,
    importScopes: options.importScopes,
    scope: {
      tenantId: options.tenantId,
      workspaceId: options.workspaceId,
      requestedTenantId: options.requestedTenantId ?? options.requestTenantId,
      requestedWorkspaceId: options.requestedWorkspaceId ?? options.requestWorkspaceId,
      role: options.role,
      permissionMode: options.permissionMode
    }
  });
  const importClientReadiness = buildImportClientReadinessBrief(imports, {
    ...options,
    health: importHealth,
    previousBrief: options.previousImportClientReadinessBrief,
    previousHistoryExport: options.previousImportHistoryExport,
    previousAnalytics: options.previousImportAnalytics,
    acceptance: options.importClientAcceptance ?? options.importAcceptance,
    boundaryAcceptance: options.importBoundaryAcceptance,
    requiredAliases: options.requiredImportAliases,
    requestedCapabilities: options.importRequestedCapabilities ?? imports.capabilityRefs,
    importScopes: options.importScopes,
    now: options.now ?? options.timestamp,
    scope: {
      tenantId: options.tenantId,
      workspaceId: options.workspaceId,
      requestedTenantId: options.requestedTenantId ?? options.requestTenantId,
      requestedWorkspaceId: options.requestedWorkspaceId ?? options.requestWorkspaceId,
      role: options.role,
      permissionMode: options.permissionMode
    }
  });
  const importClientPreviewDigest = buildImportClientPreviewDigest(importClientReadiness, {
    ...options,
    previousDigest: options.previousImportClientPreviewDigest,
    requireExplicitAcceptance: options.requireImportPreviewAcceptance === true
      || options.requireImportClientAcceptance === true,
    now: options.now ?? options.timestamp
  });
  const importClientResolutionBrief = buildImportClientResolutionBrief(imports, {
    ...options,
    health: importHealth,
    previousBrief: options.previousImportClientReadinessBrief,
    previousDigest: options.previousImportClientPreviewDigest,
    previousResolutionBrief: options.previousImportClientResolutionBrief,
    previousHistoryExport: options.previousImportHistoryExport,
    previousAnalytics: options.previousImportAnalytics,
    acceptance: options.importClientAcceptance ?? options.importAcceptance,
    boundaryAcceptance: options.importBoundaryAcceptance,
    requiredAliases: options.requiredImportAliases,
    requestedCapabilities: options.importRequestedCapabilities ?? imports.capabilityRefs,
    requireExplicitAcceptance: options.requireImportPreviewAcceptance === true
      || options.requireImportClientAcceptance === true,
    now: options.now ?? options.timestamp
  });
  const importClientEvidenceManifest = buildImportClientEvidenceManifest(imports, {
    ...options,
    health: importHealth,
    readinessBrief: importClientReadiness,
    previewDigest: importClientPreviewDigest,
    resolutionBrief: importClientResolutionBrief,
    previousManifest: options.previousImportClientEvidenceManifest,
    acceptance: options.importClientAcceptance ?? options.importAcceptance,
    boundaryAcceptance: options.importBoundaryAcceptance,
    requiredAliases: options.requiredImportAliases,
    requestedCapabilities: options.importRequestedCapabilities ?? imports.capabilityRefs,
    requireExplicitAcceptance: options.requireImportPreviewAcceptance === true
      || options.requireImportClientAcceptance === true,
    now: options.now ?? options.timestamp
  });
  const importClientActionQueue = buildImportClientActionQueue(imports, {
    ...options,
    health: importHealth,
    previousBrief: options.previousImportClientReadinessBrief,
    previousDigest: options.previousImportClientPreviewDigest,
    previousHistoryExport: options.previousImportHistoryExport,
    previousAnalytics: options.previousImportAnalytics,
    acceptance: options.importClientAcceptance ?? options.importAcceptance,
    boundaryAcceptance: options.importBoundaryAcceptance,
    requiredAliases: options.requiredImportAliases,
    requestedCapabilities: options.importRequestedCapabilities ?? imports.capabilityRefs,
    requireExplicitAcceptance: options.requireImportPreviewAcceptance === true
      || options.requireImportClientAcceptance === true
  });
  const importClientPreviewRoute = buildImportClientPreviewRouteContract(imports, {
    ...options,
    health: importHealth,
    readinessBrief: importClientReadiness,
    previewDigest: importClientPreviewDigest,
    resolutionBrief: importClientResolutionBrief,
    evidenceManifest: importClientEvidenceManifest,
    actionQueue: importClientActionQueue,
    previousRoute: options.previousImportClientPreviewRoute,
    acceptance: options.importClientAcceptance ?? options.importAcceptance,
    boundaryAcceptance: options.importBoundaryAcceptance,
    requiredAliases: options.requiredImportAliases,
    requestedCapabilities: options.importRequestedCapabilities ?? imports.capabilityRefs,
    requireExplicitAcceptance: options.requireImportPreviewAcceptance === true
      || options.requireImportClientAcceptance === true,
    now: options.now ?? options.timestamp
  });
  const recovery = deriveFeatureGateRecovery({
    operation,
    requestedEffects: parsed.sections.effects,
    gates: gateSource || options.gates || {}
  });
  const boundary = deriveModuleBoundaryContract({
    boundarySource: parsed.sections.boundaries,
    options,
    capabilities: [
      ...(profile.profile?.capabilities ?? []),
      ...imports.capabilityRefs,
      ...gate.allowedEffects
    ],
    operation
  });
  const profileExport = buildProfileExportSummary(profileSource || options.profile || {}, {
    ...options,
    previousState: options.previousProfileState,
    persistedMemory: options.persistedMemory,
    command: options.profileCommand,
    previousExport: options.previousProfileExport,
    now: options.now ?? options.timestamp
  });
  const profilePreviewAcceptance = buildProfilePreviewAcceptanceState(profileSource || options.profile || {}, {
    ...options,
    previousState: options.previousProfileState,
    persistedMemory: options.persistedMemory,
    previousProviderState: options.previousProfileProviderState,
    requestedProviderCapabilities: options.profileProviderCapabilities ?? options.requestedProviderCapabilities,
    acceptance: {
      requireExplicitAcceptance: options.requireProfilePreviewAcceptance === true,
      ...(options.profilePreviewAcceptance && typeof options.profilePreviewAcceptance === 'object'
        ? options.profilePreviewAcceptance
        : {})
    },
    requiredPreviewItems: options.requiredProfilePreviewItems
  });
  const profileNextStepDigest = buildProfilePreviewNextStepDigest(profileSource || options.profile || {}, {
    ...options,
    previousState: options.previousProfileState,
    persistedMemory: options.persistedMemory,
    previousProviderState: options.previousProfileProviderState,
    requestedProviderCapabilities: options.profileProviderCapabilities ?? options.requestedProviderCapabilities,
    acceptance: {
      requireExplicitAcceptance: options.requireProfilePreviewAcceptance === true,
      ...(options.profilePreviewAcceptance && typeof options.profilePreviewAcceptance === 'object'
        ? options.profilePreviewAcceptance
        : {})
    },
    requiredPreviewItems: options.requiredProfilePreviewItems
  });
  const profileBoundaryEvidence = buildProfileBoundaryEvidencePacket(profileSource || options.profile || {}, {
    ...options,
    previousLifecycle: options.previousProfileLifecycle,
    previousState: options.previousProfileState,
    persistedMemory: options.persistedMemory,
    previousEvidence: options.previousProfileBoundaryEvidence,
    acceptance: options.profileBoundaryEvidenceAcceptance,
    lifecycleCommand: options.profileLifecycleCommand,
    profileCommand: options.profileCommand,
    settings: options.profileLifecycleSettings,
    now: options.now ?? options.timestamp
  });
  const profileTenantPermissionMatrix = buildProfileTenantPermissionMatrix(profileSource || options.profile || {}, {
    ...options,
    requestedPermissions: options.profileRequestedPermissions ?? options.requestedPermissions,
    requestedCapabilities: options.profileRequestedCapabilities ?? options.requestedCapabilities,
    requireStatusWrite: options.requireProfileStatusWrite
  });
  const profileTenantLaunchGuard = buildProfileTenantLaunchGuardContract(profileSource || options.profile || {}, {
    ...options,
    previousGuard: options.previousProfileTenantLaunchGuard,
    previousPacket: options.previousProfileTenantHandoffBoundary,
    previousEvidence: options.previousProfileBoundaryEvidence,
    acceptance: options.profileBoundaryEvidenceAcceptance,
    releaseAcceptance: options.profileBoundaryReleaseAcceptance,
    handoffAcceptance: options.profileBoundaryHandoffAcceptance,
    releasePolicy: options.profileBoundaryReleasePolicy,
    requestedPermissions: options.profileRequestedPermissions ?? options.requestedPermissions,
    requestedCapabilities: options.profileRequestedCapabilities ?? options.requestedCapabilities,
    requireStatusWrite: options.requireProfileStatusWrite,
    requireExplicitBoundaryRelease: options.requireProfileBoundaryLaunchRelease === true
      || options.requireProfileBoundaryRelease === true,
    now: options.now ?? options.timestamp
  });
  const moduleTenantLaunchGuard = buildModuleTenantLaunchGuardReport({
    operation,
    boundary,
    profileTenantLaunchGuard,
    previousReport: options.previousModuleTenantLaunchGuard,
    now: options.now ?? options.timestamp,
    historyLimit: options.moduleTenantLaunchGuardHistoryLimit ?? options.historyLimit
  });
  const profileOperationalHealth = buildProfileOperationalHealthExport(profileSource || options.profile || {}, {
    ...options,
    previousState: options.previousProfileState,
    previousLifecycle: options.previousProfileLifecycle,
    previousExport: options.previousProfileExport,
    previousProviderState: options.previousProfileProviderState,
    previousHealthExport: options.previousProfileHealthExport,
    previousEvidence: options.previousProfileBoundaryEvidence,
    persistedMemory: options.persistedMemory,
    profileCommand: options.profileCommand,
    lifecycleCommand: options.profileLifecycleCommand,
    settings: options.profileLifecycleSettings,
    acceptance: options.profilePreviewAcceptance,
    boundaryAcceptance: options.profileBoundaryEvidenceAcceptance,
    requestedProviderCapabilities: options.profileProviderCapabilities ?? options.requestedProviderCapabilities,
    attempt: options.profileAttempt,
    maxAttempts: options.maxProfileAttempts,
    now: options.now ?? options.timestamp
  });
  const profilePrimaryPack = buildProfilePrimaryExportPack(profileSource || options.profile || {}, {
    ...options,
    previousState: options.previousProfileState,
    previousLifecycle: options.previousProfileLifecycle,
    previousExport: options.previousProfileExport,
    previousHealthExport: options.previousProfileHealthExport,
    previousPrimaryPack: options.previousProfilePrimaryPack,
    previousProviderState: options.previousProfileProviderState,
    previousEvidence: options.previousProfileBoundaryEvidence,
    persistedMemory: options.persistedMemory,
    profileCommand: options.profileCommand,
    lifecycleCommand: options.profileLifecycleCommand,
    settings: options.profileLifecycleSettings,
    acceptance: options.profilePreviewAcceptance,
    boundaryAcceptance: options.profileBoundaryEvidenceAcceptance,
    requestedProviderCapabilities: options.profileProviderCapabilities ?? options.requestedProviderCapabilities,
    attempt: options.profileAttempt,
    maxAttempts: options.maxProfileAttempts,
    now: options.now ?? options.timestamp
  });
  const profileAnalyticsExportLedger = buildProfileAnalyticsExportLedger(profileSource || options.profile || {}, {
    ...options,
    previousExport: options.previousProfileExport,
    previousHealthExport: options.previousProfileHealthExport,
    previousPrimaryPack: options.previousProfilePrimaryPack,
    previousLedger: options.previousProfileAnalyticsExportLedger,
    healthExport: profileOperationalHealth,
    primaryPack: profilePrimaryPack,
    now: options.now ?? options.timestamp
  });
  const profileAudienceLedger = buildProfileAudienceExportLedger(profileSource || options.profile || {}, {
    ...options,
    previousState: options.previousProfileState,
    previousLifecycle: options.previousProfileLifecycle,
    previousExport: options.previousProfileExport,
    previousHealthExport: options.previousProfileHealthExport,
    previousPrimaryPack: options.previousProfilePrimaryPack,
    previousLedger: options.previousProfileAudienceLedger,
    previousProviderState: options.previousProfileProviderState,
    previousEvidence: options.previousProfileBoundaryEvidence,
    persistedMemory: options.persistedMemory,
    profileCommand: options.profileCommand,
    lifecycleCommand: options.profileLifecycleCommand,
    settings: options.profileLifecycleSettings,
    acceptance: options.profilePreviewAcceptance,
    boundaryAcceptance: options.profileBoundaryEvidenceAcceptance,
    requestedProviderCapabilities: options.profileProviderCapabilities ?? options.requestedProviderCapabilities,
    attempt: options.profileAttempt,
    maxAttempts: options.maxProfileAttempts,
    now: options.now ?? options.timestamp
  });
  const profileRuntimeAdoption = buildProfileClientRuntimeAdoptionPack(profileSource || options.profile || {}, {
    ...options,
    previousState: options.previousProfileState,
    previousLifecycle: options.previousProfileLifecycle,
    previousExport: options.previousProfileExport,
    previousHealthExport: options.previousProfileHealthExport,
    previousPrimaryPack: options.previousProfilePrimaryPack,
    previousRuntimeAdoption: options.previousProfileRuntimeAdoption,
    previousProviderState: options.previousProfileProviderState,
    previousAdoption: options.previousProfileProviderAdoption,
    previousEvidence: options.previousProfileBoundaryEvidence,
    persistedMemory: options.persistedMemory,
    profileCommand: options.profileCommand,
    lifecycleCommand: options.profileLifecycleCommand,
    settings: options.profileLifecycleSettings,
    activationSettings: options.profileActivationSettings,
    acceptance: options.profilePreviewAcceptance,
    providerAcceptance: options.profileProviderAdoptionAcceptance,
    requestedProviderCapabilities: options.profileProviderCapabilities ?? options.requestedProviderCapabilities,
    attempt: options.profileAttempt,
    maxAttempts: options.maxProfileAttempts,
    now: options.now ?? options.timestamp
  });
  const profileClientResolutionBrief = buildProfileClientResolutionBrief(profileSource || options.profile || {}, {
    ...options,
    previousState: options.previousProfileState,
    previousLifecycle: options.previousProfileLifecycle,
    previousExport: options.previousProfileExport,
    previousHealthExport: options.previousProfileHealthExport,
    previousPrimaryPack: options.previousProfilePrimaryPack,
    previousRuntimeAdoption: options.previousProfileRuntimeAdoption,
    previousResolutionBrief: options.previousProfileClientResolutionBrief,
    previousProviderState: options.previousProfileProviderState,
    previousAdoption: options.previousProfileProviderAdoption,
    previousEvidence: options.previousProfileBoundaryEvidence,
    persistedMemory: options.persistedMemory,
    profileCommand: options.profileCommand,
    lifecycleCommand: options.profileLifecycleCommand,
    settings: options.profileLifecycleSettings,
    activationSettings: options.profileActivationSettings,
    acceptance: options.profilePreviewAcceptance,
    providerAcceptance: options.profileProviderAdoptionAcceptance,
    requestedProviderCapabilities: options.profileProviderCapabilities ?? options.requestedProviderCapabilities,
    attempt: options.profileAttempt,
    maxAttempts: options.maxProfileAttempts,
    now: options.now ?? options.timestamp
  });
  const profileRequestKernelBinding = buildProfileRequestKernelBinding(profileSource || options.profile || {}, {
    ...options,
    previousState: options.previousProfileState,
    previousLifecycle: options.previousProfileLifecycle,
    previousExport: options.previousProfileExport,
    previousHealthExport: options.previousProfileHealthExport,
    previousPrimaryPack: options.previousProfilePrimaryPack,
    previousRuntimeAdoption: options.previousProfileRuntimeAdoption,
    previousRequestKernelBinding: options.previousProfileRequestKernelBinding,
    previousProviderState: options.previousProfileProviderState,
    previousAdoption: options.previousProfileProviderAdoption,
    persistedMemory: options.persistedMemory,
    profileCommand: options.profileCommand,
    lifecycleCommand: options.profileLifecycleCommand,
    settings: options.profileLifecycleSettings,
    activationSettings: options.profileActivationSettings,
    acceptance: options.profilePreviewAcceptance,
    providerAcceptance: options.profileProviderAdoptionAcceptance,
    requestedProviderCapabilities: options.profileProviderCapabilities ?? options.requestedProviderCapabilities,
    attempt: options.profileAttempt,
    maxAttempts: options.maxProfileAttempts,
    now: options.now ?? options.timestamp
  });
  const profileRestartRecovery = buildProfileRestartRecoveryPacket(profileSource || options.profile || {}, {
    ...options,
    previousState: options.previousProfileState,
    previousLifecycle: options.previousProfileLifecycle,
    previousRestartPacket: options.previousProfileRestartRecovery,
    persistedMemory: options.persistedMemory,
    profileCommand: options.profileCommand,
    lifecycleCommand: options.profileLifecycleCommand,
    settings: options.profileLifecycleSettings,
    attempt: options.profileAttempt,
    maxAttempts: options.maxProfileAttempts
  });
  const profileRestartStatusLedger = buildProfileRestartStatusLedger(profileSource || options.profile || {}, {
    ...options,
    previousState: options.previousProfileState,
    previousLifecycle: options.previousProfileLifecycle,
    previousRestartPacket: options.previousProfileRestartRecovery,
    previousLedger: options.previousProfileRestartStatusLedger,
    persistedMemory: options.persistedMemory,
    profileCommand: options.profileCommand,
    lifecycleCommand: options.profileLifecycleCommand,
    settings: options.profileLifecycleSettings,
    attempt: options.profileAttempt,
    maxAttempts: options.maxProfileAttempts,
    now: options.now ?? options.timestamp
  });
  const profileRestartReplayDecision = buildProfileRestartReplayDecisionEnvelope(profileSource || options.profile || {}, {
    ...options,
    previousState: options.previousProfileState,
    previousLifecycle: options.previousProfileLifecycle,
    previousRestartStatusLedger: options.previousProfileRestartStatusLedger,
    previousReplayPlan: options.previousProfileRestartCommandReplay,
    previousReplayDecision: options.previousProfileRestartReplayDecision,
    previousCheckpoint: options.previousProfileRuntimeCheckpoint,
    previousRuntimeAdoption: options.previousProfileRuntimeAdoption,
    previousProviderState: options.previousProfileProviderState,
    previousAdoption: options.previousProfileProviderAdoption,
    previousManifest: options.previousProfileRecoveryManifest,
    persistedMemory: options.persistedMemory,
    profileCommand: options.profileCommand,
    lifecycleCommand: options.profileLifecycleCommand,
    settings: options.profileLifecycleSettings,
    commands: options.profileReplayCommands,
    replayDecisionCommandKey: options.profileReplayDecisionCommandKey,
    attempt: options.profileAttempt,
    maxAttempts: options.maxProfileAttempts,
    now: options.now ?? options.timestamp
  });
  const profileActivation = buildProfileActivationControlPanel(profileSource || options.profile || {}, {
    ...options,
    previousState: options.previousProfileState,
    previousLifecycle: options.previousProfileLifecycle,
    previousProviderState: options.previousProfileProviderState,
    persistedMemory: options.persistedMemory,
    profileCommand: options.profileCommand,
    lifecycleCommand: options.profileLifecycleCommand,
    settings: options.profileLifecycleSettings,
    activationSettings: options.profileActivationSettings,
    acceptance: options.profilePreviewAcceptance,
    requestedProviderCapabilities: options.profileProviderCapabilities ?? options.requestedProviderCapabilities,
    attempt: options.profileAttempt,
    maxAttempts: options.maxProfileAttempts
  });
  const profileLaunchControls = buildProfileLaunchControlContract(profileSource || options.profile || {}, {
    ...options,
    previousState: options.previousProfileState,
    previousLifecycle: options.previousProfileLifecycle,
    previousProviderState: options.previousProfileProviderState,
    previousLaunchControl: options.previousProfileLaunchControl,
    persistedMemory: options.persistedMemory,
    profileCommand: options.profileCommand,
    lifecycleCommand: options.profileLifecycleCommand,
    settings: options.profileLifecycleSettings,
    activationSettings: options.profileActivationSettings,
    acceptance: options.profilePreviewAcceptance,
    requestedProviderCapabilities: options.profileProviderCapabilities ?? options.requestedProviderCapabilities,
    attempt: options.profileAttempt,
    maxAttempts: options.maxProfileAttempts
  });
  const profileProviderAdoption = buildProfileProviderAdoptionContract(profileSource || options.profile || {}, {
    ...options,
    previousProviderState: options.previousProfileProviderState,
    previousAdoption: options.previousProfileProviderAdoption,
    requestedProviderCapabilities: options.profileProviderCapabilities ?? options.requestedProviderCapabilities,
    requiredProviderCapabilities: options.profileProviderCapabilities ?? options.requestedProviderCapabilities,
    acceptance: options.profileProviderAdoptionAcceptance,
    syncCursor: options.profileSyncCursor
  });
  const profileProviderSyncIntent = buildProfileProviderSyncIntent(profileSource || options.profile || {}, {
    ...options,
    previousProviderState: options.previousProfileProviderState,
    previousAdoption: options.previousProfileProviderAdoption,
    previousSyncIntent: options.previousProfileProviderSyncIntent,
    requestedProviderCapabilities: options.profileProviderCapabilities ?? options.requestedProviderCapabilities,
    requiredProviderCapabilities: options.profileProviderCapabilities ?? options.requestedProviderCapabilities,
    acceptance: options.profileProviderAdoptionAcceptance,
    syncCursor: options.profileSyncCursor,
    syncCommandKey: options.profileProviderSyncCommandKey
  });
  const providerAdoption = buildModuleProviderAdoptionHandoff({
    operation,
    profileProviderService,
    profileProviderAdoption,
    importProviderContract,
    importProviderReadiness,
    importProviderAdoption,
    importRuntimeAdoption,
    providerGatePreview,
    profileActivation,
    previousAdoption: options.previousModuleProviderAdoption,
    now: options.now ?? options.timestamp
  });
  const importProviderSyncCheckpoint = buildImportProviderSyncCheckpoint(importProviderContract, {
    ...options,
    readinessPlan: importProviderReadiness,
    providerAdoption: importProviderAdoption,
    profileProviderSyncIntent,
    previousCheckpoint: options.previousImportProviderSyncCheckpoint,
    requestedCapabilities: options.importRequestedCapabilities ?? imports.capabilityRefs,
    syncCommandKey: options.importProviderSyncCommandKey,
    now: options.now ?? options.timestamp
  });
  const profileProviderSyncHandoff = buildProfileProviderSyncHandoffContract(profileSource || options.profile || {}, {
    ...options,
    previousProviderState: options.previousProfileProviderState,
    previousAdoption: options.previousProfileProviderAdoption,
    previousSyncIntent: options.previousProfileProviderSyncIntent,
    previousHandoff: options.previousProfileProviderSyncHandoff,
    requestedProviderCapabilities: options.profileProviderCapabilities ?? options.requestedProviderCapabilities,
    requiredProviderCapabilities: options.profileProviderCapabilities ?? options.requestedProviderCapabilities,
    acceptance: options.profileProviderAdoptionAcceptance,
    handoffAcceptance: options.profileProviderSyncHandoffAcceptance,
    importProviderSyncCheckpoint,
    syncCursor: options.profileSyncCursor,
    syncCommandKey: options.profileProviderSyncCommandKey,
    now: options.now ?? options.timestamp
  });
  const profileProviderLaunchHandoff = buildProfileProviderLaunchHandoffContract(profileSource || options.profile || {}, {
    ...options,
    previousProviderState: options.previousProfileProviderState,
    previousProfileProviderLaunchHandoff: options.previousProfileProviderLaunchHandoff,
    requestedProviderCapabilities: options.profileProviderCapabilities ?? options.requestedProviderCapabilities,
    profileSyncCursor: options.profileSyncCursor,
    launchCommandKey: options.profileProviderLaunchCommandKey,
    now: options.now ?? options.timestamp
  });
  const featureLaunchPreview = buildFeatureGateLaunchPreviewContract(gateSource || options.gates || {}, {
    ...options,
    operation,
    requestedEffects,
    previousPreview: options.previousFeatureLaunchPreview,
    acceptance: options.featureClientAcceptance ?? options.providerPreviewAcceptance,
    launchAcceptance: options.featureLaunchPreviewAcceptance,
    requireLaunchPreviewAcceptance: options.requireFeatureLaunchPreviewAcceptance === true,
    providerService: profileProviderService.contract,
    providerSyncHandoff: profileProviderSyncHandoff,
    requiredProviderCapabilities: profileProviderService.negotiation?.requestedCapabilities
  });
  const featureNextStepDigest = buildFeatureGateClientNextStepDigest(gateSource || options.gates || {}, {
    ...options,
    operation,
    requestedEffects,
    previousState: options.previousGateState,
    previousAnalytics: options.previousGateAnalytics,
    generation: options.gateGeneration,
    acceptance: options.featureClientAcceptance ?? options.providerPreviewAcceptance,
    launchAcceptance: options.featureLaunchPreviewAcceptance,
    requireLaunchPreviewAcceptance: options.requireFeatureLaunchPreviewAcceptance === true,
    providerService: profileProviderService.contract,
    providerSyncHandoff: profileProviderSyncHandoff,
    launchPreview: featureLaunchPreview,
    requiredProviderCapabilities: profileProviderService.negotiation?.requestedCapabilities
  });
  const importTimelineReport = buildImportTimelineReport(imports, {
    ...options,
    health: importHealth,
    analytics: importAnalytics,
    historyExport: importHistoryExport,
    lifecycle: importLifecycle,
    providerReadiness: importProviderReadiness,
    providerSyncCheckpoint: importProviderSyncCheckpoint,
    previousTimelineReport: options.previousImportTimelineReport,
    timelineLimit: options.importTimelineLimit ?? options.historyLimit,
    now: options.now ?? options.timestamp
  });
  const importStatusJournal = buildImportStatusJournal(imports, {
    ...options,
    health: importHealth,
    analytics: importAnalytics,
    historyExport: importHistoryExport,
    timelineReport: importTimelineReport,
    lifecycle: importLifecycle,
    previousStatusJournal: options.previousImportStatusJournal,
    journalCommandKey: options.importStatusJournalCommandKey,
    journalHistoryLimit: options.importStatusJournalHistoryLimit ?? options.historyLimit,
    now: options.now ?? options.timestamp
  });
  const profileRecoveryManifest = buildProfilePersistedStateRecoveryManifest(profileSource || options.profile || {}, {
    ...options,
    previousState: options.previousProfileState,
    previousManifest: options.previousProfileRecoveryManifest,
    persistedMemory: options.persistedMemory,
    statusJournal: options.profileStatusJournal ?? options.previousProfileStatusJournal,
    command: options.profileCommand,
    commandKey: options.profileRecoveryCommandKey ?? options.profileCommandKey,
    attempt: options.profileAttempt,
    maxAttempts: options.maxProfileAttempts,
    now: options.now ?? options.timestamp
  });
  const importAnalyticsRecovery = buildImportAnalyticsRecoveryDigest(imports, {
    ...options,
    health: importHealth,
    analytics: importAnalytics,
    historyExport: importHistoryExport,
    timelineReport: importTimelineReport,
    statusJournal: importStatusJournal,
    previousDigest: options.previousImportAnalyticsRecoveryDigest,
    commandKey: options.importAnalyticsRecoveryCommandKey,
    now: options.now ?? options.timestamp
  });
  const moduleRecoveryRows = [
    {
      id: 'profile_recovery_manifest',
      status: profileRecoveryManifest.status,
      restartSafe: profileRecoveryManifest.restartSafe === true,
      fingerprint: profileRecoveryManifest.fingerprint,
      publish: profileRecoveryManifest.handoff?.publish === true,
      nextAction: profileRecoveryManifest.recovery?.nextAction ?? profileRecoveryManifest.handoff?.nextAction,
      blockedRows: profileRecoveryManifest.exportSummary?.blockedRows ?? [],
      guardedRows: profileRecoveryManifest.exportSummary?.guardedRows ?? []
    },
    {
      id: 'import_analytics_recovery',
      status: importAnalyticsRecovery.status,
      restartSafe: importAnalyticsRecovery.restartSafe === true,
      fingerprint: importAnalyticsRecovery.fingerprint,
      publish: importAnalyticsRecovery.handoff?.publish === true,
      nextAction: importAnalyticsRecovery.recovery?.nextAction ?? importAnalyticsRecovery.handoff?.nextAction,
      blockedRows: importAnalyticsRecovery.exportSummary?.blockedRows ?? [],
      guardedRows: importAnalyticsRecovery.exportSummary?.guardedRows ?? []
    }
  ];
  const moduleRecoveryStatus = moduleRecoveryRows.some((row) => row.status === 'blocked')
    ? 'blocked'
    : moduleRecoveryRows.some((row) => row.status === 'guarded' || row.status === 'degraded' || row.restartSafe !== true)
      ? 'guarded'
      : 'ready';
  const moduleRecoveryFingerprint = [
    'module_restart_recovery_digest',
    operation,
    moduleRecoveryStatus,
    ...moduleRecoveryRows.map((row) => [
      row.id,
      row.status,
      row.restartSafe ? 'restart_safe' : 'restart_guarded',
      row.fingerprint,
      row.nextAction
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('|');
  const moduleRecoveryNextAction = moduleRecoveryStatus === 'blocked'
    ? 'resolve_module_restart_recovery_blockers'
    : moduleRecoveryStatus === 'guarded'
      ? 'publish_module_restart_recovery_guarded'
      : 'publish_module_restart_recovery_ready';
  const moduleRestartRecoveryDigest = {
    schemaVersion: MODULE_SYNTAX_SCHEMA_VERSION,
    title: 'mailchimp_module_restart_recovery_digest',
    operation,
    status: moduleRecoveryStatus,
    restartSafe: moduleRecoveryStatus === 'ready' && moduleRecoveryRows.every((row) => row.restartSafe),
    fingerprint: moduleRecoveryFingerprint,
    rows: moduleRecoveryRows,
    readiness: {
      blockingReasons: unique(moduleRecoveryRows.flatMap((row) => row.blockedRows.map((id) => `${row.id}:${id}`))),
      guardedReasons: unique(moduleRecoveryRows.flatMap((row) => row.guardedRows.map((id) => `${row.id}:${id}`))),
      nextAction: moduleRecoveryNextAction
    },
    handoff: {
      target: 'kernel.status.mailchimp.module-restart-recovery',
      statusChannel: moduleRecoveryStatus === 'ready' ? 'kernel.status.mailchimp' : 'local.status.module-restart-recovery',
      publish: moduleRecoveryStatus !== 'ready' || moduleRecoveryRows.some((row) => row.publish),
      severity: moduleRecoveryStatus === 'blocked' ? 'error' : moduleRecoveryStatus === 'guarded' ? 'warning' : 'info',
      includeRows: true,
      nextAction: moduleRecoveryNextAction
    },
    exportSummary: {
      schemaVersion: MODULE_SYNTAX_SCHEMA_VERSION,
      title: 'mailchimp_module_restart_recovery_digest',
      operation,
      status: moduleRecoveryStatus,
      restartSafe: moduleRecoveryStatus === 'ready' && moduleRecoveryRows.every((row) => row.restartSafe),
      fingerprint: moduleRecoveryFingerprint,
      blockedRows: moduleRecoveryRows.flatMap((row) => row.blockedRows.map((id) => `${row.id}:${id}`)).sort(),
      guardedRows: moduleRecoveryRows.flatMap((row) => row.guardedRows.map((id) => `${row.id}:${id}`)).sort(),
      nextAction: moduleRecoveryNextAction
    }
  };
  const featureKernelManifest = buildFeatureGateKernelHandoffManifest(gateSource || options.gates || {}, {
    ...options,
    operation,
    requestedEffects,
    previousState: options.previousGateState,
    generation: options.gateGeneration
  });
  const importKernelManifest = buildImportKernelHandoffManifest(imports, {
    ...options,
    health: importHealth,
    providerContract: importProviderContract,
    providerReadiness: importProviderReadiness,
    requiredAliases: options.requiredImportAliases,
    requestedCapabilities: options.importRequestedCapabilities ?? imports.capabilityRefs
  });
  const profileLifecycleNextAction = buildProfileLifecycleNextActionState(profileSource || options.profile || {}, {
    ...options,
    previousState: options.previousProfileState,
    previousLifecycle: options.previousProfileLifecycle,
    previousProviderState: options.previousProfileProviderState,
    previousLaunchControl: options.previousProfileLaunchControl,
    previousAdoption: options.previousProfileProviderAdoption,
    persistedMemory: options.persistedMemory,
    profileCommand: options.profileCommand,
    lifecycleCommand: options.profileLifecycleCommand,
    settings: options.profileLifecycleSettings,
    providerAdoptionAcceptance: options.profileProviderAdoptionAcceptance,
    requestedProviderCapabilities: options.profileProviderCapabilities ?? options.requestedProviderCapabilities,
    attempt: options.profileAttempt,
    maxAttempts: options.maxProfileAttempts
  });
  const profileLifecycleSettingsControls = buildProfileLifecycleSettingsControlContract(profileSource || options.profile || {}, {
    ...options,
    previousState: options.previousProfileState,
    previousLifecycle: options.previousProfileLifecycle,
    previousControlContract: options.previousProfileLifecycleSettingsControls,
    previousProviderState: options.previousProfileProviderState,
    persistedMemory: options.persistedMemory,
    profileCommand: options.profileCommand,
    lifecycleCommand: options.profileLifecycleCommand,
    settings: options.profileLifecycleSettings,
    clientControlAcceptance: options.profileLifecycleControlAcceptance,
    requireExplicitControlAcceptance: options.requireProfileLifecycleControlAcceptance,
    requiredControlRows: options.requiredProfileLifecycleControlRows,
    attempt: options.profileAttempt,
    maxAttempts: options.maxProfileAttempts,
    now: options.now ?? options.timestamp
  });
  const profileLifecycleScheduleCheckpoint = buildProfileLifecycleScheduleCheckpoint(profileSource || options.profile || {}, {
    ...options,
    previousState: options.previousProfileState,
    previousLifecycle: options.previousProfileLifecycle,
    previousControlContract: options.previousProfileLifecycleSettingsControls,
    previousCheckpoint: options.previousProfileLifecycleScheduleCheckpoint,
    previousProviderState: options.previousProfileProviderState,
    persistedMemory: options.persistedMemory,
    profileCommand: options.profileCommand,
    lifecycleCommand: options.profileLifecycleCommand,
    settings: options.profileLifecycleSettings,
    clientControlAcceptance: options.profileLifecycleControlAcceptance,
    profileLifecycleScheduleCommandKey: options.profileLifecycleScheduleCommandKey,
    attempt: options.profileAttempt,
    maxAttempts: options.maxProfileAttempts,
    now: options.now ?? options.timestamp
  });
  const featureProviderHandoff = buildFeatureGateProviderHandoffState(gateSource || options.gates || {}, {
    ...options,
    operation,
    requestedEffects,
    previousState: options.previousGateState,
    previousReadiness: options.previousFeatureLifecycleReadiness,
    generation: options.gateGeneration,
    providerService: profileProviderService.contract,
    providerPreviewAcceptance: options.providerPreviewAcceptance,
    requiredProviderCapabilities: profileProviderService.negotiation?.requestedCapabilities
  });
  const importRuntimeHandoff = buildImportRuntimeHandoffState(imports, {
    ...options,
    health: importHealth,
    providerReadinessAcceptance: options.importProviderReadinessAcceptance,
    acceptance: options.importAcceptance,
    boundaryAcceptance: options.importBoundaryAcceptance,
    requiredAliases: options.requiredImportAliases,
    requestedCapabilities: options.importRequestedCapabilities ?? imports.capabilityRefs,
    profileProviderSyncIntent,
    previousRuntimeClientContract: options.previousImportRuntimeClientContract,
    previousImportRuntimeAdoption: options.previousImportRuntimeAdoption,
    previousCheckpoint: options.previousImportProviderSyncCheckpoint
  });
  const profileLifecycleClientControls = buildProfileLifecycleClientControlPacket(profileSource || options.profile || {}, {
    ...options,
    previousState: options.previousProfileState,
    previousLifecycle: options.previousProfileLifecycle,
    previousControlContract: options.previousProfileLifecycleSettingsControls,
    previousPacket: options.previousProfileLifecycleClientControlPacket,
    previousProviderAdoption: options.previousProfileProviderAdoption,
    previousLaunchControl: options.previousProfileLaunchControl,
    persistedMemory: options.persistedMemory,
    settings: options.profileLifecycleSettings,
    profileCommand: options.profileCommand,
    lifecycleCommand: options.profileLifecycleCommand,
    controlCommandKey: options.profileLifecycleControlCommandKey,
    clientControlAcceptance: options.profileLifecycleControlAcceptance,
    requireExplicitControlAcceptance: options.requireProfileLifecycleControlAcceptance,
    requiredControlRows: options.requiredProfileLifecycleControlRows,
    providerAdoptionAcceptance: options.profileProviderAdoptionAcceptance,
    requestedProviderCapabilities: options.profileProviderCapabilities ?? options.requestedProviderCapabilities
  });
  const featureProviderControls = buildFeatureGateProviderControlPacket(gateSource || options.gates || {}, {
    ...options,
    operation,
    requestedEffects,
    previousState: options.previousGateState,
    previousReadiness: options.previousFeatureLifecycleReadiness,
    generation: options.gateGeneration,
    providerService: profileProviderService.contract,
    providerPreviewAcceptance: options.providerPreviewAcceptance,
    providerSyncAcceptance: options.featureProviderSyncAcceptance,
    requiredProviderCapabilities: profileProviderService.negotiation?.requestedCapabilities
  });
  const importRuntimeClientControls = buildImportRuntimeClientControlPacket(imports, {
    ...options,
    health: importHealth,
    previousResumeEnvelope: options.previousImportRuntimeResumeEnvelope,
    previousLifecycle: options.previousImportLifecycle,
    previousRuntimeClientContract: options.previousImportRuntimeClientContract,
    command: options.importCommand,
    settings: options.importSettings,
    acceptance: options.importAcceptance,
    boundaryAcceptance: options.importBoundaryAcceptance,
    providerReadinessAcceptance: options.importProviderReadinessAcceptance,
    requiredAliases: options.requiredImportAliases,
    requestedCapabilities: options.importRequestedCapabilities ?? imports.capabilityRefs,
    requireExplicitAcceptance: options.requireImportPreviewAcceptance === true
      || options.requireImportClientAcceptance === true
  });
  const importRuntimeRequestAdoption = buildImportRuntimeRequestAdoptionCheckpoint(imports, {
    ...options,
    health: importHealth,
    previousCheckpoint: options.previousImportRuntimeRequestAdoption,
    previousLifecycle: options.previousImportLifecycle,
    previousAdoption: options.previousImportRuntimeAdoption,
    previousClientContract: options.previousImportRuntimeClientContract,
    previousRuntimeClientControls: options.previousImportRuntimeClientControls,
    providerSyncCheckpoint: importProviderSyncCheckpoint,
    command: options.importCommand,
    settings: options.importSettings,
    acceptance: options.importAcceptance,
    boundaryAcceptance: options.importBoundaryAcceptance,
    providerReadinessAcceptance: options.importProviderReadinessAcceptance,
    request: options.importRequest ?? options.request,
    requestKey: options.importRequestKey ?? options.requestKey,
    acceptedAliases: options.importAcceptedAliases,
    requiredAliases: options.requiredImportAliases,
    requestedCapabilities: options.importRequestedCapabilities ?? imports.capabilityRefs
  });
  const moduleClientControlRoom = buildModuleClientControlRoomContract({
    operation,
    profileLifecycleClientControls,
    featureProviderControls,
    importRuntimeClientControls,
    previousControlRoom: options.previousModuleClientControlRoom,
    now: options.now ?? options.timestamp,
    historyLimit: options.moduleClientControlRoomHistoryLimit ?? options.historyLimit
  });
  const moduleWorkflowNextAction = buildModuleWorkflowNextActionDigest({
    operation,
    profileLifecycleNextAction,
    featureProviderHandoff,
    importRuntimeHandoff,
    previousDigest: options.previousModuleWorkflowNextAction,
    now: options.now ?? options.timestamp,
    historyLimit: options.moduleWorkflowNextActionHistoryLimit ?? options.historyLimit
  });
  const profileBoundaryRelease = buildProfileBoundaryReleaseDecision(profileSource || options.profile || {}, {
    ...options,
    previousLifecycle: options.previousProfileLifecycle,
    previousState: options.previousProfileState,
    persistedMemory: options.persistedMemory,
    lifecycleCommand: options.profileLifecycleCommand,
    profileCommand: options.profileCommand,
    settings: options.profileLifecycleSettings,
    acceptance: options.profileBoundaryReleaseAcceptance ?? options.profileBoundaryEvidenceAcceptance,
    releasePolicy: options.profileBoundaryReleasePolicy
  });
  const featureBoundaryRelease = buildFeatureGateBoundaryReleaseDecision(gateSource || options.gates || {}, {
    ...options,
    operation,
    requestedEffects,
    previousState: options.previousGateState,
    previousReadiness: options.previousFeatureLifecycleReadiness,
    featureBoundary: featureBoundaryControls,
    profileLifecycle,
    importLifecycle,
    importGateLifecycle,
    providerPreview: providerGatePreview,
    releasePolicy: options.featureBoundaryReleasePolicy
  });
  const importBoundaryRelease = buildImportBoundaryReleaseDecision(imports, {
    ...options,
    health: importHealth,
    previousLifecycle: options.previousImportLifecycle,
    command: options.importCommand,
    settings: options.importSettings,
    acceptance: options.importBoundaryReleaseAcceptance ?? options.importBoundaryAcceptance,
    requestedCapabilities: options.importRequestedCapabilities ?? imports.capabilityRefs,
    importScopes: options.importScopes,
    releasePolicy: options.importBoundaryReleasePolicy,
    scope: {
      tenantId: options.tenantId,
      workspaceId: options.workspaceId,
      requestedTenantId: options.requestedTenantId ?? options.requestTenantId,
      requestedWorkspaceId: options.requestedWorkspaceId ?? options.requestWorkspaceId,
      role: options.role,
      permissionMode: options.permissionMode
    }
  });
  const profileTenantHandoffBoundary = buildProfileTenantHandoffBoundaryPacket(profileSource || options.profile || {}, {
    ...options,
    previousPacket: options.previousProfileTenantHandoffBoundary,
    previousLifecycle: options.previousProfileLifecycle,
    previousState: options.previousProfileState,
    persistedMemory: options.persistedMemory,
    acceptance: options.profileBoundaryHandoffAcceptance ?? options.profileBoundaryReleaseAcceptance,
    releasePolicy: options.profileBoundaryReleasePolicy
  });
  const featureTenantHandoffBoundary = buildFeatureGateTenantHandoffBoundaryPacket(gateSource || options.gates || {}, {
    ...options,
    operation,
    requestedEffects,
    previousPacket: options.previousFeatureTenantHandoffBoundary,
    releasePolicy: options.featureBoundaryReleasePolicy
  });
  const importTenantHandoffBoundary = buildImportTenantHandoffBoundaryPacket(imports, {
    ...options,
    health: importHealth,
    previousPacket: options.previousImportTenantHandoffBoundary,
    acceptance: options.importBoundaryHandoffAcceptance ?? options.importBoundaryReleaseAcceptance,
    requestedCapabilities: options.importRequestedCapabilities ?? imports.capabilityRefs,
    importScopes: options.importScopes,
    releasePolicy: options.importBoundaryReleasePolicy,
    scope: {
      tenantId: options.tenantId,
      workspaceId: options.workspaceId,
      requestedTenantId: options.requestedTenantId ?? options.requestTenantId,
      requestedWorkspaceId: options.requestedWorkspaceId ?? options.requestWorkspaceId,
      role: options.role,
      permissionMode: options.permissionMode
    }
  });
  const tenantHandoffBoundary = buildModuleTenantHandoffBoundaryMatrix({
    operation,
    profileTenantHandoffBoundary,
    featureTenantHandoffBoundary,
    importTenantHandoffBoundary,
    previousMatrix: options.previousModuleTenantHandoffBoundary,
    now: options.now ?? options.timestamp,
    historyLimit: options.moduleTenantHandoffHistoryLimit ?? options.historyLimit
  });
  const diagnostics = [
    ...(parsed.diagnostics ?? []),
    ...profile.diagnostics,
    ...imports.diagnostics,
    ...gate.diagnostics,
    ...boundary.diagnostics,
    ...profileProviderService.diagnostics.filter((item) => item.level === 'error'),
    ...providerGatePreview.diagnostics.filter((item) => item.level === 'error'),
    ...profilePersistence.diagnostics.filter((item) => (
      options.enforceProfilePersistence === true ? item.level === 'error' : item.level === 'fatal'
    )),
    ...gateState.diagnostics.filter((item) => item.level === 'error'),
    ...gateAnalytics.diagnostics.filter((item) => item.level === 'error'),
    ...featureCommandPlan.diagnostics.filter((item) => (
      options.enforceFeatureGateCommands === true ? item.level === 'error' : item.level === 'fatal'
    )),
    ...featureLifecycleReadiness.diagnostics.filter((item) => (
      options.enforceFeatureLifecycleReadiness === true ? item.level === 'error' : item.level === 'fatal'
    )),
    ...featureBoundaryControls.diagnostics.filter((item) => item.level === 'error'),
    ...importGateLifecycle.diagnostics.filter((item) => item.level === 'error'),
    ...importLifecycle.diagnostics.filter((item) => item.level === 'error'),
    ...importPreviewAcceptance.diagnostics.filter((item) => item.level === 'error'),
    ...importBoundaryAcceptance.diagnostics.filter((item) => item.level === 'error'),
    ...importHealth.diagnostics.filter((item) => item.level === 'error'),
    ...importHistoryExport.diagnostics.filter((item) => item.level === 'error'),
    ...importTimelineReport.diagnostics.filter((item) => (
      options.enforceImportTimelineReport === true ? item.level === 'error' : item.level === 'fatal'
    )),
    ...importStatusJournal.diagnostics.filter((item) => (
      options.enforceImportStatusJournal === true ? item.level === 'error' : item.level === 'fatal'
    )),
    ...profileRecoveryManifest.diagnostics.filter((item) => (
      options.enforceProfileRecoveryManifest === true ? item.level === 'error' : item.level === 'fatal'
    )),
    ...importAnalyticsRecovery.diagnostics.filter((item) => (
      options.enforceImportAnalyticsRecovery === true ? item.level === 'error' : item.level === 'fatal'
    )),
    ...importClientReadiness.diagnostics.filter((item) => (
      options.enforceImportClientReadiness === true ? item.level === 'error' : item.level === 'fatal'
    )),
    ...importClientPreviewRoute.diagnostics.filter((item) => (
      options.enforceImportClientPreviewRoute === true || options.requireImportPreviewAcceptance === true
        ? item.level === 'error'
        : item.level === 'fatal'
    )),
    ...importClientPreviewDigest.diagnostics.filter((item) => (
      options.enforceImportPreviewDigest === true || options.requireImportPreviewAcceptance === true
        ? item.level === 'error'
        : item.level === 'fatal'
    )),
    ...importClientResolutionBrief.diagnostics.filter((item) => (
      options.enforceImportClientResolutionBrief === true ? item.level === 'error' : item.level === 'fatal'
    )),
    ...importProviderContract.diagnostics.filter((item) => item.level === 'error'),
    ...importProviderReadiness.diagnostics.filter((item) => (
      options.enforceImportProviderReadiness === true ? item.level === 'error' : item.level === 'fatal'
    )),
    ...importProviderAdoption.diagnostics.filter((item) => (
      options.enforceImportProviderAdoption === true ? item.level === 'error' : item.level === 'fatal'
    )),
    ...importRuntimeAdoption.diagnostics.filter((item) => (
      options.enforceImportRuntimeAdoption === true ? item.level === 'error' : item.level === 'fatal'
    )),
    ...importRuntimeClientContract.diagnostics.filter((item) => (
      options.enforceImportRuntimeClientContract === true ? item.level === 'error' : item.level === 'fatal'
    )),
    ...profileProviderAdoption.diagnostics.filter((item) => (
      options.enforceProfileProviderAdoption === true ? item.level === 'error' : item.level === 'fatal'
    )),
    ...profileProviderSyncIntent.diagnostics.filter((item) => (
      options.enforceProfileProviderSync === true ? item.level === 'error' : item.level === 'fatal'
    )),
    ...profileProviderSyncHandoff.diagnostics.filter((item) => (
      options.enforceProfileProviderSyncHandoff === true ? item.level === 'error' : item.level === 'fatal'
    )),
    ...profileProviderLaunchHandoff.diagnostics.filter((item) => (
      options.enforceProfileProviderLaunch === true ? item.level === 'error' : item.level === 'fatal'
    )),
    ...importProviderSyncCheckpoint.diagnostics.filter((item) => (
      options.enforceImportProviderSync === true ? item.level === 'error' : item.level === 'fatal'
    )),
    ...featureLaunchPreview.diagnostics.filter((item) => (
      options.enforceFeatureLaunchPreview === true ? item.level === 'error' : item.level === 'fatal'
    )),
    ...featureNextStepDigest.diagnostics.filter((item) => (
      options.enforceFeatureNextStepDigest === true ? item.level === 'error' : item.level === 'fatal'
    )),
    ...featureKernelManifest.diagnostics.filter((item) => (
      options.enforceKernelHandoffManifest === true ? item.level === 'error' : item.level === 'fatal'
    )),
    ...importKernelManifest.diagnostics.filter((item) => (
      options.enforceKernelHandoffManifest === true ? item.level === 'error' : item.level === 'fatal'
    )),
    ...profileBoundaryRelease.diagnostics.filter((item) => (
      options.enforceBoundaryRelease === true || options.enforceProfileBoundaryRelease === true
        ? item.level === 'error'
        : item.level === 'fatal'
    )),
    ...featureBoundaryRelease.diagnostics.filter((item) => (
      options.enforceBoundaryRelease === true || options.enforceFeatureBoundaryRelease === true
        ? item.level === 'error'
        : item.level === 'fatal'
    )),
    ...importBoundaryRelease.diagnostics.filter((item) => (
      options.enforceBoundaryRelease === true || options.enforceImportBoundaryRelease === true
        ? item.level === 'error'
        : item.level === 'fatal'
    )),
    ...tenantHandoffBoundary.diagnostics.filter((item) => (
      options.enforceTenantHandoffBoundary === true ? item.level === 'error' : item.level === 'fatal'
    )),
    ...providerAdoption.diagnostics.filter((item) => (
      options.enforceModuleProviderAdoption === true ? item.level === 'error' : item.level === 'fatal'
    )),
    ...profileBoundaryEvidence.diagnostics.filter((item) => (
      options.enforceProfileBoundaryEvidence === true ? item.level === 'error' : item.level === 'fatal'
    )),
    ...profileTenantPermissionMatrix.diagnostics.filter((item) => (
      options.enforceProfilePermissionMatrix === true ? item.level === 'error' : item.level === 'fatal'
    )),
    ...profileTenantLaunchGuard.diagnostics.filter((item) => (
      options.enforceProfileTenantLaunchGuard === true ? item.level === 'error' : item.level === 'fatal'
    )),
    ...moduleTenantLaunchGuard.diagnostics.filter((item) => (
      options.enforceModuleTenantLaunchGuard === true ? item.level === 'error' : item.level === 'fatal'
    )),
    ...profileOperationalHealth.diagnostics.filter((item) => (
      options.enforceProfileOperationalHealth === true ? item.level === 'error' : item.level === 'fatal'
    )),
    ...profilePrimaryPack.diagnostics.filter((item) => (
      options.enforceProfilePrimaryPack === true ? item.level === 'error' : item.level === 'fatal'
    )),
    ...profileAnalyticsExportLedger.diagnostics.filter((item) => (
      options.enforceProfileAnalyticsExportLedger === true ? item.level === 'error' : item.level === 'fatal'
    )),
    ...profileAudienceLedger.diagnostics.filter((item) => (
      options.enforceProfileAudienceLedger === true ? item.level === 'error' : item.level === 'fatal'
    )),
    ...profileRuntimeAdoption.diagnostics.filter((item) => (
      options.enforceProfileRuntimeAdoption === true ? item.level === 'error' : item.level === 'fatal'
    )),
    ...profileClientResolutionBrief.diagnostics.filter((item) => (
      options.enforceProfileClientResolutionBrief === true ? item.level === 'error' : item.level === 'fatal'
    )),
    ...profileRequestKernelBinding.diagnostics.filter((item) => (
      options.enforceProfileRequestKernelBinding === true ? item.level === 'error' : item.level === 'fatal'
    )),
    ...profileRestartRecovery.diagnostics.filter((item) => (
      options.enforceProfileRestartRecovery === true ? item.level === 'error' : item.level === 'fatal'
    )),
    ...profileRestartStatusLedger.diagnostics.filter((item) => (
      options.enforceProfileRestartStatusLedger === true ? item.level === 'error' : item.level === 'fatal'
    )),
    ...profileRestartReplayDecision.diagnostics.filter((item) => (
      options.enforceProfileRestartReplayDecision === true ? item.level === 'error' : item.level === 'fatal'
    )),
    ...profileActivation.diagnostics.filter((item) => (
      options.enforceProfileActivation === true ? item.level === 'error' : item.level === 'fatal'
    )),
    ...profileLaunchControls.diagnostics.filter((item) => (
      options.enforceProfileLaunchControls === true ? item.level === 'error' : item.level === 'fatal'
    )),
    ...profilePreviewAcceptance.diagnostics.filter((item) => (
      options.enforceProfilePreviewAcceptance === true || options.requireProfilePreviewAcceptance === true
        ? item.level === 'error'
        : item.level === 'fatal'
    )),
    ...profileNextStepDigest.diagnostics.filter((item) => (
      options.enforceProfileNextStepDigest === true ? item.level === 'error' : item.level === 'fatal'
    )),
    ...profileLifecycle.diagnostics.filter((item) => (
      options.enforceProfileLifecycle === true ? item.level === 'error' : item.level === 'fatal'
    )),
    ...profileFailure.diagnostics.filter((item) => (
      options.enforceProfileFailureState === true ? item.level === 'error' : item.level === 'fatal'
    )),
    ...clientRuntime.diagnostics.filter((item) => (
      options.enforceClientRuntime === true ? item.level === 'error' : item.level === 'fatal'
    )),
    ...profileLifecycleNextAction.diagnostics.filter((item) => (
      options.enforceProfileLifecycleNextAction === true ? item.level === 'error' : item.level === 'fatal'
    )),
    ...profileLifecycleSettingsControls.diagnostics.filter((item) => (
      options.enforceProfileLifecycleSettingsControls === true
        || options.requireProfileLifecycleControlAcceptance === true
        ? item.level === 'error'
        : item.level === 'fatal'
    )),
    ...profileLifecycleScheduleCheckpoint.diagnostics.filter((item) => (
      options.enforceProfileLifecycleSchedule === true ? item.level === 'error' : item.level === 'fatal'
    )),
    ...featureProviderHandoff.diagnostics.filter((item) => (
      options.enforceFeatureProviderHandoff === true ? item.level === 'error' : item.level === 'fatal'
    )),
    ...importRuntimeHandoff.diagnostics.filter((item) => (
      options.enforceImportRuntimeHandoff === true ? item.level === 'error' : item.level === 'fatal'
    )),
    ...importRuntimeRequestAdoption.diagnostics.filter((item) => (
      options.enforceImportRuntimeRequestAdoption === true
        || options.requireImportRequestAcceptance === true
        ? item.level === 'error'
        : item.level === 'fatal'
    )),
    ...moduleWorkflowNextAction.diagnostics.filter((item) => (
      options.enforceModuleWorkflowNextAction === true ? item.level === 'error' : item.level === 'fatal'
    ))
  ];
  const ok = !diagnostics.some((item) => item.level === 'error');
  const moduleBoundaryRelease = buildModuleBoundaryReleaseReport({
    operation,
    profileBoundaryRelease,
    featureBoundaryRelease,
    importBoundaryRelease,
    previousReport: options.previousModuleBoundaryRelease,
    now: options.now ?? options.timestamp,
    historyLimit: options.moduleBoundaryReleaseHistoryLimit ?? options.historyLimit
  });
  const operationalStatus = buildModuleOperationalStatus({
    profilePersistence,
    profileFailure,
    profileLifecycle,
    gateState,
    gateAnalytics,
    featureCommandPlan,
    featureLifecycleReadiness,
    importHealth,
    importAnalytics,
    importHistoryExport,
    importTimelineReport,
    importClientReadiness,
    importLifecycle,
    importPreviewAcceptance,
    importBoundaryAcceptance,
    importProviderContract,
    importProviderReadiness,
    importProviderAdoption,
    importRuntimeAdoption,
    profileExport,
    profilePreviewAcceptance,
    profileBoundaryEvidence,
    profileProviderService,
    profileProviderAdoption,
    providerAdoption,
    profilePrimaryPack,
    profileAudienceLedger,
    profileRuntimeAdoption,
    profileRestartRecovery,
    profileRestartStatusLedger,
    profileRestartReplayDecision,
    profileActivation,
    profileLifecycleSettingsControls,
    featureBoundaryControls,
    importGateLifecycle,
    providerGatePreview,
    boundary,
    runtime,
    diagnostics
  });
  const operationalActionPlan = buildModuleOperationalActionPlan({
    profileFailure,
    profileLifecycle,
    gateAnalytics,
    featureCommandPlan,
    featureLifecycleReadiness,
    importHealth,
    importHistoryExport,
    importTimelineReport,
    importClientReadiness,
    importLifecycle,
    importPreviewAcceptance,
    importBoundaryAcceptance,
    importProviderContract,
    importProviderReadiness,
    importProviderAdoption,
    importRuntimeAdoption,
    profileExport,
    profilePreviewAcceptance,
    profileBoundaryEvidence,
    profileProviderService,
    profileProviderAdoption,
    providerAdoption,
    profilePrimaryPack,
    profileAudienceLedger,
    profileRuntimeAdoption,
    profileRestartRecovery,
    profileRestartStatusLedger,
    profileRestartReplayDecision,
    profileActivation,
    profileLifecycleSettingsControls,
    featureBoundaryControls,
    importGateLifecycle,
    providerGatePreview,
    boundary,
    operationalStatus
  });
  const moduleKernelHandoffManifest = buildModuleKernelHandoffManifest({
    operation,
    profileRuntime: runtime,
    featureKernelManifest,
    importKernelManifest,
    boundary,
    profileLifecycle,
    importLifecycle,
    operationalActionPlan
  });
  const exportReadiness = buildModuleExportReadiness({
    profileExport,
    gateAnalytics,
    providerGatePreview,
    importPreviewAcceptance,
    importBoundaryAcceptance,
    importProviderContract,
    importProviderReadiness,
    importProviderAdoption,
    importRuntimeAdoption,
    importHistoryExport,
    importTimelineReport,
    profileProviderService,
    profileProviderAdoption,
    providerAdoption,
    profilePrimaryPack,
    profileAudienceLedger,
    profileRuntimeAdoption,
    profileRestartRecovery,
    profileRestartStatusLedger,
    profileActivation,
    profileLifecycleSettingsControls,
    featureBoundaryControls,
    featureCommandPlan,
    featureLifecycleReadiness,
    importGateLifecycle,
    importClientReadiness,
    profilePreviewAcceptance,
    profileBoundaryEvidence,
    profileLifecycle,
    operationalStatus,
    operationalActionPlan,
    boundary
  });
  const moduleRuntimeAdoption = buildModuleRuntimeAdoptionHandoff({
    operation,
    profileRequestKernelBinding,
    profileRuntimeAdoption,
    featureClientWorkflow,
    featureLifecycleReadiness,
    importRuntimeAdoption,
    importProviderSyncCheckpoint,
    boundary,
    operationalStatus,
    exportReadiness,
    previousHandoff: options.previousModuleRuntimeAdoption,
    now: options.now ?? options.timestamp
  });
  const clientWorkflowHandoff = buildModuleClientWorkflowHandoff({
    profileClientWorkflow,
    featureClientWorkflow,
    importClientWorkflow,
    importRuntimeAdoption,
    moduleRuntimeAdoption,
    profileRestartRecovery,
    profileActivation,
    profileLifecycleSettingsControls,
    profileBoundaryEvidence,
    operationalStatus,
    operationalActionPlan,
    exportReadiness,
    boundary
  });
  const launchAcceptance = buildModuleLaunchAcceptancePackage({
    operation,
    profilePreviewAcceptance,
    profileNextStepDigest,
    featureClientAcceptance,
    featureNextStepDigest,
    featureLaunchPreview,
    importClientAcceptance,
    clientWorkflowHandoff,
    exportReadiness,
    operationsStatus: operationalStatus,
    acceptance: options.moduleLaunchAcceptance,
    requireExplicitAcceptance: options.requireModuleLaunchAcceptance === true,
    previousPackage: options.previousModuleLaunchAcceptance,
    now: options.now ?? options.timestamp
  });
  const operationsPack = buildModuleMailchimpOperationsPack({
    operation,
    profileOperationalHealth,
    profilePrimaryPack,
    profileAudienceLedger,
    gateAnalytics,
    featureCommandPlan,
    featureLifecycleReadiness,
    importHistoryExport,
    importClientReadiness,
    importClientPreviewDigest,
    importLifecycle,
    importProviderContract,
    importProviderReadiness,
    importProviderAdoption,
    importRuntimeAdoption,
    profileProviderService,
    profileProviderAdoption,
    providerAdoption,
    profileActivation,
    profileRuntimeAdoption,
    profileRequestKernelBinding,
    profileRestartRecovery,
    profileRestartStatusLedger,
    providerGatePreview,
    operationalStatus,
    operationalActionPlan,
    exportReadiness,
    clientWorkflowHandoff,
    launchAcceptance,
    moduleRuntimeAdoption,
    diagnostics,
    previousPack: options.previousOperationsPack,
    now: options.now ?? options.timestamp
  });
  const profileStatusPublication = buildProfileStatusPublicationPacket(profileOperationalHealth, {
    ...options,
    previousPublication: options.previousProfileStatusPublication,
    maxPublicationAgeMs: options.profileStatusPublicationMaxAgeMs ?? options.maxPublicationAgeMs,
    now: options.now ?? options.timestamp
  });
  const profileOperationalEscalation = buildProfileOperationalEscalationEnvelope(profileOperationalHealth, {
    ...options,
    publication: profileStatusPublication,
    previousEscalation: options.previousProfileOperationalEscalation,
    owners: options.profileEscalationOwners,
    thresholds: options.profileEscalationThresholds,
    now: options.now ?? options.timestamp
  });
  const importOperationalEscalation = buildImportOperationalEscalationEnvelope(imports, {
    ...options,
    health: importHealth,
    recoveryDigest: importAnalyticsRecovery,
    providerContract: importProviderContract,
    providerReadiness: importProviderReadiness,
    previousEscalation: options.previousImportOperationalEscalation,
    owners: options.importEscalationOwners,
    thresholds: options.importEscalationThresholds,
    requestedCapabilities: options.importRequestedCapabilities ?? imports.capabilityRefs,
    requiredAliases: options.requiredImportAliases,
    now: options.now ?? options.timestamp
  });
  const moduleOperationalEscalation = buildModuleOperationalEscalationMatrix({
    operation,
    profileOperationalEscalation,
    importOperationalEscalation,
    operationalStatus,
    previousEscalation: options.previousModuleOperationalEscalation,
    owners: options.moduleEscalationOwners,
    now: options.now ?? options.timestamp,
    historyLimit: options.moduleEscalationHistoryLimit ?? options.historyLimit
  });
  const featureGatePublication = buildFeatureGatePublicationTimeline(gateAnalytics, {
    ...options,
    previousPublication: options.previousFeatureGatePublication,
    maxPublicationAgeMs: options.featureGatePublicationMaxAgeMs ?? options.maxPublicationAgeMs,
    now: options.now ?? options.timestamp
  });
  const importProviderSyncPublication = buildImportProviderSyncPublication(importProviderSyncCheckpoint, {
    ...options,
    previousPublication: options.previousImportProviderSyncPublication,
    maxPublicationAgeMs: options.importProviderSyncPublicationMaxAgeMs ?? options.maxPublicationAgeMs,
    now: options.now ?? options.timestamp
  });
  const importProviderSyncBridge = buildImportProviderSyncBridge(importProviderSyncCheckpoint, {
    ...options,
    publication: importProviderSyncPublication,
    profileProviderSyncIntent,
    previousBridge: options.previousImportProviderSyncBridge,
    requiredAliases: options.requiredImportAliases,
    acceptedAliases: options.importProviderSyncBridgeAcceptedAliases,
    bridgeAcceptance: options.importProviderSyncBridgeAcceptance,
    requireExplicitBridgeAcceptance: options.requireImportProviderSyncBridgeAcceptance,
    publicationAgeMs: options.importProviderSyncPublicationAgeMs,
    maxPublicationAgeMs: options.importProviderSyncBridgeMaxAgeMs ?? options.maxPublicationAgeMs,
    now: options.now ?? options.timestamp
  });
  const importProviderLaunchGate = buildImportProviderLaunchGate(importProviderSyncBridge, {
    ...options,
    publication: importProviderSyncPublication,
    checkpoint: importProviderSyncCheckpoint,
    previousGate: options.previousImportProviderLaunchGate,
    requiredAliases: options.requiredImportAliases,
    waivedAliases: options.importProviderLaunchWaivers,
    allowDegradedLaunch: options.allowImportProviderDegradedLaunch,
    requireProviderSyncPublication: options.requireImportProviderSyncPublication,
    requireKernelHandoff: options.requireImportProviderKernelHandoff,
    now: options.now ?? options.timestamp
  });
  const importProviderSyncState = buildImportProviderSyncStateEnvelope(importProviderSyncCheckpoint, {
    ...options,
    publication: importProviderSyncPublication,
    bridge: importProviderSyncBridge,
    launchGate: importProviderLaunchGate,
    previousEnvelope: options.previousImportProviderSyncState,
    commandKey: options.importProviderSyncStateCommandKey ?? options.importProviderSyncCommandKey,
    now: options.now ?? options.timestamp
  });
  const importProviderLaunchState = buildImportProviderLaunchStateEnvelope(importProviderSyncCheckpoint, {
    ...options,
    providerSyncBridge: importProviderSyncBridge,
    profileLaunchHandoff: profileProviderLaunchHandoff,
    previousEnvelope: options.previousImportProviderLaunchState,
    launchCommandKey: options.importProviderLaunchCommandKey ?? options.importProviderSyncCommandKey,
    now: options.now ?? options.timestamp
  });
  const featureProviderSyncAcceptance = buildFeatureGateProviderSyncAcceptance(gateSource || options.gates || {}, {
    ...options,
    operation,
    requestedEffects,
    launchPreview: featureLaunchPreview,
    providerSyncHandoff: profileProviderSyncHandoff,
    syncAcceptance: options.featureProviderSyncAcceptance ?? options.providerSyncAcceptance,
    requireProviderSyncAcceptance: options.requireFeatureProviderSyncAcceptance === true
      || options.requireProviderSyncAcceptance === true,
    requiredSyncItems: options.requiredFeatureProviderSyncItems
  });
  const featureProviderLaunchAcceptance = buildFeatureGateProviderLaunchAcceptance(gateSource || options.gates || {}, {
    ...options,
    operation,
    requestedEffects,
    profileLaunchHandoff: profileProviderLaunchHandoff,
    importProviderLaunchState,
    acceptance: options.featureProviderLaunchAcceptance ?? options.providerLaunchAcceptance,
    requireExplicitProviderLaunchAcceptance: options.requireFeatureProviderLaunchAcceptance === true
      || options.requireProviderLaunchAcceptance === true
  });
  const moduleProviderSyncWorkflow = buildModuleProviderSyncWorkflowHandoff({
    operation,
    profileProviderSyncIntent,
    profileProviderSyncHandoff,
    importProviderSyncCheckpoint,
    importProviderSyncPublication,
    importProviderSyncBridge,
    importProviderLaunchGate,
    importProviderSyncState,
    featureProviderSyncAcceptance,
    previousWorkflow: options.previousModuleProviderSyncWorkflow,
    now: options.now ?? options.timestamp,
    requireExplicitAcceptance: options.requireModuleProviderSyncAcceptance === true
  });
  const moduleStatusPublication = buildModuleStatusPublicationFeed({
    operation,
    profileStatusPublication,
    featureGatePublication,
    importProviderSyncPublication,
    importProviderSyncBridge,
    importProviderLaunchGate,
    operationsPack,
    operationalStatus,
    previousPublication: options.previousModuleStatusPublication,
    now: options.now ?? options.timestamp,
    maxPublicationAgeMs: options.moduleStatusPublicationMaxAgeMs ?? options.maxPublicationAgeMs
  });
  const moduleLaunchPublicationDigest = buildModuleLaunchPublicationDigest({
    operation,
    moduleStatusPublication,
    operationsPack,
    launchAcceptance,
    clientWorkflowHandoff,
    exportReadiness,
    importClientPreviewDigest,
    moduleRuntimeAdoption,
    previousDigest: options.previousModuleLaunchPublicationDigest,
    now: options.now ?? options.timestamp,
    requireExplicitAcceptance: options.requireModuleLaunchAcceptance === true
      || options.requireImportPreviewAcceptance === true
  });
  const featureOperationalLedger = buildFeatureGateOperationalLedger(gateSource || options.gates || {}, {
    ...options,
    operation,
    requestedEffects,
    previousAnalytics: options.previousGateAnalytics,
    previousPublication: options.previousFeatureGatePublication,
    previousLedger: options.previousFeatureGateOperationalLedger,
    previousState: options.previousGateState,
    generation: options.gateGeneration,
    now: options.now ?? options.timestamp
  });
  const importOperationalLedger = buildImportOperationalLedger(imports, {
    ...options,
    health: importHealth,
    previousAnalytics: options.previousImportAnalytics,
    previousReadinessPlan: options.previousImportProviderReadiness,
    previousLedger: options.previousImportOperationalLedger,
    requestedCapabilities: options.importRequestedCapabilities ?? imports.capabilityRefs,
    requiredAliases: options.requiredImportAliases,
    now: options.now ?? options.timestamp
  });
  const featureLaunchReadinessLedger = buildFeatureGateLaunchReadinessLedger(gateSource || options.gates || {}, {
    ...options,
    operation,
    requestedEffects,
    operationalLedger: featureOperationalLedger,
    launchPreview: featureLaunchPreview,
    nextStepDigest: featureNextStepDigest,
    previousLedger: options.previousFeatureLaunchReadinessLedger,
    now: options.now ?? options.timestamp
  });
  const importLaunchReadinessLedger = buildImportClientLaunchReadinessLedger(imports, {
    ...options,
    operationalLedger: importOperationalLedger,
    previewDigest: importClientPreviewDigest,
    providerLaunchGate: importProviderLaunchGate,
    previousLedger: options.previousImportClientLaunchReadinessLedger,
    now: options.now ?? options.timestamp
  });
  const moduleOperationalReadinessLedger = buildModuleOperationalReadinessLedger({
    operation,
    profileOperationalHealth,
    featureOperationalLedger,
    importOperationalLedger,
    moduleStatusPublication,
    moduleLaunchPublicationDigest,
    operationalStatus,
    previousLedger: options.previousModuleOperationalReadinessLedger,
    now: options.now ?? options.timestamp,
    historyLimit: options.moduleOperationalLedgerHistoryLimit ?? options.historyLimit
  });
  const moduleClientActionQueue = buildModuleClientActionQueue({
    operation,
    featureClientActionQueue,
    importClientActionQueue,
    clientWorkflowHandoff,
    launchAcceptance,
    exportReadiness,
    previousQueue: options.previousModuleClientActionQueue,
    now: options.now ?? options.timestamp,
    historyLimit: options.moduleClientActionHistoryLimit ?? options.historyLimit
  });
  const moduleClientExportRouteReadiness = buildModuleClientExportRouteReadiness({
    operation,
    profileAnalyticsExportLedger,
    importClientPreviewRoute,
    exportReadiness,
    clientWorkflowHandoff,
    moduleClientActionQueue,
    moduleOperationalReadinessLedger,
    previousRoute: options.previousModuleClientExportRouteReadiness,
    now: options.now ?? options.timestamp,
    historyLimit: options.moduleClientExportRouteHistoryLimit ?? options.historyLimit
  });
  const featureClientReadiness = buildFeatureGateClientReadinessContract(gateSource || options.gates || {}, {
    ...options,
    operation,
    requestedEffects,
    previousReadiness: options.previousFeatureClientReadiness,
    previousState: options.previousGateState,
    previousAnalytics: options.previousGateAnalytics,
    generation: options.gateGeneration,
    providerService: profileProviderService.contract,
    acceptance: options.featureClientAcceptance ?? options.providerPreviewAcceptance,
    providerPreviewAcceptance: options.providerPreviewAcceptance,
    requiredProviderCapabilities: profileProviderService.negotiation?.requestedCapabilities,
    requireExplicitAcceptance: options.requireFeatureClientAcceptance === true
  });
  const importTenantAuditReadiness = buildImportTenantAuditReadinessContract(imports, {
    ...options,
    health: importHealth,
    previousReadiness: options.previousImportTenantAuditReadiness,
    acceptance: options.importBoundaryAcceptance,
    requiredAliases: options.requiredImportAliases,
    requestedCapabilities: options.importRequestedCapabilities ?? imports.capabilityRefs,
    importScopes: options.importScopes,
    scope: {
      tenantId: options.tenantId,
      workspaceId: options.workspaceId,
      requestedTenantId: options.requestedTenantId ?? options.requestTenantId,
      requestedWorkspaceId: options.requestedWorkspaceId ?? options.requestWorkspaceId,
      role: options.role,
      permissionMode: options.permissionMode
    },
    now: options.now ?? options.timestamp
  });
  const profileResumeHandoff = buildProfileClientResumeHandoffContract(profileSource || options.profile || {}, {
    ...options,
    previousState: options.previousProfileState,
    previousLifecycle: options.previousProfileLifecycle,
    previousExport: options.previousProfileExport,
    previousHealthExport: options.previousProfileHealthExport,
    previousPrimaryPack: options.previousProfilePrimaryPack,
    previousRuntimeAdoption: options.previousProfileRuntimeAdoption,
    previousResolutionBrief: options.previousProfileClientResolutionBrief,
    previousProviderState: options.previousProfileProviderState,
    previousAdoption: options.previousProfileProviderAdoption,
    persistedMemory: options.persistedMemory,
    profileCommand: options.profileCommand,
    lifecycleCommand: options.profileLifecycleCommand,
    settings: options.profileLifecycleSettings,
    activationSettings: options.profileActivationSettings,
    acceptance: options.profilePreviewAcceptance,
    providerAcceptance: options.profileProviderAdoptionAcceptance,
    requestedProviderCapabilities: options.profileProviderCapabilities ?? options.requestedProviderCapabilities,
    attempt: options.profileAttempt,
    maxAttempts: options.maxProfileAttempts,
    now: options.now ?? options.timestamp
  });
  const featureResumeState = buildFeatureGateResumeStateEnvelope(gateSource || options.gates || {}, {
    ...options,
    operation,
    requestedEffects,
    previousState: options.previousGateState,
    previousReadiness: options.previousFeatureClientReadiness,
    previousAnalytics: options.previousGateAnalytics,
    previousPlan: options.previousFeatureGateCommandPlan,
    previousResumeState: options.previousFeatureGateResumeState,
    generation: options.gateGeneration,
    providerService: profileProviderService.contract,
    acceptance: options.featureClientAcceptance ?? options.providerPreviewAcceptance,
    providerPreviewAcceptance: options.providerPreviewAcceptance,
    requiredProviderCapabilities: profileProviderService.negotiation?.requestedCapabilities,
    commands: options.featureGateCommands ?? options.gateCommands,
    now: options.now ?? options.timestamp
  });
  const importRuntimeResume = buildImportRuntimeResumeEnvelope(imports, {
    ...options,
    health: importHealth,
    previousClientContract: options.previousImportRuntimeClientContract,
    previousLifecycle: options.previousImportLifecycle,
    previousAdoption: options.previousImportRuntimeAdoption,
    previousResumeEnvelope: options.previousImportRuntimeResumeEnvelope,
    command: options.importCommand,
    settings: options.importSettings,
    acceptance: options.importAcceptance,
    boundaryAcceptance: options.importBoundaryAcceptance,
    providerReadinessAcceptance: options.importProviderReadinessAcceptance,
    requiredAliases: options.requiredImportAliases,
    requestedCapabilities: options.importRequestedCapabilities ?? imports.capabilityRefs,
    now: options.now ?? options.timestamp
  });
  const moduleResumeRows = [
    {
      id: 'profile_resume',
      status: profileResumeHandoff.status,
      restartSafe: profileResumeHandoff.restartSafe === true,
      publish: profileResumeHandoff.handoff?.publish === true,
      nextAction: profileResumeHandoff.readiness?.nextAction ?? profileResumeHandoff.handoff?.nextAction,
      blockingReasons: profileResumeHandoff.readiness?.blockingReasons ?? [],
      guardedReasons: profileResumeHandoff.readiness?.guardedReasons ?? []
    },
    {
      id: 'feature_gate_resume',
      status: featureResumeState.status,
      restartSafe: featureResumeState.restartSafe === true,
      publish: featureResumeState.handoff?.publish === true,
      nextAction: featureResumeState.readiness?.nextAction ?? featureResumeState.handoff?.nextAction,
      blockingReasons: featureResumeState.readiness?.blockingReasons ?? [],
      guardedReasons: featureResumeState.readiness?.guardedReasons ?? []
    },
    {
      id: 'import_runtime_resume',
      status: importRuntimeResume.status,
      restartSafe: importRuntimeResume.restartSafe === true,
      publish: importRuntimeResume.handoff?.publish === true,
      nextAction: importRuntimeResume.readiness?.nextAction ?? importRuntimeResume.handoff?.nextAction,
      blockingReasons: importRuntimeResume.readiness?.blockingReasons ?? [],
      guardedReasons: importRuntimeResume.readiness?.guardedReasons ?? []
    }
  ];
  const moduleResumeStatus = moduleResumeRows.some((row) => row.status === 'blocked')
    ? 'blocked'
    : moduleResumeRows.some((row) => row.status === 'guarded' || row.status === 'degraded' || row.restartSafe !== true)
      ? 'guarded'
      : 'ready';
  const moduleResumeFingerprint = [
    'module_client_runtime_resume',
    operation,
    moduleResumeStatus,
    profileResumeHandoff.fingerprint,
    featureResumeState.fingerprint,
    importRuntimeResume.fingerprint
  ].map(clean).filter(Boolean).join('|');
  const moduleClientRuntimeResume = {
    schemaVersion: MODULE_SYNTAX_SCHEMA_VERSION,
    title: 'mailchimp_module_client_runtime_resume',
    operation,
    status: moduleResumeStatus,
    restartSafe: moduleResumeStatus === 'ready' && moduleResumeRows.every((row) => row.restartSafe),
    fingerprint: moduleResumeFingerprint,
    rows: moduleResumeRows,
    request: {
      requestKey: profileResumeHandoff.request?.requestKey ?? clientRuntime.state?.requestKey ?? null,
      resumeToken: profileResumeHandoff.request?.resumeToken ?? clientRuntime.state?.workflow?.resumeToken ?? null,
      workflowState: profileResumeHandoff.request?.workflowState ?? clientRuntime.state?.workflow?.state ?? null
    },
    readiness: {
      blockingReasons: unique(moduleResumeRows.flatMap((row) => row.blockingReasons.map((reason) => `${row.id}:${reason}`))),
      guardedReasons: unique(moduleResumeRows.flatMap((row) => row.guardedReasons.map((reason) => `${row.id}:${reason}`))),
      nextAction: moduleResumeStatus === 'blocked'
        ? 'resolve_module_client_runtime_resume_blockers'
        : moduleResumeStatus === 'guarded'
          ? 'publish_module_client_runtime_resume_guarded'
          : 'publish_module_client_runtime_resume_ready'
    },
    handoff: {
      target: 'kernel.status.mailchimp.module-client-runtime-resume',
      statusChannel: moduleResumeStatus === 'ready' ? 'kernel.status.mailchimp' : 'local.status.module-runtime-resume',
      publish: moduleResumeStatus !== 'ready' || moduleResumeRows.some((row) => row.publish),
      severity: moduleResumeStatus === 'blocked' ? 'error' : moduleResumeStatus === 'guarded' ? 'warning' : 'info',
      includeRows: true,
      includeRequestState: true,
      nextAction: moduleResumeStatus === 'ready'
        ? 'publish_module_client_runtime_resume_ready'
        : 'review_module_client_runtime_resume'
    },
    exportSummary: {
      schemaVersion: MODULE_SYNTAX_SCHEMA_VERSION,
      title: 'mailchimp_module_client_runtime_resume',
      operation,
      status: moduleResumeStatus,
      restartSafe: moduleResumeStatus === 'ready' && moduleResumeRows.every((row) => row.restartSafe),
      fingerprint: moduleResumeFingerprint,
      blockedRows: moduleResumeRows.filter((row) => row.status === 'blocked').map((row) => row.id).sort(),
      guardedRows: moduleResumeRows
        .filter((row) => row.status === 'guarded' || row.status === 'degraded' || row.restartSafe !== true)
        .map((row) => row.id)
        .sort(),
      nextAction: moduleResumeStatus === 'ready'
        ? 'publish_module_client_runtime_resume_ready'
        : 'review_module_client_runtime_resume'
    }
  };
  const previousModuleRestartReplay = normalizeModuleRestartReplayCheckpoint(options.previousModuleRestartReplayCheckpoint);
  const moduleRestartReplayRows = dedupeModuleRestartReplayRows([
    moduleRestartReplayRow('profile_replay_decision', 'profile', profileRestartReplayDecision, true, {
      fingerprint: profileRestartReplayDecision.fingerprint,
      statusChannel: profileRestartReplayDecision.handoff?.statusChannel,
      nextAction: profileRestartReplayDecision.handoff?.nextAction ?? profileRestartReplayDecision.exportSummary?.nextAction,
      evidence: {
        appliedCommandKeys: profileRestartReplayDecision.idempotency?.appliedCommandKeys ?? [],
        suppressedCommandKeys: profileRestartReplayDecision.idempotency?.suppressedCommandKeys ?? [],
        blockedRows: profileRestartReplayDecision.exportSummary?.blockedRows ?? [],
        guardedRows: profileRestartReplayDecision.exportSummary?.guardedRows ?? []
      }
    }),
    moduleRestartReplayRow('module_restart_digest', 'module', moduleRestartRecoveryDigest, true, {
      fingerprint: moduleRestartRecoveryDigest.fingerprint ?? moduleRestartRecoveryDigest.exportSummary?.fingerprint,
      statusChannel: moduleRestartRecoveryDigest.handoff?.statusChannel,
      nextAction: moduleRestartRecoveryDigest.handoff?.nextAction ?? moduleRestartRecoveryDigest.exportSummary?.nextAction,
      evidence: {
        blockedRows: moduleRestartRecoveryDigest.exportSummary?.blockedRows ?? [],
        guardedRows: moduleRestartRecoveryDigest.exportSummary?.guardedRows ?? [],
        restartSafe: moduleRestartRecoveryDigest.restartSafe === true
      }
    }),
    moduleRestartReplayRow('client_runtime_resume', 'module', moduleClientRuntimeResume, true, {
      fingerprint: moduleClientRuntimeResume.fingerprint,
      statusChannel: moduleClientRuntimeResume.handoff?.statusChannel,
      nextAction: moduleClientRuntimeResume.handoff?.nextAction,
      evidence: {
        requestKey: moduleClientRuntimeResume.request.requestKey,
        resumeToken: moduleClientRuntimeResume.request.resumeToken,
        blockedRows: moduleClientRuntimeResume.exportSummary.blockedRows,
        guardedRows: moduleClientRuntimeResume.exportSummary.guardedRows
      }
    }),
    moduleRestartReplayRow('import_runtime_resume', 'imports', importRuntimeResume, false, {
      fingerprint: importRuntimeResume.fingerprint ?? importRuntimeResume.exportSummary?.fingerprint,
      statusChannel: importRuntimeResume.handoff?.statusChannel,
      nextAction: importRuntimeResume.handoff?.nextAction ?? importRuntimeResume.exportSummary?.nextAction,
      evidence: {
        blockedRows: importRuntimeResume.exportSummary?.blockedRows ?? [],
        guardedRows: importRuntimeResume.exportSummary?.guardedRows ?? []
      }
    })
  ]);
  const moduleRestartReplayBlocked = moduleRestartReplayRows.filter((row) => row.status === 'blocked');
  const moduleRestartReplayGuarded = moduleRestartReplayRows.filter((row) => row.status === 'guarded' || row.restartSafe === false);
  const moduleRestartReplayStatus = moduleRestartReplayBlocked.length > 0
    ? 'blocked'
    : moduleRestartReplayGuarded.length > 0
      ? 'guarded'
      : 'ready';
  const moduleRestartReplayFingerprint = moduleRestartReplayCheckpointFingerprint({
    operation,
    status: moduleRestartReplayStatus,
    rows: moduleRestartReplayRows
  });
  const moduleRestartReplayChanged = previousModuleRestartReplay.fingerprint
    ? previousModuleRestartReplay.fingerprint !== moduleRestartReplayFingerprint
    : true;
  const moduleRestartReplaySequence = previousModuleRestartReplay.sequence + (moduleRestartReplayChanged ? 1 : 0);
  const moduleRestartReplayNextAction = moduleRestartReplayStatus === 'blocked'
    ? moduleRestartReplayBlocked[0]?.nextAction ?? 'resolve_module_restart_replay_checkpoint'
    : moduleRestartReplayStatus === 'guarded'
      ? 'publish_module_restart_replay_checkpoint_guarded'
      : moduleRestartReplayChanged
        ? 'publish_module_restart_replay_checkpoint_ready'
        : 'reuse_module_restart_replay_checkpoint';
  const moduleRestartReplayCheckpoint = {
    schemaVersion: MODULE_SYNTAX_SCHEMA_VERSION,
    title: 'mailchimp_module_restart_replay_checkpoint',
    operation,
    status: moduleRestartReplayStatus,
    restartSafe: moduleRestartReplayStatus === 'ready' && moduleRestartReplayRows.every((row) => row.restartSafe),
    sequence: moduleRestartReplaySequence,
    fingerprint: moduleRestartReplayFingerprint,
    changed: moduleRestartReplayChanged,
    rows: moduleRestartReplayRows,
    readiness: {
      blockingReasons: unique(moduleRestartReplayBlocked.map((row) => row.id)),
      guardedReasons: unique(moduleRestartReplayGuarded.map((row) => row.id)),
      nextAction: moduleRestartReplayNextAction
    },
    handoff: {
      target: 'kernel.status.mailchimp.module-restart-replay',
      statusChannel: moduleRestartReplayStatus === 'ready' ? 'kernel.status.mailchimp' : 'local.status.module-restart-replay',
      publish: moduleRestartReplayChanged || moduleRestartReplayStatus !== 'ready',
      severity: moduleRestartReplayStatus === 'blocked' ? 'error' : moduleRestartReplayStatus === 'guarded' ? 'warning' : 'info',
      includeRows: true,
      includeIdempotency: moduleRestartReplayRows.some((row) => row.evidence.suppressedCommandKeys?.length > 0),
      nextAction: moduleRestartReplayNextAction
    },
    exportSummary: {
      schemaVersion: MODULE_SYNTAX_SCHEMA_VERSION,
      title: 'mailchimp_module_restart_replay_checkpoint',
      operation,
      status: moduleRestartReplayStatus,
      restartSafe: moduleRestartReplayStatus === 'ready' && moduleRestartReplayRows.every((row) => row.restartSafe),
      sequence: moduleRestartReplaySequence,
      fingerprint: moduleRestartReplayFingerprint,
      changed: moduleRestartReplayChanged,
      blockedRows: moduleRestartReplayBlocked.map((row) => row.id).sort(),
      guardedRows: moduleRestartReplayGuarded.map((row) => row.id).sort(),
      nextAction: moduleRestartReplayNextAction
    }
  };
  const moduleClientBoundaryReadiness = buildModuleClientBoundaryReadinessEnvelope({
    operation,
    featureClientReadiness,
    importTenantAuditReadiness,
    launchAcceptance,
    moduleClientActionQueue,
    clientWorkflowHandoff,
    previousEnvelope: options.previousModuleClientBoundaryReadiness,
    commandKey: options.moduleClientBoundaryReadinessCommandKey,
    now: options.now ?? options.timestamp,
    historyLimit: options.moduleClientBoundaryReadinessHistoryLimit ?? options.historyLimit
  });
  const moduleClientResolutionBrief = buildModuleClientResolutionBrief({
    operation,
    profileClientResolutionBrief,
    importClientResolutionBrief,
    moduleClientActionQueue,
    clientWorkflowHandoff,
    previousBrief: options.previousModuleClientResolutionBrief,
    now: options.now ?? options.timestamp,
    historyLimit: options.moduleClientResolutionHistoryLimit ?? options.historyLimit
  });
  const releaseEvidenceRows = [
    {
      id: 'feature_release_evidence',
      status: featureReleaseEvidence.status,
      restartSafe: featureReleaseEvidence.restartSafe === true,
      fingerprint: featureReleaseEvidence.fingerprint,
      nextAction: featureReleaseEvidence.readiness?.nextAction ?? featureReleaseEvidence.handoff?.nextAction,
      blockedRows: featureReleaseEvidence.exportSummary?.blockedRows ?? [],
      guardedRows: featureReleaseEvidence.exportSummary?.guardedRows ?? [],
      publishRows: featureReleaseEvidence.exportSummary?.publishRows ?? []
    },
    {
      id: 'import_client_evidence',
      status: importClientEvidenceManifest.status,
      restartSafe: importClientEvidenceManifest.restartSafe === true,
      fingerprint: importClientEvidenceManifest.fingerprint,
      nextAction: importClientEvidenceManifest.readiness?.nextAction ?? importClientEvidenceManifest.handoff?.nextAction,
      blockedRows: importClientEvidenceManifest.exportSummary?.blockedRows ?? [],
      guardedRows: importClientEvidenceManifest.exportSummary?.guardedRows ?? [],
      publishRows: importClientEvidenceManifest.exportSummary?.publishRows ?? []
    }
  ];
  const releaseEvidenceStatus = releaseEvidenceRows.some((row) => row.status === 'blocked')
    ? 'blocked'
    : releaseEvidenceRows.some((row) => row.status === 'guarded' || row.status === 'degraded')
      ? 'guarded'
      : 'ready';
  const releaseEvidenceFingerprint = [
    operation,
    releaseEvidenceStatus,
    ...releaseEvidenceRows.map((row) => [
      row.id,
      row.status,
      row.restartSafe ? 'restart_safe' : 'restart_guarded',
      row.fingerprint,
      row.nextAction
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('||');
  const releaseEvidenceNextAction = releaseEvidenceStatus === 'blocked'
    ? 'resolve_module_release_evidence_blockers'
    : releaseEvidenceStatus === 'guarded'
      ? 'publish_module_release_evidence_guarded'
      : 'publish_module_release_evidence_ready';
  const moduleReleaseEvidence = {
    schemaVersion: MODULE_SYNTAX_SCHEMA_VERSION,
    title: 'mailchimp_module_release_evidence',
    operation,
    status: releaseEvidenceStatus,
    restartSafe: releaseEvidenceStatus === 'ready' && releaseEvidenceRows.every((row) => row.restartSafe),
    fingerprint: releaseEvidenceFingerprint,
    rows: releaseEvidenceRows,
    validationSummary: {
      totalRows: releaseEvidenceRows.length,
      blockedRows: releaseEvidenceRows.reduce((count, row) => count + row.blockedRows.length, 0),
      guardedRows: releaseEvidenceRows.reduce((count, row) => count + row.guardedRows.length, 0),
      publishRows: releaseEvidenceRows.reduce((count, row) => count + row.publishRows.length, 0),
      diagnosticErrors: [
        ...featureReleaseEvidence.diagnostics,
        ...importClientEvidenceManifest.diagnostics
      ].filter((item) => item.level === 'error').length,
      diagnosticWarnings: [
        ...featureReleaseEvidence.diagnostics,
        ...importClientEvidenceManifest.diagnostics
      ].filter((item) => item.level === 'warning').length
    },
    readiness: {
      blockingReasons: unique(releaseEvidenceRows.flatMap((row) => row.blockedRows.map((id) => `${row.id}:${id}`))),
      guardedReasons: unique(releaseEvidenceRows.flatMap((row) => row.guardedRows.map((id) => `${row.id}:${id}`))),
      nextAction: releaseEvidenceNextAction
    },
    handoff: {
      target: 'kernel.status.mailchimp.module.release-evidence',
      statusChannel: releaseEvidenceStatus === 'ready' ? 'kernel.status.mailchimp' : 'local.status.module-release-evidence',
      publish: releaseEvidenceStatus !== 'ready' || releaseEvidenceRows.some((row) => row.publishRows.length > 0),
      severity: releaseEvidenceStatus === 'blocked' ? 'error' : releaseEvidenceStatus === 'guarded' ? 'warning' : 'info',
      includeRows: true,
      nextAction: releaseEvidenceNextAction
    },
    exportSummary: {
      schemaVersion: MODULE_SYNTAX_SCHEMA_VERSION,
      title: 'mailchimp_module_release_evidence',
      operation,
      status: releaseEvidenceStatus,
      restartSafe: releaseEvidenceStatus === 'ready' && releaseEvidenceRows.every((row) => row.restartSafe),
      fingerprint: releaseEvidenceFingerprint,
      blockedRows: releaseEvidenceRows.flatMap((row) => row.blockedRows.map((id) => `${row.id}:${id}`)).sort(),
      guardedRows: releaseEvidenceRows.flatMap((row) => row.guardedRows.map((id) => `${row.id}:${id}`)).sort(),
      publishRows: releaseEvidenceRows.flatMap((row) => row.publishRows.map((id) => `${row.id}:${id}`)).sort(),
      nextAction: releaseEvidenceNextAction
    }
  };
  const moduleLaunchGate = buildModuleLaunchGateControl({
    operation,
    profileLaunchControls,
    featureLaunchPreview,
    importProviderLaunchGate,
    moduleReleaseEvidence,
    moduleStatusPublication,
    moduleLaunchPublicationDigest,
    launchAcceptance,
    clientWorkflowHandoff,
    previousGate: options.previousModuleLaunchGate,
    allowDegradedLaunch: options.allowModuleDegradedLaunch,
    requireExplicitAcceptance: options.requireModuleLaunchAcceptance === true,
    now: options.now ?? options.timestamp,
    historyLimit: options.moduleLaunchGateHistoryLimit ?? options.historyLimit
  });
  const moduleClientLaunchReadiness = buildModuleClientLaunchReadinessReport({
    operation,
    featureLaunchReadinessLedger,
    importLaunchReadinessLedger,
    launchAcceptance,
    moduleLaunchGate,
    moduleLaunchPublicationDigest,
    moduleStatusPublication,
    clientWorkflowHandoff,
    previousReport: options.previousModuleClientLaunchReadiness,
    now: options.now ?? options.timestamp,
    historyLimit: options.moduleClientLaunchReadinessHistoryLimit ?? options.historyLimit
  });
  const moduleBoundaryOperations = buildModuleBoundaryOperationsPacket({
    operation,
    profileBoundaryIntent,
    featureOperationalControls,
    importLifecycleCommandSurface,
    moduleLaunchGate,
    moduleClientLaunchReadiness,
    previousPacket: options.previousModuleBoundaryOperations,
    now: options.now ?? options.timestamp,
    historyLimit: options.moduleBoundaryOperationsHistoryLimit ?? options.historyLimit
  });
  const profileOperationalReadiness = buildProfileOperationalReadinessBrief(profileSource || options.profile || {}, {
    ...options,
    previousBrief: options.previousProfileOperationalReadiness,
    previousHealthExport: options.previousProfileHealthExport,
    previousState: options.previousProfileState,
    previousLifecycle: options.previousProfileLifecycle,
    previousExport: options.previousProfileExport,
    previousProviderState: options.previousProfileProviderState,
    persistedMemory: options.persistedMemory,
    now: options.now ?? options.timestamp
  });
  const featureAnalyticsPublication = buildFeatureGateAnalyticsPublicationSummary(gateSource || options.gates || {}, {
    ...options,
    operation,
    requestedEffects,
    previousAnalytics: options.previousGateAnalytics,
    previousPublication: options.previousFeatureGateAnalyticsPublication,
    previousState: options.previousGateState,
    generation: options.gateGeneration,
    now: options.now ?? options.timestamp
  });
  const importProviderOperationalBrief = buildImportProviderOperationalBrief(imports, {
    ...options,
    health: importHealth,
    previousBrief: options.previousImportProviderOperationalBrief,
    previousReadinessPlan: options.previousImportProviderReadiness,
    requestedCapabilities: options.importRequestedCapabilities ?? imports.capabilityRefs,
    requiredAliases: options.requiredImportAliases,
    acceptance: options.importProviderReadinessAcceptance,
    now: options.now ?? options.timestamp
  });
  const moduleOperationalReadinessBrief = buildModuleOperationalReadinessBrief({
    operation,
    profileOperationalReadiness,
    featureAnalyticsPublication,
    importProviderOperationalBrief,
    operationalStatus,
    moduleBoundaryOperations,
    previousBrief: options.previousModuleOperationalReadinessBrief,
    now: options.now ?? options.timestamp,
    historyLimit: options.moduleOperationalReadinessBriefHistoryLimit ?? options.historyLimit
  });
  const finalOk = ok
    && importWorkspaceBoundaryManifest.status !== 'blocked'
    && moduleBoundaryOperations.status !== 'blocked'
    && moduleOperationalReadinessBrief.status !== 'blocked'
    && moduleLaunchGate.status !== 'blocked'
    && moduleClientBoundaryReadiness.status !== 'blocked'
    && moduleClientExportRouteReadiness.status !== 'blocked'
    && moduleClientRuntimeResume.status !== 'blocked'
    && moduleRestartReplayCheckpoint.status !== 'blocked'
    && moduleRestartRecoveryDigest.status !== 'blocked'
    && moduleTenantLaunchGuard.status !== 'blocked';

  return {
    ok: finalOk,
    module: {
      schemaVersion: MODULE_SYNTAX_SCHEMA_VERSION,
      sourceName: parsed.sourceName,
      adapter: profile.profile?.adapter ?? 'mailchimp',
      operation,
      imports: imports.imports,
      capabilityContract: unique([
        ...(profile.profile?.capabilities ?? []),
        ...imports.capabilityRefs,
        ...gate.allowedEffects
      ]),
      memoryContract: profile.profile?.memory ?? [],
      verifierContract: profile.profile?.verifier ?? { requiredClaims: [], truthBoundaries: [] },
      featurePolicy: gate.policy,
      featureState: gateState,
      featureAnalytics: gateAnalytics.exportSummary,
      featureCommandPlan,
      featureLifecycleReadiness,
      featureReleaseEvidence,
      featureOperationalControls,
      featureBoundaryControls,
      profileBoundaryIntent,
      profileBoundaryRelease,
      featureBoundaryRelease,
      importBoundaryRelease,
      moduleBoundaryRelease,
      tenantHandoffBoundary,
      profileExport: profileExport.exportSummary,
      profileAudienceLedger,
      importHealth,
      importAnalytics,
      importHistoryExport,
      importTimelineReport,
      importStatusJournal,
      profileRecoveryManifest,
      profileRestartReplayDecision,
      importAnalyticsRecovery,
      moduleRestartRecoveryDigest,
      moduleRestartReplayCheckpoint,
      importClientReadiness,
      importClientPreviewDigest,
      importClientPreviewRoute,
      importClientEvidenceManifest,
      importClientResolutionBrief,
      importLifecycle,
      importGateLifecycle,
      importLifecycleCommandSurface,
      importPreviewAcceptance,
      importBoundaryAcceptance,
      importWorkspaceBoundaryManifest,
      importProviderContract,
      importProviderReadiness,
      importProviderAdoption,
      importProviderSyncCheckpoint,
      importProviderLaunchState,
      importRuntimeAdoption,
      importRuntimeClientContract,
      profileProviderService,
      profileProviderAdoption,
      profileProviderSyncIntent,
      profileProviderSyncHandoff,
      profileProviderLaunchHandoff,
      providerAdoption,
      featureKernelManifest,
      importKernelManifest,
      profileLifecycleNextAction,
      profileLifecycleSettingsControls,
      profileLifecycleScheduleCheckpoint,
      profileLifecycleClientControls,
      featureProviderHandoff,
      featureProviderControls,
      importRuntimeHandoff,
      importRuntimeClientControls,
      importRuntimeRequestAdoption,
      moduleClientControlRoom,
      moduleWorkflowNextAction,
      kernelHandoffManifest: moduleKernelHandoffManifest,
      profileRuntimeAdoption,
      profileClientResolutionBrief,
      profileRequestKernelBinding,
      moduleRuntimeAdoption,
      profileRestartRecovery,
      profileRestartStatusLedger,
      profileActivation,
      profileLaunchControls,
      providerGatePreview,
      featureLaunchPreview,
      featureNextStepDigest,
      featureClientAcceptance,
      featureClientActionQueue,
      importClientAcceptance,
      importClientActionQueue,
      launchAcceptance,
      profileBoundaryEvidence,
      profileTenantPermissionMatrix,
      profileTenantLaunchGuard,
      moduleTenantLaunchGuard,
      profileOperationalHealth,
      profileOperationalReadiness,
      profileStatusPublication,
      profileOperationalEscalation,
      importOperationalEscalation,
      moduleOperationalEscalation,
      featureGatePublication,
      importProviderSyncPublication,
      importProviderSyncBridge,
      importProviderLaunchGate,
      importProviderSyncState,
      featureProviderSyncAcceptance,
      featureProviderLaunchAcceptance,
      moduleProviderSyncWorkflow,
      profilePrimaryPack,
      profileAnalyticsExportLedger,
      profileAudienceLedger,
      exportReadiness,
      operationsPack,
      moduleStatusPublication,
      moduleLaunchPublicationDigest,
      moduleLaunchGate,
      featureOperationalLedger,
      featureAnalyticsPublication,
      importOperationalLedger,
      importProviderOperationalBrief,
      featureLaunchReadinessLedger,
      importLaunchReadinessLedger,
      featureClientReadiness,
      importTenantAuditReadiness,
      profileResumeHandoff,
      featureResumeState,
      importRuntimeResume,
      moduleClientRuntimeResume,
      moduleClientBoundaryReadiness,
      moduleClientExportRouteReadiness,
      moduleClientLaunchReadiness,
      moduleBoundaryOperations,
      moduleOperationalReadinessBrief,
      moduleOperationalReadinessLedger,
      moduleClientActionQueue,
      moduleClientResolutionBrief,
      moduleReleaseEvidence,
      clientWorkflowHandoff,
      clientRuntime: clientRuntime.state,
      profilePreviewAcceptance,
      profileNextStepDigest,
      profileFailure,
      profileLifecycle,
      profilePersistence: profilePersistence.envelope,
      boundary: boundary.contract,
      operationalStatus,
      operationalActionPlan,
      statusHandoff: {
        ...(profile.profile?.handoff ?? {}),
        importChannels: importHandoff.handoff.statusChannels,
        importHistory: importHistoryExport.handoff,
        importTimeline: importTimelineReport.handoff,
        importStatusJournal: importStatusJournal.handoff,
        profileRecoveryManifest: profileRecoveryManifest.handoff,
        profileRestartReplayDecision: profileRestartReplayDecision.handoff,
        importAnalyticsRecovery: importAnalyticsRecovery.handoff,
        moduleRestartRecoveryDigest: moduleRestartRecoveryDigest.handoff,
        moduleRestartReplayCheckpoint: moduleRestartReplayCheckpoint.handoff,
        importLifecycle: importLifecycle.handoff,
        importGateLifecycle: importGateLifecycle.handoff,
        importRuntimeAdoption: importRuntimeAdoption.handoff,
        importRuntimeClientContract: importRuntimeClientContract.handoff,
        importProviderAdoption: importProviderAdoption.handoff,
        importProviderReadiness: importProviderReadiness.handoff,
        importProviderSync: importProviderSyncCheckpoint.handoff,
        importProviderSyncPublication: importProviderSyncPublication.publication,
        importProviderSyncBridge: importProviderSyncBridge.handoff,
        importProviderLaunchGate: importProviderLaunchGate.handoff,
        importProviderSyncState: importProviderSyncState.handoff,
        importProviderLaunchState: importProviderLaunchState.handoff,
        featureProviderSyncAcceptance: featureProviderSyncAcceptance.handoff,
        featureProviderLaunchAcceptance: featureProviderLaunchAcceptance.handoff,
        moduleProviderSyncWorkflow: moduleProviderSyncWorkflow.handoff,
        moduleLaunchGate: moduleLaunchGate.handoff,
        moduleBoundaryOperations: moduleBoundaryOperations.handoff,
        profileBoundaryIntent: profileBoundaryIntent.handoff,
        featureOperationalControls: featureOperationalControls.handoff,
        importLifecycleCommandSurface: importLifecycleCommandSurface.handoff,
        profileLifecycle: profileLifecycle.handoff,
        providerTargets: importProviderContract.externalHandoff.targets,
        profileProviderTarget: profileProviderService.externalState?.target ?? null,
        profileProviderAdoption: profileProviderAdoption.handoff,
        profileProviderSync: profileProviderSyncIntent.handoff,
        profileProviderSyncHandoff: profileProviderSyncHandoff.handoff,
        profileProviderLaunchHandoff: profileProviderLaunchHandoff.launchHandoff,
        featureLaunchPreview: featureLaunchPreview.handoff,
        featureNextStepDigest: featureNextStepDigest.handoff,
        profileLifecycleNextAction: profileLifecycleNextAction.handoff,
        featureProviderHandoff: featureProviderHandoff.handoff,
        importRuntimeHandoff: importRuntimeHandoff.handoff,
        moduleWorkflowNextAction: moduleWorkflowNextAction.handoff,
        profileStatusPublication: profileStatusPublication.publication,
        profileOperationalEscalation: profileOperationalEscalation.handoff,
        importOperationalEscalation: importOperationalEscalation.handoff,
        moduleOperationalEscalation: moduleOperationalEscalation.handoff,
        featureGatePublication: featureGatePublication.publication,
        moduleStatusPublication: moduleStatusPublication.handoff,
        moduleLaunchPublicationDigest: moduleLaunchPublicationDigest.handoff,
        featureOperationalLedger: featureOperationalLedger.handoff,
        importOperationalLedger: importOperationalLedger.handoff,
        featureLaunchReadinessLedger: featureLaunchReadinessLedger.handoff,
        importLaunchReadinessLedger: importLaunchReadinessLedger.handoff,
        moduleClientLaunchReadiness: moduleClientLaunchReadiness.handoff,
        moduleOperationalReadinessLedger: moduleOperationalReadinessLedger.handoff,
        moduleClientExportRouteReadiness: moduleClientExportRouteReadiness.handoff,
        moduleClientActionQueue: moduleClientActionQueue.handoff,
        moduleClientResolutionBrief: moduleClientResolutionBrief.handoff,
        moduleClientRuntimeResume: moduleClientRuntimeResume.handoff,
        profileResumeHandoff: profileResumeHandoff.handoff,
        featureResumeState: featureResumeState.handoff,
        importRuntimeResume: importRuntimeResume.handoff,
        moduleReleaseEvidence: moduleReleaseEvidence.handoff,
        profileClientResolutionBrief: profileClientResolutionBrief.handoff,
        importClientResolutionBrief: importClientResolutionBrief.handoff,
        providerAdoption: providerAdoption.handoff,
        featureKernelManifest: featureKernelManifest.handoff,
        importKernelManifest: importKernelManifest.handoff,
        kernelHandoffManifest: moduleKernelHandoffManifest.handoff,
        profileRuntimeAdoption: profileRuntimeAdoption.handoff,
        profileRestartRecovery: profileRestartRecovery.handoff,
        profileRestartStatusLedger: profileRestartStatusLedger.handoff,
        profileActivation: profileActivation.handoff,
        profileLaunchControls: profileLaunchControls.handoff,
        profileLifecycleSettingsControls: profileLifecycleSettingsControls.handoff,
        profileNextStepDigest: profileNextStepDigest.handoff,
        profileBoundaryEvidence: profileBoundaryEvidence.auditHandoff,
        profileTenantPermissionMatrix: profileTenantPermissionMatrix.auditHandoff,
        profileTenantLaunchGuard: profileTenantLaunchGuard.auditHandoff,
        moduleTenantLaunchGuard: moduleTenantLaunchGuard.handoff,
        profileOperationalHealth: profileOperationalHealth.handoff,
        profilePrimaryPack: profilePrimaryPack.handoff,
        profileAnalyticsExportLedger: profileAnalyticsExportLedger.handoff,
        profileAudienceLedger: profileAudienceLedger.handoff,
        featureCommandPlan: featureCommandPlan.handoff,
        featureLifecycleReadiness: featureLifecycleReadiness.handoff,
        featureReleaseEvidence: featureReleaseEvidence.handoff,
        importClientReadiness: importClientReadiness.handoff,
        importClientPreviewRoute: importClientPreviewRoute.handoff,
        importClientEvidenceManifest: importClientEvidenceManifest.handoff,
        featureBoundaryControls: featureBoundaryControls.auditHandoff,
        profileBoundaryRelease: profileBoundaryRelease.auditHandoff,
        featureBoundaryRelease: featureBoundaryRelease.auditHandoff,
        importBoundaryRelease: importBoundaryRelease.auditHandoff,
        moduleBoundaryRelease: moduleBoundaryRelease.handoff,
        importBoundary: importBoundaryAcceptance.auditHandoff,
        profilePreview: profilePreviewAcceptance.exportSummary,
        profileNextStepDigest: profileNextStepDigest.exportSummary,
        providerPreview: providerGatePreview.exportSummary,
        clientWorkflow: clientWorkflowHandoff.exportSummary,
        actionPlan: operationalActionPlan.handoff,
        exportReadiness: exportReadiness.handoff,
        operationsPack: operationsPack.handoff,
        launchAcceptance: launchAcceptance.handoff,
        restartSafe: runtime.ok
          && importHandoff.handoff.restartSafe
          && recovery.restartSafe
          && gateState.restartSafe
          && importHealth.restartSafe
          && importHistoryExport.restartSafe
          && importTimelineReport.restartSafe
          && importStatusJournal.restartSafe
          && profileRecoveryManifest.restartSafe
          && importAnalyticsRecovery.restartSafe
          && moduleRestartRecoveryDigest.restartSafe
          && featureClientActionQueue.restartSafe
          && featureNextStepDigest.restartSafe
          && importClientActionQueue.restartSafe
          && moduleClientActionQueue.restartSafe
          && moduleClientExportRouteReadiness.restartSafe
          && moduleClientResolutionBrief.restartSafe
          && moduleClientRuntimeResume.restartSafe
          && profileResumeHandoff.restartSafe
          && featureResumeState.restartSafe
          && importRuntimeResume.restartSafe
          && importLifecycle.ok
          && importGateLifecycle.restartSafe
          && importBoundaryAcceptance.restartSafe
          && importProviderContract.restartSafe
          && importProviderReadiness.restartSafe
          && importProviderAdoption.restartSafe
          && importProviderSyncCheckpoint.restartSafe
          && importProviderSyncBridge.restartSafe
          && importProviderSyncState.restartSafe
          && featureProviderSyncAcceptance.restartSafe
          && moduleProviderSyncWorkflow.restartSafe
          && featureKernelManifest.restartSafe
          && importKernelManifest.restartSafe
          && moduleKernelHandoffManifest.restartSafe
          && importRuntimeAdoption.restartSafe
          && importRuntimeClientContract.restartSafe
          && profileProviderService.restartSafe
          && profileProviderAdoption.restartSafe
          && profileProviderSyncIntent.restartSafe
          && providerAdoption.restartSafe
          && profileRuntimeAdoption.restartSafe
          && profileClientResolutionBrief.restartSafe
          && profileRestartRecovery.restartSafe
          && profileRestartStatusLedger.restartSafe
          && profileActivation.restartSafe
          && profileLaunchControls.restartSafe
          && profileLifecycleSettingsControls.restartSafe
          && profileBoundaryEvidence.restartSafe
          && profileTenantPermissionMatrix.restartSafe
          && profileTenantLaunchGuard.restartSafe
          && moduleTenantLaunchGuard.restartSafe
          && profilePrimaryPack.restartSafe
          && profileAnalyticsExportLedger.restartSafe
          && profileAudienceLedger.restartSafe
          && featureCommandPlan.restartSafe
          && featureLifecycleReadiness.restartSafe
          && featureReleaseEvidence.restartSafe
          && featureBoundaryControls.restartSafe
          && profileBoundaryRelease.restartSafe
          && featureBoundaryRelease.restartSafe
          && importBoundaryRelease.restartSafe
          && moduleBoundaryRelease.restartSafe
          && importClientReadiness.restartSafe
          && importClientPreviewRoute.restartSafe
          && importClientEvidenceManifest.restartSafe
          && importClientResolutionBrief.restartSafe
          && profilePreviewAcceptance.restartSafe
          && profileNextStepDigest.restartSafe
          && providerGatePreview.restartSafe
          && exportReadiness.restartSafe
          && operationsPack.restartSafe
          && profileStatusPublication.restartSafe
          && featureGatePublication.restartSafe
          && importProviderSyncPublication.restartSafe
          && moduleStatusPublication.restartSafe
          && moduleLaunchPublicationDigest.restartSafe
          && featureOperationalLedger.restartSafe
          && importOperationalLedger.restartSafe
          && featureLaunchReadinessLedger.restartSafe
          && importLaunchReadinessLedger.restartSafe
          && moduleClientLaunchReadiness.restartSafe
          && moduleOperationalReadinessLedger.restartSafe
          && moduleClientExportRouteReadiness.restartSafe
          && moduleReleaseEvidence.restartSafe
          && launchAcceptance.restartSafe
          && clientWorkflowHandoff.restartSafe
          && profileFailure.restartSafe !== false
          && profileLifecycle.ok
          && profileLifecycle.status !== 'disabled'
          && profileLifecycle.status !== 'paused'
          && profileLifecycle.status !== 'operator_review'
          && importLifecycle.status !== 'disabled'
          && importLifecycle.status !== 'paused'
          && boundary.contract.crossTenantSafe
          && operationalStatus.restartSafe
      },
      recovery: {
        ...profile.profile?.recovery,
        profileStatus: profilePersistence.envelope?.status ?? 'unavailable',
        gateStatus: recovery.status,
        importStatus: importHealth.status,
        importHistoryStatus: importHistoryExport.status,
        importTimelineStatus: importTimelineReport.status,
        importStatusJournalStatus: importStatusJournal.status,
        profileRecoveryManifestStatus: profileRecoveryManifest.status,
        importAnalyticsRecoveryStatus: importAnalyticsRecovery.status,
        moduleRestartRecoveryStatus: moduleRestartRecoveryDigest.status,
        importLifecycleStatus: importLifecycle.status,
        importGateLifecycleStatus: importGateLifecycle.status,
        profileLifecycleStatus: profileLifecycle.status,
        profileLifecycleSettingsControlStatus: profileLifecycleSettingsControls.status,
        importProviderStatus: importProviderContract.status,
        importProviderAdoptionStatus: importProviderAdoption.status,
        importProviderSyncStatus: importProviderSyncCheckpoint.status,
        importProviderSyncBridgeStatus: importProviderSyncBridge.status,
        profileStatusPublicationStatus: profileStatusPublication.status,
        featureGatePublicationStatus: featureGatePublication.status,
        importProviderSyncPublicationStatus: importProviderSyncPublication.status,
        featureLaunchReadinessStatus: featureLaunchReadinessLedger.status,
        importLaunchReadinessStatus: importLaunchReadinessLedger.status,
        moduleClientLaunchReadinessStatus: moduleClientLaunchReadiness.status,
        moduleClientExportRouteReadinessStatus: moduleClientExportRouteReadiness.status,
        moduleStatusPublicationStatus: moduleStatusPublication.status,
        moduleLaunchPublicationDigestStatus: moduleLaunchPublicationDigest.status,
        importProviderReadinessStatus: importProviderReadiness.status,
        importRuntimeAdoptionStatus: importRuntimeAdoption.status,
        importRuntimeClientContractStatus: importRuntimeClientContract.status,
        importClientResolutionStatus: importClientResolutionBrief.status,
        moduleClientRuntimeResumeStatus: moduleClientRuntimeResume.status,
        profileResumeHandoffStatus: profileResumeHandoff.status,
        featureResumeStateStatus: featureResumeState.status,
        importRuntimeResumeStatus: importRuntimeResume.status,
        profileProviderStatus: profileProviderService.status,
        profileProviderAdoptionStatus: profileProviderAdoption.status,
        profileProviderSyncStatus: profileProviderSyncIntent.status,
        providerAdoptionStatus: providerAdoption.status,
        featureKernelManifestStatus: featureKernelManifest.status,
        importKernelManifestStatus: importKernelManifest.status,
        kernelHandoffManifestStatus: moduleKernelHandoffManifest.status,
        profileRuntimeAdoptionStatus: profileRuntimeAdoption.status,
        profileClientResolutionStatus: profileClientResolutionBrief.status,
        profileRestartRecoveryStatus: profileRestartRecovery.status,
        profileRestartStatusLedgerStatus: profileRestartStatusLedger.status,
        profileActivationStatus: profileActivation.status,
        profileLaunchControlStatus: profileLaunchControls.status,
        profileBoundaryEvidenceStatus: profileBoundaryEvidence.status,
        profileTenantPermissionStatus: profileTenantPermissionMatrix.status,
        profileTenantLaunchGuardStatus: profileTenantLaunchGuard.status,
        moduleTenantLaunchGuardStatus: moduleTenantLaunchGuard.status,
        profilePrimaryPackStatus: profilePrimaryPack.status,
        profileAnalyticsExportLedgerStatus: profileAnalyticsExportLedger.status,
        profileAudienceLedgerStatus: profileAudienceLedger.status,
        featureCommandPlanStatus: featureCommandPlan.status,
        featureLifecycleReadinessStatus: featureLifecycleReadiness.status,
        featureReleaseEvidenceStatus: featureReleaseEvidence.status,
        featureBoundaryControlsStatus: featureBoundaryControls.status,
        profileBoundaryReleaseStatus: profileBoundaryRelease.status,
        featureBoundaryReleaseStatus: featureBoundaryRelease.status,
        importBoundaryReleaseStatus: importBoundaryRelease.status,
        moduleBoundaryReleaseStatus: moduleBoundaryRelease.status,
        importClientReadinessStatus: importClientReadiness.status,
        importClientPreviewRouteStatus: importClientPreviewRoute.status,
        importClientEvidenceStatus: importClientEvidenceManifest.status,
        importBoundaryStatus: importBoundaryAcceptance.status,
        profilePreviewStatus: profilePreviewAcceptance.status,
        providerPreviewStatus: providerGatePreview.status,
        clientWorkflowStatus: clientWorkflowHandoff.status,
        moduleClientResolutionStatus: moduleClientResolutionBrief.status,
        moduleReleaseEvidenceStatus: moduleReleaseEvidence.status,
        launchAcceptanceStatus: launchAcceptance.status,
        exportStatus: exportReadiness.status,
        profileFailureStatus: profileFailure.status,
        boundaryStatus: boundary.contract.status,
        resumeAction: operationalActionPlan.nextAction === 'operator_review'
          ? 'operator_operational_review'
          : moduleRestartRecoveryDigest.status === 'blocked'
          ? moduleRestartRecoveryDigest.readiness.nextAction
          : profileLifecycle.status === 'disabled' || profileLifecycle.status === 'paused'
          ? 'wait_for_profile_lifecycle_control'
          : profileLifecycle.status === 'retry_scheduled'
          ? 'dispatch_profile_retry'
          : profileLifecycle.status === 'operator_review'
          ? 'operator_profile_lifecycle_review'
          : profileLifecycleSettingsControls.status === 'blocked'
          ? profileLifecycleSettingsControls.readiness.nextAction
          : operationalActionPlan.nextAction === 'dispatch_import_retry'
          ? 'dispatch_import_retry'
          : importProviderReadiness.status === 'blocked'
          ? 'resolve_import_provider_readiness_blockers'
          : importProviderSyncCheckpoint.status === 'blocked'
          ? 'resolve_import_provider_sync_checkpoint_blockers'
          : importProviderSyncBridge.status === 'blocked'
          ? importProviderSyncBridge.readiness.nextAction
          : profileProviderSyncIntent.status === 'blocked'
          ? 'resolve_profile_provider_sync_blockers'
          : providerAdoption.status === 'blocked'
          ? 'resolve_module_provider_adoption_blockers'
          : moduleKernelHandoffManifest.status === 'blocked'
          ? moduleKernelHandoffManifest.readiness.nextAction
          : moduleLaunchPublicationDigest.status === 'blocked'
          ? moduleLaunchPublicationDigest.readiness.nextAction
          : moduleClientLaunchReadiness.status === 'blocked'
          ? moduleClientLaunchReadiness.readiness.nextAction
          : moduleClientExportRouteReadiness.status === 'blocked'
          ? moduleClientExportRouteReadiness.handoff.nextAction
          : moduleClientResolutionBrief.status === 'blocked'
          ? moduleClientResolutionBrief.readiness.nextAction
          : profileRuntimeAdoption.status === 'blocked'
          ? 'resolve_profile_runtime_adoption_blockers'
          : profileClientResolutionBrief.status === 'blocked'
          ? profileClientResolutionBrief.readiness.nextAction
          : profileRestartRecovery.status === 'blocked'
          ? 'resolve_profile_restart_recovery_blockers'
          : profileRestartStatusLedger.status === 'blocked'
          ? 'resolve_profile_restart_status_ledger_blockers'
          : profileAudienceLedger.status === 'blocked'
          ? 'resolve_profile_audience_export_ledger_blockers'
          : featureCommandPlan.status === 'blocked'
          ? 'resolve_feature_gate_command_plan_blockers'
          : featureLifecycleReadiness.status === 'blocked'
          ? featureLifecycleReadiness.readiness.nextAction
          : moduleReleaseEvidence.status === 'blocked'
          ? moduleReleaseEvidence.readiness.nextAction
          : featureReleaseEvidence.status === 'blocked'
          ? featureReleaseEvidence.readiness.nextAction
          : importClientEvidenceManifest.status === 'blocked'
          ? importClientEvidenceManifest.readiness.nextAction
          : moduleBoundaryRelease.status === 'blocked'
          ? moduleBoundaryRelease.readiness.nextAction
          : moduleTenantLaunchGuard.status === 'blocked'
          ? moduleTenantLaunchGuard.readiness.nextAction
          : profileTenantLaunchGuard.status === 'blocked'
          ? profileTenantLaunchGuard.readiness.nextAction
          : importStatusJournal.status === 'blocked'
          ? importStatusJournal.handoff.nextAction
          : profileRecoveryManifest.status === 'blocked'
          ? profileRecoveryManifest.recovery.nextAction
          : importAnalyticsRecovery.status === 'blocked'
          ? importAnalyticsRecovery.recovery.nextAction
          : importTimelineReport.status === 'blocked'
          ? importTimelineReport.handoff.nextAction
          : importClientReadiness.status === 'blocked'
          ? 'resolve_import_client_readiness_blockers'
          : importClientResolutionBrief.status === 'blocked'
          ? importClientResolutionBrief.readiness.nextAction
          : importLifecycle.status === 'disabled' || importLifecycle.status === 'paused'
          ? 'wait_for_import_lifecycle_control'
          : importLifecycle.status === 'retry_scheduled'
          ? 'dispatch_import_retry'
          : boundary.contract.status === 'blocked'
          ? 'operator_boundary_review'
          : profileAudienceLedger.status === 'degraded'
          ? 'publish_profile_audience_export_ledger_degraded'
          : featureCommandPlan.status === 'degraded'
          ? 'publish_feature_gate_command_plan_degraded'
          : featureLifecycleReadiness.status === 'degraded'
          ? featureLifecycleReadiness.readiness.nextAction
          : moduleReleaseEvidence.status === 'guarded'
          ? moduleReleaseEvidence.readiness.nextAction
          : featureReleaseEvidence.status === 'guarded'
          ? featureReleaseEvidence.readiness.nextAction
          : importClientEvidenceManifest.status === 'guarded'
          ? importClientEvidenceManifest.readiness.nextAction
          : moduleBoundaryRelease.status === 'guarded'
          ? moduleBoundaryRelease.readiness.nextAction
          : importStatusJournal.status === 'degraded'
          ? importStatusJournal.handoff.nextAction
          : moduleRestartRecoveryDigest.status === 'guarded'
          ? moduleRestartRecoveryDigest.readiness.nextAction
          : profileRecoveryManifest.status === 'guarded'
          ? profileRecoveryManifest.recovery.nextAction
          : importAnalyticsRecovery.status === 'guarded'
          ? importAnalyticsRecovery.recovery.nextAction
          : importClientReadiness.status === 'degraded'
          ? 'publish_import_client_readiness_degraded'
          : importTimelineReport.status === 'degraded'
          ? importTimelineReport.handoff.nextAction
          : profileBoundaryEvidence.status === 'degraded'
          ? 'publish_profile_boundary_evidence_advisory'
          : importHealth.status === 'degraded'
            ? 'resume_with_import_degraded_mode'
            : moduleKernelHandoffManifest.status === 'degraded'
              ? moduleKernelHandoffManifest.readiness.nextAction
            : importProviderSyncBridge.status === 'degraded'
              ? importProviderSyncBridge.readiness.nextAction
            : moduleLaunchPublicationDigest.status === 'guarded'
              ? moduleLaunchPublicationDigest.readiness.nextAction
            : moduleClientLaunchReadiness.status === 'guarded'
              ? moduleClientLaunchReadiness.readiness.nextAction
            : moduleClientResolutionBrief.status === 'guarded'
              ? moduleClientResolutionBrief.readiness.nextAction
            : recovery.resumeAction
      }
    },
    diagnostics
  };
}

function buildModuleKernelHandoffManifest({
  operation,
  profileRuntime = {},
  featureKernelManifest = {},
  importKernelManifest = {},
  boundary = {},
  profileLifecycle = {},
  importLifecycle = {},
  operationalActionPlan = {}
}) {
  const profileContract = profileRuntime.contract ?? {};
  const boundaryContract = boundary.contract ?? boundary;
  const rows = [
    {
      id: 'profile:kernel-job',
      component: 'profile',
      status: profileRuntime.ok === false ? 'blocked' : 'ready',
      restartSafe: profileRuntime.ok !== false,
      statusChannel: profileContract.statusHandoff?.statusChannel ?? 'kernel.status.mailchimp',
      nextAction: profileRuntime.ok === false
        ? 'repair_profile_runtime_contract'
        : 'include_profile_kernel_job',
      evidence: {
        operation: profileContract.operation ?? operation,
        capabilityRefs: profileContract.kernelJob?.capabilityRefs ?? [],
        memoryRefs: profileContract.kernelJob?.memoryRefs ?? [],
        verifierClaims: profileContract.kernelJob?.verifierClaims ?? []
      }
    },
    {
      id: 'feature:gates',
      component: 'feature_gates',
      status: featureKernelManifest.status ?? 'blocked',
      restartSafe: featureKernelManifest.restartSafe === true,
      statusChannel: featureKernelManifest.statusChannel ?? featureKernelManifest.handoff?.statusChannel ?? 'kernel.status.mailchimp',
      nextAction: featureKernelManifest.handoff?.nextAction ?? 'resolve_feature_gate_kernel_manifest',
      evidence: featureKernelManifest.summary ?? {}
    },
    {
      id: 'imports:runtime',
      component: 'imports',
      status: importKernelManifest.status ?? 'blocked',
      restartSafe: importKernelManifest.restartSafe === true,
      statusChannel: importKernelManifest.handoff?.statusChannel ?? 'kernel.status.mailchimp',
      nextAction: importKernelManifest.handoff?.nextAction ?? 'resolve_import_kernel_manifest',
      evidence: importKernelManifest.summary ?? {}
    },
    {
      id: 'boundary:tenant',
      component: 'boundary',
      status: boundaryContract.status ?? 'blocked',
      restartSafe: boundaryContract.crossTenantSafe === true && boundaryContract.status !== 'blocked',
      statusChannel: boundaryContract.auditHandoff?.statusChannel ?? 'kernel.status.mailchimp',
      nextAction: boundaryContract.status === 'blocked'
        ? 'operator_boundary_review'
        : boundaryContract.status === 'degraded'
          ? 'publish_boundary_advisory'
          : 'include_boundary_evidence',
      evidence: {
        tenantId: boundaryContract.tenantId ?? null,
        workspaceId: boundaryContract.workspaceId ?? null,
        role: boundaryContract.role ?? null,
        crossTenantSafe: boundaryContract.crossTenantSafe === true
      }
    },
    {
      id: 'lifecycle:profile',
      component: 'profile_lifecycle',
      status: lifecycleKernelStatus(profileLifecycle.status),
      restartSafe: profileLifecycle.ok !== false
        && !['disabled', 'paused', 'operator_review', 'blocked'].includes(clean(profileLifecycle.status)),
      statusChannel: profileLifecycle.handoff?.statusChannel ?? 'kernel.status.mailchimp',
      nextAction: profileLifecycle.nextAction ?? profileLifecycle.handoff?.nextAction ?? 'include_profile_lifecycle',
      evidence: {
        rawStatus: profileLifecycle.status ?? 'unknown',
        enabled: profileLifecycle.enabled !== false,
        controls: profileLifecycle.controls ?? {}
      }
    },
    {
      id: 'lifecycle:imports',
      component: 'import_lifecycle',
      status: lifecycleKernelStatus(importLifecycle.status),
      restartSafe: importLifecycle.ok !== false
        && !['disabled', 'paused', 'blocked'].includes(clean(importLifecycle.status)),
      statusChannel: importLifecycle.handoff?.statusChannel ?? 'kernel.status.mailchimp',
      nextAction: importLifecycle.nextAction ?? importLifecycle.handoff?.nextAction ?? 'include_import_lifecycle',
      evidence: {
        rawStatus: importLifecycle.status ?? 'unknown',
        enabled: importLifecycle.enabled !== false,
        controls: importLifecycle.controls ?? {}
      }
    }
  ].sort((left, right) => left.id.localeCompare(right.id));
  const blockedRows = rows.filter((row) => row.status === 'blocked');
  const degradedRows = rows.filter((row) => row.status === 'degraded');
  const status = blockedRows.length > 0
    ? 'blocked'
    : degradedRows.length > 0
      ? 'degraded'
      : 'ready';
  const statusChannels = unique(rows.map((row) => row.statusChannel));
  const restartSafe = status === 'ready' && rows.every((row) => row.restartSafe !== false);
  const nextAction = status === 'blocked'
    ? firstAction(blockedRows, operationalActionPlan?.nextAction, 'resolve_module_kernel_handoff_blockers')
    : status === 'degraded'
      ? firstAction(degradedRows, operationalActionPlan?.nextAction, 'publish_module_kernel_handoff_advisory')
      : operationalActionPlan?.nextAction === 'resume'
        ? 'publish_module_kernel_handoff_ready'
        : operationalActionPlan?.nextAction ?? 'publish_module_kernel_handoff_ready';

  return {
    ok: status !== 'blocked',
    schemaVersion: MODULE_SYNTAX_SCHEMA_VERSION,
    operation,
    status,
    restartSafe,
    statusChannels,
    rows,
    readiness: {
      blockingReasons: blockedRows.map((row) => row.id),
      degradedReasons: degradedRows.map((row) => row.id),
      nextAction
    },
    summary: {
      blockedComponents: blockedRows.map((row) => row.component),
      degradedComponents: degradedRows.map((row) => row.component),
      capabilityRefs: unique(rows.flatMap((row) => row.evidence?.capabilityRefs ?? [])),
      memoryRefs: unique(rows.flatMap((row) => row.evidence?.memoryRefs ?? [])),
      verifierClaims: unique(rows.flatMap((row) => row.evidence?.verifierClaims ?? [])),
      statusChannelReady: statusChannels.includes('kernel.status.mailchimp')
    },
    handoff: {
      target: 'kernel.status.mailchimp.module-handoff-manifest',
      statusChannel: statusChannels.includes('kernel.status.mailchimp')
        ? 'kernel.status.mailchimp'
        : 'local.status.module-handoff-manifest',
      publish: status !== 'ready',
      severity: status === 'blocked' ? 'error' : status === 'degraded' ? 'warning' : 'info',
      includeRows: status !== 'ready',
      nextAction
    },
    exportSummary: {
      schemaVersion: MODULE_SYNTAX_SCHEMA_VERSION,
      title: 'mailchimp_module_kernel_handoff_manifest',
      operation,
      status,
      restartSafe,
      blockedRows: blockedRows.map((row) => row.id),
      degradedRows: degradedRows.map((row) => row.id),
      statusChannels,
      nextAction
    },
    diagnostics: [
      ...blockedRows.map((row) => ({
        level: 'error',
        code: 'module_kernel_handoff_manifest_blocked',
        subject: row.id
      })),
      ...degradedRows.map((row) => ({
        level: 'warning',
        code: 'module_kernel_handoff_manifest_degraded',
        subject: row.id
      }))
    ]
  };
}

export function buildModuleProviderSyncWorkflowHandoff({
  operation = 'campaign.sync',
  profileProviderSyncIntent = {},
  profileProviderSyncHandoff = {},
  importProviderSyncCheckpoint = {},
  importProviderSyncPublication = {},
  importProviderSyncBridge = {},
  importProviderLaunchGate = {},
  importProviderSyncState = {},
  featureProviderSyncAcceptance = {},
  previousWorkflow = {},
  now = null,
  requireExplicitAcceptance = false
} = {}) {
  const previous = normalizeModuleProviderSyncWorkflow(previousWorkflow);
  const rows = [
    moduleProviderSyncWorkflowRow('profile_sync_intent', 'profile', profileProviderSyncIntent, true, {
      status: profileProviderSyncIntent.status,
      restartSafe: profileProviderSyncIntent.restartSafe,
      statusChannel: profileProviderSyncIntent.handoff?.statusChannel,
      nextAction: profileProviderSyncIntent.readiness?.nextAction ?? profileProviderSyncIntent.handoff?.nextAction,
      evidence: {
        profileName: profileProviderSyncIntent.profileName ?? profileProviderSyncIntent.exportSummary?.profileName,
        cursor: profileProviderSyncIntent.sync?.cursor ?? profileProviderSyncIntent.exportSummary?.syncCursor,
        fingerprint: profileProviderSyncIntent.fingerprint ?? profileProviderSyncIntent.exportSummary?.fingerprint
      }
    }),
    moduleProviderSyncWorkflowRow('profile_sync_handoff', 'profile', profileProviderSyncHandoff, true, {
      status: profileProviderSyncHandoff.status,
      restartSafe: profileProviderSyncHandoff.restartSafe,
      statusChannel: profileProviderSyncHandoff.handoff?.statusChannel,
      nextAction: profileProviderSyncHandoff.readiness?.nextAction ?? profileProviderSyncHandoff.handoff?.nextAction,
      evidence: {
        acceptedItems: profileProviderSyncHandoff.acceptance?.acceptedItems ?? [],
        blockedRows: profileProviderSyncHandoff.exportSummary?.blockedRows ?? [],
        degradedRows: profileProviderSyncHandoff.exportSummary?.degradedRows ?? []
      }
    }),
    moduleProviderSyncWorkflowRow('feature_sync_acceptance', 'feature_gates', featureProviderSyncAcceptance, true, {
      status: featureProviderSyncAcceptance.status,
      restartSafe: featureProviderSyncAcceptance.restartSafe,
      statusChannel: featureProviderSyncAcceptance.handoff?.statusChannel,
      nextAction: featureProviderSyncAcceptance.readiness?.nextAction ?? featureProviderSyncAcceptance.handoff?.nextAction,
      evidence: {
        awaitingAcceptance: featureProviderSyncAcceptance.validationSummary?.awaitingAcceptance ?? 0,
        acceptedItems: featureProviderSyncAcceptance.acceptance?.acceptedItems ?? [],
        fingerprint: featureProviderSyncAcceptance.fingerprint
      }
    }),
    moduleProviderSyncWorkflowRow('import_sync_checkpoint', 'imports', importProviderSyncCheckpoint, true, {
      status: importProviderSyncCheckpoint.status,
      restartSafe: importProviderSyncCheckpoint.restartSafe,
      statusChannel: importProviderSyncCheckpoint.handoff?.statusChannel,
      nextAction: importProviderSyncCheckpoint.readiness?.nextAction ?? importProviderSyncCheckpoint.handoff?.nextAction,
      evidence: {
        sequence: importProviderSyncCheckpoint.sequence ?? 0,
        changed: importProviderSyncCheckpoint.changed === true,
        profileCursor: importProviderSyncCheckpoint.profileSyncIntent?.cursor ?? null,
        blockedProviders: importProviderSyncCheckpoint.exportSummary?.blockedProviders ?? []
      }
    }),
    moduleProviderSyncWorkflowRow('import_sync_bridge', 'imports', importProviderSyncBridge, true, {
      status: importProviderSyncBridge.status,
      restartSafe: importProviderSyncBridge.restartSafe,
      statusChannel: importProviderSyncBridge.handoff?.statusChannel,
      nextAction: importProviderSyncBridge.readiness?.nextAction ?? importProviderSyncBridge.handoff?.nextAction,
      evidence: {
        sequence: importProviderSyncBridge.sequence ?? 0,
        pendingAcceptance: importProviderSyncBridge.exportSummary?.pendingAcceptance ?? [],
        degradedProviders: importProviderSyncBridge.exportSummary?.degradedProviders ?? []
      }
    }),
    moduleProviderSyncWorkflowRow('import_sync_state', 'imports', importProviderSyncState, true, {
      status: importProviderSyncState.status,
      restartSafe: importProviderSyncState.restartSafe,
      statusChannel: importProviderSyncState.handoff?.statusChannel,
      nextAction: importProviderSyncState.readiness?.nextAction ?? importProviderSyncState.handoff?.nextAction,
      evidence: {
        sequence: importProviderSyncState.sequence ?? 0,
        changed: importProviderSyncState.changed === true,
        replaySafe: importProviderSyncState.persistedState?.replaySafe === true,
        lastStableFingerprint: importProviderSyncState.persistedState?.lastStableFingerprint ?? null
      }
    }),
    moduleProviderSyncWorkflowRow('import_provider_launch', 'imports', importProviderLaunchGate, true, {
      status: importProviderLaunchGate.status,
      restartSafe: importProviderLaunchGate.restartSafe,
      statusChannel: importProviderLaunchGate.handoff?.statusChannel,
      nextAction: importProviderLaunchGate.readiness?.nextAction ?? importProviderLaunchGate.handoff?.nextAction,
      evidence: {
        blockedProviders: importProviderLaunchGate.exportSummary?.blockedProviders ?? [],
        degradedProviders: importProviderLaunchGate.exportSummary?.degradedProviders ?? [],
        waivedProviders: importProviderLaunchGate.exportSummary?.waivedProviders ?? []
      }
    }),
    moduleProviderSyncWorkflowRow('import_sync_publication', 'imports', importProviderSyncPublication, false, {
      status: importProviderSyncPublication.status,
      restartSafe: importProviderSyncPublication.restartSafe,
      statusChannel: importProviderSyncPublication.publication?.statusChannel,
      nextAction: importProviderSyncPublication.publication?.nextAction ?? importProviderSyncPublication.exportSummary?.nextAction,
      evidence: {
        publishProviders: importProviderSyncPublication.exportSummary?.publishProviders ?? [],
        stale: importProviderSyncPublication.stale === true,
        fingerprint: importProviderSyncPublication.fingerprint
      }
    })
  ];
  const requiredRows = rows.filter((row) => row.required);
  const blockedRows = requiredRows.filter((row) => row.status === 'blocked');
  const guardedRows = rows.filter((row) => row.status === 'guarded' || row.restartSafe === false);
  const awaitingAcceptance = rows.filter((row) => (
    requireExplicitAcceptance
    && row.required
    && Array.isArray(row.evidence?.acceptedItems)
    && row.evidence.acceptedItems.length === 0
  ));
  const status = blockedRows.length > 0 || awaitingAcceptance.length > 0
    ? 'blocked'
    : guardedRows.length > 0
      ? 'guarded'
      : 'ready';
  const fingerprint = moduleProviderSyncWorkflowFingerprint({ operation, status, rows });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = previous.sequence + (changed ? 1 : 0);
  const diagnostics = [
    ...(profileProviderSyncIntent.diagnostics ?? []).filter((item) => item.level === 'error'),
    ...(profileProviderSyncHandoff.diagnostics ?? []).filter((item) => item.level === 'error'),
    ...(featureProviderSyncAcceptance.diagnostics ?? []).filter((item) => item.level === 'error'),
    ...(importProviderSyncState.diagnostics ?? []).filter((item) => item.level === 'error'),
    ...(importProviderLaunchGate.diagnostics ?? []).filter((item) => item.level === 'error'),
    ...awaitingAcceptance.map((row) => ({
      level: 'error',
      code: 'module_provider_sync_acceptance_missing',
      subject: row.id
    }))
  ];
  const nextAction = status === 'blocked'
    ? 'resolve_module_provider_sync_workflow_blockers'
    : status === 'guarded'
      ? 'publish_module_provider_sync_workflow_guarded'
      : changed
        ? 'publish_module_provider_sync_workflow_ready'
        : 'reuse_module_provider_sync_workflow';

  return {
    ok: status !== 'blocked',
    schemaVersion: MODULE_SYNTAX_SCHEMA_VERSION,
    title: 'mailchimp_module_provider_sync_workflow',
    operation,
    status,
    restartSafe: status === 'ready' && requiredRows.every((row) => row.restartSafe === true),
    sequence,
    fingerprint,
    changed,
    generatedAt: clean(now) || null,
    rows,
    validationSummary: {
      totalRows: rows.length,
      requiredRows: requiredRows.length,
      blockedRows: blockedRows.length,
      guardedRows: guardedRows.length,
      awaitingAcceptance: awaitingAcceptance.length,
      localStatusRoutes: rows.filter((row) => row.statusChannel?.startsWith('local.status.')).length,
      diagnosticErrors: diagnostics.filter((item) => item.level === 'error').length,
      diagnosticWarnings: diagnostics.filter((item) => item.level === 'warning').length
    },
    readiness: {
      blockingReasons: unique([
        ...blockedRows.map((row) => row.id),
        ...awaitingAcceptance.map((row) => `acceptance:${row.id}`)
      ]),
      guardedReasons: unique(guardedRows.map((row) => row.id)),
      nextAction
    },
    handoff: {
      target: 'kernel.status.mailchimp.module-provider-sync',
      statusChannel: status === 'ready' ? 'kernel.status.mailchimp' : 'local.status.module-provider-sync',
      publish: changed || status !== 'ready' || rows.some((row) => row.publish),
      severity: status === 'blocked' ? 'error' : status === 'guarded' ? 'warning' : 'info',
      includeRows: true,
      nextAction
    },
    exportSummary: {
      schemaVersion: MODULE_SYNTAX_SCHEMA_VERSION,
      title: 'mailchimp_module_provider_sync_workflow',
      operation,
      status,
      restartSafe: status === 'ready' && requiredRows.every((row) => row.restartSafe === true),
      sequence,
      fingerprint,
      changed,
      blockedRows: blockedRows.map((row) => row.id).sort(),
      guardedRows: guardedRows.map((row) => row.id).sort(),
      nextAction
    },
    diagnostics
  };
}

export function buildModuleBoundaryReleaseReport({
  operation = 'campaign.sync',
  profileBoundaryRelease = {},
  featureBoundaryRelease = {},
  importBoundaryRelease = {},
  previousReport = {},
  now = null,
  historyLimit = 12
} = {}) {
  const previous = normalizeModuleBoundaryReleaseHistory(previousReport);
  const rows = [
    moduleBoundaryReleaseRow('profile_boundary_release', profileBoundaryRelease, true),
    moduleBoundaryReleaseRow('feature_boundary_release', featureBoundaryRelease, true),
    moduleBoundaryReleaseRow('import_boundary_release', importBoundaryRelease, true)
  ];
  const blockedRows = rows.filter((row) => row.status === 'blocked');
  const guardedRows = rows.filter((row) => row.status === 'guarded');
  const status = blockedRows.length > 0
    ? 'blocked'
    : guardedRows.length > 0
      ? 'guarded'
      : 'released';
  const restartSafe = status === 'released' && rows.every((row) => row.restartSafe === true);
  const counters = {
    total: rows.length,
    released: rows.filter((row) => row.status === 'released').length,
    guarded: guardedRows.length,
    blocked: blockedRows.length,
    restartUnsafe: rows.filter((row) => row.restartSafe !== true).length,
    diagnostics: {
      errors: rows.reduce((count, row) => count + row.diagnosticErrors, 0),
      warnings: rows.reduce((count, row) => count + row.diagnosticWarnings, 0)
    }
  };
  const fingerprint = moduleBoundaryReleaseFingerprint({ operation, status, rows });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = previous.sequence + (changed ? 1 : 0);
  const event = {
    sequence,
    timestamp: clean(now) || null,
    operation,
    status,
    fingerprint,
    blockedRows: blockedRows.length,
    guardedRows: guardedRows.length,
    restartSafe
  };
  const timeline = [
    ...previous.timeline,
    ...(changed || previous.timeline.length === 0 ? [event] : [])
  ].slice(-toNonNegativeInteger(historyLimit, 12) || 12);
  const statusCounts = timeline.reduce((counts, item) => {
    counts[item.status] = (counts[item.status] ?? 0) + 1;
    return counts;
  }, {});
  const nextAction = status === 'blocked'
    ? firstAction(blockedRows, null, 'resolve_module_boundary_release_blockers')
    : status === 'guarded'
      ? firstAction(guardedRows, null, 'publish_module_boundary_release_advisory')
      : changed
        ? 'publish_module_boundary_release'
        : 'reuse_module_boundary_release';

  return {
    ok: status !== 'blocked',
    schemaVersion: MODULE_SYNTAX_SCHEMA_VERSION,
    operation,
    status,
    restartSafe,
    sequence,
    fingerprint,
    changed,
    rows,
    counters,
    readiness: {
      blockingReasons: unique(blockedRows.flatMap((row) => row.reasons)),
      guardedReasons: unique(guardedRows.flatMap((row) => row.reasons)),
      nextAction
    },
    history: {
      sequence,
      timeline,
      statusCounts
    },
    handoff: {
      target: 'kernel.status.mailchimp.module-boundary-release',
      statusChannel: rows.every((row) => row.statusChannel === 'kernel.status.mailchimp')
        ? 'kernel.status.mailchimp'
        : 'local.status.module-boundary-release',
      publish: changed || status !== 'released',
      severity: status === 'blocked' ? 'error' : status === 'guarded' ? 'warning' : 'info',
      includeRows: status !== 'released',
      nextAction
    },
    exportSummary: {
      schemaVersion: MODULE_SYNTAX_SCHEMA_VERSION,
      title: 'mailchimp_module_boundary_release_report',
      operation,
      status,
      restartSafe,
      sequence,
      fingerprint,
      changed,
      blockedRows: blockedRows.map((row) => row.id),
      guardedRows: guardedRows.map((row) => row.id),
      nextAction
    },
    diagnostics: [
      ...blockedRows.map((row) => ({
        level: 'error',
        code: 'module_boundary_release_blocked',
        subject: row.id
      })),
      ...guardedRows.map((row) => ({
        level: 'warning',
        code: 'module_boundary_release_guarded',
        subject: row.id
      }))
    ]
  };
}

export function buildModuleTenantLaunchGuardReport({
  operation = 'campaign.sync',
  boundary = {},
  profileTenantLaunchGuard = {},
  previousReport = {},
  now = null,
  historyLimit = 12
} = {}) {
  const previous = normalizeModuleTenantLaunchGuardHistory(previousReport);
  const moduleBoundary = boundary.contract ?? boundary;
  const profileRows = Array.isArray(profileTenantLaunchGuard.rows) ? profileTenantLaunchGuard.rows : [];
  const profileBlocked = profileRows.filter((row) => row.status === 'blocked' && row.required !== false);
  const profileGuarded = profileRows.filter((row) => row.status === 'guarded');
  const rows = [
    {
      id: 'module_boundary',
      source: 'module',
      status: moduleBoundary.status === 'blocked'
        ? 'blocked'
        : moduleBoundary.status === 'degraded'
          ? 'guarded'
          : 'ready',
      required: true,
      restartSafe: moduleBoundary.crossTenantSafe === true && moduleBoundary.status !== 'blocked',
      nextAction: moduleBoundary.status === 'blocked'
        ? 'resolve_module_tenant_boundary'
        : moduleBoundary.status === 'degraded'
          ? 'confirm_module_role_capability_boundary'
          : 'publish_module_tenant_boundary',
      evidence: {
        tenantId: moduleBoundary.tenantId ?? null,
        workspaceId: moduleBoundary.workspaceId ?? null,
        role: moduleBoundary.role ?? null,
        deniedCapabilities: moduleBoundary.deniedCapabilities ?? [],
        crossTenantSafe: moduleBoundary.crossTenantSafe === true
      }
    },
    {
      id: 'profile_launch_guard',
      source: 'profile',
      status: profileTenantLaunchGuard.status === 'blocked'
        ? 'blocked'
        : profileTenantLaunchGuard.status === 'guarded'
          ? 'guarded'
          : 'ready',
      required: true,
      restartSafe: profileTenantLaunchGuard.restartSafe === true,
      nextAction: profileTenantLaunchGuard.readiness?.nextAction
        ?? profileTenantLaunchGuard.exportSummary?.nextAction
        ?? 'review_profile_tenant_launch_guard',
      evidence: {
        tenantId: profileTenantLaunchGuard.scope?.tenantId ?? null,
        workspaceId: profileTenantLaunchGuard.scope?.workspaceId ?? null,
        requestedTenantId: profileTenantLaunchGuard.scope?.requestedTenantId ?? null,
        requestedWorkspaceId: profileTenantLaunchGuard.scope?.requestedWorkspaceId ?? null,
        blockedRows: profileBlocked.map((row) => row.id),
        guardedRows: profileGuarded.map((row) => row.id),
        fingerprint: profileTenantLaunchGuard.fingerprint ?? null
      }
    }
  ];
  const blockedRows = rows.filter((row) => row.required !== false && row.status === 'blocked');
  const guardedRows = rows.filter((row) => row.status === 'guarded');
  const status = blockedRows.length > 0
    ? 'blocked'
    : guardedRows.length > 0
      ? 'guarded'
      : 'ready';
  const counters = {
    rows: rows.length,
    ready: rows.filter((row) => row.status === 'ready').length,
    guarded: guardedRows.length,
    blocked: blockedRows.length,
    profileBlockedRows: profileBlocked.length,
    profileGuardedRows: profileGuarded.length,
    deniedCapabilities: moduleBoundary.deniedCapabilities?.length ?? 0,
    crossTenantBlocked: moduleBoundary.crossTenantSafe === false ? 1 : 0
  };
  const fingerprint = moduleTenantLaunchGuardFingerprint({
    operation,
    status,
    rows,
    counters
  });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = previous.sequence + (changed ? 1 : 0);
  const restartSafe = status === 'ready' && rows.every((row) => row.restartSafe !== false);
  const event = {
    sequence,
    timestamp: clean(now) || null,
    operation,
    status,
    fingerprint,
    blocked: counters.blocked,
    guarded: counters.guarded,
    restartSafe
  };
  const limit = Math.max(1, toNonNegativeInteger(historyLimit, 12));
  const timeline = [...previous.timeline, event].slice(-limit);
  const statusCounts = timeline.reduce((counts, item) => {
    counts[item.status] = (counts[item.status] ?? 0) + 1;
    return counts;
  }, {});
  const diagnostics = [
    ...(boundary.diagnostics ?? []).filter((item) => item.level === 'error'),
    ...(profileTenantLaunchGuard.diagnostics ?? []).filter((item) => item.level === 'error'),
    ...blockedRows.map((row) => ({
      level: 'error',
      code: 'module_tenant_launch_guard_blocked',
      subject: row.id
    })),
    ...guardedRows.map((row) => ({
      level: 'warning',
      code: 'module_tenant_launch_guard_guarded',
      subject: row.id
    }))
  ];
  const nextAction = status === 'blocked'
    ? firstModuleTenantLaunchGuardAction(blockedRows, 'resolve_module_tenant_launch_guard')
    : status === 'guarded'
      ? firstModuleTenantLaunchGuardAction(guardedRows, 'confirm_module_tenant_launch_guard')
      : 'publish_module_tenant_launch_guard';

  return {
    ok: status !== 'blocked',
    schemaVersion: MODULE_SYNTAX_SCHEMA_VERSION,
    title: 'mailchimp_module_tenant_launch_guard',
    operation,
    status,
    restartSafe,
    sequence,
    fingerprint,
    changed,
    generatedAt: clean(now) || null,
    counters,
    rows,
    history: {
      sequence,
      timeline,
      statusCounts,
      lastStatus: timeline[timeline.length - 1]?.status ?? status
    },
    readiness: {
      status,
      blockingReasons: blockedRows.map((row) => row.id),
      guardedReasons: guardedRows.map((row) => row.id),
      nextAction
    },
    handoff: {
      target: 'kernel.status.mailchimp.module-launch-boundary',
      statusChannel: status === 'ready' ? 'kernel.status.mailchimp' : 'local.status.module-launch-boundary',
      publish: changed || status !== 'ready',
      severity: status === 'blocked' ? 'error' : status === 'guarded' ? 'warning' : 'info',
      nextAction
    },
    exportSummary: {
      schemaVersion: MODULE_SYNTAX_SCHEMA_VERSION,
      title: 'mailchimp_module_tenant_launch_guard',
      status,
      restartSafe,
      sequence,
      fingerprint,
      changed,
      counters,
      blockedRows: blockedRows.map((row) => row.id),
      guardedRows: guardedRows.map((row) => row.id),
      nextAction
    },
    diagnostics
  };
}

export function buildModuleTenantHandoffBoundaryMatrix({
  operation = 'campaign.sync',
  profileTenantHandoffBoundary = {},
  featureTenantHandoffBoundary = {},
  importTenantHandoffBoundary = {},
  previousMatrix = {},
  now = null,
  historyLimit = 12
} = {}) {
  const previous = normalizeModuleTenantHandoffBoundary(previousMatrix);
  const rows = [
    moduleTenantHandoffBoundaryRow('profile', profileTenantHandoffBoundary, true),
    moduleTenantHandoffBoundaryRow('feature_gates', featureTenantHandoffBoundary, true),
    moduleTenantHandoffBoundaryRow('imports', importTenantHandoffBoundary, true)
  ];
  const blockedRows = rows.filter((row) => row.status === 'blocked' && row.required !== false);
  const guardedRows = rows.filter((row) => row.status === 'guarded');
  const status = blockedRows.length > 0
    ? 'blocked'
    : guardedRows.length > 0
      ? 'guarded'
      : 'released';
  const fingerprint = moduleTenantHandoffBoundaryFingerprint({
    operation,
    status,
    rows
  });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = previous.sequence + (changed ? 1 : 0);
  const diagnostics = [
    ...rows.flatMap((row) => row.diagnostics.filter((item) => item.level === 'error')),
    ...blockedRows.map((row) => ({ level: 'error', code: 'module_tenant_handoff_boundary_blocked', subject: row.id })),
    ...guardedRows.map((row) => ({ level: 'warning', code: 'module_tenant_handoff_boundary_guarded', subject: row.id }))
  ];
  const timeline = [
    ...previous.timeline,
    ...(changed || previous.timeline.length === 0 ? [{
      sequence,
      timestamp: clean(now) || null,
      operation,
      status,
      fingerprint,
      blockedRows: blockedRows.map((row) => row.id),
      guardedRows: guardedRows.map((row) => row.id)
    }] : [])
  ].slice(-toNonNegativeInteger(historyLimit, 12));

  return {
    ok: status !== 'blocked',
    schemaVersion: MODULE_SYNTAX_SCHEMA_VERSION,
    title: 'mailchimp_module_tenant_handoff_boundary',
    operation,
    status,
    restartSafe: status === 'released' && rows.every((row) => row.restartSafe === true),
    sequence,
    fingerprint,
    changed,
    rows,
    history: {
      sequence,
      timeline,
      statusCounts: timeline.reduce((counts, item) => {
        counts[item.status] = (counts[item.status] ?? 0) + 1;
        return counts;
      }, {})
    },
    handoff: {
      target: 'kernel.status.mailchimp.module-boundary',
      statusChannel: status === 'released' ? 'kernel.status.mailchimp' : 'local.status.module-boundary',
      publish: changed || status !== 'released',
      severity: status === 'blocked' ? 'error' : status === 'guarded' ? 'warning' : 'info',
      includeRows: status !== 'released',
      nextAction: status === 'blocked'
        ? 'resolve_module_tenant_handoff_boundary'
        : status === 'guarded'
          ? 'publish_module_tenant_handoff_guarded'
          : 'publish_module_tenant_handoff_boundary'
    },
    exportSummary: {
      schemaVersion: MODULE_SYNTAX_SCHEMA_VERSION,
      title: 'mailchimp_module_tenant_handoff_boundary',
      operation,
      status,
      restartSafe: status === 'released' && rows.every((row) => row.restartSafe === true),
      sequence,
      fingerprint,
      changed,
      blockedRows: blockedRows.map((row) => row.id),
      guardedRows: guardedRows.map((row) => row.id),
      nextAction: status === 'released' ? 'publish_module_tenant_handoff_boundary' : 'review_module_tenant_handoff_boundary'
    },
    diagnostics
  };
}

function lifecycleKernelStatus(status) {
  const value = clean(status);
  if (['blocked', 'operator_review', 'disabled'].includes(value)) return 'blocked';
  if (['paused', 'retry_scheduled', 'enabled_degraded', 'degraded'].includes(value)) return 'degraded';
  return 'ready';
}

function firstAction(rows, preferredAction, fallbackAction) {
  return clean(preferredAction) || clean(rows[0]?.nextAction) || fallbackAction;
}

export function buildKernelModuleContract(input = {}, options = {}) {
  const compiled = compileModuleSyntax(input, options);
  if (!compiled.ok) return { ok: false, diagnostics: compiled.diagnostics };
  const module = compiled.module;
  return {
    ok: true,
    contract: {
      job: {
        adapter: module.adapter,
        operation: module.operation,
        capabilities: module.capabilityContract,
        memory: module.memoryContract.map((item) => item.name),
        verifierClaims: module.verifierContract.requiredClaims
      },
      capability: {
        allowedEffects: module.capabilityContract,
        policy: module.featurePolicy
      },
      memory: module.memoryContract,
      verifier: module.verifierContract,
      clientRuntime: module.clientRuntime,
      boundary: module.boundary,
      featureState: {
        generation: module.featureState.generation,
        fingerprint: module.featureState.fingerprint,
        status: module.featureState.status,
        restartSafe: module.featureState.restartSafe,
        scope: module.featureState.scope,
        auditHandoff: module.featureState.auditHandoff
      },
      featureAnalytics: module.featureAnalytics,
      featureBoundaryControls: {
        status: module.featureBoundaryControls.status,
        restartSafe: module.featureBoundaryControls.restartSafe,
        decisions: module.featureBoundaryControls.decisions,
        blockedRows: module.featureBoundaryControls.blockedRows,
        degradedRows: module.featureBoundaryControls.degradedRows,
        auditHandoff: module.featureBoundaryControls.auditHandoff,
        exportSummary: module.featureBoundaryControls.exportSummary
      },
      importHealth: {
        status: module.importHealth.status,
        degradedMode: module.importHealth.degradedMode,
        retryable: module.importHealth.retryable,
        nextRetry: module.importHealth.nextRetry,
        actionableErrors: module.importHealth.actionableErrors
      },
      importAnalytics: module.importAnalytics.exportSummary,
      importHistoryExport: {
        status: module.importHistoryExport.status,
        restartSafe: module.importHistoryExport.restartSafe,
        sequence: module.importHistoryExport.sequence,
        fingerprint: module.importHistoryExport.fingerprint,
        deltas: module.importHistoryExport.deltas,
        counters: module.importHistoryExport.counters,
        exportSummary: module.importHistoryExport.exportSummary,
        handoff: module.importHistoryExport.handoff
      },
      importStatusJournal: {
        status: module.importStatusJournal.status,
        restartSafe: module.importStatusJournal.restartSafe,
        sequence: module.importStatusJournal.sequence,
        fingerprint: module.importStatusJournal.fingerprint,
        changed: module.importStatusJournal.changed,
        counters: module.importStatusJournal.counters,
        journal: module.importStatusJournal.journal,
        idempotency: module.importStatusJournal.idempotency,
        handoff: module.importStatusJournal.handoff,
        exportSummary: module.importStatusJournal.exportSummary
      },
      importLifecycle: {
        status: module.importLifecycle.status,
        enabled: module.importLifecycle.enabled,
        nextAction: module.importLifecycle.nextAction,
        controls: module.importLifecycle.controls,
        schedule: module.importLifecycle.schedule,
        handoff: module.importLifecycle.handoff
      },
      importGateLifecycle: {
        status: module.importGateLifecycle.status,
        restartSafe: module.importGateLifecycle.restartSafe,
        lifecycle: module.importGateLifecycle.lifecycle,
        featureBoundary: module.importGateLifecycle.featureBoundary,
        controls: module.importGateLifecycle.controls,
        validationSummary: module.importGateLifecycle.validationSummary,
        handoff: module.importGateLifecycle.handoff,
        exportSummary: module.importGateLifecycle.exportSummary
      },
      importPreviewAcceptance: {
        status: module.importPreviewAcceptance.status,
        validationSummary: module.importPreviewAcceptance.validationSummary,
        readiness: module.importPreviewAcceptance.readiness,
        explanation: module.importPreviewAcceptance.explanation,
        exportSummary: module.importPreviewAcceptance.exportSummary
      },
      importBoundaryAcceptance: {
        status: module.importBoundaryAcceptance.status,
        validationSummary: module.importBoundaryAcceptance.validationSummary,
        readiness: module.importBoundaryAcceptance.readiness,
        auditHandoff: module.importBoundaryAcceptance.auditHandoff,
        explanation: module.importBoundaryAcceptance.explanation,
        exportSummary: module.importBoundaryAcceptance.exportSummary
      },
      importProviderContract: {
        status: module.importProviderContract.status,
        restartSafe: module.importProviderContract.restartSafe,
        capabilityNegotiation: module.importProviderContract.capabilityNegotiation,
        syncMetadata: module.importProviderContract.syncMetadata,
        externalHandoff: module.importProviderContract.externalHandoff
      },
      importProviderReadiness: {
        status: module.importProviderReadiness.status,
        restartSafe: module.importProviderReadiness.restartSafe,
        sequence: module.importProviderReadiness.sequence,
        fingerprint: module.importProviderReadiness.fingerprint,
        changed: module.importProviderReadiness.changed,
        validationSummary: module.importProviderReadiness.validationSummary,
        readiness: module.importProviderReadiness.readiness,
        handoff: module.importProviderReadiness.handoff,
        exportSummary: module.importProviderReadiness.exportSummary
      },
      importProviderAdoption: {
        status: module.importProviderAdoption.status,
        restartSafe: module.importProviderAdoption.restartSafe,
        sequence: module.importProviderAdoption.sequence,
        fingerprint: module.importProviderAdoption.fingerprint,
        changed: module.importProviderAdoption.changed,
        capabilityNegotiation: module.importProviderAdoption.capabilityNegotiation,
        syncMetadata: module.importProviderAdoption.syncMetadata,
        runtimeAdoption: module.importProviderAdoption.runtimeAdoption,
        readiness: module.importProviderAdoption.readiness,
        handoff: module.importProviderAdoption.handoff,
        exportSummary: module.importProviderAdoption.exportSummary
      },
      importProviderSyncCheckpoint: {
        status: module.importProviderSyncCheckpoint.status,
        restartSafe: module.importProviderSyncCheckpoint.restartSafe,
        sequence: module.importProviderSyncCheckpoint.sequence,
        fingerprint: module.importProviderSyncCheckpoint.fingerprint,
        changed: module.importProviderSyncCheckpoint.changed,
        profileSyncIntent: module.importProviderSyncCheckpoint.profileSyncIntent,
        validationSummary: module.importProviderSyncCheckpoint.validationSummary,
        checkpoint: module.importProviderSyncCheckpoint.checkpoint,
        readiness: module.importProviderSyncCheckpoint.readiness,
        handoff: module.importProviderSyncCheckpoint.handoff,
        exportSummary: module.importProviderSyncCheckpoint.exportSummary
      },
      kernelHandoffManifest: {
        status: module.kernelHandoffManifest.status,
        restartSafe: module.kernelHandoffManifest.restartSafe,
        statusChannels: module.kernelHandoffManifest.statusChannels,
        readiness: module.kernelHandoffManifest.readiness,
        summary: module.kernelHandoffManifest.summary,
        handoff: module.kernelHandoffManifest.handoff,
        exportSummary: module.kernelHandoffManifest.exportSummary
      },
      importRuntimeAdoption: {
        status: module.importRuntimeAdoption.status,
        restartSafe: module.importRuntimeAdoption.restartSafe,
        sequence: module.importRuntimeAdoption.sequence,
        fingerprint: module.importRuntimeAdoption.fingerprint,
        changed: module.importRuntimeAdoption.changed,
        readiness: module.importRuntimeAdoption.readiness,
        lifecycle: module.importRuntimeAdoption.lifecycle,
        provider: module.importRuntimeAdoption.provider,
        clientWorkflow: module.importRuntimeAdoption.clientWorkflow,
        handoff: module.importRuntimeAdoption.handoff,
        exportSummary: module.importRuntimeAdoption.exportSummary
      },
      profileProviderService: {
        status: module.profileProviderService.status,
        restartSafe: module.profileProviderService.restartSafe,
        generation: module.profileProviderService.generation,
        negotiation: module.profileProviderService.negotiation,
        sync: module.profileProviderService.sync,
        externalState: module.profileProviderService.externalState,
        handoff: module.profileProviderService.handoff
      },
      profileProviderAdoption: {
        status: module.profileProviderAdoption.status,
        restartSafe: module.profileProviderAdoption.restartSafe,
        sequence: module.profileProviderAdoption.sequence,
        fingerprint: module.profileProviderAdoption.fingerprint,
        changed: module.profileProviderAdoption.changed,
        negotiation: module.profileProviderAdoption.negotiation,
        sync: module.profileProviderAdoption.sync,
        externalState: module.profileProviderAdoption.externalState,
        readiness: module.profileProviderAdoption.readiness,
        handoff: module.profileProviderAdoption.handoff,
        exportSummary: module.profileProviderAdoption.exportSummary
      },
      profileProviderSyncIntent: {
        status: module.profileProviderSyncIntent.status,
        restartSafe: module.profileProviderSyncIntent.restartSafe,
        sequence: module.profileProviderSyncIntent.sequence,
        fingerprint: module.profileProviderSyncIntent.fingerprint,
        changed: module.profileProviderSyncIntent.changed,
        sync: module.profileProviderSyncIntent.sync,
        capabilityNegotiation: module.profileProviderSyncIntent.capabilityNegotiation,
        externalState: module.profileProviderSyncIntent.externalState,
        readiness: module.profileProviderSyncIntent.readiness,
        handoff: module.profileProviderSyncIntent.handoff,
        exportSummary: module.profileProviderSyncIntent.exportSummary
      },
      profileRuntimeAdoption: {
        status: module.profileRuntimeAdoption.status,
        restartSafe: module.profileRuntimeAdoption.restartSafe,
        sequence: module.profileRuntimeAdoption.sequence,
        fingerprint: module.profileRuntimeAdoption.fingerprint,
        changed: module.profileRuntimeAdoption.changed,
        request: module.profileRuntimeAdoption.request,
        readiness: module.profileRuntimeAdoption.readiness,
        handoff: module.profileRuntimeAdoption.handoff,
        exportSummary: module.profileRuntimeAdoption.exportSummary
      },
      profileRestartRecovery: {
        status: module.profileRestartRecovery.status,
        restartSafe: module.profileRestartRecovery.restartSafe,
        sequence: module.profileRestartRecovery.sequence,
        fingerprint: module.profileRestartRecovery.fingerprint,
        changed: module.profileRestartRecovery.changed,
        checkpoint: module.profileRestartRecovery.checkpoint,
        resumePlan: module.profileRestartRecovery.resumePlan,
        handoff: module.profileRestartRecovery.handoff,
        exportSummary: module.profileRestartRecovery.exportSummary
      },
      providerAdoption: {
        status: module.providerAdoption.status,
        restartSafe: module.providerAdoption.restartSafe,
        sequence: module.providerAdoption.sequence,
        fingerprint: module.providerAdoption.fingerprint,
        changed: module.providerAdoption.changed,
        readiness: module.providerAdoption.readiness,
        sync: module.providerAdoption.sync,
        handoff: module.providerAdoption.handoff,
        exportSummary: module.providerAdoption.exportSummary
      },
      profileActivation: {
        status: module.profileActivation.status,
        desiredState: module.profileActivation.desiredState,
        restartSafe: module.profileActivation.restartSafe,
        controls: module.profileActivation.controls,
        readiness: module.profileActivation.readiness,
        handoff: module.profileActivation.handoff,
        exportSummary: module.profileActivation.exportSummary
      },
      providerGatePreview: {
        status: module.providerGatePreview.status,
        restartSafe: module.providerGatePreview.restartSafe,
        validationSummary: module.providerGatePreview.validationSummary,
        readiness: module.providerGatePreview.readiness,
        explanation: module.providerGatePreview.explanation,
        exportSummary: module.providerGatePreview.exportSummary
      },
      featureClientAcceptance: {
        status: module.featureClientAcceptance.status,
        restartSafe: module.featureClientAcceptance.restartSafe,
        validationSummary: module.featureClientAcceptance.validationSummary,
        readiness: module.featureClientAcceptance.readiness,
        handoff: module.featureClientAcceptance.handoff,
        exportSummary: module.featureClientAcceptance.exportSummary
      },
      importClientAcceptance: {
        status: module.importClientAcceptance.status,
        restartSafe: module.importClientAcceptance.restartSafe,
        validationSummary: module.importClientAcceptance.validationSummary,
        readiness: module.importClientAcceptance.readiness,
        handoff: module.importClientAcceptance.handoff,
        exportSummary: module.importClientAcceptance.exportSummary
      },
      profilePreviewAcceptance: {
        status: module.profilePreviewAcceptance.status,
        restartSafe: module.profilePreviewAcceptance.restartSafe,
        validationSummary: module.profilePreviewAcceptance.validationSummary,
        readiness: module.profilePreviewAcceptance.readiness,
        explanation: module.profilePreviewAcceptance.explanation,
        exportSummary: module.profilePreviewAcceptance.exportSummary
      },
      profileBoundary: module.clientRuntime?.boundary ?? module.boundary,
      profileBoundaryEvidence: {
        status: module.profileBoundaryEvidence.status,
        restartSafe: module.profileBoundaryEvidence.restartSafe,
        sequence: module.profileBoundaryEvidence.sequence,
        fingerprint: module.profileBoundaryEvidence.fingerprint,
        scope: module.profileBoundaryEvidence.scope,
        validationSummary: module.profileBoundaryEvidence.validationSummary,
        readiness: module.profileBoundaryEvidence.readiness,
        auditHandoff: module.profileBoundaryEvidence.auditHandoff,
        exportSummary: module.profileBoundaryEvidence.exportSummary
      },
      profileTenantPermissionMatrix: {
        status: module.profileTenantPermissionMatrix.status,
        restartSafe: module.profileTenantPermissionMatrix.restartSafe,
        fingerprint: module.profileTenantPermissionMatrix.fingerprint,
        scope: module.profileTenantPermissionMatrix.scope,
        rows: module.profileTenantPermissionMatrix.rows,
        validationSummary: module.profileTenantPermissionMatrix.validationSummary,
        auditHandoff: module.profileTenantPermissionMatrix.auditHandoff,
        exportSummary: module.profileTenantPermissionMatrix.exportSummary
      },
      profileOperationalHealth: {
        status: module.profileOperationalHealth.status,
        restartSafe: module.profileOperationalHealth.restartSafe,
        sequence: module.profileOperationalHealth.sequence,
        fingerprint: module.profileOperationalHealth.fingerprint,
        counters: module.profileOperationalHealth.counters,
        actionQueue: module.profileOperationalHealth.actionQueue,
        handoff: module.profileOperationalHealth.handoff,
        exportSummary: module.profileOperationalHealth.exportSummary
      },
      profilePrimaryPack: {
        status: module.profilePrimaryPack.status,
        restartSafe: module.profilePrimaryPack.restartSafe,
        sequence: module.profilePrimaryPack.sequence,
        fingerprint: module.profilePrimaryPack.fingerprint,
        changed: module.profilePrimaryPack.changed,
        counters: module.profilePrimaryPack.counters,
        handoff: module.profilePrimaryPack.handoff,
        exportSummary: module.profilePrimaryPack.exportSummary
      },
      profileAudienceLedger: {
        status: module.profileAudienceLedger.status,
        restartSafe: module.profileAudienceLedger.restartSafe,
        sequence: module.profileAudienceLedger.sequence,
        fingerprint: module.profileAudienceLedger.fingerprint,
        changed: module.profileAudienceLedger.changed,
        counters: module.profileAudienceLedger.counters,
        handoff: module.profileAudienceLedger.handoff,
        exportSummary: module.profileAudienceLedger.exportSummary
      },
      featureCommandPlan: {
        status: module.featureCommandPlan.status,
        restartSafe: module.featureCommandPlan.restartSafe,
        sequence: module.featureCommandPlan.sequence,
        fingerprint: module.featureCommandPlan.fingerprint,
        changed: module.featureCommandPlan.changed,
        counters: module.featureCommandPlan.counters,
        controls: module.featureCommandPlan.controls,
        handoff: module.featureCommandPlan.handoff,
        exportSummary: module.featureCommandPlan.exportSummary
      },
      featureLifecycleReadiness: {
        status: module.featureLifecycleReadiness.status,
        restartSafe: module.featureLifecycleReadiness.restartSafe,
        sequence: module.featureLifecycleReadiness.sequence,
        fingerprint: module.featureLifecycleReadiness.fingerprint,
        changed: module.featureLifecycleReadiness.changed,
        controls: module.featureLifecycleReadiness.controls,
        schedule: module.featureLifecycleReadiness.schedule,
        validationSummary: module.featureLifecycleReadiness.validationSummary,
        readiness: module.featureLifecycleReadiness.readiness,
        handoff: module.featureLifecycleReadiness.handoff,
        exportSummary: module.featureLifecycleReadiness.exportSummary
      },
      importClientReadiness: {
        status: module.importClientReadiness.status,
        restartSafe: module.importClientReadiness.restartSafe,
        sequence: module.importClientReadiness.sequence,
        fingerprint: module.importClientReadiness.fingerprint,
        changed: module.importClientReadiness.changed,
        counters: module.importClientReadiness.counters,
        validationSummary: module.importClientReadiness.validationSummary,
        readiness: module.importClientReadiness.readiness,
        handoff: module.importClientReadiness.handoff,
        exportSummary: module.importClientReadiness.exportSummary
      },
      profileFailure: {
        status: module.profileFailure.status,
        degradedMode: module.profileFailure.degradedMode,
        restartSafe: module.profileFailure.restartSafe,
        retryable: module.profileFailure.retryable,
        nextRetry: module.profileFailure.nextRetry,
        failureState: module.profileFailure.failureState,
        actionableErrors: module.profileFailure.actionableErrors
      },
      profileLifecycle: {
        status: module.profileLifecycle.status,
        enabled: module.profileLifecycle.enabled,
        nextAction: module.profileLifecycle.nextAction,
        controls: module.profileLifecycle.controls,
        schedule: module.profileLifecycle.schedule,
        blockers: module.profileLifecycle.blockers,
        handoff: module.profileLifecycle.handoff
      },
      profilePersistence: module.profilePersistence ? {
        restartKey: module.profilePersistence.restartKey,
        generation: module.profilePersistence.generation,
        status: module.profilePersistence.status,
        restartSafe: module.profilePersistence.restartSafe,
        recovery: module.profilePersistence.recovery
      } : null,
      profileExport: module.profileExport,
      exportReadiness: module.exportReadiness,
      operationsPack: module.operationsPack,
      launchAcceptance: module.launchAcceptance,
      operationalStatus: module.operationalStatus,
      operationalActionPlan: module.operationalActionPlan,
      clientWorkflowHandoff: module.clientWorkflowHandoff,
      recovery: module.recovery,
      statusHandoff: module.statusHandoff
    },
    diagnostics: compiled.diagnostics
  };
}

export function buildModuleProviderAdoptionHandoff({
  operation = 'campaign.sync',
  profileProviderService = {},
  profileProviderAdoption = {},
  importProviderContract = {},
  importProviderReadiness = {},
  importProviderAdoption = {},
  importRuntimeAdoption = {},
  providerGatePreview = {},
  profileActivation = {},
  previousAdoption = {},
  now = null
} = {}) {
  const previous = normalizeModuleProviderAdoptionHistory(previousAdoption);
  const profileMissing = profileProviderAdoption.negotiation?.missingCapabilities
    ?? profileProviderService.negotiation?.missingCapabilities
    ?? [];
  const importMissing = importProviderAdoption.capabilityNegotiation?.missingCapabilities
    ?? importProviderContract.capabilityNegotiation?.missingCapabilities
    ?? [];
  const readinessMissing = importProviderReadiness.exportSummary?.missingCapabilities ?? [];
  const profileChannel = profileProviderAdoption.externalState?.statusChannel
    ?? profileProviderService.externalState?.statusChannel
    ?? null;
  const importChannels = (importProviderAdoption.externalHandoff?.targets ?? importProviderContract.externalHandoff?.targets ?? [])
    .map((target) => target.statusChannel)
    .filter(Boolean);
  const channelMismatch = profileChannel
    && importChannels.length > 0
    && importChannels.some((channel) => channel !== profileChannel);
  const syncChanged = profileProviderAdoption.sync?.changed === true
    || (importProviderAdoption.syncMetadata?.changedProviders ?? []).length > 0;
  const rows = [
    {
      component: 'profile_provider_adoption',
      status: profileProviderAdoption.status ?? profileProviderService.status ?? 'ready',
      restartSafe: profileProviderAdoption.restartSafe !== false && profileProviderService.restartSafe !== false,
      nextAction: profileProviderAdoption.readiness?.nextAction ?? profileProviderService.handoff?.nextAction ?? null,
      evidence: {
        missingCapabilities: profileMissing,
        sync: profileProviderAdoption.sync ?? profileProviderService.sync ?? null,
        externalState: profileProviderAdoption.externalState ?? profileProviderService.externalState ?? null
      }
    },
    {
      component: 'import_provider_adoption',
      status: importProviderAdoption.status ?? importProviderContract.status ?? 'ready',
      restartSafe: importProviderAdoption.restartSafe !== false && importProviderContract.restartSafe !== false,
      nextAction: importProviderAdoption.readiness?.nextAction ?? null,
      evidence: {
        missingCapabilities: importMissing,
        changedProviders: importProviderAdoption.syncMetadata?.changedProviders ?? [],
        unsafeSpecifiers: importProviderContract.externalHandoff?.unsafeSpecifiers ?? []
      }
    },
    {
      component: 'import_provider_readiness',
      status: importProviderReadiness.status ?? importProviderContract.status ?? 'ready',
      restartSafe: importProviderReadiness.restartSafe !== false && importProviderContract.restartSafe !== false,
      nextAction: importProviderReadiness.readiness?.nextAction ?? importProviderReadiness.handoff?.nextAction ?? null,
      evidence: {
        missingCapabilities: readinessMissing,
        unsafeHandoffs: importProviderReadiness.exportSummary?.unsafeHandoffs ?? [],
        pendingSyncs: importProviderReadiness.exportSummary?.pendingSyncs ?? []
      }
    },
    {
      component: 'import_runtime_adoption',
      status: importRuntimeAdoption.status ?? 'ready',
      restartSafe: importRuntimeAdoption.restartSafe !== false,
      nextAction: importRuntimeAdoption.readiness?.nextAction ?? importRuntimeAdoption.handoff?.nextAction ?? null,
      evidence: importRuntimeAdoption.exportSummary ?? null
    },
    {
      component: 'provider_preview',
      status: providerGatePreview.status ?? 'ready',
      restartSafe: providerGatePreview.restartSafe !== false,
      nextAction: providerGatePreview.readiness?.nextAction ?? providerGatePreview.exportSummary?.nextAction ?? null,
      evidence: providerGatePreview.exportSummary ?? null
    },
    {
      component: 'profile_activation',
      status: profileActivation.status ?? 'ready',
      restartSafe: profileActivation.restartSafe !== false,
      nextAction: profileActivation.readiness?.nextAction ?? profileActivation.handoff?.nextAction ?? null,
      evidence: profileActivation.exportSummary ?? null
    },
    {
      component: 'status_channel_alignment',
      status: channelMismatch ? 'blocked' : profileChannel ? 'ready' : 'degraded',
      restartSafe: channelMismatch !== true && profileChannel === 'kernel.status.mailchimp',
      nextAction: channelMismatch
        ? 'align_mailchimp_provider_status_channels'
        : profileChannel === 'kernel.status.mailchimp'
          ? 'publish_provider_channel_alignment'
          : 'route_provider_status_to_kernel',
      evidence: {
        profileChannel,
        importChannels: unique(importChannels)
      }
    }
  ];
  const blockedRows = rows.filter((row) => row.status === 'blocked' || row.status === 'operator_review');
  const degradedRows = rows.filter((row) => (
    row.status === 'degraded'
    || row.status === 'recovering'
    || row.status === 'disabled'
    || row.status === 'paused'
    || row.status === 'retry_scheduled'
    || row.restartSafe === false
  ));
  const diagnostics = [
    ...profileMissing.map((capability) => ({
      level: 'error',
      code: 'module_provider_profile_capability_missing',
      subject: capability
    })),
    ...importMissing.map((capability) => ({
      level: 'error',
      code: 'module_provider_import_capability_missing',
      subject: capability
    })),
    ...readinessMissing.map((capability) => ({
      level: 'error',
      code: 'module_provider_readiness_capability_missing',
      subject: capability
    })),
    ...(channelMismatch ? [{
      level: 'error',
      code: 'module_provider_status_channel_mismatch',
      subject: `${profileChannel}->${unique(importChannels).join(',')}`
    }] : []),
    ...(syncChanged ? [{
      level: 'warning',
      code: 'module_provider_sync_delta_pending',
      subject: operation
    }] : [])
  ];
  const status = diagnostics.some((item) => item.level === 'error') || blockedRows.length > 0
    ? 'blocked'
    : diagnostics.some((item) => item.level === 'warning') || degradedRows.length > 0
      ? 'degraded'
      : 'ready';
  const fingerprint = moduleProviderAdoptionFingerprint({
    operation,
    status,
    rows,
    profileMissing,
    importMissing,
    readinessMissing,
    syncChanged
  });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = previous.sequence + (changed ? 1 : 0);
  const nextAction = status === 'blocked'
    ? 'resolve_module_provider_adoption_blockers'
    : importRuntimeAdoption.lifecycle?.status === 'retry_scheduled'
      ? 'dispatch_import_runtime_retry'
      : status === 'degraded'
        ? 'publish_module_provider_adoption_degraded_status'
        : changed
          ? 'publish_module_provider_adoption_delta'
          : 'reuse_module_provider_adoption';

  return {
    ok: status !== 'blocked',
    schemaVersion: MODULE_SYNTAX_SCHEMA_VERSION,
    operation,
    status,
    restartSafe: status === 'ready' && rows.every((row) => row.restartSafe !== false),
    sequence,
    fingerprint,
    changed,
    generatedAt: clean(now) || null,
    rows,
    sync: {
      changed: syncChanged,
      profileCursor: profileProviderAdoption.sync?.cursor ?? null,
      changedImportProviders: importProviderAdoption.syncMetadata?.changedProviders ?? []
    },
    readiness: {
      blockingReasons: unique([
        ...blockedRows.map((row) => row.component),
        ...profileMissing.map((capability) => `profile_missing:${capability}`),
        ...importMissing.map((capability) => `import_missing:${capability}`),
        ...readinessMissing.map((capability) => `readiness_missing:${capability}`)
      ]),
      degradedReasons: unique([
        ...degradedRows.map((row) => row.component),
        ...(syncChanged ? ['sync_delta_pending'] : [])
      ]),
      nextAction
    },
    handoff: {
      target: 'kernel.status.mailchimp.provider-adoption',
      statusChannel: profileChannel === 'kernel.status.mailchimp' && channelMismatch !== true
        ? 'kernel.status.mailchimp'
        : 'local.status.provider-adoption',
      publish: changed || status !== 'ready',
      severity: status === 'blocked' ? 'error' : status === 'degraded' ? 'warning' : 'info',
      includeRows: true,
      includeSyncDeltas: syncChanged,
      nextAction
    },
    exportSummary: {
      schemaVersion: MODULE_SYNTAX_SCHEMA_VERSION,
      title: 'mailchimp_module_provider_adoption',
      operation,
      status,
      restartSafe: status === 'ready' && rows.every((row) => row.restartSafe !== false),
      sequence,
      fingerprint,
      changed,
      blockedComponents: blockedRows.map((row) => row.component),
      degradedComponents: degradedRows.map((row) => row.component),
      profileMissingCapabilities: profileMissing,
      importMissingCapabilities: importMissing,
      importReadinessMissingCapabilities: readinessMissing,
      syncChanged,
      nextAction
    },
    diagnostics
  };
}

export function buildModuleClientControlRoomContract({
  operation = 'campaign.sync',
  profileLifecycleClientControls = {},
  featureProviderControls = {},
  importRuntimeClientControls = {},
  previousControlRoom = {},
  now = null,
  historyLimit = 12
} = {}) {
  const previous = normalizeModuleClientControlRoom(previousControlRoom);
  const rows = [
    moduleClientControlRoomRow('profile_lifecycle_controls', 'profile', profileLifecycleClientControls, true, {
      status: profileLifecycleClientControls.status ?? profileLifecycleClientControls.exportSummary?.status,
      restartSafe: profileLifecycleClientControls.restartSafe ?? profileLifecycleClientControls.exportSummary?.restartSafe,
      statusChannel: profileLifecycleClientControls.handoff?.statusChannel,
      nextAction: profileLifecycleClientControls.handoff?.nextAction ?? profileLifecycleClientControls.exportSummary?.nextAction,
      evidence: {
        visibleRows: profileLifecycleClientControls.exportSummary?.visibleRows ?? [],
        blockedRows: profileLifecycleClientControls.exportSummary?.blockedRows ?? [],
        guardedRows: profileLifecycleClientControls.exportSummary?.guardedRows ?? [],
        availableCommands: profileLifecycleClientControls.exportSummary?.availableCommands ?? [],
        fingerprint: profileLifecycleClientControls.fingerprint ?? profileLifecycleClientControls.exportSummary?.fingerprint
      }
    }),
    moduleClientControlRoomRow('feature_provider_controls', 'feature_gates', featureProviderControls, true, {
      status: featureProviderControls.status ?? featureProviderControls.exportSummary?.status,
      restartSafe: featureProviderControls.restartSafe ?? featureProviderControls.exportSummary?.restartSafe,
      statusChannel: featureProviderControls.handoff?.statusChannel,
      nextAction: featureProviderControls.handoff?.nextAction ?? featureProviderControls.exportSummary?.nextAction,
      evidence: {
        visibleRows: featureProviderControls.exportSummary?.visibleRows ?? [],
        blockedRows: featureProviderControls.exportSummary?.blockedRows ?? [],
        guardedRows: featureProviderControls.exportSummary?.guardedRows ?? [],
        deniedEffects: featureProviderControls.exportSummary?.deniedEffects ?? [],
        fingerprint: featureProviderControls.fingerprint ?? featureProviderControls.exportSummary?.fingerprint
      }
    }),
    moduleClientControlRoomRow('import_runtime_controls', 'imports', importRuntimeClientControls, true, {
      status: importRuntimeClientControls.status ?? importRuntimeClientControls.exportSummary?.status,
      restartSafe: importRuntimeClientControls.restartSafe ?? importRuntimeClientControls.exportSummary?.restartSafe,
      statusChannel: importRuntimeClientControls.handoff?.statusChannel,
      nextAction: importRuntimeClientControls.handoff?.nextAction ?? importRuntimeClientControls.exportSummary?.nextAction,
      evidence: {
        visibleRows: importRuntimeClientControls.exportSummary?.visibleRows ?? [],
        blockedRows: importRuntimeClientControls.exportSummary?.blockedRows ?? [],
        guardedRows: importRuntimeClientControls.exportSummary?.guardedRows ?? [],
        fingerprint: importRuntimeClientControls.fingerprint ?? importRuntimeClientControls.exportSummary?.fingerprint
      }
    })
  ];
  const blockedRows = rows.filter((row) => row.status === 'blocked');
  const guardedRows = rows.filter((row) => row.status === 'guarded');
  const visibleRows = rows.filter((row) => row.clientVisible);
  const diagnostics = [
    ...(profileLifecycleClientControls.diagnostics ?? []).filter((item) => item.level === 'error'),
    ...(featureProviderControls.diagnostics ?? []).filter((item) => item.level === 'error'),
    ...(importRuntimeClientControls.diagnostics ?? []).filter((item) => item.level === 'error')
  ];
  const status = blockedRows.length > 0 || diagnostics.some((item) => item.level === 'error')
    ? 'blocked'
    : guardedRows.length > 0 || diagnostics.some((item) => item.level === 'warning')
      ? 'guarded'
      : 'ready';
  const fingerprint = moduleClientControlRoomFingerprint({ operation, status, rows });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = previous.sequence + (changed ? 1 : 0);
  const event = {
    sequence,
    timestamp: clean(now) || null,
    operation,
    status,
    fingerprint,
    visibleRows: visibleRows.length,
    blockedRows: blockedRows.length,
    guardedRows: guardedRows.length
  };
  const timeline = [
    ...previous.timeline,
    ...(changed || previous.timeline.length === 0 ? [event] : [])
  ].slice(-toPositiveInteger(historyLimit, 12));
  const nextAction = status === 'blocked'
    ? 'resolve_module_client_control_room_blockers'
    : status === 'guarded'
      ? 'publish_module_client_control_room_guarded'
      : changed
        ? 'publish_module_client_control_room_ready'
        : 'reuse_module_client_control_room';

  return {
    ok: status !== 'blocked',
    schemaVersion: MODULE_SYNTAX_SCHEMA_VERSION,
    title: 'mailchimp_module_client_control_room',
    operation,
    status,
    restartSafe: status === 'ready' && rows.every((row) => row.restartSafe === true),
    sequence,
    fingerprint,
    changed,
    rows,
    validationSummary: {
      totalRows: rows.length,
      visibleRows: visibleRows.length,
      blockedRows: blockedRows.length,
      guardedRows: guardedRows.length,
      diagnosticErrors: diagnostics.filter((item) => item.level === 'error').length,
      diagnosticWarnings: diagnostics.filter((item) => item.level === 'warning').length
    },
    history: {
      sequence,
      timeline,
      statusCounts: timeline.reduce((counts, item) => {
        counts[item.status] = (counts[item.status] ?? 0) + 1;
        return counts;
      }, {})
    },
    handoff: {
      target: 'mailchimp.client.workflow.module-control-room',
      statusChannel: status === 'ready' ? 'kernel.status.mailchimp' : 'local.status.module-client-control-room',
      publish: status !== 'ready' || changed || visibleRows.length > 0,
      severity: status === 'blocked' ? 'error' : status === 'guarded' ? 'warning' : 'info',
      includeRows: visibleRows.length > 0,
      nextAction
    },
    exportSummary: {
      schemaVersion: MODULE_SYNTAX_SCHEMA_VERSION,
      title: 'mailchimp_module_client_control_room',
      operation,
      status,
      restartSafe: status === 'ready' && rows.every((row) => row.restartSafe === true),
      sequence,
      fingerprint,
      changed,
      visibleRows: visibleRows.map((row) => row.id).sort(),
      blockedRows: blockedRows.map((row) => row.id).sort(),
      guardedRows: guardedRows.map((row) => row.id).sort(),
      nextAction
    },
    diagnostics
  };
}

export function buildModuleWorkflowNextActionDigest({
  operation = 'campaign.sync',
  profileLifecycleNextAction = {},
  featureProviderHandoff = {},
  importRuntimeHandoff = {},
  previousDigest = {},
  now = null,
  historyLimit = 12
} = {}) {
  const previous = normalizeModuleWorkflowNextAction(previousDigest);
  const rows = [
    moduleWorkflowNextActionRow('profile_lifecycle', 'profile', profileLifecycleNextAction, true, {
      status: profileLifecycleNextAction.status ?? profileLifecycleNextAction.exportSummary?.status,
      restartSafe: profileLifecycleNextAction.restartSafe ?? profileLifecycleNextAction.exportSummary?.restartSafe,
      nextAction: profileLifecycleNextAction.handoff?.nextAction ?? profileLifecycleNextAction.exportSummary?.nextAction,
      statusChannel: profileLifecycleNextAction.handoff?.statusChannel,
      evidence: {
        blockedRows: profileLifecycleNextAction.exportSummary?.blockedRows ?? [],
        guardedRows: profileLifecycleNextAction.exportSummary?.guardedRows ?? [],
        validationSummary: profileLifecycleNextAction.validationSummary ?? null,
        fingerprint: profileLifecycleNextAction.fingerprint ?? profileLifecycleNextAction.exportSummary?.fingerprint
      }
    }),
    moduleWorkflowNextActionRow('feature_provider_handoff', 'feature_gates', featureProviderHandoff, true, {
      status: featureProviderHandoff.status ?? featureProviderHandoff.exportSummary?.status,
      restartSafe: featureProviderHandoff.restartSafe ?? featureProviderHandoff.exportSummary?.restartSafe,
      nextAction: featureProviderHandoff.handoff?.nextAction ?? featureProviderHandoff.exportSummary?.nextAction,
      statusChannel: featureProviderHandoff.handoff?.statusChannel,
      evidence: {
        blockedRows: featureProviderHandoff.exportSummary?.blockedRows ?? [],
        guardedRows: featureProviderHandoff.exportSummary?.guardedRows ?? [],
        deniedEffects: featureProviderHandoff.exportSummary?.deniedEffects ?? [],
        validationSummary: featureProviderHandoff.validationSummary ?? null,
        fingerprint: featureProviderHandoff.fingerprint ?? featureProviderHandoff.exportSummary?.fingerprint
      }
    }),
    moduleWorkflowNextActionRow('import_runtime_handoff', 'imports', importRuntimeHandoff, true, {
      status: importRuntimeHandoff.status ?? importRuntimeHandoff.exportSummary?.status,
      restartSafe: importRuntimeHandoff.restartSafe ?? importRuntimeHandoff.exportSummary?.restartSafe,
      nextAction: importRuntimeHandoff.handoff?.nextAction ?? importRuntimeHandoff.exportSummary?.nextAction,
      statusChannel: importRuntimeHandoff.handoff?.statusChannel,
      evidence: {
        blockedRows: importRuntimeHandoff.exportSummary?.blockedRows ?? [],
        guardedRows: importRuntimeHandoff.exportSummary?.guardedRows ?? [],
        validationSummary: importRuntimeHandoff.validationSummary ?? null,
        fingerprint: importRuntimeHandoff.fingerprint ?? importRuntimeHandoff.exportSummary?.fingerprint
      }
    })
  ];
  const blockedRows = rows.filter((row) => row.status === 'blocked');
  const guardedRows = rows.filter((row) => row.status === 'guarded' || row.status === 'degraded');
  const diagnostics = [
    ...(profileLifecycleNextAction.diagnostics ?? []).filter((item) => item.level === 'error'),
    ...(featureProviderHandoff.diagnostics ?? []).filter((item) => item.level === 'error'),
    ...(importRuntimeHandoff.diagnostics ?? []).filter((item) => item.level === 'error'),
    ...blockedRows.map((row) => ({
      level: 'error',
      code: 'module_workflow_next_action_blocked',
      subject: row.id
    })),
    ...guardedRows.map((row) => ({
      level: 'warning',
      code: 'module_workflow_next_action_guarded',
      subject: row.id
    }))
  ];
  const status = blockedRows.length > 0 || diagnostics.some((item) => item.level === 'error')
    ? 'blocked'
    : guardedRows.length > 0 || diagnostics.some((item) => item.level === 'warning')
      ? 'guarded'
      : 'ready';
  const fingerprint = moduleWorkflowNextActionFingerprint({ operation, status, rows });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = previous.sequence + (changed ? 1 : 0);
  const nextAction = status === 'blocked'
    ? 'resolve_module_workflow_next_action_blockers'
    : status === 'guarded'
      ? 'publish_module_workflow_next_action_guarded'
      : changed
        ? 'publish_module_workflow_next_action_ready'
        : 'reuse_module_workflow_next_action';

  return {
    ok: status !== 'blocked',
    schemaVersion: MODULE_SYNTAX_SCHEMA_VERSION,
    title: 'mailchimp_module_workflow_next_action',
    operation,
    status,
    restartSafe: status === 'ready' && rows.every((row) => row.restartSafe !== false),
    sequence,
    fingerprint,
    changed,
    rows,
    validationSummary: {
      totalRows: rows.length,
      blockedRows: blockedRows.length,
      guardedRows: guardedRows.length,
      publishRows: rows.filter((row) => row.publish).length,
      diagnosticErrors: diagnostics.filter((item) => item.level === 'error').length,
      diagnosticWarnings: diagnostics.filter((item) => item.level === 'warning').length
    },
    history: {
      sequence,
      timeline: [
        ...previous.timeline,
        ...(changed || previous.timeline.length === 0 ? [{
          sequence,
          timestamp: clean(now) || null,
          operation,
          status,
          fingerprint,
          blockedRows: blockedRows.map((row) => row.id),
          guardedRows: guardedRows.map((row) => row.id)
        }] : [])
      ].slice(-toNonNegativeInteger(historyLimit, 12))
    },
    handoff: {
      target: 'kernel.status.mailchimp.module-workflow-next-action',
      statusChannel: status === 'ready' ? 'kernel.status.mailchimp' : 'local.status.module-workflow-next-action',
      publish: changed || status !== 'ready' || rows.some((row) => row.publish),
      severity: status === 'blocked' ? 'error' : status === 'guarded' ? 'warning' : 'info',
      includeRows: true,
      nextAction
    },
    readiness: {
      blockingReasons: blockedRows.map((row) => row.id).sort(),
      guardedReasons: guardedRows.map((row) => row.id).sort(),
      nextAction
    },
    exportSummary: {
      schemaVersion: MODULE_SYNTAX_SCHEMA_VERSION,
      title: 'mailchimp_module_workflow_next_action',
      operation,
      status,
      restartSafe: status === 'ready' && rows.every((row) => row.restartSafe !== false),
      sequence,
      fingerprint,
      changed,
      blockedRows: blockedRows.map((row) => row.id).sort(),
      guardedRows: guardedRows.map((row) => row.id).sort(),
      nextAction
    },
    diagnostics
  };
}

export function buildModuleBoundaryOperationsPacket({
  operation = 'campaign.sync',
  profileBoundaryIntent = {},
  featureOperationalControls = {},
  importLifecycleCommandSurface = {},
  moduleLaunchGate = {},
  moduleClientLaunchReadiness = {},
  previousPacket = {},
  now = null,
  historyLimit = 12
} = {}) {
  const previous = normalizeModuleBoundaryOperationsPacket(previousPacket);
  const rows = [
    moduleBoundaryOperationsRow('profile_boundary_intent', profileBoundaryIntent, true, {
      source: 'profile',
      statusChannel: profileBoundaryIntent.handoff?.statusChannel,
      nextAction: profileBoundaryIntent.handoff?.nextAction ?? profileBoundaryIntent.exportSummary?.nextAction,
      counters: profileBoundaryIntent.validationSummary
    }),
    moduleBoundaryOperationsRow('feature_gate_controls', featureOperationalControls, true, {
      source: 'feature_gates',
      statusChannel: featureOperationalControls.handoff?.statusChannel,
      nextAction: featureOperationalControls.handoff?.nextAction ?? featureOperationalControls.exportSummary?.nextAction,
      counters: featureOperationalControls.validationSummary
    }),
    moduleBoundaryOperationsRow('import_lifecycle_controls', importLifecycleCommandSurface, true, {
      source: 'imports',
      statusChannel: importLifecycleCommandSurface.handoff?.statusChannel,
      nextAction: importLifecycleCommandSurface.handoff?.nextAction ?? importLifecycleCommandSurface.exportSummary?.nextAction,
      counters: importLifecycleCommandSurface.validationSummary
    }),
    moduleBoundaryOperationsRow('module_launch_gate', moduleLaunchGate, true, {
      source: 'module',
      statusChannel: moduleLaunchGate.handoff?.statusChannel,
      nextAction: moduleLaunchGate.handoff?.nextAction ?? moduleLaunchGate.exportSummary?.nextAction,
      counters: moduleLaunchGate.validationSummary ?? moduleLaunchGate.counters
    }),
    moduleBoundaryOperationsRow('client_launch_readiness', moduleClientLaunchReadiness, false, {
      source: 'client',
      statusChannel: moduleClientLaunchReadiness.handoff?.statusChannel,
      nextAction: moduleClientLaunchReadiness.handoff?.nextAction ?? moduleClientLaunchReadiness.exportSummary?.nextAction,
      counters: moduleClientLaunchReadiness.validationSummary ?? moduleClientLaunchReadiness.counters
    })
  ];
  const blockedRows = rows.filter((row) => row.required && row.status === 'blocked');
  const guardedRows = rows.filter((row) => row.status === 'guarded' || row.restartSafe === false);
  const diagnostics = [
    ...(profileBoundaryIntent.diagnostics ?? []).filter((item) => item.level === 'error'),
    ...(featureOperationalControls.diagnostics ?? []).filter((item) => item.level === 'error'),
    ...(importLifecycleCommandSurface.diagnostics ?? []).filter((item) => item.level === 'error'),
    ...(moduleLaunchGate.diagnostics ?? []).filter((item) => item.level === 'error'),
    ...blockedRows.map((row) => ({ level: 'error', code: 'module_boundary_operations_blocked', subject: row.id })),
    ...guardedRows.map((row) => ({ level: 'warning', code: 'module_boundary_operations_guarded', subject: row.id }))
  ];
  const status = diagnostics.some((item) => item.level === 'error') || blockedRows.length > 0
    ? 'blocked'
    : diagnostics.some((item) => item.level === 'warning') || guardedRows.length > 0
      ? 'guarded'
      : 'ready';
  const fingerprint = moduleBoundaryOperationsFingerprint({ operation, status, rows });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = previous.sequence + (changed ? 1 : 0);
  const event = {
    sequence,
    timestamp: clean(now) || null,
    operation,
    status,
    fingerprint,
    blockedRows: blockedRows.length,
    guardedRows: guardedRows.length,
    restartSafe: status === 'ready' && rows.every((row) => row.restartSafe === true),
    changed
  };
  const timeline = [
    ...previous.timeline,
    ...(changed || previous.timeline.length === 0 ? [event] : [])
  ].slice(-toPositiveInteger(historyLimit, 12));
  const statusCounts = timeline.reduce((counts, item) => {
    counts[item.status] = (counts[item.status] ?? 0) + 1;
    return counts;
  }, {});
  const nextAction = status === 'blocked'
    ? 'resolve_module_boundary_operations'
    : status === 'guarded'
      ? 'publish_module_boundary_operations_guarded'
      : changed
        ? 'publish_module_boundary_operations_ready'
        : 'reuse_module_boundary_operations';

  return {
    ok: status !== 'blocked',
    schemaVersion: MODULE_SYNTAX_SCHEMA_VERSION,
    title: 'mailchimp_module_boundary_operations_packet',
    operation,
    status,
    restartSafe: status === 'ready' && rows.every((row) => row.restartSafe === true),
    sequence,
    fingerprint,
    changed,
    rows,
    counters: {
      rows: rows.length,
      requiredRows: rows.filter((row) => row.required).length,
      blockedRows: blockedRows.length,
      guardedRows: guardedRows.length,
      restartGuardedRows: rows.filter((row) => row.restartSafe !== true).length,
      diagnosticErrors: diagnostics.filter((item) => item.level === 'error').length,
      diagnosticWarnings: diagnostics.filter((item) => item.level === 'warning').length
    },
    history: {
      sequence,
      timeline,
      statusCounts
    },
    readiness: {
      blockingReasons: unique(blockedRows.map((row) => row.id)),
      guardedReasons: unique(guardedRows.map((row) => row.id)),
      nextAction
    },
    handoff: {
      target: 'kernel.status.mailchimp.module-boundary-operations',
      statusChannel: status === 'ready' ? 'kernel.status.mailchimp' : 'local.status.module-boundary-operations',
      publish: changed || status !== 'ready',
      severity: status === 'blocked' ? 'error' : status === 'guarded' ? 'warning' : 'info',
      includeRows: true,
      nextAction
    },
    exportSummary: {
      schemaVersion: MODULE_SYNTAX_SCHEMA_VERSION,
      title: 'mailchimp_module_boundary_operations_packet',
      operation,
      status,
      restartSafe: status === 'ready' && rows.every((row) => row.restartSafe === true),
      sequence,
      fingerprint,
      changed,
      blockedRows: blockedRows.map((row) => row.id),
      guardedRows: guardedRows.map((row) => row.id),
      nextAction
    },
    diagnostics
  };
}

export function buildModuleOperationalStatus({
  profilePersistence = {},
  profileFailure = {},
  profileLifecycle = {},
  gateState = {},
  gateAnalytics = {},
  featureLifecycleReadiness = {},
  importHealth = {},
  importAnalytics = {},
  importHistoryExport = {},
  importTimelineReport = {},
  importLifecycle = {},
  importPreviewAcceptance = {},
  importBoundaryAcceptance = {},
  importProviderContract = {},
  importProviderReadiness = {},
  importProviderAdoption = {},
  importRuntimeAdoption = {},
  profileProviderService = {},
  profileProviderAdoption = {},
  providerAdoption = {},
  profileRuntimeAdoption = {},
  profileRestartRecovery = {},
  profileRestartStatusLedger = {},
  profileRestartReplayDecision = {},
  providerGatePreview = {},
  profileExport = {},
  profilePreviewAcceptance = {},
  profileBoundaryEvidence = {},
  profilePrimaryPack = {},
  profileActivation = {},
  profileLifecycleSettingsControls = {},
  featureBoundaryControls = {},
  importGateLifecycle = {},
  boundary = {},
  runtime = {},
  diagnostics = []
} = {}) {
  const profileStatus = profilePersistence.envelope?.status ?? (profilePersistence.ok === false ? 'blocked' : 'ready');
  const profileFailureStatus = profileFailure.status ?? 'ready';
  const profileLifecycleStatus = profileLifecycle.status ?? 'enabled';
  const gateStatus = gateState.status ?? 'ready';
  const importStatus = importHealth.status ?? 'healthy';
  const importHistoryStatus = importHistoryExport.status ?? 'healthy';
  const importTimelineStatus = importTimelineReport.status ?? 'ready';
  const lifecycleStatus = importLifecycle.status ?? 'enabled';
  const previewStatus = importPreviewAcceptance.status ?? 'ready';
  const importBoundaryStatus = importBoundaryAcceptance.status ?? 'ready';
  const providerStatus = importProviderContract.status ?? 'ready';
  const importProviderReadinessStatus = importProviderReadiness.status ?? 'ready';
  const importProviderAdoptionStatus = importProviderAdoption.status ?? 'ready';
  const importRuntimeAdoptionStatus = importRuntimeAdoption.status ?? 'ready';
  const profileProviderStatus = profileProviderService.status ?? 'ready';
  const profileProviderAdoptionStatus = profileProviderAdoption.status ?? 'ready';
  const providerAdoptionStatus = providerAdoption.status ?? 'ready';
  const profileRuntimeAdoptionStatus = profileRuntimeAdoption.status ?? 'ready';
  const profileRestartRecoveryStatus = profileRestartRecovery.status ?? 'ready';
  const profileRestartStatusLedgerStatus = profileRestartStatusLedger.status ?? 'ready';
  const profileRestartReplayDecisionStatus = profileRestartReplayDecision.status ?? 'ready';
  const profileActivationStatus = profileActivation.status ?? 'ready';
  const profileLifecycleSettingsControlStatus = profileLifecycleSettingsControls.status ?? 'ready';
  const providerPreviewStatus = providerGatePreview.status ?? 'ready';
  const profileExportStatus = profileExport.readiness?.status ?? profileExport.exportSummary?.status ?? 'ready';
  const profilePreviewStatus = profilePreviewAcceptance.status ?? 'ready';
  const profileBoundaryEvidenceStatus = profileBoundaryEvidence.status ?? 'ready';
  const profilePrimaryPackStatus = profilePrimaryPack.status ?? 'ready';
  const featureBoundaryStatus = featureBoundaryControls.status ?? 'ready';
  const featureLifecycleReadinessStatus = featureLifecycleReadiness.status ?? 'ready';
  const importGateLifecycleStatus = importGateLifecycle.status ?? 'ready';
  const boundaryStatus = boundary.contract?.status ?? 'ready';
  const blockingReasons = [
    ...(profileStatus === 'blocked' ? ['profile_persistence'] : []),
    ...(profileFailureStatus === 'blocked' ? ['profile_failure_state'] : []),
    ...(profileLifecycleStatus === 'blocked' || profileLifecycleStatus === 'operator_review' ? ['profile_lifecycle'] : []),
    ...(profileExportStatus === 'blocked' ? ['profile_export'] : []),
    ...(gateStatus === 'blocked' ? ['feature_gates'] : []),
    ...(importStatus === 'blocked' ? ['imports'] : []),
    ...(importHistoryStatus === 'blocked' ? ['import_history_export'] : []),
    ...(importTimelineStatus === 'blocked' ? ['import_timeline_report'] : []),
    ...(lifecycleStatus === 'blocked' ? ['import_lifecycle'] : []),
    ...(previewStatus === 'blocked' ? ['import_preview_acceptance'] : []),
    ...(importBoundaryStatus === 'blocked' ? ['import_boundary_acceptance'] : []),
    ...(providerStatus === 'blocked' ? ['import_provider_contract'] : []),
    ...(importProviderReadinessStatus === 'blocked' ? ['import_provider_readiness'] : []),
    ...(importProviderAdoptionStatus === 'blocked' ? ['import_provider_adoption'] : []),
    ...(importRuntimeAdoptionStatus === 'blocked' ? ['import_runtime_adoption'] : []),
    ...(profileProviderStatus === 'blocked' ? ['profile_provider_service'] : []),
    ...(profileProviderAdoptionStatus === 'blocked' ? ['profile_provider_adoption'] : []),
    ...(providerAdoptionStatus === 'blocked' ? ['module_provider_adoption'] : []),
    ...(profileRuntimeAdoptionStatus === 'blocked' ? ['profile_runtime_adoption'] : []),
    ...(profileRestartRecoveryStatus === 'blocked' ? ['profile_restart_recovery'] : []),
    ...(profileRestartStatusLedgerStatus === 'blocked' ? ['profile_restart_status_ledger'] : []),
    ...(profileRestartReplayDecisionStatus === 'blocked' ? ['profile_restart_replay_decision'] : []),
    ...(profileActivationStatus === 'blocked' ? ['profile_activation'] : []),
    ...(profileLifecycleSettingsControlStatus === 'blocked' ? ['profile_lifecycle_settings_controls'] : []),
    ...(providerPreviewStatus === 'blocked' ? ['provider_gate_preview'] : []),
    ...(boundaryStatus === 'blocked' ? ['module_boundary'] : []),
    ...(profilePreviewStatus === 'blocked' ? ['profile_preview_acceptance'] : []),
    ...(profileBoundaryEvidenceStatus === 'blocked' ? ['profile_boundary_evidence'] : []),
    ...(profilePrimaryPackStatus === 'blocked' ? ['profile_primary_pack'] : []),
    ...(featureBoundaryStatus === 'blocked' ? ['feature_boundary_controls'] : []),
    ...(featureLifecycleReadinessStatus === 'blocked' ? ['feature_lifecycle_readiness'] : []),
    ...(importGateLifecycleStatus === 'blocked' ? ['import_gate_lifecycle'] : []),
    ...diagnostics.filter((item) => item.level === 'error').map((item) => item.code)
  ];
  const degradedReasons = [
    ...(profileStatus === 'recovering' ? ['profile_recovery'] : []),
    ...(profileFailureStatus === 'degraded' ? ['profile_failure_state'] : []),
    ...(['disabled', 'paused', 'retry_scheduled', 'enabled_degraded', 'status_acknowledged'].includes(profileLifecycleStatus)
      ? [`profile_lifecycle:${profileLifecycleStatus}`]
      : []),
    ...(profileExportStatus === 'degraded' ? ['profile_export'] : []),
    ...(gateStatus === 'degraded' ? ['feature_gates'] : []),
    ...(gateAnalytics.report?.riskLevel === 'medium' ? ['feature_gate_analytics'] : []),
    ...(importStatus === 'degraded' ? ['imports'] : []),
    ...(importHistoryStatus === 'degraded' ? ['import_history_export'] : []),
    ...(importTimelineStatus === 'degraded' ? ['import_timeline_report'] : []),
    ...(['disabled', 'paused', 'retry_scheduled', 'enabled_degraded'].includes(lifecycleStatus)
      ? [`import_lifecycle:${lifecycleStatus}`]
      : []),
    ...(previewStatus === 'degraded' ? ['import_preview_acceptance'] : []),
    ...(importBoundaryStatus === 'degraded' ? ['import_boundary_acceptance'] : []),
    ...(providerStatus === 'degraded' ? ['import_provider_contract'] : []),
    ...(importProviderReadinessStatus === 'degraded' ? ['import_provider_readiness'] : []),
    ...(importProviderAdoptionStatus === 'degraded' ? ['import_provider_adoption'] : []),
    ...(importRuntimeAdoptionStatus === 'degraded' ? ['import_runtime_adoption'] : []),
    ...(profileProviderStatus === 'degraded' ? ['profile_provider_service'] : []),
    ...(profileProviderAdoptionStatus === 'degraded' ? ['profile_provider_adoption'] : []),
    ...(providerAdoptionStatus === 'degraded' ? ['module_provider_adoption'] : []),
    ...(profileRuntimeAdoptionStatus === 'degraded' ? ['profile_runtime_adoption'] : []),
    ...(profileRestartRecoveryStatus === 'degraded' ? ['profile_restart_recovery'] : []),
    ...(profileRestartStatusLedgerStatus === 'degraded' ? ['profile_restart_status_ledger'] : []),
    ...(['degraded', 'guarded'].includes(profileRestartReplayDecisionStatus) ? ['profile_restart_replay_decision'] : []),
    ...(profileActivationStatus === 'degraded' ? ['profile_activation'] : []),
    ...(profileLifecycleSettingsControlStatus === 'degraded' ? ['profile_lifecycle_settings_controls'] : []),
    ...(providerPreviewStatus === 'degraded' ? ['provider_gate_preview'] : []),
    ...(boundaryStatus === 'degraded' ? ['module_boundary'] : []),
    ...(profilePreviewStatus === 'degraded' ? ['profile_preview_acceptance'] : []),
    ...(profileBoundaryEvidenceStatus === 'degraded' ? ['profile_boundary_evidence'] : []),
    ...(profilePrimaryPackStatus === 'degraded' ? ['profile_primary_pack'] : []),
    ...(featureBoundaryStatus === 'degraded' ? ['feature_boundary_controls'] : []),
    ...(featureLifecycleReadinessStatus === 'degraded' ? ['feature_lifecycle_readiness'] : []),
    ...(importGateLifecycleStatus === 'degraded' ? ['import_gate_lifecycle'] : []),
    ...diagnostics.filter((item) => item.level === 'warning').map((item) => item.code)
  ];
  const status = blockingReasons.length > 0
    ? 'blocked'
    : degradedReasons.length > 0
      ? 'degraded'
      : 'ready';
  const restartSafe = status === 'ready'
    && runtime.ok === true
    && profilePersistence.envelope?.restartSafe !== false
    && profileFailure.restartSafe !== false
    && profileLifecycle.ok !== false
    && profileExport.readiness?.restartSafe !== false
    && gateState.restartSafe === true
    && importHealth.restartSafe === true
    && importHistoryExport.restartSafe !== false
    && importTimelineReport.restartSafe !== false
    && importLifecycle.ok !== false
    && importPreviewAcceptance.exportSummary?.restartSafe !== false
    && importBoundaryAcceptance.restartSafe !== false
    && importProviderContract.restartSafe !== false
    && importProviderReadiness.restartSafe !== false
    && importProviderAdoption.restartSafe !== false
    && importRuntimeAdoption.restartSafe !== false
    && profileProviderService.restartSafe !== false
    && profileProviderAdoption.restartSafe !== false
    && providerAdoption.restartSafe !== false
    && profileRuntimeAdoption.restartSafe !== false
    && profileRestartRecovery.restartSafe !== false
    && profileRestartStatusLedger.restartSafe !== false
    && profileRestartReplayDecision.restartSafe !== false
    && profileActivation.restartSafe !== false
    && profileLifecycleSettingsControls.restartSafe !== false
    && profilePreviewAcceptance.restartSafe !== false
    && profileBoundaryEvidence.restartSafe !== false
    && profilePrimaryPack.restartSafe !== false
    && featureBoundaryControls.restartSafe !== false
    && featureLifecycleReadiness.restartSafe !== false
    && importGateLifecycle.restartSafe !== false
    && providerGatePreview.restartSafe !== false
    && profileLifecycleStatus === 'enabled'
    && lifecycleStatus === 'enabled'
    && boundary.contract?.crossTenantSafe === true;

  return {
    schemaVersion: MODULE_SYNTAX_SCHEMA_VERSION,
    status,
    restartSafe,
    resumeAction: status === 'blocked'
      ? 'operator_review'
      : status === 'degraded'
        ? 'resume_with_degraded_guards'
        : 'resume',
    components: {
      profile: profileStatus,
      profileFailure: profileFailureStatus,
      profileLifecycle: profileLifecycleStatus,
      profileExport: profileExportStatus,
      featureGates: gateStatus,
      imports: importStatus,
      importHistoryExport: importHistoryStatus,
      importTimelineReport: importTimelineStatus,
      importLifecycle: lifecycleStatus,
      importPreviewAcceptance: previewStatus,
      importBoundaryAcceptance: importBoundaryStatus,
      importProvider: providerStatus,
      importProviderReadiness: importProviderReadinessStatus,
      importProviderAdoption: importProviderAdoptionStatus,
      importRuntimeAdoption: importRuntimeAdoptionStatus,
      profileProvider: profileProviderStatus,
      profileProviderAdoption: profileProviderAdoptionStatus,
      providerAdoption: providerAdoptionStatus,
      profileRuntimeAdoption: profileRuntimeAdoptionStatus,
      profileRestartRecovery: profileRestartRecoveryStatus,
      profileRestartStatusLedger: profileRestartStatusLedgerStatus,
      profileRestartReplayDecision: profileRestartReplayDecisionStatus,
      profileActivation: profileActivationStatus,
      profileLifecycleSettingsControls: profileLifecycleSettingsControlStatus,
      profilePreviewAcceptance: profilePreviewStatus,
      profileBoundaryEvidence: profileBoundaryEvidenceStatus,
      profilePrimaryPack: profilePrimaryPackStatus,
      featureBoundaryControls: featureBoundaryStatus,
      featureLifecycleReadiness: featureLifecycleReadinessStatus,
      importGateLifecycle: importGateLifecycleStatus,
      providerGatePreview: providerPreviewStatus,
      boundary: boundaryStatus
    },
    blockingReasons: unique(blockingReasons),
    degradedReasons: unique(degradedReasons),
    statusReport: {
      importSummary: importAnalytics.exportSummary ?? null,
      importHistory: importHistoryExport.exportSummary ?? null,
      importHistoryDeltas: importHistoryExport.deltas ?? null,
      importTimeline: importTimelineReport.exportSummary ?? null,
      importLifecycle: importLifecycle.nextAction ? {
        status: lifecycleStatus,
        nextAction: importLifecycle.nextAction,
        schedule: importLifecycle.schedule ?? null
      } : null,
      profileLifecycle: profileLifecycle.nextAction ? {
        status: profileLifecycleStatus,
        nextAction: profileLifecycle.nextAction,
        schedule: profileLifecycle.schedule ?? null,
        blockers: profileLifecycle.blockers ?? null
      } : null,
      importPreviewAcceptance: importPreviewAcceptance.exportSummary ?? null,
      importBoundaryAcceptance: importBoundaryAcceptance.exportSummary ?? null,
      featureAudit: gateState.auditHandoff ?? null,
      featureGateSummary: gateAnalytics.exportSummary ?? null,
      featureBoundaryControls: featureBoundaryControls.exportSummary ?? null,
      featureLifecycleReadiness: featureLifecycleReadiness.exportSummary ?? null,
      importGateLifecycle: importGateLifecycle.exportSummary ?? null,
      importProvider: importProviderContract.capabilityNegotiation ?? null,
      importProviderReadiness: importProviderReadiness.exportSummary ?? null,
      importProviderAdoption: importProviderAdoption.exportSummary ?? null,
      importRuntimeAdoption: importRuntimeAdoption.exportSummary ?? null,
      profileProvider: profileProviderService.negotiation ?? null,
      profileProviderAdoption: profileProviderAdoption.exportSummary ?? null,
      providerAdoption: providerAdoption.exportSummary ?? null,
      profileRuntimeAdoption: profileRuntimeAdoption.exportSummary ?? null,
      profileRestartRecovery: profileRestartRecovery.exportSummary ?? null,
      profileRestartStatusLedger: profileRestartStatusLedger.exportSummary ?? null,
      profileRestartReplayDecision: profileRestartReplayDecision.exportSummary ?? null,
      profileActivation: profileActivation.exportSummary ?? null,
      profileLifecycleSettingsControls: profileLifecycleSettingsControls.exportSummary ?? null,
      profilePreviewAcceptance: profilePreviewAcceptance.exportSummary ?? null,
      profileBoundaryEvidence: profileBoundaryEvidence.exportSummary ?? null,
      profilePrimaryPack: profilePrimaryPack.exportSummary ?? null,
      providerGatePreview: providerGatePreview.exportSummary ?? null,
      profileExport: profileExport.exportSummary ?? null,
      profileRestartKey: profilePersistence.envelope?.restartKey ?? null,
      profileFailure: profileFailure.failureState ?? null,
      profileBoundaryAudit: profilePersistence.envelope?.boundary?.auditHandoff ?? null,
      boundaryAudit: boundary.contract?.auditHandoff ?? null
    }
  };
}

export function buildModuleOperationalReadinessBrief({
  operation = 'campaign.sync',
  profileOperationalReadiness = {},
  featureAnalyticsPublication = {},
  importProviderOperationalBrief = {},
  operationalStatus = {},
  moduleBoundaryOperations = {},
  previousBrief = {},
  now = null,
  historyLimit = 12
} = {}) {
  const previous = normalizeModuleOperationalReadinessBrief(previousBrief);
  const rows = [
    moduleOperationalReadinessBriefRow('profile_readiness', 'profile', profileOperationalReadiness, true, {
      nextAction: profileOperationalReadiness.handoff?.nextAction ?? profileOperationalReadiness.exportSummary?.nextAction,
      statusChannel: profileOperationalReadiness.handoff?.statusChannel,
      counters: profileOperationalReadiness.validationSummary
    }),
    moduleOperationalReadinessBriefRow('feature_analytics', 'feature_gates', featureAnalyticsPublication, true, {
      nextAction: featureAnalyticsPublication.handoff?.nextAction ?? featureAnalyticsPublication.exportSummary?.nextAction,
      statusChannel: featureAnalyticsPublication.handoff?.statusChannel,
      counters: featureAnalyticsPublication.counters
    }),
    moduleOperationalReadinessBriefRow('import_provider_brief', 'imports', importProviderOperationalBrief, true, {
      nextAction: importProviderOperationalBrief.handoff?.nextAction ?? importProviderOperationalBrief.exportSummary?.nextAction,
      statusChannel: importProviderOperationalBrief.handoff?.statusChannel,
      counters: importProviderOperationalBrief.validationSummary
    }),
    moduleOperationalReadinessBriefRow('module_boundary_operations', 'module', moduleBoundaryOperations, true, {
      nextAction: moduleBoundaryOperations.handoff?.nextAction ?? moduleBoundaryOperations.exportSummary?.nextAction,
      statusChannel: moduleBoundaryOperations.handoff?.statusChannel,
      counters: moduleBoundaryOperations.validationSummary
    })
  ];
  const requiredRows = rows.filter((row) => row.required);
  const blockedRows = requiredRows.filter((row) => row.status === 'blocked');
  const guardedRows = requiredRows.filter((row) => row.status === 'guarded' || row.restartSafe !== true);
  const status = blockedRows.length > 0 || operationalStatus.status === 'blocked'
    ? 'blocked'
    : guardedRows.length > 0 || operationalStatus.status === 'degraded'
      ? 'guarded'
      : 'ready';
  const fingerprint = moduleOperationalReadinessBriefFingerprint({
    operation,
    status,
    rows,
    operationalStatus
  });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = previous.sequence + (changed ? 1 : 0);
  const nextAction = status === 'blocked'
    ? blockedRows[0]?.nextAction ?? 'resolve_module_operational_readiness'
    : status === 'guarded'
      ? guardedRows[0]?.nextAction ?? 'publish_module_operational_readiness_guarded'
      : changed
        ? 'publish_module_operational_readiness_ready'
        : 'reuse_module_operational_readiness_brief';
  const event = {
    sequence,
    timestamp: clean(now) || null,
    operation,
    status,
    fingerprint,
    blockedRows: blockedRows.length,
    guardedRows: guardedRows.length,
    restartSafe: status === 'ready' && rows.every((row) => row.restartSafe)
  };
  const timeline = [
    ...previous.timeline,
    ...(changed || previous.timeline.length === 0 ? [event] : [])
  ].slice(-toNonNegativeInteger(historyLimit, 12) || 12);

  return {
    ok: status !== 'blocked',
    schemaVersion: MODULE_SYNTAX_SCHEMA_VERSION,
    title: 'mailchimp_module_operational_readiness_brief',
    operation,
    status,
    restartSafe: status === 'ready' && rows.every((row) => row.restartSafe),
    sequence,
    fingerprint,
    changed,
    rows,
    history: {
      sequence,
      timeline,
      statusCounts: timeline.reduce((counts, item) => {
        counts[item.status] = (counts[item.status] ?? 0) + 1;
        return counts;
      }, {})
    },
    validationSummary: {
      totalRows: rows.length,
      blockedRows: blockedRows.map((row) => row.id).sort(),
      guardedRows: guardedRows.map((row) => row.id).sort(),
      publishRows: rows.filter((row) => row.publish).map((row) => row.id).sort(),
      clientVisibleRows: rows.filter((row) => row.clientVisible).map((row) => row.id).sort()
    },
    handoff: {
      target: 'kernel.status.mailchimp.module-operational-readiness',
      statusChannel: status === 'ready' ? 'kernel.status.mailchimp' : 'local.status.module-operational-readiness',
      publish: changed || status !== 'ready' || rows.some((row) => row.publish),
      severity: status === 'blocked' ? 'error' : status === 'guarded' ? 'warning' : 'info',
      includeTimeline: true,
      includeRows: true,
      nextAction
    },
    exportSummary: {
      schemaVersion: MODULE_SYNTAX_SCHEMA_VERSION,
      title: 'mailchimp_module_operational_readiness_brief',
      operation,
      status,
      restartSafe: status === 'ready' && rows.every((row) => row.restartSafe),
      sequence,
      fingerprint,
      changed,
      blockedRows: blockedRows.map((row) => row.id).sort(),
      guardedRows: guardedRows.map((row) => row.id).sort(),
      nextAction
    }
  };
}

export function buildModuleOperationalEscalationMatrix({
  operation = 'campaign.sync',
  profileOperationalEscalation = {},
  importOperationalEscalation = {},
  operationalStatus = {},
  previousEscalation = {},
  owners = {},
  now = null,
  historyLimit = 12
} = {}) {
  const previous = normalizeModuleOperationalEscalation(previousEscalation);
  const ownerMap = normalizeModuleEscalationOwners(owners);
  const rows = [
    moduleOperationalEscalationRow('profile', profileOperationalEscalation, ownerMap.profile),
    moduleOperationalEscalationRow('imports', importOperationalEscalation, ownerMap.imports),
    ...moduleEscalationRowsFromLeaf('profile', profileOperationalEscalation.rows ?? [], ownerMap.profile),
    ...moduleEscalationRowsFromLeaf('imports', importOperationalEscalation.rows ?? [], ownerMap.imports)
  ].filter((row) => row.status !== 'ready' || row.publish === true);
  const blockedRows = rows.filter((row) => row.status === 'blocked');
  const guardedRows = rows.filter((row) => row.status === 'guarded');
  const status = blockedRows.length > 0 || operationalStatus.status === 'blocked'
    ? 'blocked'
    : guardedRows.length > 0 || operationalStatus.status === 'degraded'
      ? 'guarded'
      : 'ready';
  const fingerprint = moduleOperationalEscalationFingerprint({
    operation,
    status,
    rows,
    operationalStatus
  });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = previous.sequence + (changed ? 1 : 0);
  const firstRetry = profileOperationalEscalation.retry ?? importOperationalEscalation.retry ?? null;
  const nextAction = status === 'blocked'
    ? 'page_module_operational_owner'
    : status === 'guarded'
      ? firstRetry
        ? 'schedule_module_retry_and_publish_guarded_status'
        : 'publish_module_guarded_escalation'
      : changed
        ? 'publish_module_escalation_clear'
        : 'reuse_module_escalation';
  const event = {
    sequence,
    timestamp: clean(now) || null,
    operation,
    status,
    fingerprint,
    blockedRows: blockedRows.length,
    guardedRows: guardedRows.length,
    publishRows: rows.filter((row) => row.publish).length,
    nextAction
  };
  const timeline = [
    ...previous.timeline,
    ...(changed || previous.timeline.length === 0 ? [event] : [])
  ].slice(-toPositiveInteger(historyLimit, 12));
  const diagnostics = [
    ...(profileOperationalEscalation.diagnostics ?? []).filter((item) => item.level === 'error'),
    ...(importOperationalEscalation.diagnostics ?? []).filter((item) => item.level === 'error'),
    ...(status === 'blocked' && blockedRows.length === 0
      ? [{ level: 'error', code: 'module_escalation_blocked_without_row', subject: operation }]
      : [])
  ];

  return {
    ok: status !== 'blocked',
    schemaVersion: MODULE_SYNTAX_SCHEMA_VERSION,
    title: 'mailchimp_module_operational_escalation',
    operation,
    status,
    restartSafe: status === 'ready'
      && profileOperationalEscalation.restartSafe !== false
      && importOperationalEscalation.restartSafe !== false
      && operationalStatus.restartSafe !== false,
    sequence,
    fingerprint,
    changed,
    generatedAt: clean(now) || null,
    rows,
    counters: {
      rows: rows.length,
      blocked: blockedRows.length,
      guarded: guardedRows.length,
      publishRows: rows.filter((row) => row.publish).length,
      profileRows: rows.filter((row) => row.source === 'profile').length,
      importRows: rows.filter((row) => row.source === 'imports').length,
      diagnosticErrors: diagnostics.filter((item) => item.level === 'error').length
    },
    history: {
      sequence,
      timeline,
      statusCounts: timeline.reduce((counts, item) => {
        counts[item.status] = (counts[item.status] ?? 0) + 1;
        return counts;
      }, {})
    },
    escalation: {
      owner: blockedRows[0]?.owner ?? guardedRows[0]?.owner ?? ownerMap.defaultOwner,
      nextRetry: firstRetry,
      nextAction,
      lastStableFingerprint: status === 'ready' ? fingerprint : previous.lastStableFingerprint
    },
    handoff: {
      target: 'kernel.status.mailchimp.module-escalation',
      statusChannel: status === 'ready' ? 'kernel.status.mailchimp' : 'local.status.module-escalation',
      publish: changed || status !== 'ready' || rows.some((row) => row.publish),
      severity: status === 'blocked' ? 'error' : status === 'guarded' ? 'warning' : 'info',
      includeRows: rows.length > 0,
      includeTimeline: timeline.length > 0,
      nextAction
    },
    exportSummary: {
      schemaVersion: MODULE_SYNTAX_SCHEMA_VERSION,
      title: 'mailchimp_module_operational_escalation',
      operation,
      status,
      restartSafe: status === 'ready'
        && profileOperationalEscalation.restartSafe !== false
        && importOperationalEscalation.restartSafe !== false
        && operationalStatus.restartSafe !== false,
      sequence,
      fingerprint,
      changed,
      owner: blockedRows[0]?.owner ?? guardedRows[0]?.owner ?? ownerMap.defaultOwner,
      blockedRows: blockedRows.map((row) => row.id).sort(),
      guardedRows: guardedRows.map((row) => row.id).sort(),
      publishRows: rows.filter((row) => row.publish).map((row) => row.id).sort(),
      nextRetry: firstRetry,
      nextAction
    },
    diagnostics
  };
}

export function buildModuleOperationalActionPlan({
  profileFailure = {},
  profileLifecycle = {},
  gateAnalytics = {},
  importHealth = {},
  importHistoryExport = {},
  importTimelineReport = {},
  importLifecycle = {},
  importPreviewAcceptance = {},
  importBoundaryAcceptance = {},
  importProviderContract = {},
  importProviderReadiness = {},
  importProviderAdoption = {},
  importRuntimeAdoption = {},
  profileProviderService = {},
  profileProviderAdoption = {},
  providerAdoption = {},
  profileRuntimeAdoption = {},
  profileRestartRecovery = {},
  profileRestartStatusLedger = {},
  profileRestartReplayDecision = {},
  profileActivation = {},
  profileLifecycleSettingsControls = {},
  featureBoundaryControls = {},
  featureLifecycleReadiness = {},
  importGateLifecycle = {},
  providerGatePreview = {},
  profileExport = {},
  profilePreviewAcceptance = {},
  profileBoundaryEvidence = {},
  profilePrimaryPack = {},
  boundary = {},
  operationalStatus = {}
} = {}) {
  const actions = [
    ...normalizeActionable(profileFailure.actionableErrors, 'profile'),
    ...normalizeProfileLifecycleActions(profileLifecycle),
    ...normalizeProfileExportActions(profileExport),
    ...normalizeActionable(importHealth.actionableErrors, 'imports'),
    ...normalizeImportHistoryActions(importHistoryExport),
    ...normalizeImportTimelineReportActions(importTimelineReport),
    ...normalizeImportPreviewActions(importPreviewAcceptance),
    ...normalizeImportBoundaryActions(importBoundaryAcceptance),
    ...normalizeProviderActions(importProviderContract),
    ...normalizeImportProviderReadinessActions(importProviderReadiness),
    ...normalizeProviderAdoptionActions(importProviderAdoption, 'import_provider_adoption'),
    ...normalizeImportRuntimeAdoptionActions(importRuntimeAdoption),
    ...normalizeProfileProviderActions(profileProviderService),
    ...normalizeProviderAdoptionActions(profileProviderAdoption, 'profile_provider_adoption'),
    ...normalizeProviderAdoptionActions(providerAdoption, 'module_provider_adoption'),
    ...normalizeProfileRuntimeAdoptionActions(profileRuntimeAdoption),
    ...normalizeProfileRestartRecoveryActions(profileRestartRecovery),
    ...normalizeProfileRestartStatusLedgerActions(profileRestartStatusLedger),
    ...normalizeProfileRestartReplayDecisionActions(profileRestartReplayDecision),
    ...normalizeProfileActivationActions(profileActivation),
    ...normalizeProfileLifecycleSettingsControlActions(profileLifecycleSettingsControls),
    ...normalizeFeatureBoundaryControlActions(featureBoundaryControls),
    ...normalizeFeatureLifecycleReadinessActions(featureLifecycleReadiness),
    ...normalizeImportGateLifecycleActions(importGateLifecycle),
    ...normalizeProfilePreviewActions(profilePreviewAcceptance),
    ...normalizeProfileBoundaryEvidenceActions(profileBoundaryEvidence),
    ...normalizeProfilePrimaryPackActions(profilePrimaryPack),
    ...normalizeProviderPreviewActions(providerGatePreview),
    ...(gateAnalytics.exportSummary?.nextAction ? [{
      source: 'feature_gates',
      code: 'feature_gate_next_action',
      subject: gateAnalytics.operation,
      action: gateAnalytics.exportSummary.nextAction,
      severity: gateAnalytics.exportSummary.status === 'blocked' ? 'error' : 'warning'
    }] : []),
    ...(boundary.contract?.status === 'blocked' ? [{
      source: 'module_boundary',
      code: 'review_module_boundary',
      subject: boundary.contract.auditHandoff?.subject ?? 'module.boundary',
      action: 'Review module tenant, workspace, and role boundary before dispatch.',
      severity: 'error'
    }] : [])
  ];
  const sortedActions = actions.sort((left, right) => (
    severityRank(right.severity) - severityRank(left.severity)
    || left.source.localeCompare(right.source)
    || left.code.localeCompare(right.code)
  ));
  const nextAction = operationalStatus.status === 'blocked'
    ? 'operator_review'
    : profileLifecycle.status === 'retry_scheduled'
      ? 'dispatch_profile_retry'
    : importLifecycle.status === 'retry_scheduled'
      ? 'dispatch_import_retry'
    : profileActivation.status === 'blocked'
      ? 'resolve_profile_activation_blockers'
    : profileLifecycleSettingsControls.status === 'blocked'
      ? profileLifecycleSettingsControls.readiness?.nextAction ?? 'resolve_profile_lifecycle_control_blockers'
    : featureBoundaryControls.status === 'blocked'
      ? 'resolve_feature_boundary_control_blockers'
    : featureLifecycleReadiness.status === 'blocked'
      ? featureLifecycleReadiness.readiness?.nextAction ?? 'resolve_feature_lifecycle_readiness_blockers'
    : importGateLifecycle.status === 'blocked'
      ? 'resolve_import_gate_lifecycle_blockers'
    : importTimelineReport.status === 'blocked'
      ? importTimelineReport.handoff?.nextAction ?? 'resolve_import_timeline_report_blockers'
    : importRuntimeAdoption.status === 'blocked'
      ? 'resolve_import_runtime_adoption_blockers'
    : importProviderReadiness.status === 'blocked'
      ? 'resolve_import_provider_readiness_blockers'
    : providerAdoption.status === 'blocked'
      ? 'resolve_module_provider_adoption_blockers'
    : profileRuntimeAdoption.status === 'blocked'
      ? 'resolve_profile_runtime_adoption_blockers'
    : profileRestartRecovery.status === 'blocked'
      ? 'resolve_profile_restart_recovery_blockers'
    : profileRestartReplayDecision.status === 'blocked'
      ? 'resolve_profile_restart_replay_decision_blockers'
    : providerGatePreview.status === 'blocked'
      ? 'resolve_provider_preview_blockers'
    : profilePrimaryPack.status === 'blocked'
      ? 'resolve_profile_primary_pack_blockers'
    : profileBoundaryEvidence.status === 'blocked'
      ? 'resolve_profile_boundary_evidence_blockers'
    : profilePreviewAcceptance.status === 'blocked'
      ? 'resolve_profile_preview_blockers'
    : importBoundaryAcceptance.status === 'blocked'
      ? 'resolve_import_boundary_blockers'
    : importPreviewAcceptance.status === 'blocked'
      ? 'resolve_import_preview_blockers'
    : operationalStatus.status === 'degraded'
      ? 'publish_degraded_status'
      : 'publish_ready_status';

  return {
    schemaVersion: MODULE_SYNTAX_SCHEMA_VERSION,
    status: operationalStatus.status ?? 'ready',
    nextAction,
    actionCount: sortedActions.length,
    actions: sortedActions,
    handoff: {
      target: 'kernel.status.mailchimp.module',
      publish: true,
      includeActions: sortedActions.length > 0,
      severity: sortedActions.some((item) => item.severity === 'error')
        ? 'error'
        : sortedActions.some((item) => item.severity === 'warning')
          ? 'warning'
          : 'info'
    }
  };
}

export function buildModuleExportReadiness({
  profileExport = {},
  gateAnalytics = {},
  providerGatePreview = {},
  importPreviewAcceptance = {},
  importBoundaryAcceptance = {},
  importProviderContract = {},
  importProviderReadiness = {},
  importProviderAdoption = {},
  importRuntimeAdoption = {},
  importHistoryExport = {},
  importTimelineReport = {},
  profileProviderService = {},
  profileProviderAdoption = {},
  providerAdoption = {},
  profilePrimaryPack = {},
  profileRuntimeAdoption = {},
  profileRestartRecovery = {},
  profileActivation = {},
  profileLifecycleSettingsControls = {},
  featureBoundaryControls = {},
  featureLifecycleReadiness = {},
  importGateLifecycle = {},
  profilePreviewAcceptance = {},
  profileBoundaryEvidence = {},
  profileLifecycle = {},
  operationalStatus = {},
  operationalActionPlan = {},
  boundary = {}
} = {}) {
  const components = {
    profile: profileExport.exportSummary?.status ?? profileExport.readiness?.status ?? 'ready',
    profilePreview: profilePreviewAcceptance.exportSummary?.status ?? profilePreviewAcceptance.status ?? 'ready',
    profileBoundaryEvidence: profileBoundaryEvidence.exportSummary?.status ?? profileBoundaryEvidence.status ?? 'ready',
    profileLifecycle: profileLifecycle.status ?? 'enabled',
    featureGates: gateAnalytics.exportSummary?.status ?? 'ready',
    providerPreview: providerGatePreview.exportSummary?.status ?? providerGatePreview.status ?? 'ready',
    imports: importPreviewAcceptance.exportSummary?.status ?? importPreviewAcceptance.status ?? 'ready',
    importHistory: importHistoryExport.exportSummary?.status ?? importHistoryExport.status ?? 'healthy',
    importTimeline: importTimelineReport.exportSummary?.status ?? importTimelineReport.status ?? 'ready',
    importBoundary: importBoundaryAcceptance.exportSummary?.status ?? importBoundaryAcceptance.status ?? 'ready',
    provider: importProviderContract.status ?? 'ready',
    importProviderReadiness: importProviderReadiness.status ?? 'ready',
    importProviderAdoption: importProviderAdoption.status ?? 'ready',
    importRuntimeAdoption: importRuntimeAdoption.status ?? 'ready',
    profileProvider: profileProviderService.status ?? 'ready',
    profileProviderAdoption: profileProviderAdoption.status ?? 'ready',
    providerAdoption: providerAdoption.status ?? 'ready',
    profilePrimaryPack: profilePrimaryPack.status ?? 'ready',
    profileRuntimeAdoption: profileRuntimeAdoption.status ?? 'ready',
    profileRestartRecovery: profileRestartRecovery.status ?? 'ready',
    profileActivation: profileActivation.status ?? 'ready',
    profileLifecycleSettingsControls: profileLifecycleSettingsControls.status ?? 'ready',
    featureBoundaryControls: featureBoundaryControls.exportSummary?.status ?? featureBoundaryControls.status ?? 'ready',
    featureLifecycleReadiness: featureLifecycleReadiness.exportSummary?.status ?? featureLifecycleReadiness.status ?? 'ready',
    importGateLifecycle: importGateLifecycle.exportSummary?.status ?? importGateLifecycle.status ?? 'ready',
    boundary: boundary.contract?.status ?? 'ready',
    operations: operationalStatus.status ?? 'ready'
  };
  const blocked = Object.entries(components)
    .filter(([, status]) => status === 'blocked' || status === 'operator_review')
    .map(([component]) => component);
  const degraded = Object.entries(components)
    .filter(([, status]) => (
      status === 'degraded'
      || status === 'recovering'
      || status === 'disabled'
      || status === 'paused'
      || status === 'retry_scheduled'
      || status === 'status_acknowledged'
      || String(status).includes('degraded')
    ))
    .map(([component]) => component);
  const status = blocked.length > 0
    ? 'blocked'
    : degraded.length > 0
      ? 'degraded'
      : 'ready';
  const nextAction = status === 'blocked'
    ? 'operator_mailchimp_export_review'
    : status === 'degraded'
      ? 'publish_mailchimp_export_degraded_status'
      : 'publish_mailchimp_export_ready';
  const exportRows = [
    {
      component: 'profile',
      status: components.profile,
      summary: profileExport.exportSummary ?? null,
      nextAction: profileExport.exportSummary?.nextAction ?? profileExport.readiness?.nextAction ?? null
    },
    {
      component: 'profileLifecycle',
      status: components.profileLifecycle,
      summary: {
        nextAction: profileLifecycle.nextAction ?? null,
        controls: profileLifecycle.controls ?? null,
        schedule: profileLifecycle.schedule ?? null
      },
      nextAction: profileLifecycle.nextAction ?? null
    },
    {
      component: 'profilePreview',
      status: components.profilePreview,
      summary: profilePreviewAcceptance.exportSummary ?? null,
      nextAction: profilePreviewAcceptance.exportSummary?.nextAction ?? profilePreviewAcceptance.readiness?.nextAction ?? null
    },
    {
      component: 'profileBoundaryEvidence',
      status: components.profileBoundaryEvidence,
      summary: profileBoundaryEvidence.exportSummary ?? null,
      nextAction: profileBoundaryEvidence.exportSummary?.nextAction ?? profileBoundaryEvidence.readiness?.nextAction ?? null
    },
    {
      component: 'featureGates',
      status: components.featureGates,
      summary: gateAnalytics.exportSummary ?? null,
      nextAction: gateAnalytics.exportSummary?.nextAction ?? null
    },
    {
      component: 'featureBoundaryControls',
      status: components.featureBoundaryControls,
      summary: featureBoundaryControls.exportSummary ?? null,
      nextAction: featureBoundaryControls.exportSummary?.nextAction ?? null
    },
    {
      component: 'featureLifecycleReadiness',
      status: components.featureLifecycleReadiness,
      summary: featureLifecycleReadiness.exportSummary ?? null,
      nextAction: featureLifecycleReadiness.readiness?.nextAction ?? featureLifecycleReadiness.handoff?.nextAction ?? null
    },
    {
      component: 'importTimeline',
      status: components.importTimeline,
      summary: importTimelineReport.exportSummary ?? null,
      nextAction: importTimelineReport.handoff?.nextAction ?? importTimelineReport.exportSummary?.nextAction ?? null
    },
    {
      component: 'providerPreview',
      status: components.providerPreview,
      summary: providerGatePreview.exportSummary ?? null,
      nextAction: providerGatePreview.exportSummary?.nextAction ?? providerGatePreview.readiness?.nextAction ?? null
    },
    {
      component: 'imports',
      status: components.imports,
      summary: importPreviewAcceptance.exportSummary ?? null,
      nextAction: importPreviewAcceptance.exportSummary?.nextAction ?? importPreviewAcceptance.readiness?.nextAction ?? null
    },
    {
      component: 'importGateLifecycle',
      status: components.importGateLifecycle,
      summary: importGateLifecycle.exportSummary ?? null,
      nextAction: importGateLifecycle.nextAction ?? importGateLifecycle.exportSummary?.nextAction ?? null
    },
    {
      component: 'importBoundary',
      status: components.importBoundary,
      summary: importBoundaryAcceptance.exportSummary ?? null,
      nextAction: importBoundaryAcceptance.exportSummary?.nextAction ?? importBoundaryAcceptance.readiness?.nextAction ?? null
    },
    {
      component: 'importHistory',
      status: components.importHistory,
      summary: importHistoryExport.exportSummary ?? null,
      nextAction: importHistoryExport.exportSummary?.nextAction ?? importHistoryExport.handoff?.nextAction ?? null
    },
    {
      component: 'provider',
      status: components.provider,
      summary: importProviderContract.capabilityNegotiation ?? null,
      nextAction: importProviderContract.status === 'blocked' ? 'repair_import_provider_contract' : null
    },
    {
      component: 'importProviderReadiness',
      status: components.importProviderReadiness,
      summary: importProviderReadiness.exportSummary ?? null,
      nextAction: importProviderReadiness.readiness?.nextAction ?? importProviderReadiness.handoff?.nextAction ?? null
    },
    {
      component: 'importProviderAdoption',
      status: components.importProviderAdoption,
      summary: importProviderAdoption.exportSummary ?? null,
      nextAction: importProviderAdoption.readiness?.nextAction ?? importProviderAdoption.handoff?.nextAction ?? null
    },
    {
      component: 'importRuntimeAdoption',
      status: components.importRuntimeAdoption,
      summary: importRuntimeAdoption.exportSummary ?? null,
      nextAction: importRuntimeAdoption.readiness?.nextAction ?? importRuntimeAdoption.handoff?.nextAction ?? null
    },
    {
      component: 'profilePrimaryPack',
      status: components.profilePrimaryPack,
      summary: profilePrimaryPack.exportSummary ?? null,
      nextAction: profilePrimaryPack.exportSummary?.nextAction ?? profilePrimaryPack.handoff?.nextAction ?? null
    },
    {
      component: 'profileRuntimeAdoption',
      status: components.profileRuntimeAdoption,
      summary: profileRuntimeAdoption.exportSummary ?? null,
      nextAction: profileRuntimeAdoption.readiness?.nextAction ?? profileRuntimeAdoption.handoff?.nextAction ?? null
    },
    {
      component: 'profileActivation',
      status: components.profileActivation,
      summary: profileActivation.exportSummary ?? null,
      nextAction: profileActivation.readiness?.nextAction ?? profileActivation.handoff?.nextAction ?? null
    },
    {
      component: 'profileLifecycleSettingsControls',
      status: components.profileLifecycleSettingsControls,
      summary: profileLifecycleSettingsControls.exportSummary ?? null,
      nextAction: profileLifecycleSettingsControls.readiness?.nextAction ?? profileLifecycleSettingsControls.handoff?.nextAction ?? null
    },
    {
      component: 'profileProvider',
      status: components.profileProvider,
      summary: profileProviderService.negotiation ?? null,
      nextAction: profileProviderService.status === 'blocked' ? 'repair_profile_provider_contract' : null
    },
    {
      component: 'profileProviderAdoption',
      status: components.profileProviderAdoption,
      summary: profileProviderAdoption.exportSummary ?? null,
      nextAction: profileProviderAdoption.readiness?.nextAction ?? profileProviderAdoption.handoff?.nextAction ?? null
    },
    {
      component: 'providerAdoption',
      status: components.providerAdoption,
      summary: providerAdoption.exportSummary ?? null,
      nextAction: providerAdoption.readiness?.nextAction ?? providerAdoption.handoff?.nextAction ?? null
    },
    {
      component: 'boundary',
      status: components.boundary,
      summary: boundary.contract?.auditHandoff ?? null,
      nextAction: boundary.contract?.status === 'blocked' ? 'review_module_boundary' : null
    }
  ];

  return {
    schemaVersion: MODULE_SYNTAX_SCHEMA_VERSION,
    status,
    restartSafe: status === 'ready'
      && profileExport.exportSummary?.restartSafe !== false
      && profileLifecycle.ok !== false
      && profileLifecycle.status === 'enabled'
      && profilePreviewAcceptance.restartSafe !== false
      && profileBoundaryEvidence.restartSafe !== false
      && importPreviewAcceptance.exportSummary?.restartSafe !== false
      && importHistoryExport.restartSafe !== false
      && importTimelineReport.restartSafe !== false
      && importBoundaryAcceptance.restartSafe !== false
      && importProviderContract.restartSafe !== false
      && importProviderReadiness.restartSafe !== false
      && importProviderAdoption.restartSafe !== false
      && importRuntimeAdoption.restartSafe !== false
      && profileProviderService.restartSafe !== false
      && profileProviderAdoption.restartSafe !== false
      && providerAdoption.restartSafe !== false
      && profilePrimaryPack.restartSafe !== false
      && profileActivation.restartSafe !== false
      && profileLifecycleSettingsControls.restartSafe !== false
      && featureBoundaryControls.restartSafe !== false
      && importGateLifecycle.restartSafe !== false
      && providerGatePreview.restartSafe !== false
      && operationalStatus.restartSafe === true,
    components,
    blockedComponents: blocked,
    degradedComponents: degraded,
    nextAction,
    exportSummary: {
      title: 'mailchimp_module_export_readiness',
      status,
      restartSafe: status === 'ready' && operationalStatus.restartSafe === true,
      profile: profileExport.exportSummary ?? null,
      profilePreview: profilePreviewAcceptance.exportSummary ?? null,
      profileBoundaryEvidence: profileBoundaryEvidence.exportSummary ?? null,
      importTimeline: importTimelineReport.exportSummary ?? null,
      profileLifecycle: {
        status: profileLifecycle.status ?? 'enabled',
        nextAction: profileLifecycle.nextAction ?? null,
        controls: profileLifecycle.controls ?? null
      },
      featureGates: gateAnalytics.exportSummary ?? null,
      featureBoundaryControls: featureBoundaryControls.exportSummary ?? null,
      providerPreview: providerGatePreview.exportSummary ?? null,
      imports: importPreviewAcceptance.exportSummary ?? null,
      importGateLifecycle: importGateLifecycle.exportSummary ?? null,
      importHistory: importHistoryExport.exportSummary ?? null,
      importBoundary: importBoundaryAcceptance.exportSummary ?? null,
      provider: importProviderContract.capabilityNegotiation ?? null,
      importProviderReadiness: importProviderReadiness.exportSummary ?? null,
      importProviderAdoption: importProviderAdoption.exportSummary ?? null,
      importRuntimeAdoption: importRuntimeAdoption.exportSummary ?? null,
      profileProvider: profileProviderService.negotiation ?? null,
      profileProviderAdoption: profileProviderAdoption.exportSummary ?? null,
      providerAdoption: providerAdoption.exportSummary ?? null,
      profilePrimaryPack: profilePrimaryPack.exportSummary ?? null,
      profileActivation: profileActivation.exportSummary ?? null,
      profileLifecycleSettingsControls: profileLifecycleSettingsControls.exportSummary ?? null,
      boundary: boundary.contract?.auditHandoff ?? null,
      actionPlan: {
        nextAction: operationalActionPlan.nextAction ?? nextAction,
        actionCount: operationalActionPlan.actionCount ?? 0
      }
    },
    report: {
      title: 'mailchimp_module_export_readiness',
      status,
      rows: exportRows,
      nextAction
    },
    handoff: {
      target: 'kernel.status.mailchimp.module.export',
      publish: true,
      severity: status === 'blocked' ? 'error' : status === 'degraded' ? 'warning' : 'info',
      includeComponentRows: true,
      nextAction
    }
  };
}

export function buildModuleClientExportRouteReadiness({
  operation = 'campaign.sync',
  profileAnalyticsExportLedger = {},
  importClientPreviewRoute = {},
  exportReadiness = {},
  clientWorkflowHandoff = {},
  moduleClientActionQueue = {},
  moduleOperationalReadinessLedger = {},
  previousRoute = {},
  now = null,
  historyLimit = 12
} = {}) {
  const previous = normalizeModuleClientExportRoute(previousRoute);
  const rows = [
    moduleClientExportRouteRow('profile_analytics_export', profileAnalyticsExportLedger, true, {
      visible: profileAnalyticsExportLedger.handoff?.publish === true,
      nextAction: profileAnalyticsExportLedger.handoff?.nextAction ?? profileAnalyticsExportLedger.exportSummary?.nextAction,
      awaitingAcceptance: profileAnalyticsExportLedger.exportSummary?.awaitingAcceptance ?? []
    }),
    moduleClientExportRouteRow('import_preview_route', importClientPreviewRoute, true, {
      visible: importClientPreviewRoute.routeState?.previewVisible === true,
      nextAction: importClientPreviewRoute.handoff?.nextAction ?? importClientPreviewRoute.exportSummary?.nextAction,
      awaitingAcceptance: importClientPreviewRoute.exportSummary?.awaitingAcceptance ?? []
    }),
    moduleClientExportRouteRow('module_export_readiness', exportReadiness, true, {
      visible: exportReadiness.status !== 'ready',
      nextAction: exportReadiness.nextAction ?? exportReadiness.handoff?.nextAction
    }),
    moduleClientExportRouteRow('client_workflow_handoff', clientWorkflowHandoff, true, {
      visible: clientWorkflowHandoff.handoff?.publish === true || clientWorkflowHandoff.status !== 'ready',
      nextAction: clientWorkflowHandoff.readiness?.nextAction ?? clientWorkflowHandoff.handoff?.nextAction
    }),
    moduleClientExportRouteRow('client_action_queue', moduleClientActionQueue, false, {
      visible: moduleClientActionQueue.handoff?.publish === true || (moduleClientActionQueue.rows ?? []).length > 0,
      nextAction: moduleClientActionQueue.handoff?.nextAction ?? moduleClientActionQueue.exportSummary?.nextAction
    }),
    moduleClientExportRouteRow('operational_readiness_ledger', moduleOperationalReadinessLedger, false, {
      visible: moduleOperationalReadinessLedger.handoff?.publish === true || moduleOperationalReadinessLedger.status !== 'ready',
      nextAction: moduleOperationalReadinessLedger.handoff?.nextAction ?? moduleOperationalReadinessLedger.exportSummary?.nextAction
    })
  ];
  const requiredRows = rows.filter((row) => row.required);
  const blockedRows = requiredRows.filter((row) => row.status === 'blocked');
  const guardedRows = requiredRows.filter((row) => row.status === 'guarded' || row.restartSafe !== true);
  const awaitingAcceptance = unique(rows.flatMap((row) => row.awaitingAcceptance));
  const status = blockedRows.length > 0
    ? 'blocked'
    : guardedRows.length > 0 || awaitingAcceptance.length > 0
      ? 'guarded'
      : 'ready';
  const fingerprint = [
    'module_client_export_route',
    operation,
    status,
    `awaiting:${awaitingAcceptance.join(',')}`,
    ...rows.map((row) => [
      row.id,
      row.status,
      row.required ? 'required' : 'optional',
      row.restartSafe ? 'restart_safe' : 'restart_guarded',
      row.visibleToClient ? 'visible' : 'hidden',
      row.fingerprint,
      row.nextAction
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('||');
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = previous.sequence + (changed ? 1 : 0);
  const event = {
    sequence,
    timestamp: clean(now) || null,
    operation,
    status,
    fingerprint,
    blockedRows: blockedRows.length,
    guardedRows: guardedRows.length,
    awaitingAcceptance: awaitingAcceptance.length
  };
  const timeline = [
    ...previous.timeline,
    ...(changed || previous.timeline.length === 0 ? [event] : [])
  ].slice(-toPositiveInteger(historyLimit, 12));
  const nextAction = status === 'blocked'
    ? 'resolve_module_client_export_route_blockers'
    : awaitingAcceptance.length > 0
      ? 'request_module_client_export_acceptance'
      : status === 'guarded'
        ? 'publish_module_client_export_route_guarded'
        : changed
          ? 'publish_module_client_export_route'
          : 'reuse_module_client_export_route';

  return {
    ok: status !== 'blocked',
    schemaVersion: MODULE_SYNTAX_SCHEMA_VERSION,
    title: 'mailchimp_module_client_export_route_readiness',
    operation,
    status,
    restartSafe: status === 'ready' && requiredRows.every((row) => row.restartSafe),
    sequence,
    fingerprint,
    changed,
    rows,
    routeState: {
      previewVisible: rows.some((row) => row.visibleToClient),
      acceptEnabled: status !== 'blocked' && awaitingAcceptance.length > 0,
      exportEnabled: status === 'ready' && awaitingAcceptance.length === 0,
      blockedRows: blockedRows.map((row) => row.id).sort(),
      guardedRows: guardedRows.map((row) => row.id).sort(),
      awaitingAcceptance
    },
    validationSummary: {
      totalRows: rows.length,
      requiredRows: requiredRows.length,
      visibleRows: rows.filter((row) => row.visibleToClient).length,
      blockedRows: blockedRows.length,
      guardedRows: guardedRows.length,
      awaitingAcceptance: awaitingAcceptance.length
    },
    history: {
      sequence,
      timeline,
      statusCounts: timeline.reduce((counts, item) => {
        counts[item.status] = (counts[item.status] ?? 0) + 1;
        return counts;
      }, {})
    },
    handoff: {
      target: 'client.route.mailchimp.module-export',
      statusChannel: status === 'ready' ? 'kernel.status.mailchimp' : 'local.status.module-client-export-route',
      publish: changed || status !== 'ready' || awaitingAcceptance.length > 0,
      severity: status === 'blocked' ? 'error' : status === 'guarded' ? 'warning' : 'info',
      includeRows: true,
      includeHistory: true,
      nextAction
    },
    exportSummary: {
      schemaVersion: MODULE_SYNTAX_SCHEMA_VERSION,
      title: 'mailchimp_module_client_export_route_readiness',
      operation,
      status,
      restartSafe: status === 'ready' && requiredRows.every((row) => row.restartSafe),
      sequence,
      fingerprint,
      changed,
      blockedRows: blockedRows.map((row) => row.id).sort(),
      guardedRows: guardedRows.map((row) => row.id).sort(),
      awaitingAcceptance,
      visibleRows: rows.filter((row) => row.visibleToClient).map((row) => row.id).sort(),
      nextAction
    }
  };
}

export function buildModuleClientWorkflowHandoff({
  profileClientWorkflow = {},
  featureClientWorkflow = {},
  importClientWorkflow = {},
  importRuntimeAdoption = {},
  moduleRuntimeAdoption = {},
  profileActivation = {},
  profileRuntimeAdoption = {},
  profileLifecycleSettingsControls = {},
  profileBoundaryEvidence = {},
  operationalStatus = {},
  operationalActionPlan = {},
  exportReadiness = {},
  boundary = {}
} = {}) {
  const componentRows = [
    {
      id: 'profile',
      label: 'Profile workflow',
      status: profileClientWorkflow.status ?? 'ready',
      restartSafe: profileClientWorkflow.restartSafe !== false,
      nextAction: profileClientWorkflow.handoff?.nextAction ?? profileClientWorkflow.exportSummary?.nextAction ?? null,
      handoff: profileClientWorkflow.handoff ?? null,
      rows: profileClientWorkflow.rows ?? []
    },
    {
      id: 'feature_gates',
      label: 'Feature gate workflow',
      status: featureClientWorkflow.status ?? 'ready',
      restartSafe: featureClientWorkflow.restartSafe !== false,
      nextAction: featureClientWorkflow.handoff?.nextAction ?? featureClientWorkflow.exportSummary?.nextAction ?? null,
      handoff: featureClientWorkflow.handoff ?? null,
      rows: featureClientWorkflow.rows ?? []
    },
    {
      id: 'imports',
      label: 'Import workflow',
      status: importClientWorkflow.status ?? 'ready',
      restartSafe: importClientWorkflow.restartSafe !== false,
      nextAction: importClientWorkflow.handoff?.nextAction ?? importClientWorkflow.exportSummary?.nextAction ?? null,
      handoff: importClientWorkflow.handoff ?? null,
      rows: importClientWorkflow.rows ?? []
    },
    {
      id: 'import_runtime_adoption',
      label: 'Import runtime adoption',
      status: importRuntimeAdoption.status ?? 'ready',
      restartSafe: importRuntimeAdoption.restartSafe !== false,
      nextAction: importRuntimeAdoption.readiness?.nextAction ?? importRuntimeAdoption.handoff?.nextAction ?? null,
      handoff: importRuntimeAdoption.handoff ?? null,
      rows: (importRuntimeAdoption.rows ?? []).map((row) => ({
        id: row.alias,
        label: row.specifier,
        status: row.status,
        visibleToClient: row.status !== 'ready' || row.adopted !== true,
        nextAction: row.nextAction,
        evidence: {
          runtimeTarget: row.runtimeTarget,
          statusChannel: row.statusChannel,
          missingCapabilities: row.capabilities?.missing ?? []
        }
      }))
    },
    {
      id: 'profile_activation',
      label: 'Profile activation',
      status: profileActivation.status ?? 'ready',
      restartSafe: profileActivation.restartSafe !== false,
      nextAction: profileActivation.readiness?.nextAction ?? profileActivation.handoff?.nextAction ?? null,
      handoff: profileActivation.handoff ?? null,
      rows: (profileActivation.rows ?? []).map((row) => ({
        id: row.key,
        label: row.label,
        status: row.status,
        visibleToClient: row.status !== 'ready' || row.ready !== true,
        nextAction: row.nextAction,
        evidence: row.evidence ?? {}
      }))
    },
    {
      id: 'profile_lifecycle_settings_controls',
      label: 'Profile lifecycle controls',
      status: profileLifecycleSettingsControls.status ?? 'ready',
      restartSafe: profileLifecycleSettingsControls.restartSafe !== false,
      nextAction: profileLifecycleSettingsControls.readiness?.nextAction ?? profileLifecycleSettingsControls.handoff?.nextAction ?? null,
      handoff: profileLifecycleSettingsControls.handoff ?? null,
      rows: (profileLifecycleSettingsControls.rows ?? []).map((row) => ({
        id: row.key,
        label: row.label,
        status: row.status,
        visibleToClient: row.visibleToClient === true,
        nextAction: row.nextAction,
        evidence: {
          commands: row.commands ?? [],
          disabledReasons: row.disabledReasons ?? [],
          accepted: row.accepted === true,
          required: row.required === true,
          ...row.evidence
        }
      }))
    },
    {
      id: 'profile_runtime_adoption',
      label: 'Profile runtime adoption',
      status: profileRuntimeAdoption.status ?? 'ready',
      restartSafe: profileRuntimeAdoption.restartSafe !== false,
      nextAction: profileRuntimeAdoption.readiness?.nextAction ?? profileRuntimeAdoption.handoff?.nextAction ?? null,
      handoff: profileRuntimeAdoption.handoff ?? null,
      rows: (profileRuntimeAdoption.rows ?? []).map((row) => ({
        id: row.component,
        label: row.component,
        status: row.status,
        visibleToClient: row.status !== 'ready' || row.adopted !== true,
        nextAction: row.nextAction,
        evidence: row.evidence ?? {}
      }))
    },
    {
      id: 'module_runtime_adoption',
      label: 'Module runtime adoption',
      status: moduleRuntimeAdoption.status ?? 'ready',
      restartSafe: moduleRuntimeAdoption.restartSafe !== false,
      nextAction: moduleRuntimeAdoption.readiness?.nextAction ?? moduleRuntimeAdoption.handoff?.nextAction ?? null,
      handoff: moduleRuntimeAdoption.handoff ?? null,
      rows: (moduleRuntimeAdoption.rows ?? []).map((row) => ({
        id: row.key,
        label: row.label ?? row.key,
        status: row.status,
        visibleToClient: row.status !== 'ready' || row.restartSafe === false || row.requiredAcceptance === true,
        nextAction: row.nextAction,
        evidence: row.evidence ?? {}
      }))
    },
    {
      id: 'profile_boundary_evidence',
      label: 'Profile boundary evidence',
      status: profileBoundaryEvidence.status ?? 'ready',
      restartSafe: profileBoundaryEvidence.restartSafe !== false,
      nextAction: profileBoundaryEvidence.readiness?.nextAction ?? profileBoundaryEvidence.exportSummary?.nextAction ?? null,
      handoff: {
        target: profileBoundaryEvidence.auditHandoff?.target ?? 'kernel.audit.mailchimp.profile',
        statusChannel: 'kernel.status.mailchimp',
        publish: profileBoundaryEvidence.status !== 'ready'
      },
      rows: (profileBoundaryEvidence.preview?.rows ?? []).map((row) => ({
        id: row.key,
        label: row.label,
        status: row.status,
        visibleToClient: row.status !== 'ready' || row.accepted !== true,
        nextAction: row.nextStep,
        evidence: row.evidence ?? {}
      }))
    },
    {
      id: 'module_boundary',
      label: 'Module boundary',
      status: boundary.contract?.status ?? 'ready',
      restartSafe: boundary.contract?.crossTenantSafe !== false,
      nextAction: boundary.contract?.status === 'blocked'
        ? 'review_module_boundary'
        : boundary.contract?.status === 'degraded'
          ? 'publish_module_boundary_advisory'
          : 'include_module_boundary',
      handoff: {
        target: boundary.contract?.auditHandoff?.target ?? 'kernel.audit.mailchimp',
        statusChannel: 'kernel.status.mailchimp',
        publish: boundary.contract?.status !== 'ready'
      },
      rows: []
    }
  ];
  const blockedComponents = componentRows
    .filter((row) => row.status === 'blocked' || row.status === 'operator_review')
    .map((row) => row.id);
  const degradedComponents = componentRows
    .filter((row) => (
      row.status === 'degraded'
      || row.status === 'recovering'
      || row.status === 'enabled_degraded'
      || row.status === 'retry_scheduled'
      || row.status === 'paused'
      || row.status === 'disabled'
    ))
    .map((row) => row.id);
  const status = blockedComponents.length > 0 || operationalStatus.status === 'blocked'
    ? 'blocked'
    : degradedComponents.length > 0 || operationalStatus.status === 'degraded' || exportReadiness.status === 'degraded'
      ? 'degraded'
      : 'ready';
  const visibleRows = componentRows.flatMap((component) => (
    component.rows ?? []
  ).filter((row) => row.visibleToClient !== false).map((row) => ({
    component: component.id,
    id: row.id,
    label: row.label,
    status: row.status,
    nextAction: row.nextAction,
    evidence: row.evidence ?? {}
  })));
  const nextAction = status === 'blocked'
    ? 'operator_client_workflow_review'
    : operationalActionPlan.nextAction === 'dispatch_profile_retry'
      ? 'dispatch_profile_retry'
      : operationalActionPlan.nextAction === 'dispatch_import_retry'
        ? 'dispatch_import_retry'
        : status === 'degraded'
          ? 'publish_client_workflow_degraded_status'
          : 'publish_client_workflow_ready';

  return {
    schemaVersion: MODULE_SYNTAX_SCHEMA_VERSION,
    status,
    restartSafe: status === 'ready'
      && operationalStatus.restartSafe === true
      && exportReadiness.restartSafe === true
      && componentRows.every((row) => row.restartSafe !== false),
    nextAction,
    components: componentRows.map((row) => ({
      id: row.id,
      label: row.label,
      status: row.status,
      restartSafe: row.restartSafe,
      nextAction: row.nextAction
    })),
    visibleRows,
    blockedComponents,
    degradedComponents,
    handoff: {
      target: 'kernel.status.mailchimp.client-workflow',
      statusChannel: 'kernel.status.mailchimp',
      publish: true,
      includeVisibleRows: visibleRows.length > 0,
      severity: status === 'blocked' ? 'error' : status === 'degraded' ? 'warning' : 'info',
      nextAction
    },
    exportSummary: {
      schemaVersion: MODULE_SYNTAX_SCHEMA_VERSION,
      title: 'mailchimp_client_workflow_handoff',
      status,
      restartSafe: status === 'ready' && operationalStatus.restartSafe === true,
      blockedComponents,
      degradedComponents,
      visibleRowCount: visibleRows.length,
      nextAction
    }
  };
}

export function buildModuleRuntimeAdoptionHandoff({
  operation = 'campaign.sync',
  profileRequestKernelBinding = {},
  profileRuntimeAdoption = {},
  featureClientWorkflow = {},
  featureLifecycleReadiness = {},
  importRuntimeAdoption = {},
  importProviderSyncCheckpoint = {},
  boundary = {},
  operationalStatus = {},
  exportReadiness = {},
  previousHandoff = {},
  now = null
} = {}) {
  const previous = normalizeModuleRuntimeAdoptionHistory(previousHandoff);
  const boundaryStatus = boundary.contract?.status ?? 'ready';
  const rows = [
    {
      key: 'profile_request_binding',
      label: 'Profile request binding',
      status: profileRequestKernelBinding.status ?? 'ready',
      restartSafe: profileRequestKernelBinding.restartSafe !== false,
      requiredAcceptance: false,
      nextAction: profileRequestKernelBinding.readiness?.nextAction ?? profileRequestKernelBinding.handoff?.nextAction ?? null,
      evidence: {
        requestKey: profileRequestKernelBinding.request?.requestKey ?? profileRequestKernelBinding.exportSummary?.requestKey ?? null,
        resumeToken: profileRequestKernelBinding.request?.resumeToken ?? profileRequestKernelBinding.exportSummary?.resumeToken ?? null,
        blockedRows: profileRequestKernelBinding.blockedRows ?? [],
        degradedRows: profileRequestKernelBinding.degradedRows ?? [],
        kernelJobName: profileRequestKernelBinding.kernelJob?.name ?? null
      }
    },
    {
      key: 'profile_runtime_adoption',
      label: 'Profile runtime adoption',
      status: profileRuntimeAdoption.status ?? 'ready',
      restartSafe: profileRuntimeAdoption.restartSafe !== false,
      requiredAcceptance: false,
      nextAction: profileRuntimeAdoption.readiness?.nextAction ?? profileRuntimeAdoption.handoff?.nextAction ?? null,
      evidence: {
        sequence: profileRuntimeAdoption.sequence ?? 0,
        changed: profileRuntimeAdoption.changed === true,
        blockedComponents: profileRuntimeAdoption.blockedComponents ?? [],
        degradedComponents: profileRuntimeAdoption.degradedComponents ?? []
      }
    },
    {
      key: 'feature_runtime_policy',
      label: 'Feature runtime policy',
      status: featureLifecycleReadiness.status ?? featureClientWorkflow.status ?? 'ready',
      restartSafe: featureLifecycleReadiness.restartSafe !== false && featureClientWorkflow.restartSafe !== false,
      requiredAcceptance: (featureClientWorkflow.exportSummary?.blockingRows ?? []).length > 0,
      nextAction: featureLifecycleReadiness.readiness?.nextAction
        ?? featureClientWorkflow.handoff?.nextAction
        ?? featureClientWorkflow.exportSummary?.nextAction
        ?? null,
      evidence: {
        featureStatus: featureClientWorkflow.status ?? null,
        lifecycleStatus: featureLifecycleReadiness.status ?? null,
        deniedEffects: featureClientWorkflow.exportSummary?.deniedEffects ?? [],
        blockedRows: featureClientWorkflow.exportSummary?.blockingRows ?? [],
        degradedRows: featureClientWorkflow.exportSummary?.degradedRows ?? []
      }
    },
    {
      key: 'import_runtime_adoption',
      label: 'Import runtime adoption',
      status: importRuntimeAdoption.status ?? 'ready',
      restartSafe: importRuntimeAdoption.restartSafe !== false,
      requiredAcceptance: (importRuntimeAdoption.exportSummary?.blockedImports ?? []).length > 0,
      nextAction: importRuntimeAdoption.readiness?.nextAction ?? importRuntimeAdoption.handoff?.nextAction ?? null,
      evidence: {
        blockedImports: importRuntimeAdoption.exportSummary?.blockedImports ?? [],
        degradedImports: importRuntimeAdoption.exportSummary?.degradedImports ?? [],
        requiredAliases: importRuntimeAdoption.exportSummary?.requiredAliases ?? [],
        adoptedImports: (importRuntimeAdoption.rows ?? []).filter((row) => row.adopted === true).map((row) => row.alias).sort()
      }
    },
    {
      key: 'provider_sync_checkpoint',
      label: 'Provider sync checkpoint',
      status: importProviderSyncCheckpoint.status ?? 'ready',
      restartSafe: importProviderSyncCheckpoint.restartSafe !== false,
      requiredAcceptance: false,
      nextAction: importProviderSyncCheckpoint.readiness?.nextAction ?? importProviderSyncCheckpoint.handoff?.nextAction ?? null,
      evidence: {
        sequence: importProviderSyncCheckpoint.sequence ?? 0,
        changed: importProviderSyncCheckpoint.changed === true,
        profileCursor: importProviderSyncCheckpoint.profileSyncIntent?.cursor ?? null,
        blockedProviders: importProviderSyncCheckpoint.exportSummary?.blockedProviders ?? [],
        degradedProviders: importProviderSyncCheckpoint.exportSummary?.degradedProviders ?? []
      }
    },
    {
      key: 'tenant_runtime_boundary',
      label: 'Tenant runtime boundary',
      status: boundaryStatus,
      restartSafe: boundary.contract?.crossTenantSafe !== false && boundaryStatus !== 'blocked',
      requiredAcceptance: boundaryStatus !== 'ready',
      nextAction: boundaryStatus === 'blocked'
        ? 'review_module_runtime_tenant_boundary'
        : boundaryStatus === 'degraded'
          ? 'publish_module_runtime_boundary_advisory'
          : 'include_module_runtime_boundary',
      evidence: {
        tenantId: boundary.contract?.tenantId ?? null,
        workspaceId: boundary.contract?.workspaceId ?? null,
        role: boundary.contract?.role ?? null,
        permissionMode: boundary.contract?.permissionMode ?? null,
        auditSubject: boundary.contract?.auditHandoff?.subject ?? null
      }
    }
  ];
  const blockedRows = rows
    .filter((row) => row.status === 'blocked' || row.status === 'operator_review')
    .map((row) => row.key);
  const degradedRows = rows
    .filter((row) => (
      row.status === 'degraded'
      || row.status === 'recovering'
      || row.status === 'enabled_degraded'
      || row.status === 'retry_scheduled'
      || row.restartSafe === false
      || row.requiredAcceptance === true
    ))
    .map((row) => row.key);
  const diagnostics = [
    ...(profileRequestKernelBinding.diagnostics ?? []).filter((item) => item.level === 'error'),
    ...(profileRuntimeAdoption.diagnostics ?? []).filter((item) => item.level === 'error'),
    ...(featureClientWorkflow.diagnostics ?? []).filter((item) => item.level === 'error'),
    ...(featureLifecycleReadiness.diagnostics ?? []).filter((item) => item.level === 'error'),
    ...(importRuntimeAdoption.diagnostics ?? []).filter((item) => item.level === 'error'),
    ...(importProviderSyncCheckpoint.diagnostics ?? []).filter((item) => item.level === 'error'),
    ...(boundary.diagnostics ?? []).filter((item) => item.level === 'error'),
    ...(operationalStatus.status === 'blocked'
      ? [{ level: 'error', code: 'module_runtime_adoption_operations_blocked', subject: operation }]
      : []),
    ...(exportReadiness.status === 'blocked'
      ? [{ level: 'error', code: 'module_runtime_adoption_export_blocked', subject: operation }]
      : [])
  ];
  const status = diagnostics.some((item) => item.level === 'error') || blockedRows.length > 0
    ? 'blocked'
    : diagnostics.some((item) => item.level === 'warning')
      || degradedRows.length > 0
      || operationalStatus.status === 'degraded'
      || exportReadiness.status === 'degraded'
      ? 'degraded'
      : 'ready';
  const fingerprint = moduleRuntimeAdoptionFingerprint({
    operation,
    status,
    rows,
    operationalStatus,
    exportReadiness
  });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = previous.sequence + (changed ? 1 : 0);
  const nextAction = status === 'blocked'
    ? 'resolve_module_runtime_adoption_blockers'
    : status === 'degraded'
      ? 'publish_module_runtime_adoption_degraded'
      : changed
        ? 'publish_module_runtime_adoption'
        : 'reuse_module_runtime_adoption';
  const event = {
    sequence,
    timestamp: clean(now) || null,
    operation,
    status,
    fingerprint,
    changed,
    blockedRows: blockedRows.length,
    degradedRows: degradedRows.length,
    restartSafe: status === 'ready' && rows.every((row) => row.restartSafe !== false)
  };
  const timeline = [
    ...previous.timeline,
    ...(changed || previous.timeline.length === 0 ? [event] : [])
  ].slice(-12);

  return {
    schemaVersion: MODULE_SYNTAX_SCHEMA_VERSION,
    title: 'mailchimp_module_runtime_adoption',
    operation,
    status,
    restartSafe: status === 'ready'
      && rows.every((row) => row.restartSafe !== false)
      && operationalStatus.restartSafe === true
      && exportReadiness.restartSafe === true,
    sequence,
    fingerprint,
    changed,
    rows,
    blockedRows,
    degradedRows,
    history: {
      sequence,
      timeline,
      statusCounts: timeline.reduce((counts, item) => {
        counts[item.status] = (counts[item.status] ?? 0) + 1;
        return counts;
      }, {})
    },
    readiness: {
      status,
      blockingReasons: unique([
        ...blockedRows,
        ...(profileRequestKernelBinding.readiness?.blockingReasons ?? []),
        ...(importRuntimeAdoption.readiness?.blockingReasons ?? [])
      ]),
      degradedReasons: unique([
        ...degradedRows,
        ...(profileRequestKernelBinding.readiness?.degradedReasons ?? []),
        ...(importRuntimeAdoption.readiness?.degradedReasons ?? [])
      ]),
      nextAction
    },
    handoff: {
      target: 'kernel.status.mailchimp.module-runtime-adoption',
      statusChannel: 'kernel.status.mailchimp',
      publish: changed || status !== 'ready' || rows.some((row) => row.requiredAcceptance),
      severity: status === 'blocked' ? 'error' : status === 'degraded' ? 'warning' : 'info',
      includeRows: true,
      includeRequestBinding: true,
      nextAction
    },
    exportSummary: {
      schemaVersion: MODULE_SYNTAX_SCHEMA_VERSION,
      title: 'mailchimp_module_runtime_adoption',
      operation,
      status,
      restartSafe: status === 'ready' && rows.every((row) => row.restartSafe !== false),
      sequence,
      fingerprint,
      changed,
      requestKey: profileRequestKernelBinding.request?.requestKey ?? null,
      blockedRows,
      degradedRows,
      nextAction
    },
    diagnostics
  };
}

export function buildModuleLaunchAcceptancePackage({
  operation = 'campaign.sync',
  profilePreviewAcceptance = {},
  profileNextStepDigest = {},
  featureClientAcceptance = {},
  featureNextStepDigest = {},
  featureLaunchPreview = {},
  importClientAcceptance = {},
  clientWorkflowHandoff = {},
  exportReadiness = {},
  operationsStatus = {},
  acceptance = {},
  requireExplicitAcceptance = false,
  previousPackage = {},
  now = null
} = {}) {
  const previous = normalizeModuleLaunchAcceptanceHistory(previousPackage);
  const normalizedAcceptance = normalizeModuleLaunchAcceptance(acceptance);
  const explicitAcceptance = requireExplicitAcceptance || normalizedAcceptance.requireExplicitAcceptance;
  const rows = [
    {
      key: 'profile_preview',
      label: 'Profile preview',
      status: profilePreviewAcceptance.status ?? 'ready',
      restartSafe: profilePreviewAcceptance.restartSafe !== false,
      accepted: normalizedAcceptance.acceptedItems.includes('profile_preview'),
      required: true,
      nextStep: profilePreviewAcceptance.readiness?.nextAction
        ?? profilePreviewAcceptance.exportSummary?.nextAction
        ?? 'publish_profile_preview_ready',
      evidence: {
        awaitingAcceptance: profilePreviewAcceptance.validationSummary?.awaitingAcceptance ?? 0,
        missingClaims: profilePreviewAcceptance.validationSummary?.missingClaims ?? 0,
        statusChannel: profilePreviewAcceptance.exportSummary?.statusChannel ?? null,
        nextStepRows: profileNextStepDigest.validationSummary?.totalRows ?? 0,
        visibleNextStepRows: profileNextStepDigest.validationSummary?.visibleRows ?? 0,
        nextActions: profileNextStepDigest.readiness?.nextActions ?? []
      }
    },
    {
      key: 'feature_acceptance',
      label: 'Feature gate acceptance',
      status: featureClientAcceptance.status ?? 'ready',
      restartSafe: featureClientAcceptance.restartSafe !== false,
      accepted: normalizedAcceptance.acceptedItems.includes('feature_acceptance'),
      required: true,
      nextStep: featureClientAcceptance.readiness?.nextAction
        ?? featureClientAcceptance.exportSummary?.nextAction
        ?? 'publish_feature_client_acceptance_ready',
      evidence: {
        awaitingAcceptance: featureClientAcceptance.validationSummary?.awaitingAcceptance ?? 0,
        deniedEffects: featureClientAcceptance.validationSummary?.deniedEffects ?? 0,
        blockedRows: featureClientAcceptance.exportSummary?.blockedRows ?? [],
        nextStepRows: featureNextStepDigest.validationSummary?.totalRows ?? 0,
        visibleNextStepRows: featureNextStepDigest.validationSummary?.visibleRows ?? 0,
        nextActions: featureNextStepDigest.readiness?.nextActions ?? []
      }
    },
    {
      key: 'feature_launch_preview',
      label: 'Feature launch preview',
      status: featureLaunchPreview.status ?? 'ready',
      restartSafe: featureLaunchPreview.restartSafe !== false,
      accepted: normalizedAcceptance.acceptedItems.includes('feature_launch_preview'),
      required: normalizedAcceptance.requiredItems.length === 0 || normalizedAcceptance.requiredItems.includes('feature_launch_preview'),
      nextStep: featureLaunchPreview.readiness?.nextAction
        ?? featureLaunchPreview.exportSummary?.nextAction
        ?? 'publish_feature_launch_preview_ready',
      evidence: {
        visibleRows: featureLaunchPreview.validationSummary?.visibleRows ?? 0,
        blockedRows: featureLaunchPreview.exportSummary?.blockedRows ?? [],
        degradedRows: featureLaunchPreview.exportSummary?.degradedRows ?? []
      }
    },
    {
      key: 'import_acceptance',
      label: 'Import acceptance',
      status: importClientAcceptance.status ?? 'ready',
      restartSafe: importClientAcceptance.restartSafe !== false,
      accepted: normalizedAcceptance.acceptedItems.includes('import_acceptance'),
      required: true,
      nextStep: importClientAcceptance.readiness?.nextAction
        ?? importClientAcceptance.exportSummary?.nextAction
        ?? 'publish_import_client_acceptance_ready',
      evidence: {
        awaitingAcceptance: importClientAcceptance.validationSummary?.awaitingAcceptance ?? 0,
        crossTenantBlocked: importClientAcceptance.validationSummary?.crossTenantBlocked ?? 0,
        blockedImports: importClientAcceptance.exportSummary?.blockedImports ?? []
      }
    },
    {
      key: 'client_workflow',
      label: 'Client workflow handoff',
      status: clientWorkflowHandoff.status ?? 'ready',
      restartSafe: clientWorkflowHandoff.restartSafe !== false,
      accepted: normalizedAcceptance.acceptedItems.includes('client_workflow'),
      required: normalizedAcceptance.requiredItems.length === 0 || normalizedAcceptance.requiredItems.includes('client_workflow'),
      nextStep: clientWorkflowHandoff.nextAction ?? clientWorkflowHandoff.handoff?.nextAction ?? 'publish_client_workflow_ready',
      evidence: {
        visibleRowCount: clientWorkflowHandoff.exportSummary?.visibleRowCount ?? 0,
        blockedComponents: clientWorkflowHandoff.blockedComponents ?? [],
        degradedComponents: clientWorkflowHandoff.degradedComponents ?? []
      }
    },
    {
      key: 'export_readiness',
      label: 'Export readiness',
      status: exportReadiness.status ?? 'ready',
      restartSafe: exportReadiness.restartSafe !== false,
      accepted: normalizedAcceptance.acceptedItems.includes('export_readiness'),
      required: true,
      nextStep: exportReadiness.nextAction ?? exportReadiness.handoff?.nextAction ?? 'publish_mailchimp_export_ready',
      evidence: {
        blockedComponents: exportReadiness.blockedComponents ?? [],
        degradedComponents: exportReadiness.degradedComponents ?? [],
        actionCount: exportReadiness.exportSummary?.actionPlan?.actionCount ?? 0
      }
    }
  ];
  const requiredRows = rows.filter((row) => row.required);
  const blockedRows = requiredRows.filter((row) => row.status === 'blocked' || row.status === 'operator_review');
  const degradedRows = requiredRows.filter((row) => (
    row.status === 'degraded'
    || row.status === 'recovering'
    || row.status === 'enabled_degraded'
    || row.status === 'retry_scheduled'
    || row.status === 'paused'
    || row.status === 'disabled'
    || row.restartSafe === false
  ));
  const awaitingAcceptance = requiredRows.filter((row) => row.accepted !== true);
  const diagnostics = [
    ...(explicitAcceptance
      ? awaitingAcceptance.map((row) => ({
        level: 'error',
        code: 'module_launch_acceptance_missing',
        subject: row.key
      }))
      : awaitingAcceptance.map((row) => ({
        level: 'warning',
        code: 'module_launch_acceptance_pending',
        subject: row.key
      }))),
    ...(operationsStatus.status === 'blocked' ? [{
      level: 'error',
      code: 'module_launch_operations_blocked',
      subject: operation
    }] : []),
    ...(operationsStatus.status === 'degraded' ? [{
      level: 'warning',
      code: 'module_launch_operations_degraded',
      subject: operation
    }] : [])
  ];
  const status = diagnostics.some((item) => item.level === 'error') || blockedRows.length > 0
    ? 'blocked'
    : diagnostics.some((item) => item.level === 'warning') || degradedRows.length > 0
      ? 'degraded'
      : 'ready';
  const fingerprint = moduleLaunchAcceptanceFingerprint({
    operation,
    status,
    rows,
    acceptedItems: normalizedAcceptance.acceptedItems
  });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = previous.sequence + (changed ? 1 : 0);
  const nextAction = status === 'blocked'
    ? 'resolve_module_launch_acceptance_blockers'
    : status === 'degraded'
      ? 'publish_module_launch_acceptance_degraded'
      : changed
        ? 'publish_module_launch_acceptance_ready'
        : 'reuse_module_launch_acceptance';

  return {
    schemaVersion: MODULE_SYNTAX_SCHEMA_VERSION,
    title: 'mailchimp_module_launch_acceptance',
    operation,
    status,
    restartSafe: status === 'ready' && requiredRows.every((row) => row.restartSafe !== false),
    sequence,
    fingerprint,
    changed,
    generatedAt: clean(now) || null,
    package: {
      rows,
      acceptedItems: normalizedAcceptance.acceptedItems,
      acceptedAt: normalizedAcceptance.acceptedAt,
      acceptedBy: normalizedAcceptance.acceptedBy,
      requireExplicitAcceptance: explicitAcceptance
    },
    validationSummary: {
      totalRows: rows.length,
      requiredRows: requiredRows.length,
      blockedRows: blockedRows.length,
      degradedRows: degradedRows.length,
      awaitingAcceptance: awaitingAcceptance.length,
      profileNextStepRows: profileNextStepDigest.validationSummary?.totalRows ?? 0,
      featureNextStepRows: featureNextStepDigest.validationSummary?.totalRows ?? 0,
      visibleNextStepRows: (profileNextStepDigest.validationSummary?.visibleRows ?? 0)
        + (featureNextStepDigest.validationSummary?.visibleRows ?? 0),
      diagnosticErrors: diagnostics.filter((item) => item.level === 'error').length,
      diagnosticWarnings: diagnostics.filter((item) => item.level === 'warning').length
    },
    readiness: {
      status,
      blockingReasons: unique([
        ...blockedRows.map((row) => row.key),
        ...(operationsStatus.blockingReasons ?? [])
      ]),
      degradedReasons: unique([
        ...degradedRows.map((row) => row.key),
        ...(operationsStatus.degradedReasons ?? []),
        ...(!explicitAcceptance && awaitingAcceptance.length > 0 ? ['acceptance_pending'] : [])
      ]),
      nextAction
    },
    handoff: {
      target: 'kernel.status.mailchimp.module.launch',
      statusChannel: 'kernel.status.mailchimp',
      publish: changed || status !== 'ready' || awaitingAcceptance.length > 0,
      severity: status === 'blocked' ? 'error' : status === 'degraded' ? 'warning' : 'info',
      includePackage: true,
      includeValidationSummary: true,
      nextAction
    },
    exportSummary: {
      schemaVersion: MODULE_SYNTAX_SCHEMA_VERSION,
      title: 'mailchimp_module_launch_acceptance',
      operation,
      status,
      restartSafe: status === 'ready' && requiredRows.every((row) => row.restartSafe !== false),
      sequence,
      fingerprint,
      changed,
      blockedRows: blockedRows.map((row) => row.key),
      degradedRows: degradedRows.map((row) => row.key),
      awaitingAcceptance: awaitingAcceptance.map((row) => row.key),
      previewNextActions: unique([
        ...(profileNextStepDigest.readiness?.nextActions ?? []),
        ...(featureNextStepDigest.readiness?.nextActions ?? [])
      ]),
      nextAction
    },
    diagnostics
  };
}

export function buildModuleMailchimpOperationsPack({
  operation = 'campaign.sync',
  profileOperationalHealth = {},
  profilePrimaryPack = {},
  profileAudienceLedger = {},
  gateAnalytics = {},
  featureCommandPlan = {},
  featureLifecycleReadiness = {},
  importHistoryExport = {},
  importClientReadiness = {},
  importClientPreviewDigest = {},
  importLifecycle = {},
  importProviderContract = {},
  importProviderReadiness = {},
  importProviderAdoption = {},
  importRuntimeAdoption = {},
  profileProviderService = {},
  profileProviderAdoption = {},
  providerAdoption = {},
  profileActivation = {},
  profileRuntimeAdoption = {},
  profileRequestKernelBinding = {},
  profileRestartStatusLedger = {},
  providerGatePreview = {},
  operationalStatus = {},
  operationalActionPlan = {},
  exportReadiness = {},
  clientWorkflowHandoff = {},
  launchAcceptance = {},
  moduleRuntimeAdoption = {},
  diagnostics = [],
  previousPack = {},
  now = null
} = {}) {
  const previous = normalizeModuleOperationsPackHistory(previousPack);
  const rows = [
    {
      component: 'profile_health',
      status: profileOperationalHealth.status ?? 'ready',
      restartSafe: profileOperationalHealth.restartSafe !== false,
      nextAction: profileOperationalHealth.exportSummary?.nextAction ?? profileOperationalHealth.handoff?.nextAction ?? null,
      handoff: profileOperationalHealth.handoff ?? null,
      summary: profileOperationalHealth.exportSummary ?? null
    },
    {
      component: 'profile_primary_pack',
      status: profilePrimaryPack.status ?? 'ready',
      restartSafe: profilePrimaryPack.restartSafe !== false,
      nextAction: profilePrimaryPack.exportSummary?.nextAction ?? profilePrimaryPack.handoff?.nextAction ?? null,
      handoff: profilePrimaryPack.handoff ?? null,
      summary: profilePrimaryPack.exportSummary ?? null
    },
    {
      component: 'profile_audience_ledger',
      status: profileAudienceLedger.status ?? 'ready',
      restartSafe: profileAudienceLedger.restartSafe !== false,
      nextAction: profileAudienceLedger.exportSummary?.nextAction ?? profileAudienceLedger.handoff?.nextAction ?? null,
      handoff: profileAudienceLedger.handoff ?? null,
      summary: profileAudienceLedger.exportSummary ?? null
    },
    {
      component: 'feature_gates',
      status: gateAnalytics.exportSummary?.status ?? 'ready',
      restartSafe: gateAnalytics.exportSummary?.restartSafe !== false,
      nextAction: gateAnalytics.exportSummary?.nextAction ?? null,
      handoff: {
        target: 'kernel.status.mailchimp.feature-gates',
        statusChannel: 'kernel.status.mailchimp',
        publish: gateAnalytics.exportSummary?.status !== 'ready'
      },
      summary: gateAnalytics.exportSummary ?? null
    },
    {
      component: 'feature_gate_commands',
      status: featureCommandPlan.status ?? 'ready',
      restartSafe: featureCommandPlan.restartSafe !== false,
      nextAction: featureCommandPlan.exportSummary?.nextAction ?? featureCommandPlan.handoff?.nextAction ?? null,
      handoff: featureCommandPlan.handoff ?? null,
      summary: featureCommandPlan.exportSummary ?? null
    },
    {
      component: 'feature_lifecycle_readiness',
      status: featureLifecycleReadiness.status ?? 'ready',
      restartSafe: featureLifecycleReadiness.restartSafe !== false,
      nextAction: featureLifecycleReadiness.readiness?.nextAction ?? featureLifecycleReadiness.handoff?.nextAction ?? null,
      handoff: featureLifecycleReadiness.handoff ?? null,
      summary: featureLifecycleReadiness.exportSummary ?? null
    },
    {
      component: 'import_history',
      status: importHistoryExport.status ?? 'healthy',
      restartSafe: importHistoryExport.restartSafe !== false,
      nextAction: importHistoryExport.exportSummary?.nextAction ?? importHistoryExport.handoff?.nextAction ?? null,
      handoff: importHistoryExport.handoff ?? null,
      summary: importHistoryExport.exportSummary ?? null
    },
    {
      component: 'import_client_readiness',
      status: importClientReadiness.status ?? 'ready',
      restartSafe: importClientReadiness.restartSafe !== false,
      nextAction: importClientReadiness.exportSummary?.nextAction ?? importClientReadiness.handoff?.nextAction ?? null,
      handoff: importClientReadiness.handoff ?? null,
      summary: importClientReadiness.exportSummary ?? null
    },
    {
      component: 'import_client_preview_digest',
      status: importClientPreviewDigest.status ?? 'ready',
      restartSafe: importClientPreviewDigest.restartSafe !== false,
      nextAction: importClientPreviewDigest.readiness?.nextAction ?? importClientPreviewDigest.handoff?.nextAction ?? null,
      handoff: importClientPreviewDigest.handoff ?? null,
      summary: importClientPreviewDigest.exportSummary ?? null
    },
    {
      component: 'import_lifecycle',
      status: importLifecycle.status ?? 'enabled',
      restartSafe: importLifecycle.ok !== false && importLifecycle.status === 'enabled',
      nextAction: importLifecycle.nextAction ?? null,
      handoff: importLifecycle.handoff ?? null,
      summary: {
        controls: importLifecycle.controls ?? null,
        schedule: importLifecycle.schedule ?? null
      }
    },
    {
      component: 'import_provider',
      status: importProviderContract.status ?? 'ready',
      restartSafe: importProviderContract.restartSafe !== false,
      nextAction: importProviderContract.status === 'blocked'
        ? 'repair_import_provider_contract'
        : importProviderContract.status === 'degraded'
          ? 'publish_import_provider_degraded_status'
          : null,
      handoff: importProviderContract.externalHandoff ?? null,
      summary: importProviderContract.capabilityNegotiation ?? null
    },
    {
      component: 'import_provider_readiness',
      status: importProviderReadiness.status ?? 'ready',
      restartSafe: importProviderReadiness.restartSafe !== false,
      nextAction: importProviderReadiness.readiness?.nextAction ?? importProviderReadiness.handoff?.nextAction ?? null,
      handoff: importProviderReadiness.handoff ?? null,
      summary: importProviderReadiness.exportSummary ?? null
    },
    {
      component: 'import_provider_adoption',
      status: importProviderAdoption.status ?? 'ready',
      restartSafe: importProviderAdoption.restartSafe !== false,
      nextAction: importProviderAdoption.readiness?.nextAction ?? importProviderAdoption.handoff?.nextAction ?? null,
      handoff: importProviderAdoption.handoff ?? null,
      summary: importProviderAdoption.exportSummary ?? null
    },
    {
      component: 'import_runtime_adoption',
      status: importRuntimeAdoption.status ?? 'ready',
      restartSafe: importRuntimeAdoption.restartSafe !== false,
      nextAction: importRuntimeAdoption.readiness?.nextAction ?? importRuntimeAdoption.handoff?.nextAction ?? null,
      handoff: importRuntimeAdoption.handoff ?? null,
      summary: importRuntimeAdoption.exportSummary ?? null
    },
    {
      component: 'profile_provider',
      status: profileProviderService.status ?? 'ready',
      restartSafe: profileProviderService.restartSafe !== false,
      nextAction: profileProviderService.handoff?.nextAction ?? null,
      handoff: profileProviderService.handoff ?? null,
      summary: profileProviderService.negotiation ?? null
    },
    {
      component: 'profile_provider_adoption',
      status: profileProviderAdoption.status ?? 'ready',
      restartSafe: profileProviderAdoption.restartSafe !== false,
      nextAction: profileProviderAdoption.readiness?.nextAction ?? profileProviderAdoption.handoff?.nextAction ?? null,
      handoff: profileProviderAdoption.handoff ?? null,
      summary: profileProviderAdoption.exportSummary ?? null
    },
    {
      component: 'provider_adoption',
      status: providerAdoption.status ?? 'ready',
      restartSafe: providerAdoption.restartSafe !== false,
      nextAction: providerAdoption.readiness?.nextAction ?? providerAdoption.handoff?.nextAction ?? null,
      handoff: providerAdoption.handoff ?? null,
      summary: providerAdoption.exportSummary ?? null
    },
    {
      component: 'profile_activation',
      status: profileActivation.status ?? 'ready',
      restartSafe: profileActivation.restartSafe !== false,
      nextAction: profileActivation.readiness?.nextAction ?? profileActivation.handoff?.nextAction ?? null,
      handoff: profileActivation.handoff ?? null,
      summary: profileActivation.exportSummary ?? null
    },
    {
      component: 'profile_runtime_adoption',
      status: profileRuntimeAdoption.status ?? 'ready',
      restartSafe: profileRuntimeAdoption.restartSafe !== false,
      nextAction: profileRuntimeAdoption.readiness?.nextAction ?? profileRuntimeAdoption.handoff?.nextAction ?? null,
      handoff: profileRuntimeAdoption.handoff ?? null,
      summary: profileRuntimeAdoption.exportSummary ?? null
    },
    {
      component: 'profile_request_kernel_binding',
      status: profileRequestKernelBinding.status ?? 'ready',
      restartSafe: profileRequestKernelBinding.restartSafe !== false,
      nextAction: profileRequestKernelBinding.readiness?.nextAction ?? profileRequestKernelBinding.handoff?.nextAction ?? null,
      handoff: profileRequestKernelBinding.handoff ?? null,
      summary: profileRequestKernelBinding.exportSummary ?? null
    },
    {
      component: 'profile_restart_status_ledger',
      status: profileRestartStatusLedger.status ?? 'ready',
      restartSafe: profileRestartStatusLedger.restartSafe !== false,
      nextAction: profileRestartStatusLedger.exportSummary?.nextAction ?? profileRestartStatusLedger.handoff?.nextAction ?? null,
      handoff: profileRestartStatusLedger.handoff ?? null,
      summary: profileRestartStatusLedger.exportSummary ?? null
    },
    {
      component: 'module_runtime_adoption',
      status: moduleRuntimeAdoption.status ?? 'ready',
      restartSafe: moduleRuntimeAdoption.restartSafe !== false,
      nextAction: moduleRuntimeAdoption.readiness?.nextAction ?? moduleRuntimeAdoption.handoff?.nextAction ?? null,
      handoff: moduleRuntimeAdoption.handoff ?? null,
      summary: moduleRuntimeAdoption.exportSummary ?? null
    },
    {
      component: 'provider_preview',
      status: providerGatePreview.status ?? 'ready',
      restartSafe: providerGatePreview.restartSafe !== false,
      nextAction: providerGatePreview.readiness?.nextAction ?? providerGatePreview.exportSummary?.nextAction ?? null,
      handoff: {
        target: 'kernel.status.mailchimp.provider-preview',
        statusChannel: 'kernel.status.mailchimp',
        publish: providerGatePreview.status !== 'ready'
      },
      summary: providerGatePreview.exportSummary ?? null
    },
    {
      component: 'client_workflow',
      status: clientWorkflowHandoff.status ?? 'ready',
      restartSafe: clientWorkflowHandoff.restartSafe !== false,
      nextAction: clientWorkflowHandoff.nextAction ?? clientWorkflowHandoff.handoff?.nextAction ?? null,
      handoff: clientWorkflowHandoff.handoff ?? null,
      summary: clientWorkflowHandoff.exportSummary ?? null
    },
    {
      component: 'launch_acceptance',
      status: launchAcceptance.status ?? 'ready',
      restartSafe: launchAcceptance.restartSafe !== false,
      nextAction: launchAcceptance.readiness?.nextAction ?? launchAcceptance.handoff?.nextAction ?? null,
      handoff: launchAcceptance.handoff ?? null,
      summary: launchAcceptance.exportSummary ?? null
    },
    {
      component: 'export_readiness',
      status: exportReadiness.status ?? 'ready',
      restartSafe: exportReadiness.restartSafe !== false,
      nextAction: exportReadiness.nextAction ?? exportReadiness.handoff?.nextAction ?? null,
      handoff: exportReadiness.handoff ?? null,
      summary: exportReadiness.exportSummary ?? null
    }
  ];
  const blockedComponents = rows
    .filter((row) => row.status === 'blocked' || row.status === 'operator_review')
    .map((row) => row.component);
  const degradedComponents = rows
    .filter((row) => (
      row.status === 'degraded'
      || row.status === 'recovering'
      || row.status === 'enabled_degraded'
      || row.status === 'retry_scheduled'
      || row.status === 'paused'
      || row.status === 'disabled'
      || row.status === 'status_acknowledged'
      || row.status === 'healthy' && row.restartSafe === false
    ))
    .map((row) => row.component);
  const diagnosticErrors = diagnostics.filter((item) => item.level === 'error').length;
  const diagnosticWarnings = diagnostics.filter((item) => item.level === 'warning').length;
  const status = diagnosticErrors > 0 || blockedComponents.length > 0 || operationalStatus.status === 'blocked'
    ? 'blocked'
    : degradedComponents.length > 0 || diagnosticWarnings > 0 || operationalStatus.status === 'degraded'
      ? 'degraded'
      : 'ready';
  const actionQueue = mergeModuleOperationActions({
    profileOperationalHealth,
    operationalActionPlan,
    rows,
    status
  });
  const fingerprint = moduleOperationsPackFingerprint({
    operation,
    status,
    rows,
    actionQueue,
    diagnosticErrors,
    diagnosticWarnings
  });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = previous.sequence + (changed ? 1 : 0);
  const event = {
    sequence,
    timestamp: clean(now) || null,
    operation,
    status,
    fingerprint,
    blockedComponents: blockedComponents.length,
    degradedComponents: degradedComponents.length,
    actionCount: actionQueue.length,
    restartSafe: status === 'ready' && rows.every((row) => row.restartSafe !== false),
    changed
  };
  const timeline = [
    ...previous.timeline,
    ...(changed || previous.timeline.length === 0 ? [event] : [])
  ].slice(-12);
  const statusCounts = timeline.reduce((counts, item) => {
    counts[item.status] = (counts[item.status] ?? 0) + 1;
    return counts;
  }, {});
  const nextAction = status === 'blocked'
    ? 'operator_mailchimp_operations_review'
    : actionQueue.find((item) => item.severity === 'warning')?.action
      ?? (status === 'degraded' ? 'publish_mailchimp_operations_degraded_status' : 'publish_mailchimp_operations_ready');

  return {
    schemaVersion: MODULE_SYNTAX_SCHEMA_VERSION,
    title: 'mailchimp_module_operations_pack',
    operation,
    status,
    restartSafe: status === 'ready'
      && rows.every((row) => row.restartSafe !== false)
      && operationalStatus.restartSafe === true
      && exportReadiness.restartSafe === true,
    sequence,
    fingerprint,
    changed,
    rows,
    blockedComponents,
    degradedComponents,
    counters: {
      components: rows.length,
      blocked: blockedComponents.length,
      degraded: degradedComponents.length,
      actions: actionQueue.length,
      diagnosticErrors,
      diagnosticWarnings,
      profileHealthActions: profileOperationalHealth.actionQueue?.length ?? 0,
      profilePrimaryPackChanged: profilePrimaryPack.changed === true ? 1 : 0,
      profileAudienceLedgerChanged: profileAudienceLedger.changed === true ? 1 : 0,
      featureCommandPlanChanged: featureCommandPlan.changed === true ? 1 : 0,
      featureLifecycleReadinessChanged: featureLifecycleReadiness.changed === true ? 1 : 0,
      importClientReadinessChanged: importClientReadiness.changed === true ? 1 : 0,
      importClientPreviewDigestChanged: importClientPreviewDigest.changed === true ? 1 : 0,
      profileRequestKernelBindingChanged: profileRequestKernelBinding.changed === true ? 1 : 0,
      moduleRuntimeAdoptionChanged: moduleRuntimeAdoption.changed === true ? 1 : 0,
      operationalActions: operationalActionPlan.actionCount ?? 0
    },
    actionQueue,
    history: {
      sequence,
      timeline,
      statusCounts
    },
    handoff: {
      target: 'kernel.status.mailchimp.operations',
      statusChannel: 'kernel.status.mailchimp',
      publish: true,
      severity: status === 'blocked' ? 'error' : status === 'degraded' ? 'warning' : 'info',
      includeRows: true,
      includeActionQueue: actionQueue.length > 0,
      includeTimeline: true,
      nextAction
    },
    exportSummary: {
      schemaVersion: MODULE_SYNTAX_SCHEMA_VERSION,
      title: 'mailchimp_module_operations_pack',
      operation,
      status,
      restartSafe: status === 'ready' && operationalStatus.restartSafe === true,
      sequence,
      fingerprint,
      blockedComponents,
      degradedComponents,
      actionCount: actionQueue.length,
      profilePrimaryPack: profilePrimaryPack.exportSummary ?? null,
      profileAudienceLedger: profileAudienceLedger.exportSummary ?? null,
      featureCommandPlan: featureCommandPlan.exportSummary ?? null,
      featureLifecycleReadiness: featureLifecycleReadiness.exportSummary ?? null,
      importClientReadiness: importClientReadiness.exportSummary ?? null,
      importClientPreviewDigest: importClientPreviewDigest.exportSummary ?? null,
      profileRequestKernelBinding: profileRequestKernelBinding.exportSummary ?? null,
      moduleRuntimeAdoption: moduleRuntimeAdoption.exportSummary ?? null,
      launchAcceptance: launchAcceptance.exportSummary ?? null,
      nextAction
    }
  };
}

export function buildModuleStatusPublicationFeed({
  operation = 'campaign.sync',
  profileStatusPublication = {},
  featureGatePublication = {},
  importProviderSyncPublication = {},
  importProviderSyncBridge = {},
  operationsPack = {},
  operationalStatus = {},
  previousPublication = {},
  now = null,
  maxPublicationAgeMs = 120000
} = {}) {
  const previous = normalizeModuleStatusPublicationHistory(previousPublication);
  const maxAge = toNonNegativeInteger(maxPublicationAgeMs, 120000);
  const rows = [
    moduleStatusPublicationRow('profile_status', profileStatusPublication, {
      required: true,
      publication: profileStatusPublication.publication,
      summary: profileStatusPublication.exportSummary
    }),
    moduleStatusPublicationRow('feature_gate_status', featureGatePublication, {
      required: true,
      publication: featureGatePublication.publication,
      summary: featureGatePublication.exportSummary
    }),
    moduleStatusPublicationRow('import_provider_sync', importProviderSyncPublication, {
      required: true,
      publication: importProviderSyncPublication.publication,
      summary: importProviderSyncPublication.exportSummary
    }),
    moduleStatusPublicationRow('import_provider_sync_bridge', importProviderSyncBridge, {
      required: true,
      publication: importProviderSyncBridge.handoff,
      summary: importProviderSyncBridge.exportSummary
    }),
    moduleStatusPublicationRow('operations_pack', operationsPack, {
      required: true,
      publication: operationsPack.handoff,
      summary: operationsPack.exportSummary
    }),
    moduleStatusPublicationRow('operational_status', operationalStatus, {
      required: false,
      publication: operationalStatus.handoff,
      summary: operationalStatus.exportSummary
    })
  ];
  const staleRows = rows.filter((row) => (
    row.summary?.fingerprint
    && previous.rowFingerprints[row.id] === row.summary.fingerprint
    && previous.ageMs > maxAge
  ));
  const blockedRows = rows.filter((row) => row.status === 'blocked' || row.required && row.restartSafe === false);
  const degradedRows = rows.filter((row) => (
    row.status === 'degraded'
    || row.status === 'guarded'
    || row.status === 'retry_scheduled'
    || row.status === 'paused'
    || staleRows.some((staleRow) => staleRow.id === row.id)
  ));
  const status = blockedRows.length > 0 || operationsPack.status === 'blocked'
    ? 'blocked'
    : degradedRows.length > 0 || operationsPack.status === 'degraded'
      ? 'degraded'
      : 'ready';
  const fingerprint = moduleStatusPublicationFingerprint({
    operation,
    status,
    rows,
    staleRows
  });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = changed ? previous.sequence + 1 : previous.sequence;
  const nextAction = status === 'blocked'
    ? 'publish_module_status_blocked'
    : status === 'degraded'
      ? 'publish_module_status_degraded'
      : changed
        ? 'publish_module_status_ready'
        : 'reuse_module_status_publication';
  const diagnostics = [
    ...(profileStatusPublication.diagnostics ?? []).filter((item) => item.level === 'error'),
    ...(featureGatePublication.diagnostics ?? []).filter((item) => item.level === 'error'),
    ...(importProviderSyncPublication.diagnostics ?? []).filter((item) => item.level === 'error'),
    ...(importProviderSyncBridge.diagnostics ?? []).filter((item) => item.level === 'error'),
    ...staleRows.map((row) => ({
      level: 'warning',
      code: 'module_status_publication_row_stale',
      subject: row.id
    }))
  ];

  return {
    ok: status !== 'blocked',
    schemaVersion: MODULE_SYNTAX_SCHEMA_VERSION,
    title: 'mailchimp_module_status_publication',
    operation,
    status,
    restartSafe: status === 'ready' && rows.every((row) => row.restartSafe !== false),
    sequence,
    fingerprint,
    changed,
    rows,
    blockedRows: blockedRows.map((row) => row.id).sort(),
    degradedRows: degradedRows.map((row) => row.id).sort(),
    counters: {
      rows: rows.length,
      publishRows: rows.filter((row) => row.publish).length,
      blocked: blockedRows.length,
      degraded: degradedRows.length,
      stale: staleRows.length,
      diagnosticErrors: diagnostics.filter((item) => item.level === 'error').length,
      diagnosticWarnings: diagnostics.filter((item) => item.level === 'warning').length
    },
    history: {
      sequence,
      timeline: [
        ...previous.timeline,
        ...(changed || previous.timeline.length === 0 ? [{
          sequence,
          timestamp: clean(now) || null,
          operation,
          status,
          fingerprint,
          blockedRows: blockedRows.length,
          degradedRows: degradedRows.length,
          staleRows: staleRows.length,
          publishRows: rows.filter((row) => row.publish).length
        }] : [])
      ].slice(-12)
    },
    handoff: {
      target: 'kernel.status.mailchimp.module-publication',
      statusChannel: 'kernel.status.mailchimp',
      publish: changed || status !== 'ready' || staleRows.length > 0,
      severity: status === 'blocked' ? 'error' : status === 'degraded' ? 'warning' : 'info',
      includeRows: true,
      includeOperationsPack: operationsPack.status !== 'ready',
      nextAction
    },
    exportSummary: {
      schemaVersion: MODULE_SYNTAX_SCHEMA_VERSION,
      title: 'mailchimp_module_status_publication',
      operation,
      status,
      restartSafe: status === 'ready' && rows.every((row) => row.restartSafe !== false),
      sequence,
      fingerprint,
      changed,
      blockedRows: blockedRows.map((row) => row.id).sort(),
      degradedRows: degradedRows.map((row) => row.id).sort(),
      staleRows: staleRows.map((row) => row.id).sort(),
      nextAction
    },
    diagnostics
  };
}

export function buildModuleLaunchPublicationDigest({
  operation = 'campaign.sync',
  moduleStatusPublication = {},
  operationsPack = {},
  launchAcceptance = {},
  clientWorkflowHandoff = {},
  exportReadiness = {},
  importClientPreviewDigest = {},
  moduleRuntimeAdoption = {},
  previousDigest = {},
  now = null,
  requireExplicitAcceptance = false
} = {}) {
  const previous = normalizeModuleLaunchPublicationDigest(previousDigest);
  const rows = [
    moduleLaunchPublicationRow('module_status', moduleStatusPublication, {
      required: true,
      handoff: moduleStatusPublication.handoff,
      summary: moduleStatusPublication.exportSummary
    }),
    moduleLaunchPublicationRow('operations_pack', operationsPack, {
      required: true,
      handoff: operationsPack.handoff,
      summary: operationsPack.exportSummary
    }),
    moduleLaunchPublicationRow('launch_acceptance', launchAcceptance, {
      required: true,
      handoff: launchAcceptance.handoff,
      summary: launchAcceptance.exportSummary,
      acceptanceRequired: requireExplicitAcceptance
    }),
    moduleLaunchPublicationRow('client_workflow', clientWorkflowHandoff, {
      required: true,
      handoff: clientWorkflowHandoff.handoff,
      summary: clientWorkflowHandoff.exportSummary
    }),
    moduleLaunchPublicationRow('export_readiness', exportReadiness, {
      required: true,
      handoff: exportReadiness.handoff,
      summary: exportReadiness.exportSummary
    }),
    moduleLaunchPublicationRow('import_preview_digest', importClientPreviewDigest, {
      required: true,
      handoff: importClientPreviewDigest.handoff,
      summary: importClientPreviewDigest.exportSummary,
      acceptanceRequired: requireExplicitAcceptance
    }),
    moduleLaunchPublicationRow('runtime_adoption', moduleRuntimeAdoption, {
      required: false,
      handoff: moduleRuntimeAdoption.handoff,
      summary: moduleRuntimeAdoption.exportSummary
    })
  ];
  const blockedRows = rows.filter((row) => row.status === 'blocked' || row.required && row.restartSafe === false);
  const guardedRows = rows.filter((row) => (
    row.status === 'guarded'
    || row.status === 'degraded'
    || row.status === 'retry_scheduled'
    || row.status === 'paused'
    || row.acceptanceRequired && row.accepted !== true
  ));
  const publishRows = rows.filter((row) => row.publish || row.status !== 'ready' || row.changed === true);
  const status = blockedRows.length > 0
    ? 'blocked'
    : guardedRows.length > 0
      ? 'guarded'
      : 'ready';
  const fingerprint = moduleLaunchPublicationFingerprint({
    operation,
    status,
    rows,
    publishRows
  });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = previous.sequence + (changed ? 1 : 0);
  const diagnostics = [
    ...(moduleStatusPublication.diagnostics ?? []).filter((item) => item.level === 'error'),
    ...(importClientPreviewDigest.diagnostics ?? []).filter((item) => (
      requireExplicitAcceptance ? item.level === 'error' : item.level === 'fatal'
    )),
    ...blockedRows.map((row) => ({
      level: 'error',
      code: 'module_launch_publication_row_blocked',
      subject: row.id
    })),
    ...guardedRows
      .filter((row) => !blockedRows.some((blocked) => blocked.id === row.id))
      .map((row) => ({
        level: 'warning',
        code: 'module_launch_publication_row_guarded',
        subject: row.id
      }))
  ];
  const finalStatus = diagnostics.some((item) => item.level === 'error') || status === 'blocked'
    ? 'blocked'
    : diagnostics.some((item) => item.level === 'warning') || status === 'guarded'
      ? 'guarded'
      : 'ready';
  const timeline = [
    ...previous.timeline,
    ...(changed || previous.timeline.length === 0 ? [{
      sequence,
      timestamp: clean(now) || null,
      operation,
      status: finalStatus,
      fingerprint,
      blockedRows: blockedRows.length,
      guardedRows: guardedRows.length,
      publishRows: publishRows.length,
      changed
    }] : [])
  ].slice(-12);
  const nextAction = finalStatus === 'blocked'
    ? firstModuleLaunchAction(blockedRows, 'resolve_module_launch_publication_blockers')
    : finalStatus === 'guarded'
      ? firstModuleLaunchAction(guardedRows, 'publish_module_launch_publication_guarded')
      : changed
        ? 'publish_module_launch_publication_ready'
        : 'reuse_module_launch_publication_digest';

  return {
    ok: finalStatus !== 'blocked',
    schemaVersion: MODULE_SYNTAX_SCHEMA_VERSION,
    title: 'mailchimp_module_launch_publication_digest',
    operation,
    status: finalStatus,
    restartSafe: finalStatus === 'ready' && rows.every((row) => row.restartSafe !== false),
    sequence,
    fingerprint,
    changed,
    rows,
    blockedRows: blockedRows.map((row) => row.id).sort(),
    guardedRows: guardedRows.map((row) => row.id).sort(),
    publishRows: publishRows.map((row) => row.id).sort(),
    counters: {
      rows: rows.length,
      blocked: blockedRows.length,
      guarded: guardedRows.length,
      publishRows: publishRows.length,
      acceptanceRequired: rows.filter((row) => row.acceptanceRequired).length,
      accepted: rows.filter((row) => row.accepted).length,
      diagnosticErrors: diagnostics.filter((item) => item.level === 'error').length,
      diagnosticWarnings: diagnostics.filter((item) => item.level === 'warning').length
    },
    readiness: {
      status: finalStatus,
      blockingReasons: unique(blockedRows.flatMap((row) => [row.id, ...row.reasons])),
      guardedReasons: unique(guardedRows.flatMap((row) => [row.id, ...row.reasons])),
      nextAction
    },
    history: {
      sequence,
      timeline,
      statusCounts: timeline.reduce((counts, item) => {
        counts[item.status] = (counts[item.status] ?? 0) + 1;
        return counts;
      }, {})
    },
    handoff: {
      target: 'kernel.status.mailchimp.module-launch',
      statusChannel: 'kernel.status.mailchimp',
      publish: changed || finalStatus !== 'ready' || publishRows.length > 0,
      severity: finalStatus === 'blocked' ? 'error' : finalStatus === 'guarded' ? 'warning' : 'info',
      includeRows: true,
      includeAcceptance: rows.some((row) => row.acceptanceRequired),
      includeOperationsPack: operationsPack.status !== 'ready',
      nextAction
    },
    exportSummary: {
      schemaVersion: MODULE_SYNTAX_SCHEMA_VERSION,
      title: 'mailchimp_module_launch_publication_digest',
      operation,
      status: finalStatus,
      restartSafe: finalStatus === 'ready' && rows.every((row) => row.restartSafe !== false),
      sequence,
      fingerprint,
      changed,
      blockedRows: blockedRows.map((row) => row.id).sort(),
      guardedRows: guardedRows.map((row) => row.id).sort(),
      publishRows: publishRows.map((row) => row.id).sort(),
      nextAction
    },
    diagnostics
  };
}

export function buildModuleLaunchGateControl({
  operation = 'campaign.sync',
  profileLaunchControls = {},
  featureLaunchPreview = {},
  importProviderLaunchGate = {},
  moduleReleaseEvidence = {},
  moduleStatusPublication = {},
  moduleLaunchPublicationDigest = {},
  launchAcceptance = {},
  clientWorkflowHandoff = {},
  previousGate = {},
  allowDegradedLaunch = false,
  requireExplicitAcceptance = false,
  now = null,
  historyLimit = 12
} = {}) {
  const previous = normalizeModuleLaunchPublicationDigest(previousGate);
  const rows = [
    moduleLaunchGateRow('profile_launch_controls', profileLaunchControls, {
      required: true,
      restartSafe: profileLaunchControls.restartSafe,
      handoff: profileLaunchControls.handoff,
      summary: profileLaunchControls.exportSummary
    }),
    moduleLaunchGateRow('feature_launch_preview', featureLaunchPreview, {
      required: true,
      restartSafe: featureLaunchPreview.restartSafe,
      handoff: featureLaunchPreview.handoff,
      summary: featureLaunchPreview.exportSummary
    }),
    moduleLaunchGateRow('import_provider_launch_gate', importProviderLaunchGate, {
      required: true,
      restartSafe: importProviderLaunchGate.restartSafe,
      handoff: importProviderLaunchGate.handoff,
      summary: importProviderLaunchGate.exportSummary
    }),
    moduleLaunchGateRow('release_evidence', moduleReleaseEvidence, {
      required: true,
      restartSafe: moduleReleaseEvidence.restartSafe,
      handoff: moduleReleaseEvidence.handoff,
      summary: moduleReleaseEvidence.exportSummary
    }),
    moduleLaunchGateRow('status_publication', moduleStatusPublication, {
      required: true,
      restartSafe: moduleStatusPublication.restartSafe,
      handoff: moduleStatusPublication.handoff,
      summary: moduleStatusPublication.exportSummary
    }),
    moduleLaunchGateRow('launch_publication_digest', moduleLaunchPublicationDigest, {
      required: true,
      restartSafe: moduleLaunchPublicationDigest.restartSafe,
      handoff: moduleLaunchPublicationDigest.handoff,
      summary: moduleLaunchPublicationDigest.exportSummary
    }),
    moduleLaunchGateRow('launch_acceptance', launchAcceptance, {
      required: requireExplicitAcceptance,
      restartSafe: launchAcceptance.restartSafe,
      handoff: launchAcceptance.handoff,
      summary: launchAcceptance.exportSummary,
      acceptanceRequired: requireExplicitAcceptance
    }),
    moduleLaunchGateRow('client_workflow_handoff', clientWorkflowHandoff, {
      required: false,
      restartSafe: clientWorkflowHandoff.restartSafe,
      handoff: clientWorkflowHandoff.handoff,
      summary: clientWorkflowHandoff.exportSummary
    })
  ];
  const blockedRows = rows.filter((row) => row.required && (
    row.status === 'blocked'
    || row.restartSafe === false
    || row.acceptanceRequired && row.accepted !== true
  ));
  const degradedRows = rows.filter((row) => !blockedRows.some((blocked) => blocked.id === row.id) && (
    row.status === 'degraded'
    || row.status === 'guarded'
    || row.status === 'paused'
    || row.status === 'retry_scheduled'
    || row.publishPending === true
  ));
  const status = blockedRows.length > 0
    ? 'blocked'
    : degradedRows.length > 0
      ? allowDegradedLaunch ? 'degraded' : 'blocked'
      : 'ready';
  const fingerprint = moduleLaunchGateFingerprint({
    operation,
    status,
    allowDegradedLaunch,
    requireExplicitAcceptance,
    rows
  });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = previous.sequence + (changed ? 1 : 0);
  const diagnostics = [
    ...rows
      .filter((row) => row.status === 'blocked' || row.required && row.restartSafe === false)
      .map((row) => ({
        level: 'error',
        code: 'module_launch_gate_row_blocked',
        subject: row.id
      })),
    ...degradedRows.map((row) => ({
      level: allowDegradedLaunch ? 'warning' : 'error',
      code: 'module_launch_gate_row_degraded',
      subject: row.id
    })),
    ...(requireExplicitAcceptance && rows.some((row) => row.acceptanceRequired && row.accepted !== true)
      ? [{
        level: 'error',
        code: 'module_launch_gate_acceptance_missing',
        subject: 'launch_acceptance'
      }]
      : [])
  ];
  const finalStatus = diagnostics.some((item) => item.level === 'error') || status === 'blocked'
    ? 'blocked'
    : diagnostics.some((item) => item.level === 'warning') || status === 'degraded'
      ? 'degraded'
      : 'ready';
  const nextAction = finalStatus === 'blocked'
    ? firstModuleLaunchAction(blockedRows, 'resolve_module_launch_gate_blockers')
    : finalStatus === 'degraded'
      ? firstModuleLaunchAction(degradedRows, 'publish_module_launch_gate_degraded')
      : changed
        ? 'publish_module_launch_gate_ready'
        : 'reuse_module_launch_gate';
  const timeline = [
    ...previous.timeline,
    ...(changed || previous.timeline.length === 0 ? [{
      sequence,
      timestamp: clean(now) || null,
      operation,
      status: finalStatus,
      fingerprint,
      blockedRows: blockedRows.length,
      degradedRows: degradedRows.length,
      restartSafe: finalStatus === 'ready' && rows.every((row) => row.restartSafe !== false)
    }] : [])
  ].slice(-Math.max(1, toNonNegativeInteger(historyLimit, 12)));

  return {
    ok: finalStatus !== 'blocked',
    schemaVersion: MODULE_SYNTAX_SCHEMA_VERSION,
    title: 'mailchimp_module_launch_gate',
    operation,
    status: finalStatus,
    restartSafe: finalStatus === 'ready' && rows.every((row) => row.restartSafe !== false),
    sequence,
    fingerprint,
    changed,
    policy: {
      allowDegradedLaunch,
      requireExplicitAcceptance
    },
    rows,
    validationSummary: {
      totalRows: rows.length,
      blockedRows: blockedRows.length,
      degradedRows: degradedRows.length,
      publishPending: rows.filter((row) => row.publishPending).length,
      restartGuarded: rows.filter((row) => row.restartSafe === false).length,
      diagnosticErrors: diagnostics.filter((item) => item.level === 'error').length,
      diagnosticWarnings: diagnostics.filter((item) => item.level === 'warning').length
    },
    readiness: {
      blockingReasons: unique(blockedRows.flatMap((row) => [row.id, ...row.reasons])),
      degradedReasons: unique(degradedRows.flatMap((row) => [row.id, ...row.reasons])),
      nextAction
    },
    history: {
      sequence,
      timeline,
      statusCounts: timeline.reduce((counts, item) => {
        counts[item.status] = (counts[item.status] ?? 0) + 1;
        return counts;
      }, {})
    },
    handoff: {
      target: 'kernel.status.mailchimp.module-launch-gate',
      statusChannel: finalStatus === 'ready' ? 'kernel.status.mailchimp' : 'local.status.module-launch-gate',
      publish: changed || finalStatus !== 'ready' || rows.some((row) => row.publishPending),
      severity: finalStatus === 'blocked' ? 'error' : finalStatus === 'degraded' ? 'warning' : 'info',
      includeRows: true,
      includePublicationDigest: moduleLaunchPublicationDigest.status !== 'ready',
      nextAction
    },
    exportSummary: {
      schemaVersion: MODULE_SYNTAX_SCHEMA_VERSION,
      title: 'mailchimp_module_launch_gate',
      operation,
      status: finalStatus,
      restartSafe: finalStatus === 'ready' && rows.every((row) => row.restartSafe !== false),
      sequence,
      fingerprint,
      changed,
      blockedRows: blockedRows.map((row) => row.id).sort(),
      degradedRows: degradedRows.map((row) => row.id).sort(),
      nextAction
    },
    diagnostics
  };
}

export function buildModuleClientLaunchReadinessReport({
  operation = 'campaign.sync',
  featureLaunchReadinessLedger = {},
  importLaunchReadinessLedger = {},
  launchAcceptance = {},
  moduleLaunchGate = {},
  moduleLaunchPublicationDigest = {},
  moduleStatusPublication = {},
  clientWorkflowHandoff = {},
  previousReport = {},
  now = null,
  historyLimit = 12
} = {}) {
  const previous = normalizeModuleClientLaunchReadiness(previousReport);
  const timestamp = clean(now) || null;
  const rows = [
    moduleClientLaunchReadinessRow('feature_launch_readiness', 'feature_gates', featureLaunchReadinessLedger, true, {
      status: featureLaunchReadinessLedger.status,
      restartSafe: featureLaunchReadinessLedger.restartSafe,
      clientVisible: (featureLaunchReadinessLedger.exportSummary?.clientVisibleRows ?? []).length > 0,
      fingerprint: featureLaunchReadinessLedger.fingerprint ?? featureLaunchReadinessLedger.exportSummary?.fingerprint,
      nextAction: featureLaunchReadinessLedger.readiness?.nextAction ?? featureLaunchReadinessLedger.handoff?.nextAction ?? featureLaunchReadinessLedger.exportSummary?.nextAction,
      evidence: {
        blockedRows: featureLaunchReadinessLedger.exportSummary?.blockedRows ?? [],
        guardedRows: featureLaunchReadinessLedger.exportSummary?.guardedRows ?? [],
        clientVisibleRows: featureLaunchReadinessLedger.exportSummary?.clientVisibleRows ?? []
      }
    }),
    moduleClientLaunchReadinessRow('import_launch_readiness', 'imports', importLaunchReadinessLedger, true, {
      status: importLaunchReadinessLedger.status,
      restartSafe: importLaunchReadinessLedger.restartSafe,
      clientVisible: (importLaunchReadinessLedger.exportSummary?.clientVisibleRows ?? []).length > 0,
      fingerprint: importLaunchReadinessLedger.fingerprint ?? importLaunchReadinessLedger.exportSummary?.fingerprint,
      nextAction: importLaunchReadinessLedger.readiness?.nextAction ?? importLaunchReadinessLedger.handoff?.nextAction ?? importLaunchReadinessLedger.exportSummary?.nextAction,
      evidence: {
        blockedRows: importLaunchReadinessLedger.exportSummary?.blockedRows ?? [],
        guardedRows: importLaunchReadinessLedger.exportSummary?.guardedRows ?? [],
        clientVisibleRows: importLaunchReadinessLedger.exportSummary?.clientVisibleRows ?? [],
        imports: importLaunchReadinessLedger.exportSummary?.imports ?? []
      }
    }),
    moduleClientLaunchReadinessRow('module_launch_acceptance', 'module', launchAcceptance, true, {
      status: launchAcceptance.status,
      restartSafe: launchAcceptance.restartSafe,
      clientVisible: launchAcceptance.status !== 'ready' || (launchAcceptance.exportSummary?.awaitingAcceptance ?? []).length > 0,
      fingerprint: launchAcceptance.fingerprint ?? launchAcceptance.exportSummary?.fingerprint,
      nextAction: launchAcceptance.readiness?.nextAction ?? launchAcceptance.handoff?.nextAction ?? launchAcceptance.exportSummary?.nextAction,
      evidence: {
        awaitingAcceptance: launchAcceptance.exportSummary?.awaitingAcceptance ?? [],
        rejectedItems: launchAcceptance.exportSummary?.rejectedItems ?? [],
        blockedRows: launchAcceptance.exportSummary?.blockedRows ?? [],
        guardedRows: launchAcceptance.exportSummary?.guardedRows ?? []
      }
    }),
    moduleClientLaunchReadinessRow('module_launch_gate', 'module', moduleLaunchGate, true, {
      status: moduleLaunchGate.status,
      restartSafe: moduleLaunchGate.restartSafe,
      clientVisible: moduleLaunchGate.status !== 'ready',
      fingerprint: moduleLaunchGate.fingerprint ?? moduleLaunchGate.exportSummary?.fingerprint,
      nextAction: moduleLaunchGate.readiness?.nextAction ?? moduleLaunchGate.handoff?.nextAction ?? moduleLaunchGate.exportSummary?.nextAction,
      evidence: {
        blockedRows: moduleLaunchGate.exportSummary?.blockedRows ?? [],
        guardedRows: moduleLaunchGate.exportSummary?.guardedRows ?? moduleLaunchGate.exportSummary?.degradedRows ?? [],
        launchAllowed: moduleLaunchGate.launch?.allowed === true
      }
    }),
    moduleClientLaunchReadinessRow('module_launch_publication', 'module', moduleLaunchPublicationDigest, false, {
      status: moduleLaunchPublicationDigest.status,
      restartSafe: moduleLaunchPublicationDigest.restartSafe,
      clientVisible: moduleLaunchPublicationDigest.status !== 'ready' || moduleLaunchPublicationDigest.publication?.publish === true,
      fingerprint: moduleLaunchPublicationDigest.fingerprint ?? moduleLaunchPublicationDigest.exportSummary?.fingerprint,
      nextAction: moduleLaunchPublicationDigest.readiness?.nextAction ?? moduleLaunchPublicationDigest.handoff?.nextAction ?? moduleLaunchPublicationDigest.exportSummary?.nextAction,
      evidence: {
        publish: moduleLaunchPublicationDigest.publication?.publish === true,
        statusChannel: moduleLaunchPublicationDigest.handoff?.statusChannel,
        blockedRows: moduleLaunchPublicationDigest.exportSummary?.blockedRows ?? [],
        guardedRows: moduleLaunchPublicationDigest.exportSummary?.guardedRows ?? []
      }
    }),
    moduleClientLaunchReadinessRow('module_status_publication', 'module', moduleStatusPublication, false, {
      status: moduleStatusPublication.status,
      restartSafe: moduleStatusPublication.restartSafe,
      clientVisible: moduleStatusPublication.status !== 'ready' || moduleStatusPublication.handoff?.publish === true,
      fingerprint: moduleStatusPublication.fingerprint ?? moduleStatusPublication.exportSummary?.fingerprint,
      nextAction: moduleStatusPublication.readiness?.nextAction ?? moduleStatusPublication.handoff?.nextAction ?? moduleStatusPublication.exportSummary?.nextAction,
      evidence: {
        publish: moduleStatusPublication.handoff?.publish === true,
        statusChannel: moduleStatusPublication.handoff?.statusChannel,
        blockedRows: moduleStatusPublication.exportSummary?.blockedRows ?? [],
        guardedRows: moduleStatusPublication.exportSummary?.guardedRows ?? []
      }
    }),
    moduleClientLaunchReadinessRow('client_workflow_handoff', 'module', clientWorkflowHandoff, true, {
      status: clientWorkflowHandoff.status,
      restartSafe: clientWorkflowHandoff.restartSafe,
      clientVisible: clientWorkflowHandoff.handoff?.publish === true || (clientWorkflowHandoff.exportSummary?.blockingRows ?? []).length > 0,
      fingerprint: clientWorkflowHandoff.fingerprint ?? clientWorkflowHandoff.exportSummary?.fingerprint,
      nextAction: clientWorkflowHandoff.readiness?.nextAction ?? clientWorkflowHandoff.handoff?.nextAction ?? clientWorkflowHandoff.exportSummary?.nextAction,
      evidence: {
        blockedRows: clientWorkflowHandoff.exportSummary?.blockingRows ?? [],
        guardedRows: clientWorkflowHandoff.exportSummary?.degradedRows ?? [],
        statusChannel: clientWorkflowHandoff.handoff?.statusChannel
      }
    })
  ];
  const requiredRows = rows.filter((row) => row.required);
  const blockedRows = requiredRows.filter((row) => row.status === 'blocked');
  const guardedRows = requiredRows.filter((row) => row.status === 'guarded');
  const status = blockedRows.length > 0 ? 'blocked' : guardedRows.length > 0 ? 'guarded' : 'ready';
  const fingerprint = [
    operation,
    status,
    ...rows.map((row) => [
      row.id,
      row.status,
      row.required ? 'required' : 'optional',
      row.restartSafe ? 'restart_safe' : 'restart_guarded',
      row.clientVisible ? 'visible' : 'hidden',
      row.fingerprint,
      row.nextAction
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('||');
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = previous.sequence + (changed ? 1 : 0);
  const nextAction = status === 'blocked'
    ? 'resolve_module_client_launch_readiness_blockers'
    : status === 'guarded'
      ? 'publish_module_client_launch_readiness_guarded'
      : changed
        ? 'publish_module_client_launch_readiness_ready'
        : 'reuse_module_client_launch_readiness';

  return {
    ok: status !== 'blocked',
    schemaVersion: MODULE_SYNTAX_SCHEMA_VERSION,
    title: 'mailchimp_module_client_launch_readiness',
    operation,
    status,
    restartSafe: status === 'ready' && requiredRows.every((row) => row.restartSafe),
    sequence,
    fingerprint,
    changed,
    generatedAt: timestamp,
    rows,
    validationSummary: {
      totalRows: rows.length,
      requiredRows: requiredRows.length,
      blockedRows: blockedRows.length,
      guardedRows: guardedRows.length,
      clientVisibleRows: rows.filter((row) => row.clientVisible).length
    },
    history: {
      sequence,
      timeline: [
        ...previous.timeline,
        ...(changed || previous.timeline.length === 0 ? [{
          sequence,
          timestamp,
          operation,
          status,
          fingerprint,
          blockedRows: blockedRows.map((row) => row.id).sort(),
          guardedRows: guardedRows.map((row) => row.id).sort(),
          clientVisibleRows: rows.filter((row) => row.clientVisible).map((row) => row.id).sort()
        }] : [])
      ].slice(-Math.max(1, toNonNegativeInteger(historyLimit, 12)))
    },
    readiness: {
      blockingReasons: unique(blockedRows.flatMap((row) => row.evidence.blockedRows?.map((id) => `${row.id}:${id}`) ?? [row.id])),
      guardedReasons: unique(guardedRows.flatMap((row) => row.evidence.guardedRows?.map((id) => `${row.id}:${id}`) ?? [row.id])),
      clientVisibleRows: rows.filter((row) => row.clientVisible).map((row) => row.id).sort(),
      nextAction
    },
    handoff: {
      target: 'kernel.status.mailchimp.module-client-launch-readiness',
      statusChannel: status === 'ready' ? 'kernel.status.mailchimp' : 'local.status.module-client-launch-readiness',
      publish: changed || status !== 'ready' || rows.some((row) => row.clientVisible),
      severity: status === 'blocked' ? 'error' : status === 'guarded' ? 'warning' : 'info',
      includeRows: true,
      nextAction
    },
    exportSummary: {
      schemaVersion: MODULE_SYNTAX_SCHEMA_VERSION,
      title: 'mailchimp_module_client_launch_readiness',
      operation,
      status,
      restartSafe: status === 'ready' && requiredRows.every((row) => row.restartSafe),
      sequence,
      fingerprint,
      changed,
      blockedRows: blockedRows.map((row) => row.id).sort(),
      guardedRows: guardedRows.map((row) => row.id).sort(),
      clientVisibleRows: rows.filter((row) => row.clientVisible).map((row) => row.id).sort(),
      nextAction
    },
    diagnostics: []
  };
}

export function buildModuleClientPreviewRouteReadiness(input = {}, options = {}) {
  const parsed = typeof input === 'string' ? parseModuleSyntaxSource(input, options) : normalizeModuleInput(input);
  const profileSource = parsed.sections.profiles.join('\n');
  const gateSource = parsed.sections.gates.join('\n');
  const importSource = parsed.sections.imports.join('\n');
  const profile = compileProfileDeclaration(profileSource || options.profile || {}, options);
  const operation = (profile.profile?.operation ?? clean(options.operation)) || 'campaign.sync';
  const requestedEffects = [...parsed.sections.effects, ...(options.requestedEffects ?? [])];
  const profileRoute = buildProfileClientPreviewRouteContract(profileSource || options.profile || {}, {
    ...options,
    previousRoute: options.previousProfileClientPreviewRoute,
    previousState: options.previousProfileState,
    persistedMemory: options.persistedMemory,
    previousProviderState: options.previousProfileProviderState,
    requestedProviderCapabilities: options.profileProviderCapabilities ?? options.requestedProviderCapabilities,
    acceptance: options.profilePreviewAcceptance,
    requiredPreviewItems: options.requiredProfilePreviewItems
  });
  const featureRoute = buildFeatureGateClientPreviewRouteContract(gateSource || options.gates || {}, {
    ...options,
    operation,
    requestedEffects,
    previousRoute: options.previousFeatureClientPreviewRoute,
    previousReadiness: options.previousFeatureClientReadiness,
    previousQueue: options.previousFeatureClientActionQueue,
    previousLaunchPreview: options.previousFeatureLaunchPreview,
    providerService: options.providerService,
    acceptance: options.featureClientAcceptance ?? options.providerPreviewAcceptance
  });
  const importRoute = buildImportTenantScopedPreviewRoute(importSource, {
    ...options,
    previousScopedRoute: options.previousImportTenantScopedPreviewRoute,
    previousRoute: options.previousImportClientPreviewRoute,
    requestedCapabilities: options.importRequestedCapabilities,
    requiredAliases: options.requiredImportAliases,
    acceptance: options.importClientAcceptance ?? options.importAcceptance,
    boundaryAcceptance: options.importBoundaryAcceptance,
    requireExplicitAcceptance: options.requireImportPreviewAcceptance === true
      || options.requireImportClientAcceptance === true,
    scope: {
      tenantId: options.tenantId,
      workspaceId: options.workspaceId,
      requestedTenantId: options.requestedTenantId ?? options.requestTenantId,
      requestedWorkspaceId: options.requestedWorkspaceId ?? options.requestWorkspaceId,
      role: options.role,
      permissionMode: options.permissionMode
    }
  });
  const previous = normalizeModuleClientPreviewRouteReadiness(
    options.previousRouteReadiness ?? options.previousModuleClientPreviewRouteReadiness
  );
  const rows = dedupeModuleClientPreviewRouteRows([
    moduleClientPreviewRouteRow('profile_route', profileRoute, true, {
      surface: 'profile',
      visible: profileRoute.handoff?.includeRows === true || profileRoute.status !== 'ready'
    }),
    moduleClientPreviewRouteRow('feature_gate_route', featureRoute, true, {
      surface: 'feature-gates',
      visible: featureRoute.handoff?.includeRows === true || featureRoute.status !== 'ready'
    }),
    moduleClientPreviewRouteRow('import_route', importRoute, true, {
      surface: 'imports',
      visible: importRoute.handoff?.includeRouteState === true || importRoute.status !== 'ready',
      evidence: {
        tenantId: importRoute.scope?.tenantId ?? null,
        workspaceId: importRoute.scope?.workspaceId ?? null,
        tenantBoundaryClear: importRoute.routeState?.tenantBoundaryClear === true
      }
    })
  ]);
  const blockedRows = rows.filter((row) => row.status === 'blocked');
  const guardedRows = rows.filter((row) => row.status === 'guarded');
  const visibleRows = rows.filter((row) => row.visibleToClient);
  const status = blockedRows.length > 0 ? 'blocked' : guardedRows.length > 0 ? 'guarded' : 'ready';
  const fingerprint = moduleClientPreviewRouteReadinessFingerprint({
    operation,
    status,
    rows,
    parsedDiagnostics: parsed.diagnostics ?? []
  });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = previous.sequence + (changed ? 1 : 0);
  const diagnostics = [
    ...(parsed.diagnostics ?? []),
    ...(profileRoute.diagnostics ?? []).filter((item) => item.level === 'error' || options.includeProfilePreviewWarnings === true),
    ...(featureRoute.diagnostics ?? []).filter((item) => item.level === 'error' || options.includeFeaturePreviewWarnings === true),
    ...(importRoute.diagnostics ?? []).filter((item) => item.level === 'error' || options.includeImportPreviewWarnings === true),
    ...blockedRows.map((row) => ({ level: 'error', code: 'module_client_preview_route_blocked', subject: row.id })),
    ...guardedRows.map((row) => ({ level: 'warning', code: 'module_client_preview_route_guarded', subject: row.id }))
  ];
  const nextAction = blockedRows[0]?.nextAction
    ?? guardedRows[0]?.nextAction
    ?? (visibleRows.length > 0 ? 'publish_module_client_preview_updates' : changed ? 'publish_module_client_preview_route_ready' : 'reuse_module_client_preview_route');

  return {
    ok: status !== 'blocked',
    schemaVersion: MODULE_SYNTAX_SCHEMA_VERSION,
    title: 'mailchimp_module_client_preview_route_readiness',
    operation,
    status,
    restartSafe: status === 'ready' && rows.every((row) => row.restartSafe),
    sequence,
    fingerprint,
    changed,
    rows,
    surfaces: {
      profile: profileRoute.exportSummary,
      featureGates: featureRoute.exportSummary,
      imports: importRoute.exportSummary
    },
    routeState: {
      previewVisible: visibleRows.length > 0,
      acceptEnabled: status !== 'blocked' && rows.some((row) => row.awaitingAcceptance.length > 0),
      readyEnabled: status === 'ready' && rows.every((row) => row.awaitingAcceptance.length === 0),
      blockedRows: blockedRows.map((row) => row.id).sort(),
      guardedRows: guardedRows.map((row) => row.id).sort(),
      visibleRows: visibleRows.map((row) => row.id).sort(),
      awaitingAcceptance: unique(rows.flatMap((row) => row.awaitingAcceptance))
    },
    validationSummary: {
      totalRows: rows.length,
      blockedRows: blockedRows.length,
      guardedRows: guardedRows.length,
      visibleRows: visibleRows.length,
      awaitingAcceptance: rows.reduce((count, row) => count + row.awaitingAcceptance.length, 0),
      diagnosticErrors: diagnostics.filter((item) => item.level === 'error').length,
      diagnosticWarnings: diagnostics.filter((item) => item.level === 'warning').length
    },
    explanation: {
      headline: status === 'ready'
        ? 'mailchimp_module_preview_route_ready'
        : status === 'guarded'
          ? 'mailchimp_module_preview_route_guarded'
          : 'mailchimp_module_preview_route_blocked',
      nextSteps: unique(rows
        .filter((row) => row.status !== 'ready' || row.visibleToClient || row.awaitingAcceptance.length > 0)
        .map((row) => row.nextAction))
    },
    handoff: {
      target: 'client.route.mailchimp.module-preview',
      statusChannel: status === 'ready' ? 'kernel.status.mailchimp' : 'local.status.module-preview-route',
      publish: changed || status !== 'ready' || visibleRows.length > 0,
      severity: status === 'blocked' ? 'error' : status === 'guarded' ? 'warning' : 'info',
      includeRows: true,
      includeSurfaceSummaries: true,
      nextAction
    },
    exportSummary: {
      schemaVersion: MODULE_SYNTAX_SCHEMA_VERSION,
      title: 'mailchimp_module_client_preview_route_readiness',
      operation,
      status,
      restartSafe: status === 'ready' && rows.every((row) => row.restartSafe),
      sequence,
      fingerprint,
      changed,
      blockedRows: blockedRows.map((row) => row.id).sort(),
      guardedRows: guardedRows.map((row) => row.id).sort(),
      visibleRows: visibleRows.map((row) => row.id).sort(),
      awaitingAcceptance: unique(rows.flatMap((row) => row.awaitingAcceptance)),
      nextAction
    },
    diagnostics
  };
}

export function buildModuleLaunchAcceptanceExportRoute(input = {}, options = {}) {
  const parsed = typeof input === 'string' ? parseModuleSyntaxSource(input, options) : normalizeModuleInput(input);
  const profileSource = parsed.sections.profiles.join('\n');
  const gateSource = parsed.sections.gates.join('\n');
  const importSource = parsed.sections.imports.join('\n');
  const profile = compileProfileDeclaration(profileSource || options.profile || {}, options);
  const operation = (profile.profile?.operation ?? clean(options.operation)) || 'campaign.sync';
  const requestedEffects = [...parsed.sections.effects, ...(options.requestedEffects ?? [])];
  const profileLaunch = buildProfileLaunchAcceptanceExport(profileSource || options.profile || {}, {
    ...options,
    previousLaunchAcceptanceExport: options.previousProfileLaunchAcceptanceExport,
    previousExport: options.previousProfileExport,
    previousHealthExport: options.previousProfileHealthExport,
    previousPrimaryPack: options.previousProfilePrimaryPack,
    previousLedger: options.previousProfileAnalyticsExportLedger,
    previousRoute: options.previousProfileClientPreviewRoute,
    previousState: options.previousProfileState,
    persistedMemory: options.persistedMemory,
    acceptance: options.profilePreviewAcceptance,
    requiredItems: options.requiredProfilePreviewItems,
    requireProfileLaunchAcceptance: options.requireProfileLaunchAcceptance === true,
    now: options.now ?? options.timestamp
  });
  const featureRoute = buildFeatureGateClientPreviewRouteContract(gateSource || options.gates || {}, {
    ...options,
    operation,
    requestedEffects,
    previousRoute: options.previousFeatureClientPreviewRoute,
    previousReadiness: options.previousFeatureClientReadiness,
    previousQueue: options.previousFeatureClientActionQueue,
    previousLaunchPreview: options.previousFeatureLaunchPreview,
    providerService: options.providerService,
    acceptance: options.featureClientAcceptance ?? options.providerPreviewAcceptance,
    requireExplicitAcceptance: options.requireFeatureLaunchAcceptance === true
  });
  const importRoute = buildImportTenantScopedPreviewRoute(importSource, {
    ...options,
    previousScopedRoute: options.previousImportTenantScopedPreviewRoute,
    previousRoute: options.previousImportClientPreviewRoute,
    requestedCapabilities: options.importRequestedCapabilities,
    requiredAliases: options.requiredImportAliases,
    acceptance: options.importClientAcceptance ?? options.importAcceptance,
    boundaryAcceptance: options.importBoundaryAcceptance,
    requireExplicitAcceptance: options.requireImportLaunchAcceptance === true
      || options.requireImportPreviewAcceptance === true
      || options.requireImportClientAcceptance === true,
    scope: {
      tenantId: options.tenantId,
      workspaceId: options.workspaceId,
      requestedTenantId: options.requestedTenantId ?? options.requestTenantId,
      requestedWorkspaceId: options.requestedWorkspaceId ?? options.requestWorkspaceId,
      role: options.role,
      permissionMode: options.permissionMode
    }
  });
  const previewRoute = buildModuleClientPreviewRouteReadiness(input, {
    ...options,
    previousRouteReadiness: options.previousModuleClientPreviewRouteReadiness,
    providerService: options.providerService
  });
  const previous = normalizeModuleLaunchAcceptanceExportRoute(
    options.previousLaunchAcceptanceExportRoute ?? options.previousModuleLaunchAcceptanceExportRoute
  );
  const rows = dedupeModuleLaunchAcceptanceRows([
    moduleLaunchAcceptanceRow('profile_launch_acceptance', profileLaunch, true, {
      surface: 'profile',
      awaitingAcceptance: profileLaunch.exportSummary?.awaitingAcceptance,
      nextAction: profileLaunch.readiness?.nextAction ?? profileLaunch.exportSummary?.nextAction
    }),
    moduleLaunchAcceptanceRow('feature_gate_preview_route', featureRoute, true, {
      surface: 'feature-gates',
      awaitingAcceptance: featureRoute.exportSummary?.awaitingAcceptance,
      nextAction: featureRoute.handoff?.nextAction ?? featureRoute.exportSummary?.nextAction
    }),
    moduleLaunchAcceptanceRow('import_preview_route', importRoute, true, {
      surface: 'imports',
      awaitingAcceptance: importRoute.exportSummary?.awaitingAcceptance,
      nextAction: importRoute.handoff?.nextAction ?? importRoute.exportSummary?.nextAction
    }),
    moduleLaunchAcceptanceRow('module_preview_route', previewRoute, options.includeModulePreviewRoute !== false, {
      surface: 'module',
      awaitingAcceptance: previewRoute.exportSummary?.awaitingAcceptance,
      nextAction: previewRoute.handoff?.nextAction ?? previewRoute.exportSummary?.nextAction
    })
  ]);
  const requiredRows = rows.filter((row) => row.required);
  const blockedRows = requiredRows.filter((row) => row.status === 'blocked');
  const guardedRows = requiredRows.filter((row) => row.status === 'guarded');
  const awaitingAcceptance = unique(rows.flatMap((row) => row.awaitingAcceptance));
  const diagnostics = [
    ...(parsed.diagnostics ?? []),
    ...(profileLaunch.diagnostics ?? []).filter((item) => item.level === 'error' || options.includeProfileLaunchWarnings === true),
    ...(featureRoute.diagnostics ?? []).filter((item) => item.level === 'error' || options.includeFeatureLaunchWarnings === true),
    ...(importRoute.diagnostics ?? []).filter((item) => item.level === 'error' || options.includeImportLaunchWarnings === true),
    ...(previewRoute.diagnostics ?? []).filter((item) => item.level === 'error' || options.includeModulePreviewWarnings === true),
    ...blockedRows.map((row) => ({ level: 'error', code: 'module_launch_acceptance_row_blocked', subject: row.id })),
    ...guardedRows.map((row) => ({ level: 'warning', code: 'module_launch_acceptance_row_guarded', subject: row.id })),
    ...(awaitingAcceptance.length > 0 && options.requireModuleLaunchAcceptance === true
      ? awaitingAcceptance.map((item) => ({ level: 'error', code: 'module_launch_acceptance_required', subject: item }))
      : awaitingAcceptance.map((item) => ({ level: 'warning', code: 'module_launch_acceptance_pending', subject: item })))
  ];
  const status = diagnostics.some((item) => item.level === 'error') || blockedRows.length > 0
    ? 'blocked'
    : diagnostics.some((item) => item.level === 'warning') || guardedRows.length > 0 || awaitingAcceptance.length > 0
      ? 'guarded'
      : 'ready';
  const fingerprint = moduleLaunchAcceptanceExportRouteFingerprint({
    operation,
    status,
    rows,
    awaitingAcceptance
  });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = previous.sequence + (changed ? 1 : 0);
  const now = clean(options.now ?? options.timestamp) || null;
  const event = {
    sequence,
    timestamp: now,
    operation,
    status,
    fingerprint,
    blockedRows: blockedRows.length,
    guardedRows: guardedRows.length,
    awaitingAcceptance: awaitingAcceptance.length
  };
  const timeline = [
    ...previous.timeline,
    ...(changed || previous.timeline.length === 0 ? [event] : [])
  ].slice(-toPositiveInteger(options.launchAcceptanceHistoryLimit ?? options.historyLimit, 12));
  const nextAction = blockedRows[0]?.nextAction
    ?? (awaitingAcceptance.length > 0 ? 'collect_module_launch_acceptance' : null)
    ?? guardedRows[0]?.nextAction
    ?? (changed ? 'publish_module_launch_acceptance_export_route' : 'reuse_module_launch_acceptance_export_route');

  return {
    ok: status !== 'blocked',
    schemaVersion: MODULE_SYNTAX_SCHEMA_VERSION,
    title: 'mailchimp_module_launch_acceptance_export_route',
    operation,
    status,
    restartSafe: status === 'ready' && requiredRows.every((row) => row.restartSafe),
    sequence,
    fingerprint,
    changed,
    rows,
    surfaces: {
      profile: profileLaunch.exportSummary,
      featureGates: featureRoute.exportSummary,
      imports: importRoute.exportSummary,
      modulePreview: previewRoute.exportSummary
    },
    counters: {
      totalRows: rows.length,
      requiredRows: requiredRows.length,
      blockedRows: blockedRows.length,
      guardedRows: guardedRows.length,
      awaitingAcceptance: awaitingAcceptance.length,
      publishRows: rows.filter((row) => row.publish).length,
      diagnosticErrors: diagnostics.filter((item) => item.level === 'error').length,
      diagnosticWarnings: diagnostics.filter((item) => item.level === 'warning').length
    },
    history: {
      sequence,
      timeline,
      statusCounts: timeline.reduce((counts, item) => {
        counts[item.status] = (counts[item.status] ?? 0) + 1;
        return counts;
      }, {})
    },
    routeState: {
      previewVisible: rows.some((row) => row.clientVisible),
      acceptEnabled: status !== 'blocked' && awaitingAcceptance.length > 0,
      readyEnabled: status === 'ready' && awaitingAcceptance.length === 0,
      blockedRows: blockedRows.map((row) => row.id).sort(),
      guardedRows: guardedRows.map((row) => row.id).sort(),
      awaitingAcceptance
    },
    explanation: {
      headline: status === 'ready'
        ? 'mailchimp_module_launch_acceptance_ready'
        : status === 'guarded'
          ? 'mailchimp_module_launch_acceptance_guarded'
          : 'mailchimp_module_launch_acceptance_blocked',
      nextSteps: unique(rows
        .filter((row) => row.status !== 'ready' || row.awaitingAcceptance.length > 0 || row.publish)
        .map((row) => row.nextAction))
    },
    handoff: {
      target: 'client.route.mailchimp.module-launch-acceptance',
      statusChannel: status === 'ready' ? 'kernel.status.mailchimp' : 'local.status.module-launch-acceptance',
      publish: changed || status !== 'ready' || awaitingAcceptance.length > 0,
      severity: status === 'blocked' ? 'error' : status === 'guarded' ? 'warning' : 'info',
      includeRows: true,
      includeHistory: true,
      includeSurfaceSummaries: true,
      nextAction
    },
    exportSummary: {
      schemaVersion: MODULE_SYNTAX_SCHEMA_VERSION,
      title: 'mailchimp_module_launch_acceptance_export_route',
      operation,
      status,
      restartSafe: status === 'ready' && requiredRows.every((row) => row.restartSafe),
      sequence,
      fingerprint,
      changed,
      blockedRows: blockedRows.map((row) => row.id).sort(),
      guardedRows: guardedRows.map((row) => row.id).sort(),
      awaitingAcceptance,
      publishRows: rows.filter((row) => row.publish).map((row) => row.id).sort(),
      nextAction
    },
    diagnostics
  };
}

export function selfCheckModuleSyntax() {
  return buildKernelModuleContract([
    'import profile from "@mailchimp/profile"',
    'import recovery from "@mailchimp/recovery"',
    'tenant id=mailchimp.default workspace=mailchimp.workspace.default role=campaign_operator',
    'profile mailchimp.campaign operation=campaign.sync',
    'gate mailchimpRead=on',
    'gate campaignPlanning=on',
    'effect mailchimp.read'
  ].join('\n'));
}

function normalizeModuleClientPreviewRouteReadiness(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    sequence: toNonNegativeInteger(value.sequence ?? value.history?.sequence ?? value.exportSummary?.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint)
  };
}

function normalizeModuleLaunchAcceptanceExportRoute(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    sequence: toNonNegativeInteger(value.sequence ?? value.history?.sequence ?? value.exportSummary?.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint),
    timeline: Array.isArray(value.history?.timeline)
      ? value.history.timeline.filter((item) => item && typeof item === 'object')
      : Array.isArray(value.timeline)
        ? value.timeline.filter((item) => item && typeof item === 'object')
        : []
  };
}

function moduleLaunchAcceptanceRow(id, source = {}, required, fallback = {}) {
  const rawStatus = clean(source.status ?? source.exportSummary?.status) || 'ready';
  const status = rawStatus === 'blocked'
    ? 'blocked'
    : rawStatus === 'guarded' || rawStatus === 'degraded' || rawStatus === 'recovering' || source.restartSafe === false
      ? 'guarded'
      : 'ready';
  const awaitingAcceptance = Array.isArray(fallback.awaitingAcceptance)
    ? fallback.awaitingAcceptance.map(clean).filter(Boolean)
    : Array.isArray(source.exportSummary?.awaitingAcceptance)
      ? source.exportSummary.awaitingAcceptance.map(clean).filter(Boolean)
      : [];
  return {
    id,
    surface: clean(fallback.surface) || id,
    status,
    required: required === true,
    restartSafe: status === 'ready' && source.restartSafe !== false && source.exportSummary?.restartSafe !== false,
    clientVisible: status !== 'ready' || awaitingAcceptance.length > 0 || source.handoff?.publish === true,
    publish: status !== 'ready' || awaitingAcceptance.length > 0 || source.handoff?.publish === true || source.changed === true,
    awaitingAcceptance: unique(awaitingAcceptance),
    sequence: toNonNegativeInteger(source.sequence ?? source.exportSummary?.sequence, 0),
    fingerprint: clean(source.fingerprint ?? source.exportSummary?.fingerprint),
    statusChannel: clean(source.handoff?.statusChannel ?? source.exportSummary?.statusChannel) || null,
    nextAction: clean(fallback.nextAction ?? source.readiness?.nextAction ?? source.handoff?.nextAction ?? source.exportSummary?.nextAction)
      || (status === 'blocked' ? `resolve_${id}` : status === 'guarded' ? `review_${id}` : `publish_${id}`),
    evidence: fallback.evidence && typeof fallback.evidence === 'object' ? fallback.evidence : {}
  };
}

function dedupeModuleLaunchAcceptanceRows(rows = []) {
  const seen = new Set();
  return rows
    .filter((row) => row && typeof row === 'object' && clean(row.id))
    .filter((row) => {
      const key = [row.id, row.status, row.nextAction].map(clean).join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => (
      moduleLaunchAcceptanceStatusRank(right.status) - moduleLaunchAcceptanceStatusRank(left.status)
      || clean(left.surface).localeCompare(clean(right.surface))
      || clean(left.id).localeCompare(clean(right.id))
    ));
}

function moduleLaunchAcceptanceStatusRank(status) {
  if (status === 'blocked') return 3;
  if (status === 'guarded' || status === 'degraded') return 2;
  return 1;
}

function moduleLaunchAcceptanceExportRouteFingerprint({
  operation,
  status,
  rows,
  awaitingAcceptance
}) {
  return [
    'module_launch_acceptance_export_route',
    operation,
    status,
    `awaiting:${awaitingAcceptance.join(',')}`,
    ...rows.map((row) => [
      row.id,
      row.surface,
      row.status,
      row.required ? 'required' : 'optional',
      row.restartSafe ? 'restart_safe' : 'restart_guarded',
      row.clientVisible ? 'client_visible' : 'client_hidden',
      row.publish ? 'publish' : 'silent',
      row.statusChannel,
      row.fingerprint,
      row.nextAction,
      ...row.awaitingAcceptance
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('||');
}

function moduleClientPreviewRouteRow(id, source = {}, required, fallback = {}) {
  const rawStatus = clean(source.status ?? source.exportSummary?.status) || 'ready';
  const status = rawStatus === 'degraded' ? 'guarded' : rawStatus;
  const blocked = status === 'blocked';
  const guarded = !blocked && status !== 'ready';
  const awaitingAcceptance = Array.isArray(source.exportSummary?.awaitingAcceptance)
    ? source.exportSummary.awaitingAcceptance.map(clean).filter(Boolean)
    : [];
  return {
    id,
    surface: clean(fallback.surface) || id,
    status: blocked ? 'blocked' : guarded ? 'guarded' : 'ready',
    required: required === true,
    restartSafe: blocked !== true && guarded !== true && source.restartSafe !== false && source.exportSummary?.restartSafe !== false,
    visibleToClient: fallback.visible === true || blocked || guarded || awaitingAcceptance.length > 0,
    awaitingAcceptance,
    fingerprint: clean(source.fingerprint ?? source.exportSummary?.fingerprint),
    nextAction: clean(source.readiness?.nextAction ?? source.handoff?.nextAction ?? source.exportSummary?.nextAction)
      || (blocked ? `resolve_${id}` : guarded ? `review_${id}` : `publish_${id}`),
    evidence: {
      statusChannel: source.handoff?.statusChannel ?? null,
      visibleRows: source.exportSummary?.visibleRows ?? source.exportSummary?.clientVisibleRows ?? [],
      ...(fallback.evidence && typeof fallback.evidence === 'object' ? fallback.evidence : {})
    }
  };
}

function dedupeModuleClientPreviewRouteRows(rows = []) {
  const seen = new Set();
  return rows
    .filter((row) => row && typeof row === 'object' && clean(row.id))
    .filter((row) => {
      const key = [row.id, row.status, row.nextAction].map(clean).join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => (
      moduleClientPreviewRouteRank(right.status) - moduleClientPreviewRouteRank(left.status)
      || clean(left.id).localeCompare(clean(right.id))
    ));
}

function moduleClientPreviewRouteRank(status) {
  if (status === 'blocked') return 3;
  if (status === 'guarded') return 2;
  return 1;
}

function moduleClientPreviewRouteReadinessFingerprint({
  operation,
  status,
  rows,
  parsedDiagnostics
}) {
  return [
    'module_client_preview_route_readiness',
    operation,
    status,
    ...parsedDiagnostics.map((item) => `${item.level}:${item.code}:${item.subject}`),
    ...rows.map((row) => [
      row.id,
      row.surface,
      row.status,
      row.required ? 'required' : 'optional',
      row.restartSafe ? 'restart_safe' : 'restart_guarded',
      row.visibleToClient ? 'visible' : 'hidden',
      row.fingerprint,
      row.nextAction,
      ...row.awaitingAcceptance
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('||');
}

function normalizeModuleInput(input) {
  if (input?.sections) return { ...input, diagnostics: input.diagnostics ?? [] };
  return {
    schemaVersion: MODULE_SYNTAX_SCHEMA_VERSION,
    sourceName: input.sourceName ?? 'object.module.aios',
    sections: {
      imports: input.imports ?? [],
      profiles: input.profiles ?? [],
      gates: input.gates ?? [],
      effects: input.effects ?? [],
      boundaries: input.boundaries ?? []
    },
    diagnostics: []
  };
}

function normalizeModuleOperationsPackHistory(input) {
  const value = input && typeof input === 'object' ? input : {};
  const history = value.history && typeof value.history === 'object' ? value.history : value;
  return {
    sequence: toNonNegativeInteger(value.sequence ?? history.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint),
    timeline: Array.isArray(history.timeline) ? history.timeline.filter((item) => item && typeof item === 'object') : []
  };
}

function normalizeModuleStatusPublicationHistory(input) {
  const value = input && typeof input === 'object' ? input : {};
  const history = value.history && typeof value.history === 'object' ? value.history : value;
  const rowFingerprints = value.rowFingerprints && typeof value.rowFingerprints === 'object'
    ? value.rowFingerprints
    : {};
  return {
    sequence: toNonNegativeInteger(value.sequence ?? history.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint),
    ageMs: toNonNegativeInteger(value.ageMs ?? value.publicationAgeMs, 0),
    rowFingerprints,
    timeline: Array.isArray(history.timeline) ? history.timeline.filter((item) => item && typeof item === 'object') : []
  };
}

function moduleStatusPublicationRow(id, source, {
  required,
  publication,
  summary
}) {
  const normalizedSummary = summary && typeof summary === 'object' ? summary : {};
  const normalizedPublication = publication && typeof publication === 'object' ? publication : {};
  const status = clean(source.status ?? normalizedSummary.status) || 'ready';
  return {
    id,
    status,
    required,
    restartSafe: source.restartSafe !== false && normalizedSummary.restartSafe !== false,
    publish: normalizedPublication.publish === true || status !== 'ready',
    statusChannel: clean(normalizedPublication.statusChannel) || 'kernel.status.mailchimp',
    target: clean(normalizedPublication.target) || `kernel.status.mailchimp.${id.replace(/_/g, '-')}`,
    sequence: toNonNegativeInteger(source.sequence ?? normalizedSummary.sequence, 0),
    fingerprint: clean(source.fingerprint ?? normalizedSummary.fingerprint),
    summary: normalizedSummary,
    nextAction: clean(normalizedPublication.nextAction ?? normalizedSummary.nextAction) || (
      status === 'ready' ? `publish_${id}` : `review_${id}`
    )
  };
}

function normalizeModuleLaunchPublicationDigest(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  const history = value.history && typeof value.history === 'object' ? value.history : value;
  return {
    sequence: toNonNegativeInteger(value.sequence ?? value.exportSummary?.sequence ?? history.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint),
    timeline: Array.isArray(history.timeline) ? history.timeline.filter((item) => item && typeof item === 'object') : []
  };
}

function normalizeModuleClientLaunchReadiness(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  const history = value.history && typeof value.history === 'object' ? value.history : value;
  return {
    sequence: toNonNegativeInteger(value.sequence ?? value.exportSummary?.sequence ?? history.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint),
    timeline: Array.isArray(history.timeline) ? history.timeline.filter((item) => item && typeof item === 'object') : []
  };
}

function moduleClientLaunchReadinessRow(id, sourceName, source, required, fallback = {}) {
  const rawStatus = clean(fallback.status ?? source.status ?? source.exportSummary?.status) || 'ready';
  const status = rawStatus === 'degraded' || rawStatus === 'paused' || rawStatus === 'disabled'
    ? 'guarded'
    : rawStatus;
  const blocked = status === 'blocked';
  const guarded = !blocked && status !== 'ready';
  return {
    id,
    source: sourceName,
    status: blocked ? 'blocked' : guarded ? 'guarded' : 'ready',
    required,
    restartSafe: fallback.restartSafe === true && blocked !== true,
    clientVisible: fallback.clientVisible === true || blocked || guarded,
    fingerprint: clean(fallback.fingerprint ?? source.fingerprint ?? source.exportSummary?.fingerprint),
    nextAction: clean(fallback.nextAction) || (
      blocked ? `resolve_${id}_blockers` : guarded ? `publish_${id}_guarded` : `publish_${id}`
    ),
    evidence: fallback.evidence && typeof fallback.evidence === 'object' ? fallback.evidence : {}
  };
}

function moduleLaunchPublicationRow(id, source, {
  required,
  handoff,
  summary,
  acceptanceRequired = false
}) {
  const normalizedSummary = summary && typeof summary === 'object' ? summary : {};
  const normalizedHandoff = handoff && typeof handoff === 'object' ? handoff : {};
  const status = normalizeLaunchPublicationStatus(clean(source.status ?? normalizedSummary.status) || 'ready');
  const accepted = acceptanceRequired
    ? source.accepted === true || normalizedSummary.accepted === true || normalizedSummary.awaitingAcceptance?.length === 0
    : true;
  const reasons = unique([
    ...normalizeList(source.readiness?.blockingReasons),
    ...normalizeList(source.readiness?.guardedReasons),
    ...normalizeList(source.readiness?.degradedReasons),
    ...normalizeList(normalizedSummary.blockedRows),
    ...normalizeList(normalizedSummary.guardedRows),
    ...normalizeList(normalizedSummary.degradedRows),
    ...(accepted ? [] : ['acceptance_pending'])
  ]);
  return {
    id,
    status,
    required,
    acceptanceRequired,
    accepted,
    restartSafe: source.restartSafe !== false && normalizedSummary.restartSafe !== false,
    publish: normalizedHandoff.publish === true || status !== 'ready',
    changed: source.changed === true || normalizedSummary.changed === true,
    statusChannel: clean(normalizedHandoff.statusChannel) || 'kernel.status.mailchimp',
    target: clean(normalizedHandoff.target) || `kernel.status.mailchimp.${id.replace(/_/g, '-')}`,
    sequence: toNonNegativeInteger(source.sequence ?? normalizedSummary.sequence, 0),
    fingerprint: clean(source.fingerprint ?? normalizedSummary.fingerprint),
    reasons,
    nextAction: clean(normalizedHandoff.nextAction ?? source.readiness?.nextAction ?? normalizedSummary.nextAction) || (
      status === 'ready' ? `publish_${id}` : `review_${id}`
    ),
    summary: normalizedSummary
  };
}

function moduleLaunchGateRow(id, source, {
  required,
  restartSafe,
  handoff,
  summary,
  acceptanceRequired = false
}) {
  const normalizedSummary = summary && typeof summary === 'object' ? summary : {};
  const normalizedHandoff = handoff && typeof handoff === 'object' ? handoff : {};
  const status = normalizeModuleLaunchGateStatus(clean(source.status ?? normalizedSummary.status) || 'ready');
  const accepted = acceptanceRequired
    ? source.accepted === true
      || normalizedSummary.accepted === true
      || normalizeList(normalizedSummary.awaitingAcceptance).length === 0
    : true;
  const restartClear = restartSafe !== false
    && source.restartSafe !== false
    && normalizedSummary.restartSafe !== false;
  const reasons = unique([
    ...normalizeList(source.readiness?.blockingReasons),
    ...normalizeList(source.readiness?.guardedReasons),
    ...normalizeList(source.readiness?.degradedReasons),
    ...normalizeList(normalizedSummary.blockedRows),
    ...normalizeList(normalizedSummary.guardedRows),
    ...normalizeList(normalizedSummary.degradedRows),
    ...(restartClear ? [] : ['restart_guarded']),
    ...(accepted ? [] : ['acceptance_pending']),
    ...(normalizedHandoff.publish === true && status !== 'ready' ? ['publication_pending'] : [])
  ]);

  return {
    id,
    status,
    required,
    acceptanceRequired,
    accepted,
    restartSafe: restartClear,
    publishPending: normalizedHandoff.publish === true || status !== 'ready',
    statusChannel: clean(normalizedHandoff.statusChannel) || (
      status === 'ready' ? 'kernel.status.mailchimp' : 'local.status.module-launch-gate'
    ),
    target: clean(normalizedHandoff.target) || `kernel.status.mailchimp.${id.replace(/_/g, '-')}`,
    sequence: toNonNegativeInteger(source.sequence ?? normalizedSummary.sequence, 0),
    fingerprint: clean(source.fingerprint ?? normalizedSummary.fingerprint),
    reasons,
    nextAction: clean(normalizedHandoff.nextAction ?? source.readiness?.nextAction ?? normalizedSummary.nextAction) || (
      status === 'ready' ? `release_${id}` : `review_${id}`
    ),
    summary: normalizedSummary
  };
}

function normalizeModuleLaunchGateStatus(status) {
  if (status === 'blocked' || status === 'operator_review') return 'blocked';
  if (['guarded', 'degraded', 'retry_scheduled', 'paused', 'disabled', 'status_acknowledged'].includes(status)) {
    return 'degraded';
  }
  if (status === 'released' || status === 'healthy' || status === 'accepted') return 'ready';
  return 'ready';
}

function normalizeLaunchPublicationStatus(status) {
  if (status === 'blocked' || status === 'operator_review') return 'blocked';
  if (['guarded', 'degraded', 'retry_scheduled', 'paused', 'disabled', 'status_acknowledged'].includes(status)) {
    return 'guarded';
  }
  return 'ready';
}

function normalizeModuleLaunchAcceptanceHistory(input) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    sequence: toNonNegativeInteger(value.sequence ?? value.history?.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint),
    acceptedItems: normalizeModuleLaunchList(value.package?.acceptedItems ?? value.acceptedItems)
  };
}

function normalizeModuleLaunchAcceptance(input) {
  const acceptance = input && typeof input === 'object' ? input : {};
  return {
    acceptedItems: normalizeModuleLaunchList(acceptance.acceptedItems ?? acceptance.accepted),
    requiredItems: normalizeModuleLaunchList(acceptance.requiredItems ?? acceptance.required),
    acceptedAt: clean(acceptance.acceptedAt ?? acceptance.timestamp) || null,
    acceptedBy: clean(acceptance.acceptedBy ?? acceptance.operator) || null,
    requireExplicitAcceptance: acceptance.requireExplicitAcceptance === true
  };
}

function normalizeModuleLaunchList(value) {
  if (Array.isArray(value)) return value.map(clean).filter(Boolean);
  return String(value ?? '').split(',').map(clean).filter(Boolean);
}

function moduleLaunchAcceptanceFingerprint({
  operation,
  status,
  rows,
  acceptedItems
}) {
  return [
    operation,
    status,
    ...acceptedItems.map((item) => `accepted:${item}`).sort(),
    ...rows.map((row) => [
      row.key,
      row.status,
      row.restartSafe === false ? 'guarded' : 'restart_safe',
      row.accepted ? 'accepted' : 'pending',
      row.required ? 'required' : 'optional'
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('|');
}

function mergeModuleOperationActions({
  profileOperationalHealth,
  operationalActionPlan,
  rows,
  status
}) {
  const rowActions = rows
    .filter((row) => row.status !== 'ready' && row.nextAction)
    .map((row) => ({
      source: row.component,
      code: 'component_next_action',
      subject: row.status,
      action: row.nextAction,
      severity: row.status === 'blocked' || row.status === 'operator_review' ? 'error' : 'warning'
    }));
  const profileActions = (profileOperationalHealth.actionQueue ?? []).map((item) => ({
    source: `profile_health:${clean(item.source) || 'profile'}`,
    code: clean(item.code) || 'profile_health_action',
    subject: clean(item.subject) || 'profile_health',
    action: clean(item.action) || 'Review Mailchimp profile health before module dispatch.',
    severity: clean(item.severity) || 'warning'
  }));
  const operationActions = (operationalActionPlan.actions ?? []).map((item) => ({
    source: clean(item.source) || 'operations',
    code: clean(item.code) || 'operational_action',
    subject: clean(item.subject) || 'mailchimp.module',
    action: clean(item.action) || operationalActionPlan.nextAction || 'Review Mailchimp module operations.',
    severity: clean(item.severity) || 'warning'
  }));
  const actions = dedupeModuleOperationActions([
    ...profileActions,
    ...operationActions,
    ...rowActions
  ]);
  return actions
    .filter((item) => status !== 'ready' || item.severity === 'error')
    .sort((left, right) => (
      severityRank(right.severity) - severityRank(left.severity)
      || left.source.localeCompare(right.source)
      || left.code.localeCompare(right.code)
      || left.subject.localeCompare(right.subject)
    ));
}

function dedupeModuleOperationActions(actions) {
  const seen = new Set();
  return actions.filter((item) => {
    const normalized = {
      source: clean(item.source),
      code: clean(item.code),
      subject: clean(item.subject),
      action: clean(item.action),
      severity: clean(item.severity) || 'warning'
    };
    const key = [normalized.source, normalized.code, normalized.subject, normalized.action].join('|');
    if (!normalized.source || !normalized.code || seen.has(key)) return false;
    seen.add(key);
    Object.assign(item, normalized);
    return true;
  });
}

function moduleOperationsPackFingerprint({
  operation,
  status,
  rows,
  actionQueue,
  diagnosticErrors,
  diagnosticWarnings
}) {
  return [
    operation,
    status,
    ...rows.map((row) => `${row.component}:${row.status}:${row.restartSafe === false ? 'guarded' : 'safe'}`).sort(),
    ...actionQueue.map((item) => `${item.severity}:${item.source}:${item.code}:${item.subject}`).sort(),
    `errors:${toNonNegativeInteger(diagnosticErrors, 0)}`,
    `warnings:${toNonNegativeInteger(diagnosticWarnings, 0)}`
  ].map(clean).filter(Boolean).join('||');
}

function moduleLaunchPublicationFingerprint({
  operation,
  status,
  rows,
  publishRows
}) {
  return [
    operation,
    status,
    ...rows.map((row) => [
      row.id,
      row.status,
      row.restartSafe ? 'restart_safe' : 'restart_guarded',
      row.acceptanceRequired ? 'acceptance_required' : 'acceptance_optional',
      row.accepted ? 'accepted' : 'pending',
      row.publish ? 'publish' : 'silent',
      row.fingerprint,
      row.nextAction
    ].map(clean).filter(Boolean).join(':')).sort(),
    ...publishRows.map((row) => `publish:${row.id}`).sort()
  ].map(clean).filter(Boolean).join('||');
}

function moduleLaunchGateFingerprint({
  operation,
  status,
  allowDegradedLaunch,
  requireExplicitAcceptance,
  rows
}) {
  return [
    operation,
    status,
    allowDegradedLaunch ? 'degraded_allowed' : 'degraded_blocks',
    requireExplicitAcceptance ? 'acceptance_required' : 'acceptance_optional',
    ...rows.map((row) => [
      row.id,
      row.status,
      row.required ? 'required' : 'optional',
      row.restartSafe ? 'restart_safe' : 'restart_guarded',
      row.acceptanceRequired ? 'acceptance_required' : 'acceptance_optional',
      row.accepted ? 'accepted' : 'pending',
      row.publishPending ? 'publish' : 'silent',
      row.statusChannel,
      row.fingerprint,
      row.nextAction
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('||');
}

function firstModuleLaunchAction(rows, fallback) {
  return clean(rows.find((row) => row.nextAction)?.nextAction) || fallback;
}

function moduleStatusPublicationFingerprint({
  operation,
  status,
  rows,
  staleRows
}) {
  const staleIds = new Set(staleRows.map((row) => row.id));
  return [
    operation,
    status,
    ...rows.map((row) => [
      row.id,
      row.status,
      row.restartSafe === false ? 'guarded' : 'safe',
      row.publish === true ? 'publish' : 'silent',
      staleIds.has(row.id) ? 'stale' : 'fresh',
      row.sequence ?? 0,
      row.fingerprint ?? '',
      row.nextAction ?? 'no_action'
    ].map(clean).join(':')).sort()
  ].map(clean).filter(Boolean).join('||');
}

export function deriveModuleBoundaryContract({
  boundarySource = [],
  options = {},
  capabilities = [],
  operation = 'campaign.sync'
} = {}) {
  const fields = parseBoundaryFields(boundarySource);
  const tenantId = clean(fields.id ?? fields.tenant ?? options.tenantId ?? DEFAULT_MODULE_BOUNDARY.tenantId);
  const workspaceId = clean(fields.workspace ?? fields.workspaceId ?? options.workspaceId ?? DEFAULT_MODULE_BOUNDARY.workspaceId);
  const role = clean(fields.role ?? options.role ?? DEFAULT_MODULE_BOUNDARY.role);
  const requestedTenant = clean(options.requestedTenantId ?? options.requestTenantId);
  const roleCapabilities = ROLE_CAPABILITIES[role] ?? [];
  const deniedCapabilities = unique(capabilities).filter((capability) => !roleCapabilities.includes(capability));
  const crossTenantSafe = !requestedTenant || requestedTenant === tenantId;
  const diagnostics = [
    ...(tenantId ? [] : [{ level: 'error', code: 'module_tenant_missing', subject: operation }]),
    ...(workspaceId ? [] : [{ level: 'error', code: 'module_workspace_missing', subject: operation }]),
    ...(ROLE_CAPABILITIES[role] ? [] : [{ level: 'error', code: 'module_role_unknown', subject: role || 'missing_role' }]),
    ...(crossTenantSafe ? [] : [{ level: 'error', code: 'module_cross_tenant_handoff_blocked', subject: `${requestedTenant}->${tenantId}` }]),
    ...deniedCapabilities.map((capability) => ({
      level: 'warning',
      code: 'module_role_capability_outside_boundary',
      subject: capability
    }))
  ];
  const status = diagnostics.some((item) => item.level === 'error')
    ? 'blocked'
    : deniedCapabilities.length > 0
      ? 'degraded'
      : 'ready';

  return {
    ok: status !== 'blocked',
    contract: {
      schemaVersion: MODULE_SYNTAX_SCHEMA_VERSION,
      tenantId,
      workspaceId,
      role,
      permissionMode: clean(fields.permissionMode ?? options.permissionMode) || DEFAULT_MODULE_BOUNDARY.permissionMode,
      allowedCapabilities: [...roleCapabilities].sort(),
      deniedCapabilities,
      crossTenantSafe,
      status,
      auditHandoff: {
        target: 'kernel.audit.mailchimp',
        subject: `${tenantId}/${workspaceId}/${operation}`,
        includeDeniedCapabilities: deniedCapabilities.length > 0
      }
    },
    diagnostics
  };
}

function parseBoundaryFields(lines) {
  return lines.reduce((fields, line) => {
    const body = clean(line).replace(/^(tenant|workspace)\s+/i, '');
    return { ...fields, ...parseKeyValues(body) };
  }, {});
}

function parseKeyValues(value) {
  return String(value ?? '').split(/\s+/).filter(Boolean).reduce((fields, token) => {
    const [key, ...rest] = token.split('=');
    if (key && rest.length) fields[key] = rest.join('=');
    return fields;
  }, {});
}

function unique(values) {
  return [...new Set(values.map(clean).filter(Boolean))].sort();
}

function normalizeList(value) {
  if (Array.isArray(value)) return value.map(clean).filter(Boolean);
  return String(value ?? '').split(',').map(clean).filter(Boolean);
}

function normalizeModuleProviderAdoptionHistory(input) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    sequence: toNonNegativeInteger(value.sequence ?? value.exportSummary?.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint)
  };
}

function moduleProviderAdoptionFingerprint({
  operation,
  status,
  rows,
  profileMissing,
  importMissing,
  readinessMissing,
  syncChanged
}) {
  return [
    operation,
    status,
    syncChanged ? 'sync_changed' : 'sync_stable',
    ...(profileMissing ?? []).map((capability) => `profile_missing:${capability}`),
    ...(importMissing ?? []).map((capability) => `import_missing:${capability}`),
    ...(readinessMissing ?? []).map((capability) => `readiness_missing:${capability}`),
    ...rows.map((row) => [
      row.component,
      row.status,
      row.restartSafe ? 'restart_safe' : 'restart_guarded',
      row.nextAction
    ].map(clean).filter(Boolean).join(':'))
  ].map(clean).filter(Boolean).join('|');
}

function normalizeActionable(items, source) {
  return Array.isArray(items) ? items.map((item) => ({
    source,
    code: clean(item.code) || 'action_required',
    subject: clean(item.subject) || source,
    action: clean(item.action) || 'Review operational state before resume.',
    severity: clean(item.severity) || (source === 'imports' ? 'warning' : 'error')
  })) : [];
}

function normalizeProviderActions(contract) {
  const missing = contract.capabilityNegotiation?.missingCapabilities ?? [];
  const unsafe = contract.externalHandoff?.unsafeSpecifiers ?? [];
  return [
    ...missing.map((capability) => ({
      source: 'import_provider',
      code: 'provide_import_capability',
      subject: capability,
      action: `Map a Mailchimp import provider that offers ${capability}.`,
      severity: 'error'
    })),
    ...unsafe.map((specifier) => ({
      source: 'import_provider',
      code: 'repair_provider_handoff',
      subject: specifier,
      action: `Route ${specifier} provider handoff through kernel.status.mailchimp.`,
      severity: contract.status === 'blocked' ? 'error' : 'warning'
    }))
  ];
}

function normalizeImportProviderReadinessActions(plan) {
  const summary = plan.exportSummary ?? {};
  const validation = plan.validationSummary ?? {};
  const readiness = plan.readiness ?? {};
  return [
    ...(summary.blockedProviders?.length > 0 ? [{
      source: 'import_provider_readiness',
      code: 'repair_import_provider_readiness',
      subject: summary.blockedProviders.join(','),
      action: 'Repair blocked Mailchimp import provider readiness rows before module handoff.',
      severity: 'error'
    }] : []),
    ...(summary.missingCapabilities?.length > 0 ? [{
      source: 'import_provider_readiness',
      code: 'provide_import_provider_readiness_capabilities',
      subject: summary.missingCapabilities.join(','),
      action: 'Map Mailchimp import providers that satisfy the readiness capability contract.',
      severity: 'error'
    }] : []),
    ...(summary.unsafeHandoffs?.length > 0 ? [{
      source: 'import_provider_readiness',
      code: 'repair_import_provider_readiness_handoffs',
      subject: summary.unsafeHandoffs.join(','),
      action: 'Route Mailchimp import provider readiness handoffs through kernel.status.mailchimp.',
      severity: plan.status === 'blocked' ? 'error' : 'warning'
    }] : []),
    ...(summary.pendingSyncs?.length > 0 ? [{
      source: 'import_provider_readiness',
      code: 'wait_import_provider_readiness_sync',
      subject: summary.pendingSyncs.join(','),
      action: 'Wait for pending Mailchimp import provider sync windows before restart-safe export.',
      severity: 'warning'
    }] : []),
    ...(validation.awaitingAcceptance > 0 ? [{
      source: 'import_provider_readiness',
      code: 'accept_import_provider_readiness',
      subject: String(validation.awaitingAcceptance),
      action: 'Accept required Mailchimp import provider readiness rows before module export.',
      severity: plan.status === 'blocked' ? 'error' : 'warning'
    }] : []),
    ...((readiness.blockingReasons ?? []).map((reason) => ({
      source: 'import_provider_readiness',
      code: 'import_provider_readiness_blocker',
      subject: reason,
      action: 'Resolve Mailchimp import provider readiness blockers before publishing module status.',
      severity: 'error'
    }))),
    ...((readiness.degradedReasons ?? []).map((reason) => ({
      source: 'import_provider_readiness',
      code: 'import_provider_readiness_degraded',
      subject: reason,
      action: 'Publish degraded Mailchimp import provider readiness status before guarded handoff.',
      severity: 'warning'
    })))
  ];
}

function normalizeImportRuntimeAdoptionActions(adoption) {
  const summary = adoption.exportSummary ?? {};
  const readiness = adoption.readiness ?? {};
  return [
    ...(summary.blockedImports?.length > 0 ? [{
      source: 'import_runtime_adoption',
      code: 'repair_import_runtime_adoption',
      subject: summary.blockedImports.join(','),
      action: 'Repair blocked Mailchimp import runtime adoption rows before module handoff.',
      severity: 'error'
    }] : []),
    ...(summary.degradedImports?.length > 0 ? [{
      source: 'import_runtime_adoption',
      code: 'publish_import_runtime_adoption_guard',
      subject: summary.degradedImports.join(','),
      action: 'Publish degraded Mailchimp import runtime adoption status before guarded handoff.',
      severity: adoption.status === 'blocked' ? 'error' : 'warning'
    }] : []),
    ...(adoption.changed === true && adoption.status !== 'blocked' ? [{
      source: 'import_runtime_adoption',
      code: 'publish_import_runtime_adoption_delta',
      subject: summary.fingerprint ?? adoption.fingerprint ?? 'import_runtime_adoption',
      action: 'Publish the Mailchimp import runtime adoption delta with the module operations handoff.',
      severity: adoption.status === 'degraded' ? 'warning' : 'info'
    }] : []),
    ...(readiness.blockingReasons ?? []).map((reason) => ({
      source: 'import_runtime_adoption',
      code: 'import_runtime_adoption_blocker',
      subject: reason,
      action: 'Resolve Mailchimp import runtime adoption blockers before activation.',
      severity: 'error'
    })),
    ...(readiness.degradedReasons ?? []).map((reason) => ({
      source: 'import_runtime_adoption',
      code: 'import_runtime_adoption_degraded',
      subject: reason,
      action: 'Publish degraded Mailchimp import runtime adoption state before guarded activation.',
      severity: 'warning'
    }))
  ];
}

function normalizeProviderAdoptionActions(adoption, source) {
  const summary = adoption.exportSummary ?? {};
  const readiness = adoption.readiness ?? {};
  return [
    ...(summary.blockedProviders?.length > 0 ? [{
      source,
      code: 'repair_provider_adoption',
      subject: summary.blockedProviders.join(','),
      action: 'Repair blocked Mailchimp provider adoption rows before module activation.',
      severity: 'error'
    }] : []),
    ...(summary.blockedComponents?.length > 0 ? [{
      source,
      code: 'repair_provider_adoption_components',
      subject: summary.blockedComponents.join(','),
      action: 'Resolve blocked Mailchimp provider adoption components before handoff.',
      severity: 'error'
    }] : []),
    ...(summary.degradedProviders?.length > 0 ? [{
      source,
      code: 'publish_provider_adoption_guard',
      subject: summary.degradedProviders.join(','),
      action: 'Publish degraded Mailchimp provider adoption status before guarded handoff.',
      severity: adoption.status === 'blocked' ? 'error' : 'warning'
    }] : []),
    ...(summary.degradedComponents?.length > 0 ? [{
      source,
      code: 'publish_provider_adoption_component_guard',
      subject: summary.degradedComponents.join(','),
      action: 'Publish Mailchimp provider adoption component guard state.',
      severity: adoption.status === 'blocked' ? 'error' : 'warning'
    }] : []),
    ...(summary.awaitingAcceptance?.length > 0 ? [{
      source,
      code: 'accept_provider_adoption',
      subject: summary.awaitingAcceptance.join(','),
      action: 'Accept Mailchimp provider adoption preview rows or disable explicit acceptance.',
      severity: adoption.status === 'blocked' ? 'error' : 'warning'
    }] : []),
    ...(summary.changed === true && adoption.status !== 'blocked' ? [{
      source,
      code: 'publish_provider_adoption_delta',
      subject: summary.fingerprint ?? adoption.fingerprint ?? source,
      action: 'Publish the Mailchimp provider adoption delta with the module operations handoff.',
      severity: adoption.status === 'degraded' ? 'warning' : 'info'
    }] : []),
    ...(readiness.blockingReasons ?? []).map((reason) => ({
      source,
      code: 'provider_adoption_blocker',
      subject: reason,
      action: 'Resolve Mailchimp provider adoption blockers before activation.',
      severity: 'error'
    }))
  ];
}

function normalizeProfileProviderActions(contract) {
  const missing = contract.negotiation?.missingCapabilities ?? [];
  const handoffReady = contract.externalState?.ready !== false;
  return [
    ...missing.map((capability) => ({
      source: 'profile_provider',
      code: 'provide_profile_provider_capability',
      subject: capability,
      action: `Expose ${capability} from the Mailchimp profile provider before module handoff.`,
      severity: 'error'
    })),
    ...(handoffReady ? [] : [{
      source: 'profile_provider',
      code: 'repair_profile_provider_handoff',
      subject: contract.externalState?.statusChannel ?? 'kernel.status.mailchimp',
      action: 'Route the Mailchimp profile provider external state through kernel.status.mailchimp.',
      severity: contract.status === 'blocked' ? 'error' : 'warning'
    }]),
    ...(contract.status === 'degraded' ? [{
      source: 'profile_provider',
      code: 'publish_profile_provider_degraded',
      subject: contract.profileName ?? 'mailchimp.profile',
      action: 'Publish degraded Mailchimp profile provider status before guarded resume.',
      severity: 'warning'
    }] : [])
  ];
}

function normalizeProfileActivationActions(activation) {
  const summary = activation.exportSummary ?? {};
  const readiness = activation.readiness ?? {};
  return [
    ...(summary.blockedRows?.length > 0 ? [{
      source: 'profile_activation',
      code: 'resolve_profile_activation_blockers',
      subject: summary.blockedRows.join(','),
      action: 'Resolve blocked Mailchimp profile activation rows before runtime enablement.',
      severity: 'error'
    }] : []),
    ...(summary.degradedRows?.length > 0 ? [{
      source: 'profile_activation',
      code: 'publish_profile_activation_guard',
      subject: summary.degradedRows.join(','),
      action: 'Publish degraded Mailchimp profile activation controls before guarded resume.',
      severity: activation.status === 'blocked' ? 'error' : 'warning'
    }] : []),
    ...(summary.desiredState && summary.desiredState !== 'enabled' ? [{
      source: 'profile_activation',
      code: 'apply_profile_activation_control',
      subject: summary.desiredState,
      action: activation.handoff?.nextAction ?? readiness.nextAction ?? 'apply_profile_activation_control',
      severity: activation.status === 'blocked' ? 'error' : 'warning'
    }] : []),
    ...(readiness.blockingReasons ?? []).map((reason) => ({
      source: 'profile_activation',
      code: 'profile_activation_blocker',
      subject: reason,
      action: 'Resolve Mailchimp profile activation blocker before module handoff.',
      severity: 'error'
    })),
    ...(readiness.degradedReasons ?? []).map((reason) => ({
      source: 'profile_activation',
      code: 'profile_activation_degraded',
      subject: reason,
      action: 'Publish degraded Mailchimp profile activation state before guarded handoff.',
      severity: 'warning'
    }))
  ];
}

function normalizeProfileLifecycleSettingsControlActions(contract) {
  const summary = contract.exportSummary ?? {};
  const readiness = contract.readiness ?? {};
  return [
    ...(summary.blockedRows?.length > 0 ? [{
      source: 'profile_lifecycle_settings_controls',
      code: 'resolve_profile_lifecycle_control_blockers',
      subject: summary.blockedRows.join(','),
      action: readiness.nextAction ?? 'Resolve blocked Mailchimp profile lifecycle controls.',
      severity: 'error'
    }] : []),
    ...(summary.guardedRows?.length > 0 ? [{
      source: 'profile_lifecycle_settings_controls',
      code: 'publish_profile_lifecycle_control_guard',
      subject: summary.guardedRows.join(','),
      action: 'Publish guarded Mailchimp profile lifecycle controls before client handoff.',
      severity: contract.status === 'blocked' ? 'error' : 'warning'
    }] : []),
    ...(summary.awaitingAcceptance?.length > 0 ? [{
      source: 'profile_lifecycle_settings_controls',
      code: 'profile_lifecycle_control_acceptance_pending',
      subject: summary.awaitingAcceptance.join(','),
      action: 'Collect lifecycle control acceptance before exposing Mailchimp runtime controls.',
      severity: contract.status === 'blocked' ? 'error' : 'warning'
    }] : []),
    ...(summary.availableCommands?.length > 0 && contract.status === 'ready' ? [{
      source: 'profile_lifecycle_settings_controls',
      code: 'publish_profile_lifecycle_control_contract',
      subject: summary.availableCommands.join(','),
      action: contract.handoff?.nextAction ?? 'Publish Mailchimp profile lifecycle control contract.',
      severity: 'info'
    }] : []),
    ...(readiness.blockingReasons ?? []).map((reason) => ({
      source: 'profile_lifecycle_settings_controls',
      code: 'profile_lifecycle_control_blocker',
      subject: reason,
      action: 'Resolve Mailchimp profile lifecycle control blocker before module launch.',
      severity: 'error'
    })),
    ...(readiness.guardedReasons ?? []).map((reason) => ({
      source: 'profile_lifecycle_settings_controls',
      code: 'profile_lifecycle_control_guarded',
      subject: reason,
      action: 'Publish guarded Mailchimp profile lifecycle control state before launch.',
      severity: 'warning'
    }))
  ];
}

function normalizeProviderPreviewActions(preview) {
  const summary = preview.validationSummary ?? {};
  const readiness = preview.readiness ?? {};
  return [
    ...(summary.awaitingAcceptance > 0 ? [{
      source: 'provider_preview',
      code: 'accept_provider_preview',
      subject: String(summary.awaitingAcceptance),
      action: 'Accept Mailchimp provider preview rows before exporting the module contract.',
      severity: preview.status === 'blocked' ? 'error' : 'warning'
    }] : []),
    ...(summary.missingCapabilities > 0 ? [{
      source: 'provider_preview',
      code: 'repair_provider_preview_capabilities',
      subject: String(summary.missingCapabilities),
      action: 'Repair provider capability negotiation before module export.',
      severity: 'error'
    }] : []),
    ...(readiness.blockingReasons ?? []).map((reason) => ({
      source: 'provider_preview',
      code: 'provider_preview_blocker',
      subject: reason,
      action: 'Resolve Mailchimp provider preview blockers before module handoff.',
      severity: 'error'
    })),
    ...(readiness.degradedReasons ?? []).map((reason) => ({
      source: 'provider_preview',
      code: 'provider_preview_degraded',
      subject: reason,
      action: 'Publish degraded Mailchimp provider preview status before guarded handoff.',
      severity: 'warning'
    }))
  ];
}

function normalizeProfileLifecycleActions(lifecycle) {
  const controls = lifecycle.controls ?? {};
  const blockers = lifecycle.blockers ?? {};
  const schedule = lifecycle.schedule ?? {};
  return [
    ...(lifecycle.status === 'blocked' || lifecycle.status === 'operator_review' ? [{
      source: 'profile_lifecycle',
      code: 'review_profile_lifecycle',
      subject: lifecycle.profileName ?? 'mailchimp.profile',
      action: 'Review profile lifecycle blockers before module handoff.',
      severity: 'error'
    }] : []),
    ...(lifecycle.status === 'disabled' ? [{
      source: 'profile_lifecycle',
      code: 'enable_profile_lifecycle',
      subject: lifecycle.profileName ?? 'mailchimp.profile',
      action: 'Enable the Mailchimp profile lifecycle before dispatching the module contract.',
      severity: 'warning'
    }] : []),
    ...(lifecycle.status === 'paused' ? [{
      source: 'profile_lifecycle',
      code: 'resume_profile_lifecycle',
      subject: lifecycle.profileName ?? 'mailchimp.profile',
      action: 'Resume the Mailchimp profile lifecycle before module dispatch.',
      severity: 'warning'
    }] : []),
    ...(lifecycle.status === 'retry_scheduled' ? [{
      source: 'profile_lifecycle',
      code: 'dispatch_profile_retry',
      subject: schedule.nextRetry?.reason ?? 'profile_retry',
      action: 'Dispatch the scheduled Mailchimp profile retry through the kernel status handoff.',
      severity: 'warning'
    }] : []),
    ...(blockers.missingClaims ?? []).map((claim) => ({
      source: 'profile_lifecycle',
      code: 'collect_profile_lifecycle_claim',
      subject: claim,
      action: `Attach ${claim} before resuming the Mailchimp profile lifecycle.`,
      severity: 'error'
    })),
    ...(blockers.missingDurableMemory ?? []).map((name) => ({
      source: 'profile_lifecycle',
      code: 'restore_profile_lifecycle_memory',
      subject: name,
      action: `Restore ${name} before retrying the Mailchimp profile lifecycle.`,
      severity: controls.canRetry ? 'warning' : 'error'
    })),
    ...(blockers.statusChannelReady === false ? [{
      source: 'profile_lifecycle',
      code: 'repair_profile_lifecycle_handoff',
      subject: 'kernel.status.mailchimp',
      action: 'Route profile lifecycle handoff through kernel.status.mailchimp.',
      severity: 'error'
    }] : [])
  ];
}

function normalizeProfileExportActions(profileExport) {
  const summary = profileExport.exportSummary ?? {};
  return [
    ...(summary.missingClaims ?? []).map((claim) => ({
      source: 'profile_export',
      code: 'collect_profile_claim',
      subject: claim,
      action: `Attach ${claim} before exporting the Mailchimp module contract.`,
      severity: 'error'
    })),
    ...(summary.missingDurableMemory ?? []).map((name) => ({
      source: 'profile_export',
      code: 'restore_profile_memory',
      subject: name,
      action: `Restore ${name} before exporting restart-safe Mailchimp runtime state.`,
      severity: 'warning'
    })),
    ...(profileExport.readiness?.blockingReasons ?? []).map((reason) => ({
      source: 'profile_export',
      code: 'profile_export_blocker',
      subject: reason,
      action: 'Resolve profile export blockers before module handoff.',
      severity: 'error'
    }))
  ];
}

function normalizeImportPreviewActions(preview) {
  const summary = preview.validationSummary ?? {};
  const readiness = preview.readiness ?? {};
  return [
    ...(summary.awaitingAcceptance > 0 ? [{
      source: 'import_preview',
      code: 'accept_required_imports',
      subject: String(summary.awaitingAcceptance),
      action: 'Accept required Mailchimp import previews before exporting the module contract.',
      severity: 'error'
    }] : []),
    ...(summary.rejectedRequired > 0 ? [{
      source: 'import_preview',
      code: 'review_rejected_required_imports',
      subject: String(summary.rejectedRequired),
      action: 'Remove or re-accept rejected required Mailchimp imports before export.',
      severity: 'error'
    }] : []),
    ...(summary.unsafeRequiredHandoffs > 0 ? [{
      source: 'import_preview',
      code: 'repair_required_import_handoff',
      subject: String(summary.unsafeRequiredHandoffs),
      action: 'Route required import status handoffs through kernel.status.mailchimp.',
      severity: preview.status === 'blocked' ? 'error' : 'warning'
    }] : []),
    ...(readiness.degradedReasons ?? []).map((reason) => ({
      source: 'import_preview',
      code: 'import_preview_degraded',
      subject: reason,
      action: 'Publish degraded import preview status before guarded module handoff.',
      severity: 'warning'
    }))
  ];
}

function normalizeImportHistoryActions(historyExport) {
  const summary = historyExport.exportSummary ?? {};
  const deltas = historyExport.deltas ?? {};
  return [
    ...(historyExport.status === 'blocked' ? [{
      source: 'import_history',
      code: 'review_import_history_export',
      subject: summary.fingerprint ?? 'import_history',
      action: 'Review blocked Mailchimp import history export before module handoff.',
      severity: 'error'
    }] : []),
    ...(summary.unsafeHandoffs > 0 ? [{
      source: 'import_history',
      code: 'repair_import_history_handoffs',
      subject: String(summary.unsafeHandoffs),
      action: 'Route changed Mailchimp imports through kernel.status.mailchimp before restart-safe export.',
      severity: historyExport.status === 'blocked' ? 'error' : 'warning'
    }] : []),
    ...(summary.changedImports > 0 || summary.addedImports > 0 || summary.removedImports > 0 ? [{
      source: 'import_history',
      code: 'publish_import_history_delta',
      subject: summary.fingerprint ?? 'import_history',
      action: 'Publish the Mailchimp import history delta with the module status handoff.',
      severity: historyExport.status === 'degraded' ? 'warning' : 'info'
    }] : []),
    ...((deltas.removedImports ?? []).map((exportKey) => ({
      source: 'import_history',
      code: 'review_removed_import',
      subject: exportKey,
      action: 'Confirm removed Mailchimp import is no longer required by the module contract.',
      severity: 'warning'
    })))
  ];
}

function normalizeImportTimelineReportActions(timelineReport) {
  const summary = timelineReport.exportSummary ?? {};
  const counters = timelineReport.counters ?? {};
  return [
    ...(timelineReport.status === 'blocked' ? [{
      source: 'import_timeline_report',
      code: 'resolve_import_timeline_report',
      subject: summary.fingerprint ?? 'import_timeline_report',
      action: 'Resolve blocked Mailchimp import timeline rows before module handoff.',
      severity: 'error'
    }] : []),
    ...((summary.blockedImports ?? []).map((alias) => ({
      source: 'import_timeline_report',
      code: 'import_timeline_row_blocked',
      subject: alias,
      action: 'Review the blocked Mailchimp import timeline row before restart-safe dispatch.',
      severity: 'error'
    }))),
    ...((summary.degradedImports ?? []).map((alias) => ({
      source: 'import_timeline_report',
      code: 'import_timeline_row_degraded',
      subject: alias,
      action: 'Publish degraded Mailchimp import timeline status before guarded resume.',
      severity: timelineReport.status === 'blocked' ? 'error' : 'warning'
    }))),
    ...(counters.changedImports > 0 || timelineReport.changed === true ? [{
      source: 'import_timeline_report',
      code: 'publish_import_timeline_delta',
      subject: summary.fingerprint ?? 'import_timeline_report',
      action: 'Publish the Mailchimp import timeline delta with module status handoff.',
      severity: timelineReport.status === 'degraded' ? 'warning' : 'info'
    }] : [])
  ];
}

function normalizeImportBoundaryActions(boundaryAcceptance) {
  const summary = boundaryAcceptance.validationSummary ?? {};
  const readiness = boundaryAcceptance.readiness ?? {};
  return [
    ...(summary.crossTenantBlocked > 0 ? [{
      source: 'import_boundary',
      code: 'block_cross_tenant_imports',
      subject: String(summary.crossTenantBlocked),
      action: 'Review cross-tenant Mailchimp import boundary requests before module handoff.',
      severity: 'error'
    }] : []),
    ...(summary.providerCapabilityGaps > 0 ? [{
      source: 'import_boundary',
      code: 'repair_import_boundary_provider_capabilities',
      subject: String(summary.providerCapabilityGaps),
      action: 'Repair Mailchimp import provider capability gaps before accepting the boundary preview.',
      severity: 'error'
    }] : []),
    ...(summary.awaitingAcceptance > 0 ? [{
      source: 'import_boundary',
      code: 'accept_import_boundary',
      subject: String(summary.awaitingAcceptance),
      action: 'Accept required Mailchimp import boundary rows before exporting the module contract.',
      severity: boundaryAcceptance.status === 'blocked' ? 'error' : 'warning'
    }] : []),
    ...(summary.unsafeHandoffs > 0 ? [{
      source: 'import_boundary',
      code: 'repair_import_boundary_handoff',
      subject: String(summary.unsafeHandoffs),
      action: 'Route import boundary handoffs through kernel.status.mailchimp before restart-safe dispatch.',
      severity: boundaryAcceptance.status === 'blocked' ? 'error' : 'warning'
    }] : []),
    ...(readiness.blockingReasons ?? []).map((reason) => ({
      source: 'import_boundary',
      code: 'import_boundary_blocker',
      subject: reason,
      action: 'Resolve Mailchimp import boundary blockers before module handoff.',
      severity: 'error'
    })),
    ...(readiness.degradedReasons ?? []).map((reason) => ({
      source: 'import_boundary',
      code: 'import_boundary_degraded',
      subject: reason,
      action: 'Publish degraded Mailchimp import boundary status before guarded handoff.',
      severity: 'warning'
    }))
  ];
}

function normalizeProfilePreviewActions(preview) {
  const summary = preview.validationSummary ?? {};
  const readiness = preview.readiness ?? {};
  return [
    ...(summary.missingClaims > 0 ? [{
      source: 'profile_preview',
      code: 'collect_profile_preview_claims',
      subject: String(summary.missingClaims),
      action: 'Collect required Mailchimp profile claims before accepting the profile preview.',
      severity: 'error'
    }] : []),
    ...(summary.providerMissingCapabilities > 0 ? [{
      source: 'profile_preview',
      code: 'repair_profile_preview_provider',
      subject: String(summary.providerMissingCapabilities),
      action: 'Repair Mailchimp profile provider capabilities before module export.',
      severity: 'error'
    }] : []),
    ...(summary.awaitingAcceptance > 0 ? [{
      source: 'profile_preview',
      code: 'accept_profile_preview',
      subject: String(summary.awaitingAcceptance),
      action: 'Accept required Mailchimp profile preview rows before exporting the module contract.',
      severity: preview.status === 'blocked' ? 'error' : 'warning'
    }] : []),
    ...(summary.missingDurableMemory > 0 ? [{
      source: 'profile_preview',
      code: 'restore_profile_preview_memory',
      subject: String(summary.missingDurableMemory),
      action: 'Restore durable Mailchimp profile memory before restart-safe module dispatch.',
      severity: 'warning'
    }] : []),
    ...(readiness.blockingReasons ?? []).map((reason) => ({
      source: 'profile_preview',
      code: 'profile_preview_blocker',
      subject: reason,
      action: 'Resolve Mailchimp profile preview blockers before module handoff.',
      severity: 'error'
    })),
    ...(readiness.degradedReasons ?? []).map((reason) => ({
      source: 'profile_preview',
      code: 'profile_preview_degraded',
      subject: reason,
      action: 'Publish degraded Mailchimp profile preview status before guarded handoff.',
      severity: 'warning'
    }))
  ];
}

function normalizeProfileBoundaryEvidenceActions(evidence) {
  const summary = evidence.validationSummary ?? {};
  const readiness = evidence.readiness ?? {};
  return [
    ...(summary.blockedRows > 0 ? [{
      source: 'profile_boundary_evidence',
      code: 'review_profile_boundary_evidence',
      subject: String(summary.blockedRows),
      action: 'Review blocked Mailchimp profile boundary evidence rows before module handoff.',
      severity: 'error'
    }] : []),
    ...(summary.deniedCapabilities > 0 ? [{
      source: 'profile_boundary_evidence',
      code: 'ack_profile_boundary_capabilities',
      subject: String(summary.deniedCapabilities),
      action: 'Acknowledge Mailchimp profile capability boundary advisories before guarded dispatch.',
      severity: evidence.status === 'blocked' ? 'error' : 'warning'
    }] : []),
    ...(summary.deniedPermissions > 0 ? [{
      source: 'profile_boundary_evidence',
      code: 'ack_profile_boundary_permissions',
      subject: String(summary.deniedPermissions),
      action: 'Acknowledge Mailchimp profile permission boundary advisories before guarded dispatch.',
      severity: evidence.status === 'blocked' ? 'error' : 'warning'
    }] : []),
    ...(summary.awaitingAcceptance > 0 ? [{
      source: 'profile_boundary_evidence',
      code: 'accept_profile_boundary_evidence',
      subject: String(summary.awaitingAcceptance),
      action: 'Accept required Mailchimp profile boundary evidence rows before exporting the module contract.',
      severity: evidence.status === 'blocked' ? 'error' : 'warning'
    }] : []),
    ...(readiness.blockingReasons ?? []).map((reason) => ({
      source: 'profile_boundary_evidence',
      code: 'profile_boundary_evidence_blocker',
      subject: reason,
      action: 'Resolve Mailchimp profile boundary evidence blockers before module handoff.',
      severity: 'error'
    })),
    ...(readiness.degradedReasons ?? []).map((reason) => ({
      source: 'profile_boundary_evidence',
      code: 'profile_boundary_evidence_degraded',
      subject: reason,
      action: 'Publish degraded Mailchimp profile boundary evidence before guarded handoff.',
      severity: 'warning'
    }))
  ];
}

function normalizeProfilePrimaryPackActions(pack) {
  const counters = pack.counters ?? {};
  const summary = pack.exportSummary ?? {};
  return [
    ...(pack.status === 'blocked' ? [{
      source: 'profile_primary_pack',
      code: 'review_profile_primary_pack',
      subject: summary.fingerprint ?? pack.fingerprint ?? 'profile_primary_pack',
      action: 'Review blocked Mailchimp profile primary pack before module export.',
      severity: 'error'
    }] : []),
    ...(counters.restartGuarded > 0 ? [{
      source: 'profile_primary_pack',
      code: 'repair_profile_primary_pack_restart_guards',
      subject: String(counters.restartGuarded),
      action: 'Repair guarded Mailchimp profile primary pack rows before restart-safe handoff.',
      severity: pack.status === 'blocked' ? 'error' : 'warning'
    }] : []),
    ...(counters.missingClaims > 0 ? [{
      source: 'profile_primary_pack',
      code: 'collect_profile_primary_pack_claims',
      subject: String(counters.missingClaims),
      action: 'Collect missing Mailchimp profile claims before publishing the primary pack.',
      severity: 'error'
    }] : []),
    ...(counters.awaitingPreviewAcceptance > 0 || counters.awaitingBoundaryAcceptance > 0 ? [{
      source: 'profile_primary_pack',
      code: 'accept_profile_primary_pack_rows',
      subject: `${toNonNegativeInteger(counters.awaitingPreviewAcceptance, 0)}:${toNonNegativeInteger(counters.awaitingBoundaryAcceptance, 0)}`,
      action: 'Accept pending Mailchimp profile preview and boundary rows before primary pack export.',
      severity: pack.status === 'blocked' ? 'error' : 'warning'
    }] : []),
    ...(pack.changed === true && pack.status !== 'blocked' ? [{
      source: 'profile_primary_pack',
      code: 'publish_profile_primary_pack_delta',
      subject: summary.fingerprint ?? pack.fingerprint ?? 'profile_primary_pack',
      action: 'Publish the Mailchimp profile primary pack delta with the module operations handoff.',
      severity: pack.status === 'degraded' ? 'warning' : 'info'
    }] : [])
  ];
}

function normalizeProfileRuntimeAdoptionActions(adoption) {
  const summary = adoption.exportSummary ?? {};
  const readiness = adoption.readiness ?? {};
  return [
    ...(adoption.status === 'blocked' ? [{
      source: 'profile_runtime_adoption',
      code: 'review_profile_runtime_adoption',
      subject: summary.fingerprint ?? adoption.fingerprint ?? 'profile_runtime_adoption',
      action: 'Review blocked Mailchimp profile runtime adoption before module handoff.',
      severity: 'error'
    }] : []),
    ...((readiness.blockingReasons ?? []).map((reason) => ({
      source: 'profile_runtime_adoption',
      code: 'profile_runtime_adoption_blocker',
      subject: reason,
      action: 'Resolve Mailchimp profile runtime adoption blockers before publishing client handoff.',
      severity: 'error'
    }))),
    ...((readiness.degradedReasons ?? []).map((reason) => ({
      source: 'profile_runtime_adoption',
      code: 'profile_runtime_adoption_degraded',
      subject: reason,
      action: 'Publish degraded Mailchimp profile runtime adoption status before guarded resume.',
      severity: 'warning'
    }))),
    ...(summary.changed === true && adoption.status !== 'blocked' ? [{
      source: 'profile_runtime_adoption',
      code: 'publish_profile_runtime_adoption_delta',
      subject: summary.requestKey ?? summary.fingerprint ?? 'profile_runtime_adoption',
      action: 'Publish the Mailchimp profile runtime adoption delta with request and resume state.',
      severity: adoption.status === 'degraded' ? 'warning' : 'info'
    }] : []),
    ...(adoption.restartSafe === false ? [{
      source: 'profile_runtime_adoption',
      code: 'repair_profile_runtime_adoption_restart_guard',
      subject: summary.requestKey ?? 'profile_runtime_adoption',
      action: 'Repair guarded Mailchimp profile runtime adoption before restart-safe dispatch.',
      severity: adoption.status === 'blocked' ? 'error' : 'warning'
    }] : [])
  ];
}

function normalizeProfileRestartRecoveryActions(packet) {
  const summary = packet.exportSummary ?? {};
  const resumePlan = packet.resumePlan ?? {};
  return [
    ...(packet.status === 'blocked' ? [{
      source: 'profile_restart_recovery',
      code: 'review_profile_restart_recovery',
      subject: summary.restartKey ?? packet.checkpoint?.restartKey ?? 'profile_restart_recovery',
      action: 'Review blocked Mailchimp profile restart recovery before module resume.',
      severity: 'error'
    }] : []),
    ...((resumePlan.blockedBy ?? []).map((reason) => ({
      source: 'profile_restart_recovery',
      code: 'profile_restart_recovery_blocker',
      subject: reason,
      action: 'Resolve Mailchimp profile restart blockers before publishing resume handoff.',
      severity: 'error'
    }))),
    ...((resumePlan.degradedBy ?? []).map((reason) => ({
      source: 'profile_restart_recovery',
      code: 'profile_restart_recovery_degraded',
      subject: reason,
      action: 'Publish degraded Mailchimp profile restart status before guarded resume.',
      severity: 'warning'
    }))),
    ...((resumePlan.steps ?? [])
      .filter((step) => step.status !== 'ready')
      .map((step) => ({
        source: 'profile_restart_recovery',
        code: clean(step.action) || 'profile_restart_recovery_step',
        subject: clean(step.subject) || summary.restartKey || 'profile_restart_recovery',
        action: `Run Mailchimp profile restart step ${clean(step.action) || 'profile_restart_recovery_step'}.`,
        severity: step.required === true || step.status === 'blocked' ? 'error' : 'warning'
      }))),
    ...(summary.changed === true && packet.status !== 'blocked' ? [{
      source: 'profile_restart_recovery',
      code: 'publish_profile_restart_checkpoint',
      subject: summary.restartKey ?? summary.fingerprint ?? 'profile_restart_recovery',
      action: 'Publish the Mailchimp profile restart checkpoint with the module status handoff.',
      severity: packet.status === 'degraded' ? 'warning' : 'info'
    }] : []),
    ...(packet.restartSafe === false ? [{
      source: 'profile_restart_recovery',
      code: 'repair_profile_restart_guard',
      subject: summary.restartKey ?? 'profile_restart_recovery',
      action: 'Repair Mailchimp profile restart guards before marking the module restart-safe.',
      severity: packet.status === 'blocked' ? 'error' : 'warning'
    }] : [])
  ];
}

function normalizeProfileRestartStatusLedgerActions(ledger) {
  const summary = ledger.exportSummary ?? {};
  return [
    ...(ledger.status === 'blocked' ? [{
      source: 'profile_restart_status_ledger',
      code: 'review_profile_restart_status_ledger',
      subject: summary.restartKey ?? summary.fingerprint ?? 'profile_restart_status_ledger',
      action: 'Review blocked Mailchimp profile restart status ledger before module resume.',
      severity: 'error'
    }] : []),
    ...((summary.blockedRows ?? []).map((row) => ({
      source: 'profile_restart_status_ledger',
      code: 'profile_restart_status_row_blocked',
      subject: row,
      action: 'Resolve the blocked Mailchimp profile restart ledger row before publishing module status.',
      severity: 'error'
    }))),
    ...((summary.degradedRows ?? []).map((row) => ({
      source: 'profile_restart_status_ledger',
      code: 'profile_restart_status_row_guarded',
      subject: row,
      action: 'Publish guarded Mailchimp profile restart ledger status before restart-safe handoff.',
      severity: ledger.status === 'blocked' ? 'error' : 'warning'
    }))),
    ...(summary.changed === true && ledger.status !== 'blocked' ? [{
      source: 'profile_restart_status_ledger',
      code: 'publish_profile_restart_status_ledger_delta',
      subject: summary.fingerprint ?? summary.restartKey ?? 'profile_restart_status_ledger',
      action: 'Publish the Mailchimp profile restart status ledger delta with the module handoff.',
      severity: ledger.status === 'degraded' ? 'warning' : 'info'
    }] : []),
    ...(ledger.restartSafe === false ? [{
      source: 'profile_restart_status_ledger',
      code: 'repair_profile_restart_status_ledger_guard',
      subject: summary.restartKey ?? 'profile_restart_status_ledger',
      action: 'Repair Mailchimp profile restart ledger guards before marking the module restart-safe.',
      severity: ledger.status === 'blocked' ? 'error' : 'warning'
    }] : [])
  ];
}

function normalizeProfileRestartReplayDecisionActions(decision) {
  const summary = decision.exportSummary ?? {};
  const readiness = decision.readiness ?? {};
  const idempotency = decision.idempotency ?? {};
  return [
    ...(decision.status === 'blocked' ? [{
      source: 'profile_restart_replay_decision',
      code: 'review_profile_restart_replay_decision',
      subject: summary.fingerprint ?? decision.fingerprint ?? 'profile_restart_replay_decision',
      action: 'Review blocked Mailchimp profile restart replay decision before module resume.',
      severity: 'error'
    }] : []),
    ...((readiness.blockingReasons ?? summary.blockedRows ?? []).map((row) => ({
      source: 'profile_restart_replay_decision',
      code: 'profile_restart_replay_decision_blocked_row',
      subject: row,
      action: 'Resolve the blocked Mailchimp profile replay decision row before restart-safe handoff.',
      severity: 'error'
    }))),
    ...((readiness.guardedReasons ?? summary.guardedRows ?? []).map((row) => ({
      source: 'profile_restart_replay_decision',
      code: 'profile_restart_replay_decision_guarded_row',
      subject: row,
      action: 'Publish guarded Mailchimp profile replay decision status before module resume.',
      severity: decision.status === 'blocked' ? 'error' : 'warning'
    }))),
    ...((idempotency.suppressedCommandKeys ?? summary.suppressedCommandKeys ?? []).map((commandKey) => ({
      source: 'profile_restart_replay_decision',
      code: 'profile_restart_replay_command_suppressed',
      subject: commandKey,
      action: 'Keep the duplicate Mailchimp profile replay command suppressed during restart recovery.',
      severity: 'info'
    }))),
    ...(summary.changed === true && decision.status !== 'blocked' ? [{
      source: 'profile_restart_replay_decision',
      code: 'publish_profile_restart_replay_decision_delta',
      subject: summary.fingerprint ?? 'profile_restart_replay_decision',
      action: 'Publish the Mailchimp profile restart replay decision delta with module status.',
      severity: decision.status === 'guarded' ? 'warning' : 'info'
    }] : []),
    ...(decision.restartSafe === false ? [{
      source: 'profile_restart_replay_decision',
      code: 'repair_profile_restart_replay_guard',
      subject: summary.fingerprint ?? 'profile_restart_replay_decision',
      action: 'Repair guarded Mailchimp profile replay decisions before marking the module restart-safe.',
      severity: decision.status === 'blocked' ? 'error' : 'warning'
    }] : [])
  ];
}

function normalizeFeatureBoundaryControlActions(controls) {
  const summary = controls.exportSummary ?? {};
  return [
    ...(controls.status === 'blocked' ? [{
      source: 'feature_boundary_controls',
      code: 'resolve_feature_boundary_controls',
      subject: summary.operation ?? controls.operation ?? 'feature_boundary_controls',
      action: 'Resolve Mailchimp feature gate tenant and permission boundary blockers before module handoff.',
      severity: 'error'
    }] : []),
    ...((controls.blockedRows ?? []).map((row) => ({
      source: 'feature_boundary_controls',
      code: 'feature_boundary_row_blocked',
      subject: row,
      action: 'Review the blocked Mailchimp feature boundary row before enabling import lifecycle controls.',
      severity: 'error'
    }))),
    ...((controls.degradedRows ?? []).map((row) => ({
      source: 'feature_boundary_controls',
      code: 'feature_boundary_row_degraded',
      subject: row,
      action: 'Publish a Mailchimp feature boundary advisory before guarded module resume.',
      severity: 'warning'
    }))),
    ...(summary.nextAction && controls.status !== 'ready' ? [{
      source: 'feature_boundary_controls',
      code: 'feature_boundary_next_action',
      subject: summary.title ?? 'mailchimp_feature_gate_boundary_controls',
      action: summary.nextAction,
      severity: controls.status === 'blocked' ? 'error' : 'warning'
    }] : [])
  ];
}

function normalizeFeatureLifecycleReadinessActions(readiness) {
  const summary = readiness.exportSummary ?? {};
  const validation = readiness.validationSummary ?? {};
  return [
    ...(readiness.status === 'blocked' ? [{
      source: 'feature_lifecycle_readiness',
      code: 'resolve_feature_lifecycle_readiness',
      subject: summary.title ?? 'mailchimp_feature_lifecycle_readiness',
      action: 'Resolve Mailchimp feature lifecycle readiness blockers before module dispatch.',
      severity: 'error'
    }] : []),
    ...((summary.blockedRows ?? []).map((row) => ({
      source: 'feature_lifecycle_readiness',
      code: 'feature_lifecycle_readiness_row_blocked',
      subject: row,
      action: 'Review the blocked Mailchimp lifecycle readiness row before kernel handoff.',
      severity: 'error'
    }))),
    ...((summary.degradedRows ?? []).map((row) => ({
      source: 'feature_lifecycle_readiness',
      code: 'feature_lifecycle_readiness_row_degraded',
      subject: row,
      action: 'Publish a Mailchimp feature lifecycle readiness advisory before guarded resume.',
      severity: 'warning'
    }))),
    ...(validation.disabledControls > 0 ? [{
      source: 'feature_lifecycle_readiness',
      code: 'enable_feature_lifecycle_controls',
      subject: String(validation.disabledControls),
      action: 'Enable disabled Mailchimp profile or import lifecycle controls before dispatch.',
      severity: readiness.status === 'blocked' ? 'error' : 'warning'
    }] : []),
    ...(validation.pendingSchedules > 0 ? [{
      source: 'feature_lifecycle_readiness',
      code: 'dispatch_feature_lifecycle_schedules',
      subject: String(validation.pendingSchedules),
      action: 'Dispatch pending Mailchimp lifecycle retry schedules before marking the module ready.',
      severity: readiness.status === 'blocked' ? 'error' : 'warning'
    }] : []),
    ...(validation.deniedEffects > 0 ? [{
      source: 'feature_lifecycle_readiness',
      code: 'resolve_feature_lifecycle_denied_effects',
      subject: String(validation.deniedEffects),
      action: 'Remove denied Mailchimp effects or enable the matching feature gates before launch.',
      severity: 'error'
    }] : []),
    ...(summary.changed === true && readiness.status !== 'blocked' ? [{
      source: 'feature_lifecycle_readiness',
      code: 'publish_feature_lifecycle_readiness_delta',
      subject: summary.fingerprint ?? readiness.fingerprint ?? 'feature_lifecycle_readiness',
      action: 'Publish the Mailchimp feature lifecycle readiness delta with module status handoff.',
      severity: readiness.status === 'degraded' ? 'warning' : 'info'
    }] : [])
  ];
}

function normalizeImportGateLifecycleActions(controlPlan) {
  const summary = controlPlan.exportSummary ?? {};
  const validation = controlPlan.validationSummary ?? {};
  return [
    ...(controlPlan.status === 'blocked' ? [{
      source: 'import_gate_lifecycle',
      code: 'resolve_import_gate_lifecycle',
      subject: summary.title ?? 'mailchimp_import_gate_lifecycle_controls',
      action: 'Resolve Mailchimp import lifecycle rows blocked by feature gate boundary controls.',
      severity: 'error'
    }] : []),
    ...(validation.missingGateAlignment > 0 ? [{
      source: 'import_gate_lifecycle',
      code: 'align_import_feature_gates',
      subject: String(validation.missingGateAlignment),
      action: 'Enable required Mailchimp feature gates before enabling dependent imports.',
      severity: 'error'
    }] : []),
    ...(validation.unsafeHandoffs > 0 ? [{
      source: 'import_gate_lifecycle',
      code: 'repair_import_gate_handoffs',
      subject: String(validation.unsafeHandoffs),
      action: 'Route gated Mailchimp import status handoffs through kernel.status.mailchimp.',
      severity: controlPlan.status === 'blocked' ? 'error' : 'warning'
    }] : []),
    ...((summary.blockedImports ?? []).map((alias) => ({
      source: 'import_gate_lifecycle',
      code: 'import_gate_row_blocked',
      subject: alias,
      action: 'Review the blocked Mailchimp import gate lifecycle row before dispatch.',
      severity: 'error'
    }))),
    ...((summary.degradedImports ?? []).map((alias) => ({
      source: 'import_gate_lifecycle',
      code: 'import_gate_row_degraded',
      subject: alias,
      action: 'Publish degraded Mailchimp import gate lifecycle status before guarded resume.',
      severity: 'warning'
    })))
  ];
}

export function buildModuleOperationalReadinessLedger({
  operation = 'campaign.sync',
  profileOperationalHealth = {},
  featureOperationalLedger = {},
  importOperationalLedger = {},
  moduleStatusPublication = {},
  moduleLaunchPublicationDigest = {},
  operationalStatus = {},
  previousLedger = {},
  now = null,
  historyLimit = 12
} = {}) {
  const previous = normalizeModuleOperationalLedger(previousLedger);
  const rows = [
    moduleOperationalReadinessRow('profile_health', 'profile', profileOperationalHealth, true, {
      status: profileOperationalHealth.status ?? profileOperationalHealth.exportSummary?.status,
      restartSafe: profileOperationalHealth.restartSafe ?? profileOperationalHealth.exportSummary?.restartSafe,
      nextAction: profileOperationalHealth.readiness?.nextAction
        ?? profileOperationalHealth.exportSummary?.nextAction
        ?? profileOperationalHealth.handoff?.nextAction,
      statusChannel: profileOperationalHealth.handoff?.statusChannel,
      evidence: {
        profileName: profileOperationalHealth.profileName ?? profileOperationalHealth.exportSummary?.profileName,
        blockedRows: profileOperationalHealth.exportSummary?.blockedRows ?? [],
        degradedRows: profileOperationalHealth.exportSummary?.degradedRows ?? [],
        fingerprint: profileOperationalHealth.fingerprint ?? profileOperationalHealth.exportSummary?.fingerprint
      }
    }),
    moduleOperationalReadinessRow('feature_operational_ledger', 'feature', featureOperationalLedger, true, {
      status: featureOperationalLedger.status ?? featureOperationalLedger.exportSummary?.status,
      restartSafe: featureOperationalLedger.restartSafe ?? featureOperationalLedger.exportSummary?.restartSafe,
      nextAction: featureOperationalLedger.exportSummary?.nextAction ?? featureOperationalLedger.handoff?.nextAction,
      statusChannel: featureOperationalLedger.handoff?.statusChannel,
      evidence: {
        blockedRows: featureOperationalLedger.exportSummary?.blockedRows ?? [],
        degradedRows: featureOperationalLedger.exportSummary?.degradedRows ?? [],
        deniedEffects: featureOperationalLedger.counters?.deniedEffects ?? 0,
        fingerprint: featureOperationalLedger.fingerprint ?? featureOperationalLedger.exportSummary?.fingerprint
      }
    }),
    moduleOperationalReadinessRow('import_operational_ledger', 'import', importOperationalLedger, true, {
      status: importOperationalLedger.status ?? importOperationalLedger.exportSummary?.status,
      restartSafe: importOperationalLedger.restartSafe ?? importOperationalLedger.exportSummary?.restartSafe,
      nextAction: importOperationalLedger.exportSummary?.nextAction ?? importOperationalLedger.handoff?.nextAction,
      statusChannel: importOperationalLedger.handoff?.statusChannel,
      evidence: {
        blockedRows: importOperationalLedger.exportSummary?.blockedRows ?? [],
        degradedRows: importOperationalLedger.exportSummary?.degradedRows ?? [],
        missingCapabilities: importOperationalLedger.exportSummary?.missingCapabilities ?? [],
        unsafeHandoffs: importOperationalLedger.exportSummary?.unsafeHandoffs ?? [],
        fingerprint: importOperationalLedger.fingerprint ?? importOperationalLedger.exportSummary?.fingerprint
      }
    }),
    moduleOperationalReadinessRow('status_publication', 'module', moduleStatusPublication, true, {
      status: moduleStatusPublication.status ?? moduleStatusPublication.exportSummary?.status,
      restartSafe: moduleStatusPublication.restartSafe ?? moduleStatusPublication.exportSummary?.restartSafe,
      nextAction: moduleStatusPublication.exportSummary?.nextAction ?? moduleStatusPublication.handoff?.nextAction,
      statusChannel: moduleStatusPublication.handoff?.statusChannel,
      evidence: {
        staleRows: moduleStatusPublication.exportSummary?.staleRows ?? [],
        publishRows: moduleStatusPublication.exportSummary?.publishRows ?? [],
        fingerprint: moduleStatusPublication.fingerprint ?? moduleStatusPublication.exportSummary?.fingerprint
      }
    }),
    moduleOperationalReadinessRow('launch_publication_digest', 'module', moduleLaunchPublicationDigest, false, {
      status: moduleLaunchPublicationDigest.status ?? moduleLaunchPublicationDigest.exportSummary?.status,
      restartSafe: moduleLaunchPublicationDigest.restartSafe ?? moduleLaunchPublicationDigest.exportSummary?.restartSafe,
      nextAction: moduleLaunchPublicationDigest.exportSummary?.nextAction ?? moduleLaunchPublicationDigest.handoff?.nextAction,
      statusChannel: moduleLaunchPublicationDigest.handoff?.statusChannel,
      evidence: {
        awaitingAcceptance: moduleLaunchPublicationDigest.exportSummary?.awaitingAcceptance ?? [],
        blockedRows: moduleLaunchPublicationDigest.exportSummary?.blockedRows ?? [],
        guardedRows: moduleLaunchPublicationDigest.exportSummary?.guardedRows ?? [],
        fingerprint: moduleLaunchPublicationDigest.fingerprint ?? moduleLaunchPublicationDigest.exportSummary?.fingerprint
      }
    })
  ];
  const blockedRows = rows.filter((row) => row.status === 'blocked');
  const guardedRows = rows.filter((row) => row.status === 'guarded' || row.status === 'degraded');
  const status = blockedRows.length > 0 || operationalStatus.status === 'blocked'
    ? 'blocked'
    : guardedRows.length > 0 || operationalStatus.status === 'degraded'
      ? 'guarded'
      : 'ready';
  const fingerprint = moduleOperationalReadinessFingerprint({
    operation,
    status,
    rows,
    operationalStatus
  });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = previous.sequence + (changed ? 1 : 0);
  const nextAction = status === 'blocked'
    ? 'resolve_module_operational_readiness_blockers'
    : status === 'guarded'
      ? 'publish_module_operational_readiness_guarded'
      : changed
        ? 'publish_module_operational_readiness'
        : 'reuse_module_operational_readiness';
  const timeline = [
    ...previous.timeline,
    ...(changed || previous.timeline.length === 0 ? [{
      sequence,
      timestamp: clean(now) || null,
      operation,
      status,
      fingerprint,
      blockedRows: blockedRows.map((row) => row.id),
      guardedRows: guardedRows.map((row) => row.id)
    }] : [])
  ].slice(-Math.max(1, toNonNegativeInteger(historyLimit, 12)));

  return {
    ok: status !== 'blocked',
    schemaVersion: MODULE_SYNTAX_SCHEMA_VERSION,
    title: 'mailchimp_module_operational_readiness_ledger',
    operation,
    status,
    restartSafe: status === 'ready' && rows.every((row) => row.restartSafe === true),
    sequence,
    fingerprint,
    changed,
    rows,
    validationSummary: {
      totalRows: rows.length,
      requiredRows: rows.filter((row) => row.required).length,
      blockedRows: blockedRows.length,
      guardedRows: guardedRows.length,
      profileRows: rows.filter((row) => row.source === 'profile').length,
      featureRows: rows.filter((row) => row.source === 'feature').length,
      importRows: rows.filter((row) => row.source === 'import').length
    },
    readiness: {
      status,
      blockingReasons: blockedRows.map((row) => row.id).sort(),
      guardedReasons: guardedRows.map((row) => row.id).sort(),
      nextAction
    },
    history: {
      sequence,
      timeline,
      statusCounts: timeline.reduce((counts, item) => {
        counts[item.status] = (counts[item.status] ?? 0) + 1;
        return counts;
      }, {})
    },
    handoff: {
      target: 'kernel.status.mailchimp.module-operational-readiness',
      statusChannel: rows.every((row) => row.statusChannel === 'kernel.status.mailchimp' || !row.statusChannel)
        ? 'kernel.status.mailchimp'
        : 'local.status.module-operational-readiness',
      publish: changed || status !== 'ready',
      severity: status === 'blocked' ? 'error' : status === 'guarded' ? 'warning' : 'info',
      includeRows: status !== 'ready' || changed,
      nextAction
    },
    exportSummary: {
      schemaVersion: MODULE_SYNTAX_SCHEMA_VERSION,
      title: 'mailchimp_module_operational_readiness_ledger',
      operation,
      status,
      restartSafe: status === 'ready' && rows.every((row) => row.restartSafe === true),
      sequence,
      fingerprint,
      changed,
      blockedRows: blockedRows.map((row) => row.id).sort(),
      guardedRows: guardedRows.map((row) => row.id).sort(),
      nextAction
    }
  };
}

function buildModuleClientActionQueue({
  operation,
  featureClientActionQueue,
  importClientActionQueue,
  clientWorkflowHandoff,
  launchAcceptance,
  exportReadiness,
  previousQueue,
  now,
  historyLimit
}) {
  const previous = normalizeModuleClientActionQueueHistory(previousQueue);
  const featureRows = normalizeModuleClientActionRows(featureClientActionQueue, 'feature');
  const importRows = normalizeModuleClientActionRows(importClientActionQueue, 'import');
  const workflowRows = (clientWorkflowHandoff.rows ?? [])
    .filter((row) => row.status !== 'ready' || row.visibleToClient === true)
    .map((row) => ({
      id: `workflow:${row.id ?? row.component}`,
      source: 'module_workflow',
      subject: clean(row.id ?? row.component),
      status: row.status === 'degraded' ? 'guarded' : row.status,
      severity: row.status === 'blocked' ? 'error' : row.status === 'degraded' ? 'warning' : 'info',
      clientVisible: true,
      required: row.required !== false,
      nextAction: clean(row.nextAction) || 'review_module_workflow',
      evidence: row.evidence ?? {}
    }));
  const launchRows = [
    ...(launchAcceptance.status === 'ready' ? [] : [{
      id: 'launch:acceptance',
      source: 'module_launch_acceptance',
      subject: launchAcceptance.exportSummary?.title ?? 'module_launch_acceptance',
      status: launchAcceptance.status === 'degraded' ? 'guarded' : launchAcceptance.status,
      severity: launchAcceptance.status === 'blocked' ? 'error' : 'warning',
      clientVisible: true,
      required: true,
      nextAction: launchAcceptance.readiness?.nextAction ?? launchAcceptance.exportSummary?.nextAction ?? 'review_module_launch_acceptance',
      evidence: {
        awaitingAcceptance: launchAcceptance.exportSummary?.awaitingAcceptance ?? [],
        blockedRows: launchAcceptance.exportSummary?.blockedRows ?? [],
        guardedRows: launchAcceptance.exportSummary?.guardedRows ?? launchAcceptance.exportSummary?.degradedRows ?? []
      }
    }]),
    ...(exportReadiness.status === 'ready' ? [] : [{
      id: 'launch:export_readiness',
      source: 'module_export_readiness',
      subject: exportReadiness.exportSummary?.title ?? 'module_export_readiness',
      status: exportReadiness.status === 'degraded' ? 'guarded' : exportReadiness.status,
      severity: exportReadiness.status === 'blocked' ? 'error' : 'warning',
      clientVisible: true,
      required: true,
      nextAction: exportReadiness.readiness?.nextAction ?? exportReadiness.exportSummary?.nextAction ?? 'review_module_export_readiness',
      evidence: {
        blockingReasons: exportReadiness.readiness?.blockingReasons ?? [],
        degradedReasons: exportReadiness.readiness?.degradedReasons ?? []
      }
    }])
  ];
  const rows = dedupeModuleClientActionRows([
    ...featureRows,
    ...importRows,
    ...workflowRows,
    ...launchRows
  ]).sort((left, right) => (
    severityRank(right.severity) - severityRank(left.severity)
    || moduleClientActionStatusRank(right.status) - moduleClientActionStatusRank(left.status)
    || left.id.localeCompare(right.id)
  ));
  const blockingRows = rows.filter((row) => row.status === 'blocked');
  const guardedRows = rows.filter((row) => row.status === 'guarded' || row.status === 'degraded' || row.status === 'awaiting_acceptance');
  const visibleRows = rows.filter((row) => row.clientVisible);
  const status = blockingRows.length > 0
    ? 'blocked'
    : guardedRows.length > 0
      ? 'guarded'
      : 'ready';
  const fingerprint = moduleClientActionQueueFingerprint({
    operation,
    status,
    rows,
    featureClientActionQueue,
    importClientActionQueue,
    clientWorkflowHandoff,
    launchAcceptance,
    exportReadiness
  });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = previous.sequence + (changed ? 1 : 0);
  const limit = Math.max(1, toNonNegativeInteger(historyLimit, 12));
  const timeline = [
    ...previous.timeline,
    ...(changed || previous.timeline.length === 0 ? [{
      sequence,
      timestamp: clean(now) || null,
      operation,
      status,
      fingerprint,
      visibleActions: visibleRows.length,
      blockingActions: blockingRows.length,
      guardedActions: guardedRows.length,
      changed
    }] : [])
  ].slice(-limit);
  const nextAction = status === 'blocked'
    ? 'resolve_module_client_action_blockers'
    : status === 'guarded'
      ? 'publish_module_client_action_guarded'
      : changed
        ? 'publish_module_client_action_ready'
        : 'reuse_module_client_action_queue';

  return {
    ok: status !== 'blocked',
    schemaVersion: MODULE_SYNTAX_SCHEMA_VERSION,
    title: 'mailchimp_module_client_action_queue',
    operation,
    status,
    restartSafe: status === 'ready'
      && featureClientActionQueue.restartSafe === true
      && importClientActionQueue.restartSafe === true
      && clientWorkflowHandoff.restartSafe !== false,
    sequence,
    fingerprint,
    changed,
    rows,
    validationSummary: {
      totalRows: rows.length,
      visibleRows: visibleRows.length,
      blockingRows: blockingRows.length,
      guardedRows: guardedRows.length,
      featureActions: featureRows.length,
      importActions: importRows.length,
      workflowActions: workflowRows.length,
      launchActions: launchRows.length
    },
    readiness: {
      status,
      blockingReasons: blockingRows.map((row) => row.subject).sort(),
      guardedReasons: guardedRows.map((row) => row.subject).sort(),
      nextAction
    },
    history: {
      sequence,
      timeline,
      statusCounts: timeline.reduce((counts, item) => {
        counts[item.status] = (counts[item.status] ?? 0) + 1;
        return counts;
      }, {})
    },
    handoff: {
      target: 'mailchimp.client.workflow.module-actions',
      statusChannel: rows.some((row) => row.source === 'import' && row.status !== 'ready')
        ? importClientActionQueue.handoff?.statusChannel ?? 'kernel.status.mailchimp'
        : featureClientActionQueue.handoff?.statusChannel ?? 'kernel.status.mailchimp',
      publish: changed || status !== 'ready' || visibleRows.length > 0,
      severity: status === 'blocked' ? 'error' : status === 'guarded' ? 'warning' : 'info',
      includeRows: visibleRows.length > 0,
      nextAction
    },
    exportSummary: {
      schemaVersion: MODULE_SYNTAX_SCHEMA_VERSION,
      title: 'mailchimp_module_client_action_queue',
      operation,
      status,
      restartSafe: status === 'ready'
        && featureClientActionQueue.restartSafe === true
        && importClientActionQueue.restartSafe === true,
      sequence,
      fingerprint,
      changed,
      visibleActions: visibleRows.map((row) => row.id).sort(),
      blockingActions: blockingRows.map((row) => row.id).sort(),
      guardedActions: guardedRows.map((row) => row.id).sort(),
      nextAction
    }
  };
}

export function buildModuleClientBoundaryReadinessEnvelope({
  operation = 'campaign.sync',
  featureClientReadiness = {},
  importTenantAuditReadiness = {},
  launchAcceptance = {},
  moduleClientActionQueue = {},
  clientWorkflowHandoff = {},
  previousEnvelope = {},
  commandKey = null,
  now = null,
  historyLimit = 12
} = {}) {
  const previous = normalizeModuleClientBoundaryReadiness(previousEnvelope);
  const seenCommands = new Set(previous.appliedCommandKeys.map(clean).filter(Boolean));
  const normalizedCommandKey = clean(commandKey);
  const repeatedCommand = normalizedCommandKey && seenCommands.has(normalizedCommandKey);
  const rows = [
    moduleClientBoundaryReadinessRow('feature_client_readiness', 'feature', featureClientReadiness, true, {
      status: featureClientReadiness.status ?? featureClientReadiness.exportSummary?.status,
      restartSafe: featureClientReadiness.restartSafe ?? featureClientReadiness.exportSummary?.restartSafe,
      statusChannel: featureClientReadiness.handoff?.statusChannel,
      nextAction: featureClientReadiness.readiness?.nextAction ?? featureClientReadiness.exportSummary?.nextAction,
      evidence: {
        fingerprint: featureClientReadiness.fingerprint ?? featureClientReadiness.exportSummary?.fingerprint,
        blockedRows: featureClientReadiness.exportSummary?.blockedRows ?? [],
        guardedRows: featureClientReadiness.exportSummary?.guardedRows ?? [],
        awaitingAcceptance: featureClientReadiness.validationSummary?.awaitingAcceptance ?? 0
      }
    }),
    moduleClientBoundaryReadinessRow('import_tenant_audit', 'import', importTenantAuditReadiness, true, {
      status: importTenantAuditReadiness.status ?? importTenantAuditReadiness.exportSummary?.status,
      restartSafe: importTenantAuditReadiness.restartSafe ?? importTenantAuditReadiness.exportSummary?.restartSafe,
      statusChannel: importTenantAuditReadiness.auditHandoff?.statusChannel,
      nextAction: importTenantAuditReadiness.readiness?.nextAction ?? importTenantAuditReadiness.exportSummary?.nextAction,
      evidence: {
        fingerprint: importTenantAuditReadiness.fingerprint ?? importTenantAuditReadiness.exportSummary?.fingerprint,
        tenantId: importTenantAuditReadiness.scope?.tenantId ?? importTenantAuditReadiness.exportSummary?.tenantId,
        workspaceId: importTenantAuditReadiness.scope?.workspaceId ?? importTenantAuditReadiness.exportSummary?.workspaceId,
        blockedImports: importTenantAuditReadiness.exportSummary?.blockedImports ?? [],
        guardedImports: importTenantAuditReadiness.exportSummary?.guardedImports ?? []
      }
    }),
    moduleClientBoundaryReadinessRow('module_launch_acceptance', 'module', launchAcceptance, true, {
      status: launchAcceptance.status ?? launchAcceptance.exportSummary?.status,
      restartSafe: launchAcceptance.restartSafe ?? launchAcceptance.exportSummary?.restartSafe,
      statusChannel: launchAcceptance.handoff?.statusChannel,
      nextAction: launchAcceptance.readiness?.nextAction ?? launchAcceptance.exportSummary?.nextAction,
      evidence: {
        fingerprint: launchAcceptance.fingerprint ?? launchAcceptance.exportSummary?.fingerprint,
        awaitingAcceptance: launchAcceptance.exportSummary?.awaitingAcceptance ?? [],
        blockedRows: launchAcceptance.exportSummary?.blockedRows ?? [],
        guardedRows: launchAcceptance.exportSummary?.guardedRows ?? launchAcceptance.exportSummary?.degradedRows ?? []
      }
    }),
    moduleClientBoundaryReadinessRow('module_client_actions', 'module', moduleClientActionQueue, false, {
      status: moduleClientActionQueue.status ?? moduleClientActionQueue.exportSummary?.status,
      restartSafe: moduleClientActionQueue.restartSafe ?? moduleClientActionQueue.exportSummary?.restartSafe,
      statusChannel: moduleClientActionQueue.handoff?.statusChannel,
      nextAction: moduleClientActionQueue.readiness?.nextAction ?? moduleClientActionQueue.exportSummary?.nextAction,
      evidence: {
        fingerprint: moduleClientActionQueue.fingerprint ?? moduleClientActionQueue.exportSummary?.fingerprint,
        visibleActions: moduleClientActionQueue.exportSummary?.visibleActions ?? [],
        blockingActions: moduleClientActionQueue.exportSummary?.blockingActions ?? [],
        guardedActions: moduleClientActionQueue.exportSummary?.guardedActions ?? []
      }
    }),
    moduleClientBoundaryReadinessRow('client_workflow_handoff', 'module', clientWorkflowHandoff, false, {
      status: clientWorkflowHandoff.status ?? clientWorkflowHandoff.exportSummary?.status,
      restartSafe: clientWorkflowHandoff.restartSafe ?? clientWorkflowHandoff.exportSummary?.restartSafe,
      statusChannel: clientWorkflowHandoff.handoff?.statusChannel,
      nextAction: clientWorkflowHandoff.handoff?.nextAction ?? clientWorkflowHandoff.exportSummary?.nextAction,
      evidence: {
        fingerprint: clientWorkflowHandoff.fingerprint ?? clientWorkflowHandoff.exportSummary?.fingerprint,
        blockingRows: clientWorkflowHandoff.exportSummary?.blockingRows ?? [],
        degradedRows: clientWorkflowHandoff.exportSummary?.degradedRows ?? []
      }
    })
  ];
  const blockedRows = rows.filter((row) => row.status === 'blocked');
  const guardedRows = rows.filter((row) => row.status === 'guarded' || row.status === 'degraded');
  const status = blockedRows.length > 0
    ? 'blocked'
    : guardedRows.length > 0
      ? 'guarded'
      : 'ready';
  const fingerprint = moduleClientBoundaryReadinessFingerprint({
    operation,
    status,
    rows,
    repeatedCommand
  });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = previous.sequence + (changed ? 1 : 0);
  const appliedCommandKeys = normalizedCommandKey && !repeatedCommand && status !== 'blocked'
    ? [...seenCommands, normalizedCommandKey].sort()
    : [...seenCommands].sort();
  const nextAction = status === 'blocked'
    ? 'resolve_module_client_boundary_readiness_blockers'
    : status === 'guarded'
      ? 'publish_module_client_boundary_readiness_guarded'
      : repeatedCommand
        ? 'reuse_module_client_boundary_readiness'
        : changed
          ? 'publish_module_client_boundary_readiness_ready'
          : 'reuse_module_client_boundary_readiness';
  const timeline = [
    ...previous.timeline,
    ...(changed || previous.timeline.length === 0 ? [{
      sequence,
      timestamp: clean(now) || null,
      operation,
      status,
      fingerprint,
      blockedRows: blockedRows.map((row) => row.id),
      guardedRows: guardedRows.map((row) => row.id),
      commandKey: normalizedCommandKey || null,
      repeatedCommand: Boolean(repeatedCommand)
    }] : [])
  ].slice(-Math.max(1, toNonNegativeInteger(historyLimit, 12)));
  const diagnostics = [
    ...(featureClientReadiness.diagnostics ?? []).filter((item) => item.level === 'error'),
    ...(importTenantAuditReadiness.diagnostics ?? []).filter((item) => item.level === 'error'),
    ...(launchAcceptance.diagnostics ?? []).filter((item) => item.level === 'error'),
    ...(repeatedCommand ? [{
      level: 'info',
      code: 'module_client_boundary_readiness_command_already_applied',
      subject: normalizedCommandKey
    }] : [])
  ];

  return {
    ok: status !== 'blocked' && !diagnostics.some((item) => item.level === 'error'),
    schemaVersion: MODULE_SYNTAX_SCHEMA_VERSION,
    title: 'mailchimp_module_client_boundary_readiness',
    operation,
    status,
    restartSafe: status === 'ready' && rows.every((row) => row.restartSafe === true),
    sequence,
    fingerprint,
    changed,
    rows,
    validationSummary: {
      totalRows: rows.length,
      requiredRows: rows.filter((row) => row.required).length,
      blockedRows: blockedRows.length,
      guardedRows: guardedRows.length,
      localStatusRows: rows.filter((row) => row.statusChannel?.startsWith('local.status.')).length,
      diagnosticErrors: diagnostics.filter((item) => item.level === 'error').length,
      diagnosticWarnings: diagnostics.filter((item) => item.level === 'warning').length
    },
    readiness: {
      status,
      blockingReasons: blockedRows.map((row) => row.id).sort(),
      guardedReasons: guardedRows.map((row) => row.id).sort(),
      nextAction
    },
    idempotency: {
      commandKey: normalizedCommandKey || null,
      repeated: Boolean(repeatedCommand),
      applied: Boolean(normalizedCommandKey) && !repeatedCommand && status !== 'blocked',
      appliedCommandKeys
    },
    history: {
      sequence,
      timeline,
      statusCounts: timeline.reduce((counts, item) => {
        counts[item.status] = (counts[item.status] ?? 0) + 1;
        return counts;
      }, {})
    },
    handoff: {
      target: 'mailchimp.client.workflow.module-boundary-readiness',
      statusChannel: rows.every((row) => row.statusChannel === 'kernel.status.mailchimp' || !row.statusChannel)
        ? 'kernel.status.mailchimp'
        : 'local.status.module-boundary-readiness',
      publish: changed || status !== 'ready' || repeatedCommand,
      severity: status === 'blocked' ? 'error' : status === 'guarded' ? 'warning' : 'info',
      includeRows: status !== 'ready' || changed,
      nextAction
    },
    exportSummary: {
      schemaVersion: MODULE_SYNTAX_SCHEMA_VERSION,
      title: 'mailchimp_module_client_boundary_readiness',
      operation,
      status,
      restartSafe: status === 'ready' && rows.every((row) => row.restartSafe === true),
      sequence,
      fingerprint,
      changed,
      blockedRows: blockedRows.map((row) => row.id).sort(),
      guardedRows: guardedRows.map((row) => row.id).sort(),
      nextAction
    },
    diagnostics
  };
}

export function buildModuleClientResolutionBrief({
  operation,
  profileClientResolutionBrief = {},
  importClientResolutionBrief = {},
  moduleClientActionQueue = {},
  clientWorkflowHandoff = {},
  previousBrief,
  now,
  historyLimit
} = {}) {
  const previous = normalizeModuleClientResolutionBrief(previousBrief);
  const profileRows = normalizeModuleResolutionRows(profileClientResolutionBrief, 'profile');
  const importRows = normalizeModuleResolutionRows(importClientResolutionBrief, 'import');
  const actionRows = (moduleClientActionQueue.rows ?? [])
    .filter((row) => row.status !== 'ready' || row.clientVisible === true)
    .map((row) => ({
      id: `action:${row.id}`,
      source: 'module_action_queue',
      subject: clean(row.subject) || clean(row.id),
      status: row.status === 'degraded' ? 'guarded' : clean(row.status) || 'ready',
      severity: clean(row.severity) || (row.status === 'blocked' ? 'error' : 'warning'),
      clientVisible: row.clientVisible !== false,
      nextAction: clean(row.nextAction) || moduleClientActionQueue.readiness?.nextAction || 'review_module_client_action',
      evidence: {
        queueStatus: moduleClientActionQueue.status ?? null,
        queueFingerprint: moduleClientActionQueue.fingerprint ?? moduleClientActionQueue.exportSummary?.fingerprint ?? null,
        source: row.source,
        required: row.required === true
      }
    }));
  const workflowRows = (clientWorkflowHandoff.rows ?? [])
    .filter((row) => row.status !== 'ready' || row.visibleToClient === true)
    .map((row) => ({
      id: `workflow:${row.id ?? row.component}`,
      source: 'module_workflow',
      subject: clean(row.id ?? row.component),
      status: row.status === 'degraded' ? 'guarded' : clean(row.status) || 'ready',
      severity: row.status === 'blocked' ? 'error' : row.status === 'ready' ? 'info' : 'warning',
      clientVisible: true,
      nextAction: clean(row.nextAction) || clientWorkflowHandoff.readiness?.nextAction || 'review_module_client_workflow',
      evidence: {
        workflowStatus: clientWorkflowHandoff.status ?? null,
        workflowFingerprint: clientWorkflowHandoff.fingerprint ?? clientWorkflowHandoff.exportSummary?.fingerprint ?? null,
        component: row.component
      }
    }));
  const rows = dedupeModuleResolutionRows([
    ...profileRows,
    ...importRows,
    ...actionRows,
    ...workflowRows
  ]).sort((left, right) => (
    severityRank(right.severity) - severityRank(left.severity)
    || moduleClientActionStatusRank(right.status) - moduleClientActionStatusRank(left.status)
    || left.source.localeCompare(right.source)
    || left.subject.localeCompare(right.subject)
  ));
  const blockingRows = rows.filter((row) => row.status === 'blocked' || row.severity === 'error');
  const guardedRows = rows.filter((row) => row.status !== 'blocked' && row.severity !== 'error');
  const status = blockingRows.length > 0
    || profileClientResolutionBrief.status === 'blocked'
    || importClientResolutionBrief.status === 'blocked'
    || moduleClientActionQueue.status === 'blocked'
    ? 'blocked'
    : guardedRows.length > 0
      || profileClientResolutionBrief.status === 'guarded'
      || importClientResolutionBrief.status === 'guarded'
      || moduleClientActionQueue.status === 'guarded'
      || clientWorkflowHandoff.status === 'degraded'
      ? 'guarded'
      : 'ready';
  const fingerprint = moduleClientResolutionFingerprint({
    operation,
    status,
    rows,
    profileClientResolutionBrief,
    importClientResolutionBrief,
    moduleClientActionQueue,
    clientWorkflowHandoff
  });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = previous.sequence + (changed ? 1 : 0);
  const limit = Math.max(1, toNonNegativeInteger(historyLimit, 12));
  const timeline = [
    ...previous.timeline,
    ...(changed || previous.timeline.length === 0 ? [{
      sequence,
      timestamp: clean(now) || null,
      operation,
      status,
      fingerprint,
      blocked: blockingRows.length,
      guarded: guardedRows.length,
      changed
    }] : [])
  ].slice(-limit);
  const nextAction = status === 'blocked'
    ? 'resolve_module_client_resolution_blockers'
    : status === 'guarded'
      ? 'publish_module_client_resolution_guarded'
      : changed
        ? 'publish_module_client_resolution_ready'
        : 'reuse_module_client_resolution';

  return {
    ok: status !== 'blocked',
    schemaVersion: MODULE_SYNTAX_SCHEMA_VERSION,
    title: 'mailchimp_module_client_resolution_brief',
    operation,
    status,
    restartSafe: status === 'ready'
      && profileClientResolutionBrief.restartSafe === true
      && importClientResolutionBrief.restartSafe === true
      && moduleClientActionQueue.restartSafe === true
      && clientWorkflowHandoff.restartSafe !== false,
    sequence,
    fingerprint,
    changed,
    rows,
    validationSummary: {
      totalRows: rows.length,
      blockingRows: blockingRows.length,
      guardedRows: guardedRows.length,
      profileRows: profileRows.length,
      importRows: importRows.length,
      actionRows: actionRows.length,
      workflowRows: workflowRows.length
    },
    readiness: {
      status,
      blockingReasons: unique(blockingRows.map((row) => row.subject)),
      guardedReasons: unique(guardedRows.map((row) => row.subject)),
      nextAction
    },
    history: {
      sequence,
      timeline,
      statusCounts: timeline.reduce((counts, item) => {
        counts[item.status] = (counts[item.status] ?? 0) + 1;
        return counts;
      }, {})
    },
    handoff: {
      target: 'mailchimp.client.workflow.module-resolution',
      statusChannel: status === 'ready'
        ? 'kernel.status.mailchimp'
        : rows.some((row) => row.source.startsWith('import'))
          ? importClientResolutionBrief.handoff?.statusChannel ?? 'kernel.status.mailchimp'
          : profileClientResolutionBrief.handoff?.statusChannel ?? 'kernel.status.mailchimp',
      publish: changed || status !== 'ready',
      severity: status === 'blocked' ? 'error' : status === 'guarded' ? 'warning' : 'info',
      includeRows: rows.length > 0,
      includeWorkflow: clientWorkflowHandoff.status !== 'ready',
      nextAction
    },
    exportSummary: {
      schemaVersion: MODULE_SYNTAX_SCHEMA_VERSION,
      title: 'mailchimp_module_client_resolution_brief',
      operation,
      status,
      restartSafe: status === 'ready'
        && profileClientResolutionBrief.restartSafe === true
        && importClientResolutionBrief.restartSafe === true,
      sequence,
      fingerprint,
      changed,
      blockedRows: blockingRows.map((row) => row.id).sort(),
      guardedRows: guardedRows.map((row) => row.id).sort(),
      nextAction
    }
  };
}

function normalizeModuleClientActionRows(queue, prefix) {
  return (queue.rows ?? []).map((row) => ({
    id: `${prefix}:${row.id}`,
    source: prefix,
    subject: clean(row.subject) || clean(row.id),
    status: row.status === 'degraded' ? 'guarded' : clean(row.status) || 'ready',
    severity: clean(row.severity) || (row.status === 'blocked' ? 'error' : row.status === 'ready' ? 'info' : 'warning'),
    clientVisible: row.clientVisible === true || row.status !== 'ready',
    required: row.required === true,
    nextAction: clean(row.nextAction) || queue.readiness?.nextAction || queue.exportSummary?.nextAction || `review_${prefix}_action`,
    evidence: {
      ...(row.evidence ?? {}),
      queueStatus: queue.status,
      queueFingerprint: queue.fingerprint ?? queue.exportSummary?.fingerprint ?? null
    }
  }));
}

function normalizeModuleClientExportRoute(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    sequence: toNonNegativeInteger(value.sequence ?? value.history?.sequence ?? value.exportSummary?.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint),
    timeline: Array.isArray(value.history?.timeline)
      ? value.history.timeline.filter((item) => item && typeof item === 'object')
      : Array.isArray(value.timeline)
        ? value.timeline.filter((item) => item && typeof item === 'object')
        : []
  };
}

function moduleClientExportRouteRow(id, source = {}, required, fallback = {}) {
  const rawStatus = clean(source.status ?? source.exportSummary?.status) || 'ready';
  const status = rawStatus === 'degraded' || rawStatus === 'recovering' || rawStatus === 'paused' ? 'guarded' : rawStatus;
  const blocked = status === 'blocked';
  const guarded = !blocked && (status === 'guarded' || source.restartSafe === false || source.exportSummary?.restartSafe === false);
  const awaitingAcceptance = normalizeList(fallback.awaitingAcceptance ?? source.exportSummary?.awaitingAcceptance);
  return {
    id,
    status: blocked ? 'blocked' : guarded ? 'guarded' : 'ready',
    required: required === true,
    restartSafe: blocked !== true && guarded !== true,
    visibleToClient: fallback.visible === true || blocked || guarded || awaitingAcceptance.length > 0,
    fingerprint: clean(source.fingerprint ?? source.exportSummary?.fingerprint),
    awaitingAcceptance,
    nextAction: clean(fallback.nextAction ?? source.readiness?.nextAction ?? source.handoff?.nextAction ?? source.exportSummary?.nextAction)
      || (blocked ? `resolve_${id}` : guarded ? `publish_${id}_guarded` : `publish_${id}`)
  };
}

function normalizeModuleResolutionRows(brief, prefix) {
  return (brief.rows ?? [])
    .filter((row) => row.status !== 'ready' || row.clientVisible === true)
    .map((row) => ({
      id: `${prefix}:${row.id}`,
      source: `${prefix}_resolution`,
      subject: clean(row.subject) || clean(row.id),
      status: row.status === 'degraded' ? 'guarded' : clean(row.status) || 'ready',
      severity: clean(row.severity) || (row.status === 'blocked' ? 'error' : row.status === 'ready' ? 'info' : 'warning'),
      clientVisible: row.clientVisible !== false,
      nextAction: clean(row.nextAction) || brief.readiness?.nextAction || `review_${prefix}_resolution`,
      evidence: {
        ...(row.evidence ?? {}),
        briefStatus: brief.status ?? null,
        briefFingerprint: brief.fingerprint ?? brief.exportSummary?.fingerprint ?? null
      }
    }));
}

function dedupeModuleClientActionRows(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    row.id = clean(row.id);
    row.source = clean(row.source);
    row.subject = clean(row.subject);
    row.status = clean(row.status) || 'ready';
    row.severity = clean(row.severity) || 'info';
    row.nextAction = clean(row.nextAction) || null;
    row.evidence = row.evidence && typeof row.evidence === 'object' ? row.evidence : {};
    const key = [row.id, row.source, row.subject, row.nextAction].map(clean).join('|');
    if (!row.id || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupeModuleResolutionRows(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    const normalized = {
      ...row,
      id: clean(row.id),
      source: clean(row.source),
      subject: clean(row.subject),
      status: clean(row.status) || 'ready',
      severity: clean(row.severity) || 'info',
      nextAction: clean(row.nextAction) || null,
      clientVisible: row.clientVisible === true,
      evidence: row.evidence && typeof row.evidence === 'object' ? row.evidence : {}
    };
    const key = [normalized.id, normalized.source, normalized.subject, normalized.nextAction].map(clean).join('|');
    if (!normalized.id || !normalized.source || seen.has(key)) return false;
    seen.add(key);
    Object.assign(row, normalized);
    return true;
  });
}

function normalizeModuleClientActionQueueHistory(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    sequence: toNonNegativeInteger(value.sequence ?? value.history?.sequence ?? value.exportSummary?.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint),
    timeline: Array.isArray(value.history?.timeline)
      ? value.history.timeline.filter((item) => item && typeof item === 'object')
      : Array.isArray(value.timeline)
        ? value.timeline.filter((item) => item && typeof item === 'object')
        : []
  };
}

function normalizeModuleClientResolutionBrief(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    sequence: toNonNegativeInteger(value.sequence ?? value.history?.sequence ?? value.exportSummary?.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint),
    timeline: Array.isArray(value.history?.timeline)
      ? value.history.timeline.filter((item) => item && typeof item === 'object')
      : Array.isArray(value.timeline)
        ? value.timeline.filter((item) => item && typeof item === 'object')
        : []
  };
}

function moduleClientActionQueueFingerprint({
  operation,
  status,
  rows,
  featureClientActionQueue,
  importClientActionQueue,
  clientWorkflowHandoff,
  launchAcceptance,
  exportReadiness
}) {
  return [
    operation,
    status,
    featureClientActionQueue.fingerprint ?? featureClientActionQueue.exportSummary?.fingerprint ?? '',
    importClientActionQueue.fingerprint ?? importClientActionQueue.exportSummary?.fingerprint ?? '',
    clientWorkflowHandoff.fingerprint ?? clientWorkflowHandoff.exportSummary?.fingerprint ?? '',
    launchAcceptance.fingerprint ?? launchAcceptance.exportSummary?.fingerprint ?? '',
    exportReadiness.fingerprint ?? exportReadiness.exportSummary?.fingerprint ?? '',
    ...rows.map((row) => [
      row.id,
      row.status,
      row.severity,
      row.clientVisible ? 'visible' : 'hidden',
      row.required ? 'required' : 'optional',
      row.nextAction ?? 'no_action'
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('||');
}

function moduleClientResolutionFingerprint({
  operation,
  status,
  rows,
  profileClientResolutionBrief,
  importClientResolutionBrief,
  moduleClientActionQueue,
  clientWorkflowHandoff
}) {
  return [
    operation,
    status,
    profileClientResolutionBrief.fingerprint ?? profileClientResolutionBrief.exportSummary?.fingerprint ?? '',
    importClientResolutionBrief.fingerprint ?? importClientResolutionBrief.exportSummary?.fingerprint ?? '',
    moduleClientActionQueue.fingerprint ?? moduleClientActionQueue.exportSummary?.fingerprint ?? '',
    clientWorkflowHandoff.fingerprint ?? clientWorkflowHandoff.exportSummary?.fingerprint ?? '',
    ...rows.map((row) => [
      row.id,
      row.source,
      row.status,
      row.severity,
      row.clientVisible ? 'visible' : 'hidden',
      row.nextAction ?? 'no_action'
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('||');
}

function moduleClientActionStatusRank(status) {
  if (status === 'blocked') return 4;
  if (status === 'guarded' || status === 'degraded') return 3;
  if (status === 'awaiting_acceptance') return 2;
  return 1;
}

function normalizeModuleOperationalLedger(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    sequence: toNonNegativeInteger(value.sequence ?? value.history?.sequence ?? value.exportSummary?.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint),
    timeline: Array.isArray(value.history?.timeline)
      ? value.history.timeline.filter((item) => item && typeof item === 'object')
      : Array.isArray(value.timeline)
        ? value.timeline.filter((item) => item && typeof item === 'object')
        : []
  };
}

function moduleOperationalReadinessRow(id, source, contract, required, fallback) {
  const rawStatus = clean(fallback.status ?? contract.status ?? contract.exportSummary?.status) || 'ready';
  const status = rawStatus === 'healthy'
    ? 'ready'
    : rawStatus === 'degraded'
      ? 'guarded'
      : rawStatus;
  const blocked = status === 'blocked';
  const guarded = !blocked && (status === 'guarded' || status === 'paused' || status === 'disabled');
  return {
    id,
    source,
    status: blocked ? 'blocked' : guarded ? 'guarded' : 'ready',
    required,
    restartSafe: fallback.restartSafe === true && blocked !== true && guarded !== true,
    statusChannel: clean(fallback.statusChannel) || null,
    nextAction: clean(fallback.nextAction) || (
      blocked ? `resolve_${id}` : guarded ? `publish_${id}_guarded` : `publish_${id}`
    ),
    evidence: fallback.evidence && typeof fallback.evidence === 'object' ? fallback.evidence : {}
  };
}

function moduleOperationalReadinessFingerprint({
  operation,
  status,
  rows,
  operationalStatus
}) {
  return [
    operation,
    status,
    operationalStatus.status ?? 'unknown',
    operationalStatus.fingerprint ?? operationalStatus.exportSummary?.fingerprint ?? '',
    ...rows.map((row) => [
      row.id,
      row.source,
      row.status,
      row.required ? 'required' : 'optional',
      row.restartSafe ? 'restart_safe' : 'restart_guarded',
      row.statusChannel ?? '',
      row.evidence?.fingerprint ?? '',
      row.nextAction ?? 'no_action'
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('||');
}

function normalizeModuleRuntimeAdoptionHistory(input = {}) {
  return {
    sequence: toNonNegativeInteger(input.sequence ?? input.exportSummary?.sequence, 0),
    fingerprint: clean(input.fingerprint ?? input.exportSummary?.fingerprint),
    timeline: Array.isArray(input.history?.timeline)
      ? input.history.timeline
      : Array.isArray(input.timeline)
        ? input.timeline
        : []
  };
}

function normalizeModuleWorkflowNextAction(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    sequence: toNonNegativeInteger(value.sequence ?? value.history?.sequence ?? value.exportSummary?.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint),
    timeline: Array.isArray(value.history?.timeline)
      ? value.history.timeline.filter((item) => item && typeof item === 'object')
      : Array.isArray(value.timeline)
        ? value.timeline.filter((item) => item && typeof item === 'object')
        : []
  };
}

function moduleWorkflowNextActionRow(id, source, contract, required, fallback) {
  const rawStatus = clean(fallback.status ?? contract.status ?? contract.exportSummary?.status) || 'ready';
  const status = rawStatus === 'degraded' ? 'guarded' : rawStatus;
  const blocked = status === 'blocked';
  const guarded = !blocked && (status === 'guarded' || status === 'paused' || status === 'disabled');
  const statusChannel = clean(fallback.statusChannel) || null;
  return {
    id,
    source,
    status: blocked ? 'blocked' : guarded ? 'guarded' : 'ready',
    required,
    restartSafe: fallback.restartSafe !== false && blocked !== true && guarded !== true,
    statusChannel,
    publish: blocked || guarded || statusChannel.startsWith('local.status.'),
    nextAction: clean(fallback.nextAction) || (
      blocked ? `resolve_${id}` : guarded ? `publish_${id}_guarded` : `publish_${id}`
    ),
    evidence: fallback.evidence && typeof fallback.evidence === 'object' ? fallback.evidence : {}
  };
}

function normalizeModuleClientControlRoom(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    sequence: toNonNegativeInteger(value.sequence ?? value.history?.sequence ?? value.exportSummary?.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint),
    timeline: Array.isArray(value.history?.timeline)
      ? value.history.timeline.filter((item) => item && typeof item === 'object')
      : Array.isArray(value.timeline)
        ? value.timeline.filter((item) => item && typeof item === 'object')
        : []
  };
}

function moduleClientControlRoomRow(id, source, contract = {}, required, fallback = {}) {
  const rawStatus = clean(fallback.status ?? contract.status ?? contract.exportSummary?.status) || 'ready';
  const status = rawStatus === 'blocked'
    ? 'blocked'
    : rawStatus === 'guarded' || rawStatus === 'degraded' || fallback.restartSafe === false || contract.restartSafe === false
      ? 'guarded'
      : 'ready';
  const evidence = fallback.evidence && typeof fallback.evidence === 'object' ? fallback.evidence : {};
  const visibleRows = normalizeList(evidence.visibleRows);
  const blockedRows = normalizeList(evidence.blockedRows);
  const guardedRows = normalizeList(evidence.guardedRows);
  return {
    id,
    source,
    status,
    required: required === true,
    restartSafe: status === 'ready' && fallback.restartSafe !== false && contract.restartSafe !== false,
    statusChannel: clean(fallback.statusChannel ?? contract.handoff?.statusChannel) || null,
    clientVisible: status !== 'ready' || visibleRows.length > 0,
    nextAction: clean(fallback.nextAction ?? contract.handoff?.nextAction ?? contract.exportSummary?.nextAction)
      || (status === 'blocked' ? `resolve_${id}` : status === 'guarded' ? `review_${id}` : `publish_${id}`),
    evidence: {
      ...evidence,
      visibleRows,
      blockedRows,
      guardedRows
    },
    fingerprint: clean(evidence.fingerprint ?? contract.fingerprint ?? contract.exportSummary?.fingerprint)
  };
}

function moduleClientControlRoomFingerprint({ operation, status, rows }) {
  return [
    'module_client_control_room',
    operation,
    status,
    ...rows.map((row) => [
      row.id,
      row.source,
      row.status,
      row.restartSafe ? 'restart_safe' : 'restart_guarded',
      row.statusChannel,
      row.fingerprint,
      row.nextAction,
      ...row.evidence.visibleRows,
      ...row.evidence.blockedRows,
      ...row.evidence.guardedRows
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('||');
}

function moduleWorkflowNextActionFingerprint({
  operation,
  status,
  rows
}) {
  return [
    operation,
    status,
    ...rows.map((row) => [
      row.id,
      row.source,
      row.status,
      row.required ? 'required' : 'optional',
      row.restartSafe ? 'restart_safe' : 'restart_guarded',
      row.statusChannel ?? '',
      row.evidence?.fingerprint ?? '',
      row.nextAction ?? 'no_action'
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('||');
}

function moduleRuntimeAdoptionFingerprint({
  operation,
  status,
  rows,
  operationalStatus,
  exportReadiness
}) {
  return [
    operation,
    status,
    `ops:${operationalStatus.status ?? 'unknown'}`,
    `export:${exportReadiness.status ?? 'unknown'}`,
    ...rows.map((row) => [
      row.key,
      row.status,
      row.restartSafe === false ? 'guarded' : 'safe',
      row.requiredAcceptance === true ? 'acceptance' : 'auto',
      row.evidence?.requestKey ?? '',
      row.evidence?.sequence ?? 0,
      row.evidence?.changed === true ? 'changed' : 'stable',
      row.nextAction ?? 'no_action'
    ].map(clean).join(':')).sort()
  ].map(clean).filter(Boolean).join('||');
}

function normalizeModuleProviderSyncWorkflow(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    sequence: toNonNegativeInteger(value.sequence ?? value.exportSummary?.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint)
  };
}

function moduleProviderSyncWorkflowRow(id, source, contract, required, fallback = {}) {
  const rawStatus = clean(fallback.status ?? contract.status ?? contract.exportSummary?.status) || 'ready';
  const status = rawStatus === 'degraded' || rawStatus === 'paused' || rawStatus === 'disabled'
    ? 'guarded'
    : rawStatus;
  const blocked = status === 'blocked';
  const guarded = !blocked && status !== 'ready';
  const statusChannel = clean(fallback.statusChannel ?? contract.handoff?.statusChannel) || null;
  return {
    id,
    source,
    status: blocked ? 'blocked' : guarded ? 'guarded' : 'ready',
    required,
    restartSafe: fallback.restartSafe === true && blocked !== true && guarded !== true,
    statusChannel,
    publish: blocked || guarded || statusChannel?.startsWith('local.status.') === true,
    nextAction: clean(fallback.nextAction) || (
      blocked ? `resolve_${id}` : guarded ? `publish_${id}_guarded` : `publish_${id}`
    ),
    evidence: fallback.evidence && typeof fallback.evidence === 'object' ? fallback.evidence : {}
  };
}

function moduleProviderSyncWorkflowFingerprint({ operation, status, rows }) {
  return [
    operation,
    status,
    ...rows.map((row) => [
      row.id,
      row.source,
      row.status,
      row.required ? 'required' : 'optional',
      row.restartSafe ? 'restart_safe' : 'restart_guarded',
      row.statusChannel ?? '',
      row.evidence?.fingerprint ?? row.evidence?.lastStableFingerprint ?? '',
      row.evidence?.cursor ?? row.evidence?.profileCursor ?? '',
      row.evidence?.changed === true ? 'changed' : '',
      row.nextAction ?? 'no_action'
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('||');
}

function normalizeModuleBoundaryReleaseHistory(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    sequence: toNonNegativeInteger(value.sequence ?? value.history?.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint),
    timeline: Array.isArray(value.history?.timeline)
      ? value.history.timeline
      : Array.isArray(value.timeline)
        ? value.timeline
        : []
  };
}

function moduleBoundaryReleaseRow(id, release, required) {
  const summary = release.exportSummary ?? {};
  const readiness = release.readiness ?? {};
  const status = clean(release.status ?? summary.status) || 'blocked';
  const blocked = status === 'blocked';
  const guarded = status === 'guarded' || status === 'degraded';
  const normalizedStatus = blocked ? 'blocked' : guarded ? 'guarded' : 'released';
  return {
    id,
    status: normalizedStatus,
    required,
    restartSafe: release.restartSafe === true || summary.restartSafe === true,
    statusChannel: clean(release.auditHandoff?.statusChannel ?? release.handoff?.statusChannel) || 'kernel.status.mailchimp',
    diagnosticErrors: (release.diagnostics ?? []).filter((item) => item.level === 'error').length,
    diagnosticWarnings: (release.diagnostics ?? []).filter((item) => item.level === 'warning').length,
    reasons: normalizedStatus === 'blocked'
      ? normalizeList(readiness.blockingReasons ?? summary.blockedRows)
      : normalizedStatus === 'guarded'
        ? normalizeList(readiness.guardedReasons ?? readiness.degradedReasons ?? summary.guardedRows ?? summary.degradedRows)
        : [],
    nextAction: readiness.nextAction ?? summary.nextAction ?? (
      normalizedStatus === 'released' ? `publish_${id}` : `review_${id}`
    ),
    evidence: {
      tenantId: summary.tenantId ?? release.scope?.tenantId ?? null,
      workspaceId: summary.workspaceId ?? release.scope?.workspaceId ?? null,
      blockedRows: summary.blockedRows ?? [],
      guardedRows: summary.guardedRows ?? summary.degradedRows ?? [],
      restartSafe: release.restartSafe === true || summary.restartSafe === true
    }
  };
}

function moduleBoundaryReleaseFingerprint({ operation, status, rows }) {
  return [
    operation,
    status,
    ...rows.map((row) => [
      row.id,
      row.status,
      row.restartSafe ? 'restart_safe' : 'restart_guarded',
      row.nextAction,
      ...row.reasons
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('||');
}

function normalizeModuleTenantLaunchGuardHistory(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    sequence: toNonNegativeInteger(value.sequence ?? value.history?.sequence ?? value.exportSummary?.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint),
    timeline: Array.isArray(value.history?.timeline)
      ? value.history.timeline.filter((item) => item && typeof item === 'object')
      : Array.isArray(value.timeline)
        ? value.timeline.filter((item) => item && typeof item === 'object')
        : []
  };
}

function firstModuleTenantLaunchGuardAction(rows, fallback) {
  return rows
    .map((row) => clean(row.nextAction))
    .filter(Boolean)[0] || fallback;
}

function moduleTenantLaunchGuardFingerprint({
  operation,
  status,
  rows,
  counters
}) {
  return [
    operation,
    status,
    `blocked:${counters.blocked ?? 0}`,
    `guarded:${counters.guarded ?? 0}`,
    ...rows.map((row) => [
      row.id,
      row.source,
      row.status,
      row.required === false ? 'optional' : 'required',
      row.restartSafe === false ? 'restart_guarded' : 'restart_safe',
      row.nextAction,
      row.evidence?.tenantId,
      row.evidence?.workspaceId,
      row.evidence?.requestedTenantId,
      row.evidence?.requestedWorkspaceId,
      ...(row.evidence?.deniedCapabilities ?? []).map((item) => `capability:${item}`),
      ...(row.evidence?.blockedRows ?? []).map((item) => `blocked:${item}`),
      ...(row.evidence?.guardedRows ?? []).map((item) => `guarded:${item}`),
      row.evidence?.fingerprint
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('||');
}

function normalizeModuleRestartReplayCheckpoint(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    sequence: toNonNegativeInteger(value.sequence ?? value.history?.sequence ?? value.exportSummary?.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint)
  };
}

function moduleRestartReplayRow(id, source, packet = {}, required, fallback = {}) {
  const rawStatus = clean(packet.status ?? packet.exportSummary?.status ?? fallback.status) || 'ready';
  const status = rawStatus === 'blocked'
    ? 'blocked'
    : rawStatus === 'guarded' || rawStatus === 'degraded' || packet.restartSafe === false
      ? 'guarded'
      : 'ready';
  return {
    id,
    source,
    status,
    required: required === true,
    restartSafe: status === 'ready' && packet.restartSafe !== false,
    fingerprint: clean(fallback.fingerprint ?? packet.fingerprint ?? packet.exportSummary?.fingerprint),
    statusChannel: clean(fallback.statusChannel ?? packet.handoff?.statusChannel) || null,
    nextAction: clean(fallback.nextAction ?? packet.handoff?.nextAction ?? packet.exportSummary?.nextAction)
      || (status === 'blocked' ? `resolve_${id}` : status === 'guarded' ? `review_${id}` : `publish_${id}`),
    evidence: fallback.evidence && typeof fallback.evidence === 'object' ? fallback.evidence : {}
  };
}

function dedupeModuleRestartReplayRows(rows = []) {
  const seen = new Set();
  return rows
    .filter((row) => row && typeof row === 'object' && clean(row.id))
    .filter((row) => {
      const key = [row.id, row.source, row.status, row.nextAction].map(clean).join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => (
      moduleRestartReplayStatusRank(right.status) - moduleRestartReplayStatusRank(left.status)
      || clean(left.id).localeCompare(clean(right.id))
    ));
}

function moduleRestartReplayStatusRank(status) {
  if (status === 'blocked') return 3;
  if (status === 'guarded') return 2;
  return 1;
}

function moduleRestartReplayCheckpointFingerprint({ operation, status, rows }) {
  return [
    'module_restart_replay_checkpoint',
    operation,
    status,
    ...rows.map((row) => [
      row.id,
      row.source,
      row.status,
      row.required ? 'required' : 'optional',
      row.restartSafe ? 'restart_safe' : 'restart_guarded',
      row.statusChannel,
      row.fingerprint,
      row.nextAction,
      ...(row.evidence?.appliedCommandKeys ?? []),
      ...(row.evidence?.suppressedCommandKeys ?? []),
      ...(row.evidence?.blockedRows ?? []),
      ...(row.evidence?.guardedRows ?? [])
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('||');
}

function normalizeModuleTenantHandoffBoundary(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    sequence: toNonNegativeInteger(value.sequence ?? value.history?.sequence ?? value.exportSummary?.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint),
    timeline: Array.isArray(value.history?.timeline)
      ? value.history.timeline.filter((item) => item && typeof item === 'object')
      : Array.isArray(value.timeline)
        ? value.timeline.filter((item) => item && typeof item === 'object')
        : []
  };
}

function normalizeModuleClientBoundaryReadiness(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    sequence: toNonNegativeInteger(value.sequence ?? value.history?.sequence ?? value.exportSummary?.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint),
    appliedCommandKeys: Array.isArray(value.idempotency?.appliedCommandKeys)
      ? value.idempotency.appliedCommandKeys
      : Array.isArray(value.appliedCommandKeys)
        ? value.appliedCommandKeys
        : [],
    timeline: Array.isArray(value.history?.timeline)
      ? value.history.timeline.filter((item) => item && typeof item === 'object')
      : Array.isArray(value.timeline)
        ? value.timeline.filter((item) => item && typeof item === 'object')
        : []
  };
}

function moduleClientBoundaryReadinessRow(id, source, contract, required, fallback = {}) {
  const rawStatus = clean(fallback.status ?? contract.status ?? contract.exportSummary?.status) || 'ready';
  const status = rawStatus === 'degraded' || rawStatus === 'paused' || rawStatus === 'disabled'
    ? 'guarded'
    : rawStatus;
  const blocked = status === 'blocked';
  const guarded = !blocked && status !== 'ready';
  return {
    id,
    source,
    status: blocked ? 'blocked' : guarded ? 'guarded' : 'ready',
    required,
    restartSafe: fallback.restartSafe === true && blocked !== true && guarded !== true,
    statusChannel: clean(fallback.statusChannel) || null,
    nextAction: clean(fallback.nextAction) || (
      blocked ? `resolve_${id}` : guarded ? `publish_${id}_guarded` : `publish_${id}`
    ),
    evidence: fallback.evidence && typeof fallback.evidence === 'object' ? fallback.evidence : {}
  };
}

function moduleClientBoundaryReadinessFingerprint({
  operation,
  status,
  rows,
  repeatedCommand
}) {
  return [
    operation,
    status,
    repeatedCommand ? 'replayed_command' : 'new_command',
    ...rows.map((row) => [
      row.id,
      row.source,
      row.status,
      row.required ? 'required' : 'optional',
      row.restartSafe ? 'restart_safe' : 'restart_guarded',
      row.statusChannel ?? '',
      row.evidence?.fingerprint ?? '',
      row.nextAction ?? 'no_action'
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('||');
}

function moduleTenantHandoffBoundaryRow(id, packet, required) {
  const summary = packet.exportSummary ?? {};
  const handoff = packet.handoff ?? {};
  const rawStatus = clean(packet.status ?? summary.status) || 'blocked';
  const status = rawStatus === 'released' || rawStatus === 'ready'
    ? 'released'
    : rawStatus === 'guarded' || rawStatus === 'degraded'
      ? 'guarded'
      : 'blocked';
  return {
    id,
    status,
    required,
    restartSafe: packet.restartSafe === true || summary.restartSafe === true,
    sequence: toNonNegativeInteger(packet.sequence ?? summary.sequence, 0),
    fingerprint: clean(packet.fingerprint ?? summary.fingerprint),
    statusChannel: clean(handoff.statusChannel) || (status === 'released' ? 'kernel.status.mailchimp' : 'local.status.module-boundary'),
    diagnosticErrors: (packet.diagnostics ?? []).filter((item) => item.level === 'error').length,
    diagnosticWarnings: (packet.diagnostics ?? []).filter((item) => item.level === 'warning').length,
    blockedRows: summary.blockedRows ?? [],
    guardedRows: summary.guardedRows ?? [],
    nextAction: clean(handoff.nextAction ?? summary.nextAction) || (
      status === 'released' ? `publish_${id}_tenant_handoff` : `review_${id}_tenant_handoff`
    ),
    evidence: {
      tenantId: summary.tenantId ?? packet.scope?.tenantId ?? null,
      workspaceId: summary.workspaceId ?? packet.scope?.workspaceId ?? null,
      changed: packet.changed === true || summary.changed === true,
      publish: handoff.publish === true,
      severity: clean(handoff.severity) || (status === 'blocked' ? 'error' : status === 'guarded' ? 'warning' : 'info')
    },
    diagnostics: Array.isArray(packet.diagnostics) ? packet.diagnostics : []
  };
}

function moduleTenantHandoffBoundaryFingerprint({ operation, status, rows }) {
  return [
    operation,
    status,
    ...rows.map((row) => [
      row.id,
      row.status,
      row.restartSafe ? 'restart_safe' : 'restart_guarded',
      row.statusChannel,
      row.fingerprint,
      row.nextAction,
      ...row.blockedRows,
      ...row.guardedRows
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('||');
}

function normalizeModuleOperationalEscalation(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    sequence: toNonNegativeInteger(value.sequence ?? value.history?.sequence ?? value.exportSummary?.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint),
    lastStableFingerprint: clean(value.escalation?.lastStableFingerprint ?? value.lastStableFingerprint) || null,
    timeline: Array.isArray(value.history?.timeline)
      ? value.history.timeline.filter((item) => item && typeof item === 'object')
      : Array.isArray(value.timeline)
        ? value.timeline.filter((item) => item && typeof item === 'object')
      : []
  };
}

function normalizeModuleOperationalReadinessBrief(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    sequence: toNonNegativeInteger(value.sequence ?? value.history?.sequence ?? value.exportSummary?.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint),
    timeline: Array.isArray(value.history?.timeline)
      ? value.history.timeline.filter((item) => item && typeof item === 'object')
      : Array.isArray(value.timeline)
        ? value.timeline.filter((item) => item && typeof item === 'object')
        : []
  };
}

function moduleOperationalReadinessBriefRow(id, source, contract = {}, required, fallback = {}) {
  const rawStatus = clean(contract.status ?? contract.exportSummary?.status) || 'ready';
  const status = rawStatus === 'blocked'
    ? 'blocked'
    : rawStatus === 'guarded' || rawStatus === 'degraded' || rawStatus === 'recovering' || contract.restartSafe === false
      ? 'guarded'
      : 'ready';
  return {
    id,
    source,
    status,
    required: required === true,
    restartSafe: status === 'ready' && contract.restartSafe !== false && contract.exportSummary?.restartSafe !== false,
    publish: contract.handoff?.publish === true || status !== 'ready' || contract.changed === true,
    clientVisible: status !== 'ready' || required === true || contract.handoff?.publish === true,
    sequence: toNonNegativeInteger(contract.sequence ?? contract.exportSummary?.sequence, 0),
    fingerprint: clean(contract.fingerprint ?? contract.exportSummary?.fingerprint),
    statusChannel: clean(fallback.statusChannel ?? contract.handoff?.statusChannel) || null,
    nextAction: clean(fallback.nextAction ?? contract.handoff?.nextAction ?? contract.exportSummary?.nextAction)
      || (status === 'blocked' ? `resolve_${id}` : status === 'guarded' ? `review_${id}` : `publish_${id}`),
    counters: fallback.counters && typeof fallback.counters === 'object' ? fallback.counters : {}
  };
}

function moduleOperationalReadinessBriefFingerprint({
  operation,
  status,
  rows,
  operationalStatus
}) {
  return [
    'module_operational_readiness_brief',
    operation,
    status,
    operationalStatus.status ?? 'unknown_operational_status',
    ...rows.map((row) => [
      row.id,
      row.source,
      row.status,
      row.required ? 'required' : 'optional',
      row.restartSafe ? 'restart_safe' : 'restart_guarded',
      row.publish ? 'publish' : 'silent',
      row.statusChannel,
      row.fingerprint,
      row.nextAction
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('||');
}

function normalizeModuleEscalationOwners(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    defaultOwner: clean(value.defaultOwner) || 'mailchimp.operations',
    profile: clean(value.profile) || clean(value.profileOwner) || 'mailchimp.profile',
    imports: clean(value.imports) || clean(value.importOwner) || 'mailchimp.imports'
  };
}

function moduleOperationalEscalationRow(source, envelope = {}, owner) {
  const rawStatus = clean(envelope.status ?? envelope.exportSummary?.status) || 'ready';
  const status = rawStatus === 'blocked' ? 'blocked' : rawStatus === 'degraded' || rawStatus === 'guarded' ? 'guarded' : 'ready';
  return {
    id: `${source}:summary`,
    source,
    subject: envelope.exportSummary?.title ?? envelope.title ?? source,
    status,
    severity: status === 'blocked' ? 'error' : status === 'guarded' ? 'warning' : 'info',
    owner: clean(envelope.escalation?.owner ?? envelope.exportSummary?.owner) || owner,
    deadlineMs: envelope.escalation?.deadlineMs ?? null,
    publish: envelope.handoff?.publish === true || status !== 'ready',
    restartSafe: envelope.restartSafe !== false && status === 'ready',
    nextAction: clean(envelope.escalation?.nextAction ?? envelope.handoff?.nextAction ?? envelope.exportSummary?.nextAction)
      || (status === 'blocked' ? `resolve_${source}_escalation` : status === 'guarded' ? `publish_${source}_escalation_guarded` : `publish_${source}_escalation_ready`),
    evidence: {
      sequence: envelope.sequence ?? envelope.exportSummary?.sequence ?? 0,
      fingerprint: envelope.fingerprint ?? envelope.exportSummary?.fingerprint ?? null,
      publishRows: envelope.exportSummary?.publishRows ?? [],
      nextRetry: envelope.retry ?? envelope.exportSummary?.nextRetry ?? null
    }
  };
}

function moduleEscalationRowsFromLeaf(source, rows = [], defaultOwner) {
  return rows
    .filter((row) => row && typeof row === 'object')
    .filter((row) => row.severity === 'error' || row.severity === 'warning' || row.publish === true)
    .map((row) => ({
      id: `${source}:${clean(row.id)}`,
      source,
      subject: clean(row.subject) || clean(row.id),
      status: row.severity === 'error' ? 'blocked' : row.severity === 'warning' ? 'guarded' : 'ready',
      severity: clean(row.severity) || 'info',
      owner: clean(row.owner) || defaultOwner,
      deadlineMs: row.deadlineMs ?? null,
      publish: row.publish === true || row.severity === 'error',
      restartSafe: row.severity !== 'error',
      nextAction: clean(row.action) || (row.severity === 'error' ? `resolve_${source}_row` : `review_${source}_row`),
      evidence: row.evidence && typeof row.evidence === 'object' ? row.evidence : {}
    }));
}

function moduleOperationalEscalationFingerprint({
  operation,
  status,
  rows,
  operationalStatus
}) {
  return [
    operation,
    status,
    operationalStatus.status ?? 'unknown_operational_status',
    ...rows.map((row) => [
      row.id,
      row.status,
      row.severity,
      row.owner,
      row.deadlineMs ?? '',
      row.publish ? 'publish' : 'silent',
      row.nextAction
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('||');
}

function normalizeModuleBoundaryOperationsPacket(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    sequence: toNonNegativeInteger(value.sequence ?? value.history?.sequence ?? value.exportSummary?.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint),
    timeline: Array.isArray(value.history?.timeline)
      ? value.history.timeline.filter((item) => item && typeof item === 'object')
      : Array.isArray(value.timeline)
        ? value.timeline.filter((item) => item && typeof item === 'object')
        : []
  };
}

function moduleBoundaryOperationsRow(id, source = {}, required, fallback = {}) {
  const rawStatus = clean(source.status ?? source.exportSummary?.status) || 'ready';
  const status = rawStatus === 'blocked'
    ? 'blocked'
    : rawStatus === 'guarded' || rawStatus === 'degraded' || rawStatus === 'paused' || rawStatus === 'disabled' || source.restartSafe === false
      ? 'guarded'
      : 'ready';
  return {
    id,
    source: clean(fallback.source) || id,
    status,
    required: required === true,
    restartSafe: status === 'ready' && source.restartSafe !== false && source.exportSummary?.restartSafe !== false,
    fingerprint: clean(source.fingerprint ?? source.exportSummary?.fingerprint),
    statusChannel: clean(fallback.statusChannel ?? source.handoff?.statusChannel ?? source.exportSummary?.statusChannel) || null,
    nextAction: clean(fallback.nextAction ?? source.readiness?.nextAction ?? source.handoff?.nextAction ?? source.exportSummary?.nextAction)
      || (status === 'blocked' ? `resolve_${id}` : status === 'guarded' ? `review_${id}` : `publish_${id}`),
    counters: fallback.counters && typeof fallback.counters === 'object' ? fallback.counters : {}
  };
}

function moduleBoundaryOperationsFingerprint({ operation, status, rows }) {
  return [
    'module_boundary_operations',
    operation,
    status,
    ...rows.map((row) => [
      row.id,
      row.source,
      row.status,
      row.required ? 'required' : 'optional',
      row.restartSafe ? 'restart_safe' : 'restart_guarded',
      row.statusChannel,
      row.fingerprint,
      row.nextAction
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('||');
}

function severityRank(severity) {
  if (severity === 'error') return 3;
  if (severity === 'warning') return 2;
  return 1;
}

function toNonNegativeInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

function clean(value) {
  return String(value ?? '').trim();
}
