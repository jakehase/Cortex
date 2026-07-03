import {
  buildProfileActivationControlPanel,
  buildProfileLifecycleControlState,
  buildProfileClientWorkflowHandoff,
  buildProfilePersistenceEnvelope,
  buildProfileClientRuntimeState,
  buildProfileExportSummary,
  buildProfileOperationalHealthExport,
  buildProfileOperationalFailureState,
  buildProfileBoundaryEvidencePacket,
  buildProfilePreviewAcceptanceState,
  buildProfileProviderServiceContract,
  buildProfileProviderAdoptionContract,
  buildProfileProviderSyncIntent,
  buildProfilePrimaryExportPack,
  buildProfileAudienceExportLedger,
  buildProfileClientRuntimeAdoptionPack,
  buildProfileRequestKernelBinding,
  buildProfileRestartRecoveryPacket,
  compileProfileDeclaration,
  deriveProfileRuntimeContract
} from './profile-declaration.mjs';
import {
  buildFeatureGateAnalyticsReport,
  buildFeatureGateClientAcceptancePackage,
  buildFeatureGateClientWorkflowHandoff,
  buildFeatureGateBoundaryControlPlan,
  buildFeatureGateLifecycleCommandPlan,
  buildFeatureGateLifecycleReadinessContract,
  buildFeatureGateKernelHandoffManifest,
  buildFeatureGateProviderPreviewAcceptance,
  buildFeatureGateStateSnapshot,
  deriveFeatureGateRecovery,
  evaluateFeatureGateContract
} from './feature-gates.mjs';
import {
  buildImportAnalyticsSnapshot,
  buildImportClientAcceptancePackage,
  buildImportClientWorkflowHandoff,
  buildImportGateLifecycleControlPlan,
  buildImportHistoryExport,
  buildImportTimelineReport,
  buildImportKernelHandoffManifest,
  buildImportLifecycleControlState,
  buildImportPreviewAcceptanceState,
  buildImportTenantBoundaryAcceptance,
  buildImportProviderContract,
  buildImportProviderReadinessPlan,
  buildImportProviderAdoptionContract,
  buildImportProviderSyncCheckpoint,
  buildImportRuntimeAdoptionHandoff,
  buildImportClientReadinessBrief,
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
    ...importClientReadiness.diagnostics.filter((item) => (
      options.enforceImportClientReadiness === true ? item.level === 'error' : item.level === 'fatal'
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
    ...profileProviderAdoption.diagnostics.filter((item) => (
      options.enforceProfileProviderAdoption === true ? item.level === 'error' : item.level === 'fatal'
    )),
    ...profileProviderSyncIntent.diagnostics.filter((item) => (
      options.enforceProfileProviderSync === true ? item.level === 'error' : item.level === 'fatal'
    )),
    ...importProviderSyncCheckpoint.diagnostics.filter((item) => (
      options.enforceImportProviderSync === true ? item.level === 'error' : item.level === 'fatal'
    )),
    ...featureKernelManifest.diagnostics.filter((item) => (
      options.enforceKernelHandoffManifest === true ? item.level === 'error' : item.level === 'fatal'
    )),
    ...importKernelManifest.diagnostics.filter((item) => (
      options.enforceKernelHandoffManifest === true ? item.level === 'error' : item.level === 'fatal'
    )),
    ...providerAdoption.diagnostics.filter((item) => (
      options.enforceModuleProviderAdoption === true ? item.level === 'error' : item.level === 'fatal'
    )),
    ...profileBoundaryEvidence.diagnostics.filter((item) => (
      options.enforceProfileBoundaryEvidence === true ? item.level === 'error' : item.level === 'fatal'
    )),
    ...profileOperationalHealth.diagnostics.filter((item) => (
      options.enforceProfileOperationalHealth === true ? item.level === 'error' : item.level === 'fatal'
    )),
    ...profilePrimaryPack.diagnostics.filter((item) => (
      options.enforceProfilePrimaryPack === true ? item.level === 'error' : item.level === 'fatal'
    )),
    ...profileAudienceLedger.diagnostics.filter((item) => (
      options.enforceProfileAudienceLedger === true ? item.level === 'error' : item.level === 'fatal'
    )),
    ...profileRuntimeAdoption.diagnostics.filter((item) => (
      options.enforceProfileRuntimeAdoption === true ? item.level === 'error' : item.level === 'fatal'
    )),
    ...profileRequestKernelBinding.diagnostics.filter((item) => (
      options.enforceProfileRequestKernelBinding === true ? item.level === 'error' : item.level === 'fatal'
    )),
    ...moduleRuntimeAdoption.diagnostics.filter((item) => (
      options.enforceModuleRuntimeAdoption === true ? item.level === 'error' : item.level === 'fatal'
    )),
    ...profileRestartRecovery.diagnostics.filter((item) => (
      options.enforceProfileRestartRecovery === true ? item.level === 'error' : item.level === 'fatal'
    )),
    ...profileActivation.diagnostics.filter((item) => (
      options.enforceProfileActivation === true ? item.level === 'error' : item.level === 'fatal'
    )),
    ...profilePreviewAcceptance.diagnostics.filter((item) => (
      options.enforceProfilePreviewAcceptance === true || options.requireProfilePreviewAcceptance === true
        ? item.level === 'error'
        : item.level === 'fatal'
    )),
    ...profileLifecycle.diagnostics.filter((item) => (
      options.enforceProfileLifecycle === true ? item.level === 'error' : item.level === 'fatal'
    )),
    ...profileFailure.diagnostics.filter((item) => (
      options.enforceProfileFailureState === true ? item.level === 'error' : item.level === 'fatal'
    )),
    ...clientRuntime.diagnostics.filter((item) => (
      options.enforceClientRuntime === true ? item.level === 'error' : item.level === 'fatal'
    ))
  ];
  const ok = !diagnostics.some((item) => item.level === 'error');
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
    profileActivation,
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
    profileActivation,
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
    profileActivation,
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
    profileBoundaryEvidence,
    operationalStatus,
    operationalActionPlan,
    exportReadiness,
    boundary
  });
  const launchAcceptance = buildModuleLaunchAcceptancePackage({
    operation,
    profilePreviewAcceptance,
    featureClientAcceptance,
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

  return {
    ok,
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
      featureBoundaryControls,
      profileExport: profileExport.exportSummary,
      profileAudienceLedger,
      importHealth,
      importAnalytics,
      importHistoryExport,
      importTimelineReport,
      importClientReadiness,
      importLifecycle,
      importGateLifecycle,
      importPreviewAcceptance,
      importBoundaryAcceptance,
      importProviderContract,
      importProviderReadiness,
      importProviderAdoption,
      importProviderSyncCheckpoint,
      importRuntimeAdoption,
      profileProviderService,
      profileProviderAdoption,
      profileProviderSyncIntent,
      providerAdoption,
      featureKernelManifest,
      importKernelManifest,
      kernelHandoffManifest: moduleKernelHandoffManifest,
      profileRuntimeAdoption,
      profileRequestKernelBinding,
      moduleRuntimeAdoption,
      profileRestartRecovery,
      profileActivation,
      providerGatePreview,
      featureClientAcceptance,
      importClientAcceptance,
      launchAcceptance,
      profileBoundaryEvidence,
      profileOperationalHealth,
      profilePrimaryPack,
      profileAudienceLedger,
      exportReadiness,
      operationsPack,
      clientWorkflowHandoff,
      clientRuntime: clientRuntime.state,
      profilePreviewAcceptance,
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
        importLifecycle: importLifecycle.handoff,
        importGateLifecycle: importGateLifecycle.handoff,
        importRuntimeAdoption: importRuntimeAdoption.handoff,
        importProviderAdoption: importProviderAdoption.handoff,
        importProviderReadiness: importProviderReadiness.handoff,
        importProviderSync: importProviderSyncCheckpoint.handoff,
        profileLifecycle: profileLifecycle.handoff,
        providerTargets: importProviderContract.externalHandoff.targets,
        profileProviderTarget: profileProviderService.externalState?.target ?? null,
        profileProviderAdoption: profileProviderAdoption.handoff,
        profileProviderSync: profileProviderSyncIntent.handoff,
        providerAdoption: providerAdoption.handoff,
        featureKernelManifest: featureKernelManifest.handoff,
        importKernelManifest: importKernelManifest.handoff,
        kernelHandoffManifest: moduleKernelHandoffManifest.handoff,
        profileRuntimeAdoption: profileRuntimeAdoption.handoff,
        profileRestartRecovery: profileRestartRecovery.handoff,
        profileActivation: profileActivation.handoff,
        profileBoundaryEvidence: profileBoundaryEvidence.auditHandoff,
        profileOperationalHealth: profileOperationalHealth.handoff,
        profilePrimaryPack: profilePrimaryPack.handoff,
        profileAudienceLedger: profileAudienceLedger.handoff,
        featureCommandPlan: featureCommandPlan.handoff,
        featureLifecycleReadiness: featureLifecycleReadiness.handoff,
        importClientReadiness: importClientReadiness.handoff,
        featureBoundaryControls: featureBoundaryControls.auditHandoff,
        importBoundary: importBoundaryAcceptance.auditHandoff,
        profilePreview: profilePreviewAcceptance.exportSummary,
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
          && importLifecycle.ok
          && importGateLifecycle.restartSafe
          && importBoundaryAcceptance.restartSafe
          && importProviderContract.restartSafe
          && importProviderReadiness.restartSafe
          && importProviderAdoption.restartSafe
          && importProviderSyncCheckpoint.restartSafe
          && featureKernelManifest.restartSafe
          && importKernelManifest.restartSafe
          && moduleKernelHandoffManifest.restartSafe
          && importRuntimeAdoption.restartSafe
          && profileProviderService.restartSafe
          && profileProviderAdoption.restartSafe
          && profileProviderSyncIntent.restartSafe
          && providerAdoption.restartSafe
          && profileRuntimeAdoption.restartSafe
          && profileRestartRecovery.restartSafe
          && profileActivation.restartSafe
          && profileBoundaryEvidence.restartSafe
          && profilePrimaryPack.restartSafe
          && profileAudienceLedger.restartSafe
          && featureCommandPlan.restartSafe
          && featureLifecycleReadiness.restartSafe
          && featureBoundaryControls.restartSafe
          && importClientReadiness.restartSafe
          && profilePreviewAcceptance.restartSafe
          && providerGatePreview.restartSafe
          && exportReadiness.restartSafe
          && operationsPack.restartSafe
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
        importLifecycleStatus: importLifecycle.status,
        importGateLifecycleStatus: importGateLifecycle.status,
        profileLifecycleStatus: profileLifecycle.status,
        importProviderStatus: importProviderContract.status,
        importProviderAdoptionStatus: importProviderAdoption.status,
        importProviderSyncStatus: importProviderSyncCheckpoint.status,
        importProviderReadinessStatus: importProviderReadiness.status,
        importRuntimeAdoptionStatus: importRuntimeAdoption.status,
        profileProviderStatus: profileProviderService.status,
        profileProviderAdoptionStatus: profileProviderAdoption.status,
        profileProviderSyncStatus: profileProviderSyncIntent.status,
        providerAdoptionStatus: providerAdoption.status,
        featureKernelManifestStatus: featureKernelManifest.status,
        importKernelManifestStatus: importKernelManifest.status,
        kernelHandoffManifestStatus: moduleKernelHandoffManifest.status,
        profileRuntimeAdoptionStatus: profileRuntimeAdoption.status,
        profileRestartRecoveryStatus: profileRestartRecovery.status,
        profileActivationStatus: profileActivation.status,
        profileBoundaryEvidenceStatus: profileBoundaryEvidence.status,
        profilePrimaryPackStatus: profilePrimaryPack.status,
        profileAudienceLedgerStatus: profileAudienceLedger.status,
        featureCommandPlanStatus: featureCommandPlan.status,
        featureLifecycleReadinessStatus: featureLifecycleReadiness.status,
        featureBoundaryControlsStatus: featureBoundaryControls.status,
        importClientReadinessStatus: importClientReadiness.status,
        importBoundaryStatus: importBoundaryAcceptance.status,
        profilePreviewStatus: profilePreviewAcceptance.status,
        providerPreviewStatus: providerGatePreview.status,
        clientWorkflowStatus: clientWorkflowHandoff.status,
        launchAcceptanceStatus: launchAcceptance.status,
        exportStatus: exportReadiness.status,
        profileFailureStatus: profileFailure.status,
        boundaryStatus: boundary.contract.status,
        resumeAction: operationalActionPlan.nextAction === 'operator_review'
          ? 'operator_operational_review'
          : profileLifecycle.status === 'disabled' || profileLifecycle.status === 'paused'
          ? 'wait_for_profile_lifecycle_control'
          : profileLifecycle.status === 'retry_scheduled'
          ? 'dispatch_profile_retry'
          : profileLifecycle.status === 'operator_review'
          ? 'operator_profile_lifecycle_review'
          : operationalActionPlan.nextAction === 'dispatch_import_retry'
          ? 'dispatch_import_retry'
          : importProviderReadiness.status === 'blocked'
          ? 'resolve_import_provider_readiness_blockers'
          : importProviderSyncCheckpoint.status === 'blocked'
          ? 'resolve_import_provider_sync_checkpoint_blockers'
          : profileProviderSyncIntent.status === 'blocked'
          ? 'resolve_profile_provider_sync_blockers'
          : providerAdoption.status === 'blocked'
          ? 'resolve_module_provider_adoption_blockers'
          : moduleKernelHandoffManifest.status === 'blocked'
          ? moduleKernelHandoffManifest.readiness.nextAction
          : profileRuntimeAdoption.status === 'blocked'
          ? 'resolve_profile_runtime_adoption_blockers'
          : profileRestartRecovery.status === 'blocked'
          ? 'resolve_profile_restart_recovery_blockers'
          : profileAudienceLedger.status === 'blocked'
          ? 'resolve_profile_audience_export_ledger_blockers'
          : featureCommandPlan.status === 'blocked'
          ? 'resolve_feature_gate_command_plan_blockers'
          : featureLifecycleReadiness.status === 'blocked'
          ? featureLifecycleReadiness.readiness.nextAction
          : importTimelineReport.status === 'blocked'
          ? importTimelineReport.handoff.nextAction
          : importClientReadiness.status === 'blocked'
          ? 'resolve_import_client_readiness_blockers'
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
  providerGatePreview = {},
  profileExport = {},
  profilePreviewAcceptance = {},
  profileBoundaryEvidence = {},
  profilePrimaryPack = {},
  profileActivation = {},
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
  const profileActivationStatus = profileActivation.status ?? 'ready';
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
    ...(profileActivationStatus === 'blocked' ? ['profile_activation'] : []),
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
    ...(profileActivationStatus === 'degraded' ? ['profile_activation'] : []),
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
    && profileActivation.restartSafe !== false
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
      profileActivation: profileActivationStatus,
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
      profileActivation: profileActivation.exportSummary ?? null,
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
  profileActivation = {},
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
    ...normalizeProfileActivationActions(profileActivation),
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

export function buildModuleClientWorkflowHandoff({
  profileClientWorkflow = {},
  featureClientWorkflow = {},
  importClientWorkflow = {},
  importRuntimeAdoption = {},
  moduleRuntimeAdoption = {},
  profileActivation = {},
  profileRuntimeAdoption = {},
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
  featureClientAcceptance = {},
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
        statusChannel: profilePreviewAcceptance.exportSummary?.statusChannel ?? null
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
        blockedRows: featureClientAcceptance.exportSummary?.blockedRows ?? []
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
      profileRequestKernelBinding: profileRequestKernelBinding.exportSummary ?? null,
      moduleRuntimeAdoption: moduleRuntimeAdoption.exportSummary ?? null,
      launchAcceptance: launchAcceptance.exportSummary ?? null,
      nextAction
    }
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
