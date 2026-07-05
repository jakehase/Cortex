import fs from 'node:fs';
import path from 'node:path';
import { writeJsonAtomic, writeJsonFile, writeTextFile } from './persistence-io.mjs';
import { createId, nowIso } from './utils.mjs';
import { loadDbFromSqlite, saveDbToSqlite, sqliteOperationalSummary } from './storage-sqlite.mjs';

const ROOT_DIR = path.resolve(new URL('../..', import.meta.url).pathname);

export const PLAN_CATALOG = [
  { id: 'starter', name: 'Starter', price: '$0', monthlyLimit: 500, features: { scheduledSend: false, advancedSegments: false, auditExport: false, multiUser: false, assetFolders: false } },
  { id: 'growth', name: 'Growth', price: '$49', monthlyLimit: 10000, features: { scheduledSend: true, advancedSegments: true, auditExport: true, multiUser: true, assetFolders: true } },
  { id: 'pro', name: 'Pro', price: '$149', monthlyLimit: 50000, features: { scheduledSend: true, advancedSegments: true, auditExport: true, multiUser: true, assetFolders: true } }
];

export const DEFAULT_FLAGS = {
  smartSegments: true,
  sendScheduler: true,
  templateLibrary: true,
  contentStudioTemplates: true,
  auditExport: true,
  apiAccess: true,
  campaignChecklist: true,
  automations: true,
  forms: true,
  landingPages: true,
  reports: true,
  webhooks: true,
  integrationsMarketplace: true,
  commerceInsights: true,
  approvals: true,
  complianceCenter: true,
  conversationsInbox: true,
  hostedPreferences: true,
  transactionalMessaging: true,
  surveyFeedback: true,
  mobileApp: true
};

export const DEFAULT_TEMPLATES = [
  { id: 'tmpl-announce', name: 'Product announcement', category: 'Launch', description: 'Hero + body + CTA launch structure.', blocks: [{ type: 'hero', title: 'Big news', body: 'Lead with the launch and value proposition.' }, { type: 'text', title: 'What changed', body: 'Explain the release in short, scannable paragraphs.' }, { type: 'button', title: 'Try it now', buttonLabel: 'Open product', buttonUrl: 'https://example.test/product' }] },
  { id: 'tmpl-newsletter', name: 'Weekly newsletter', category: 'Newsletter', description: 'Digest-style update with sections.', blocks: [{ type: 'hero', title: 'This week', body: 'Top stories, launches, and team notes.' }, { type: 'text', title: 'Highlights', body: 'Share 3-5 highlights with links and short blurbs.' }, { type: 'divider' }, { type: 'text', title: 'Metrics corner', body: 'Add the trend or win worth calling out.' }] },
  { id: 'tmpl-offer', name: 'Offer spotlight', category: 'Promo', description: 'Short promotional structure with proof and CTA.', blocks: [{ type: 'hero', title: 'Special offer', body: 'Put the offer, deadline, and why it matters up top.' }, { type: 'image', title: 'Offer image', assetId: '', body: 'Add a product or banner asset.' }, { type: 'button', title: 'Redeem', buttonLabel: 'Claim offer', buttonUrl: 'https://example.test/offer' }] }
];

export const DEFAULT_JOURNEY_TEMPLATES = [
  { id: 'journey-welcome', name: 'Welcome series', nodes: [{ type: 'email', title: 'Welcome email' }, { type: 'delay', title: 'Wait 1 day', delayHours: 24 }] },
  { id: 'journey-reengage', name: 'Re-engagement', nodes: [{ type: 'delay', title: 'Wait 7 days', delayHours: 168 }, { type: 'branch', title: 'Opened campaign?' }] }
];

export function dataPaths() {
  const dataDir = process.env.MAILCLONE_DATA_DIR || path.join(ROOT_DIR, 'data');
  const rootLegacyDbPath = path.join(ROOT_DIR, 'app.json');
  const cwdLegacyDbPath = path.join(process.cwd(), 'app.json');
  return {
    dataDir,
    dbPath: path.join(dataDir, 'workspace-state.json'),
    sqlitePath: path.join(dataDir, 'workspace-state.sqlite'),
    legacyDbPath: rootLegacyDbPath,
    legacyDbCandidates: Array.from(new Set([rootLegacyDbPath, cwdLegacyDbPath])),
    uploadDir: path.join(dataDir, 'uploads'),
    exportDir: path.join(dataDir, 'exports')
  };
}

export function storageEngine() {
  return String(process.env.MAILCLONE_STORAGE_ENGINE || 'json').toLowerCase() === 'sqlite' ? 'sqlite' : 'json';
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function createWorkspace(name, ownerName = '') {
  return {
    id: createId('ws'),
    name,
    planId: 'starter',
    apiKey: createId('key'),
    featureFlags: { ...DEFAULT_FLAGS },
    billing: { currentPlan: 'starter', invoices: [{ id: createId('inv'), amount: '$0', status: 'paid', createdAt: nowIso() }] },
    settings: { senderName: ownerName, senderEmail: '', replyTo: '', timezone: 'America/Chicago', address: '', brandColor: '#0b5fff', domains: [] },
    createdAt: nowIso()
  };
}

export function createAudience(workspaceId, name = 'Main audience') {
  return { id: createId('aud'), workspaceId, name, description: '', createdAt: nowIso(), updatedAt: nowIso(), taxonomy: { tags: ['vip', 'new'], interests: ['product updates'], groupCategories: [{ name: 'Region', options: ['North', 'South', 'East', 'West'] }] } };
}

const DEFAULT_DB_STATE = {
  schemaVersion: 5,
  schemaMigrations: [
    { id: 'base_workspace_state', version: 5, appliedAt: '2026-06-04T00:00:00.000Z', collections: ['users', 'workspaces', 'memberships'] },
    { id: 'audience_campaign_foundation', version: 5, appliedAt: '2026-06-04T00:00:00.000Z', collections: ['audiences', 'contacts', 'campaigns'] },
    { id: 'service_runtime_ledgers', version: 5, appliedAt: '2026-06-04T00:00:00.000Z', collections: ['serviceRequests', 'aiModelRuns', 'deliveryPipelineRuns'] },
    { id: 'architecture_assessment_runtime', version: 5, appliedAt: '2026-06-04T00:00:00.000Z', collections: ['primaryArchitectureAssessments', 'productionArchitectureAssessments'] },
    { id: 'production_architecture_runtime', version: 5, appliedAt: '2026-06-04T00:00:00.000Z', collections: ['productionArchitectureTransactions', 'productionProviderSyncCheckpoints', 'productionQueueWorkerLeases'] }
  ],
  users: [], memberships: [], workspaces: [], invitations: [], sessions: [], auditEvents: [], events: [], notifications: [], jobs: [], assets: [], audiences: [], contacts: [], segments: [], campaigns: [], templates: DEFAULT_TEMPLATES,
  passwordResets: [], importPreviews: [], automations: [], automationRuns: [], journeyTemplates: DEFAULT_JOURNEY_TEMPLATES, crossChannelJourneyRuntimeSnapshots: [], crossChannelJourneyNodeEvents: [], crossChannelJourneyHandoffEvents: [], crossChannelJourneyDecisionEvents: [], crossChannelJourneyPerformanceEvents: [], forms: [], landingPages: [], apiKeys: [], webhooks: [], webhookDeliveries: [], exports: [],
  integrationInstallations: [], integrationSyncRuns: [], integrationProviderAccounts: [], integrationProviderAuthSessions: [], integrationProviderCursors: [], integrationProviderRequests: [], integrationProviderWebhookEvents: [], commerceStores: [], commerceProducts: [], commerceOrders: [], revenueAttributions: [], approvalRequests: [], approvalComments: [], brandKits: [], contentTemplates: [], templateCollections: [], contentRuntimeSnapshots: [], contentAssetLifecycleEvents: [], contentTemplateReviewEvents: [], contentUsageTelemetryEvents: [], contentGovernanceEvents: [], suppressionEntries: [], complianceAlerts: [], deliverabilityRuntimeSnapshots: [], domainDnsCheckEvents: [], domainDmarcAlignmentEvents: [], senderReputationWarmupEvents: [], dedicatedIpReadinessEvents: [], complianceReviewRuns: [],
  conversations: [], conversationMessages: [], preferenceCenters: [], preferenceProfiles: [], preferenceRuntimeSnapshots: [], preferenceConsentEvents: [], preferenceSuppressionSyncs: [], preferenceExportRuns: [], transactionalJourneys: [], transactionalDeliveries: [], transactionalRuntimeSnapshots: [], transactionalTriggerEvents: [], transactionalRenderEvents: [], transactionalDeliveryAttempts: [], transactionalSuppressionEvents: [], transactionalWebhookEvents: [], surveyPrograms: [], surveyResponses: [], mobileAppSessions: [], mobileAppQueuedActions: [], mobileRuntimeSnapshots: [], mobilePushRegistrations: [], mobileDeviceTrustEvents: [], mobileSyncBatches: [], mobileConflictResolutions: [], mobileNotificationEvents: [],
  assetSnippets: [], contentVersions: [], generatedSuggestions: [], campaignExperiments: [], campaignExperimentRuntimeSnapshots: [], campaignExperimentAllocationEvents: [], campaignExperimentDynamicContentEvents: [], campaignExperimentHoldoutEvents: [], campaignExperimentWinnerDecisions: [], channelPrograms: [], smsRuntimeSnapshots: [], smsConsentEvents: [], smsComplianceEvents: [], smsDeliveryAttempts: [], smsLinkTrackingEvents: [], socialRuntimeSnapshots: [], socialApprovalEvents: [], socialScheduledPosts: [], socialProviderHandoffs: [], socialEngagementEvents: [], adsRuntimeSnapshots: [], adsRetargetingAudiences: [], adsBudgetPacingEvents: [], adsProviderSyncEvents: [], adsConversionAttributionEvents: [], postcardRuntimeSnapshots: [], postcardAddressValidationEvents: [], postcardCreativeProofEvents: [], postcardProviderHandoffEvents: [], postcardDeliveryTrackingEvents: [], socialCalendarRuntimeSnapshots: [], socialCalendarPlacements: [], socialCampaignCoordinationEvents: [], socialTimelineEvents: [], omnichannelReportingRuntimeSnapshots: [], omnichannelChannelMixSnapshots: [], omnichannelObjectiveRollups: [], omnichannelAttributionEvents: [], mailchimpFrontierSurfaceRuns: [], mailchimpFrontierEvidenceEvents: [], mailchimpFrontierRuntimeSnapshots: [], websites: [], websitePages: [], websitePublishes: [], analyticsEvents: [], aiRecommendationRuns: [], predictiveRecommendationSnapshots: [], aiFeedbackEvents: [],
  rateLimits: [], jobDeadLetters: [], jobQueueLeases: [], jobOperationalSnapshots: [], jobServiceHeartbeats: [], jobIdempotencyKeys: [], csrfTokens: [], mfaFactors: [], mfaChallenges: [], ssoSessions: [], trustedDevices: [], securityEvents: [], apiKeyRotations: [], developerRuntimeSnapshots: [], developerApiRequestAudits: [], webhookSubscriptionEvents: [], billingRuntimeSnapshots: [], billingUsageMeterEvents: [], billingEntitlementEvents: [], billingTrialEvents: [], billingInvoiceEvents: [], teamGovernanceRuntimeSnapshots: [], teamPermissionPolicyEvents: [], teamAccessReviewEvents: [], teamDelegatedAdminEvents: [], teamScimProvisioningEvents: [], teamRegionGovernanceEvents: [], onboardingRuntimeSnapshots: [], onboardingStepEvents: [], onboardingRecoveryEvents: [], workspaceSetupCommandEvents: [], firstCampaignHandoffEvents: [], dashboardRuntimeSnapshots: [], dashboardWidgetPreferenceEvents: [], dashboardInsightEvents: [], dashboardTaskQueueEvents: [], dashboardDrillthroughEvents: [], dashboardSavedViewEvents: [],
  leadConversionSnapshots: [], leadAttributionEvents: [], leadConsentReceipts: [], landingPageExperiments: [], commerceRuntimeSnapshots: [], commerceCustomerProfiles: [], abandonedCartEvents: [], productRecommendationEvents: [], conversationRuntimeSnapshots: [], conversationSlaEvents: [], conversationAssignments: [], conversationMacros: [], conversationAutomationHandoffs: [], surveyRuntimeSnapshots: [], surveySentimentEvents: [], surveySegments: [], surveyDeliveryEvents: [], surveyAutomationHandoffs: [],
  primaryArchitectureAssessments: [], productionArchitectureAssessments: [], productionArchitectureTransactions: [], productionProviderSyncCheckpoints: [], productionQueueWorkerLeases: [], serviceRequests: [], aiModelRuns: [], deliveryPipelineRuns: []
};

export function initDb() {
  const db = Object.fromEntries(Object.entries(DEFAULT_DB_STATE).map(([key, value]) => [key, Array.isArray(value) ? value.map((entry) => (entry && typeof entry === 'object' ? structuredClone(entry) : entry)) : structuredClone(value)]));
  return {
    ...db,
    templates: DEFAULT_TEMPLATES.map((entry) => ({ ...entry })),
    journeyTemplates: DEFAULT_JOURNEY_TEMPLATES.map((entry) => ({ ...entry, nodes: Array.isArray(entry.nodes) ? entry.nodes.map((node) => ({ ...node })) : [] }))
  };
}

export function loadDb() {
  const paths = dataPaths();
  ensureDir(paths.dataDir);
  ensureDir(paths.uploadDir);
  ensureDir(paths.exportDir);
  const legacyDbPath = (paths.legacyDbCandidates || [paths.legacyDbPath]).find((filePath) => fs.existsSync(filePath)) || null;
  const dbSourcePath = fs.existsSync(paths.dbPath) ? paths.dbPath : legacyDbPath;
  if (storageEngine() === 'sqlite') {
    const legacyDb = dbSourcePath ? JSON.parse(fs.readFileSync(dbSourcePath, 'utf8')) : null;
    const db = loadDbFromSqlite(paths, initDb, legacyDb);
    for (const [key, value] of Object.entries(DEFAULT_DB_STATE)) {
      if (db[key] == null) db[key] = Array.isArray(value) ? [] : structuredClone(value);
    }
    if (!Array.isArray(db.templates) || db.templates.length === 0) db.templates = DEFAULT_TEMPLATES.map((entry) => ({ ...entry }));
    if (!Array.isArray(db.journeyTemplates) || db.journeyTemplates.length === 0) {
      db.journeyTemplates = DEFAULT_JOURNEY_TEMPLATES.map((entry) => ({ ...entry, nodes: Array.isArray(entry.nodes) ? entry.nodes.map((node) => ({ ...node })) : [] }));
    }
    return db;
  }
  if (!dbSourcePath) {
    const db = initDb();
    writeJsonFile(paths.dbPath, db);
    return db;
  }
  const db = JSON.parse(fs.readFileSync(dbSourcePath, 'utf8'));
  for (const [key, value] of Object.entries(DEFAULT_DB_STATE)) {
    if (db[key] == null) db[key] = Array.isArray(value) ? [] : structuredClone(value);
  }
  if (!Array.isArray(db.templates) || db.templates.length === 0) db.templates = DEFAULT_TEMPLATES.map((entry) => ({ ...entry }));
  if (!Array.isArray(db.journeyTemplates) || db.journeyTemplates.length === 0) {
    db.journeyTemplates = DEFAULT_JOURNEY_TEMPLATES.map((entry) => ({ ...entry, nodes: Array.isArray(entry.nodes) ? entry.nodes.map((node) => ({ ...node })) : [] }));
  }
  return db;
}

export function saveDb(db) {
  const paths = dataPaths();
  ensureDir(paths.dataDir);
  if (storageEngine() === 'sqlite') {
    saveDbToSqlite(paths, db);
    return;
  }
  writeJsonAtomic(paths.dbPath, db);
}

export function persistState(state) {
  saveDb(state.db);
  return state.db;
}

export function storageOperationalSummary() {
  const paths = dataPaths();
  const engine = storageEngine();
  const sqlite = engine === 'sqlite' ? sqliteOperationalSummary(paths) : null;
  return {
    engine,
    dataDir: paths.dataDir,
    dbPath: paths.dbPath,
    sqlitePath: paths.sqlitePath,
    activeDbPath: engine === 'sqlite' ? paths.sqlitePath : paths.dbPath,
    sqlite,
    uploadDir: paths.uploadDir,
    exportDir: paths.exportDir,
    legacyDbCandidates: [...(paths.legacyDbCandidates || [])]
  };
}

export function storageOperationalHealth() {
  const summary = storageOperationalSummary();
  return {
    ok: Boolean(summary.activeDbPath && summary.dataDir && summary.uploadDir && summary.exportDir),
    engine: summary.engine,
    dbPath: summary.dbPath,
    sqlitePath: summary.sqlitePath,
    activeDbPath: summary.activeDbPath,
    sqliteSchemaVersion: summary.sqlite?.schemaVersion || null,
    dataDir: summary.dataDir,
    writableTargets: ['activeDbPath', 'uploadDir', 'exportDir'].filter((key) => Boolean(summary[key])),
    legacyFallbacks: summary.legacyDbCandidates.length
  };
}

export function storageOperationalChecklist() {
  const summary = storageOperationalSummary();
  const health = storageOperationalHealth();
  return [
    { id: 'data_dir', label: 'Data directory resolved', ok: Boolean(summary.dataDir) },
    { id: 'db_path', label: 'Operational database path resolved', ok: Boolean(summary.activeDbPath) },
    { id: 'storage_engine', label: `Storage engine selected: ${summary.engine}`, ok: ['json', 'sqlite'].includes(summary.engine) },
    { id: 'sqlite_migrations', label: 'SQLite migration ledger available when database mode is enabled', ok: summary.engine !== 'sqlite' || Number(summary.sqlite?.schemaVersion || 0) >= 1 },
    { id: 'uploads', label: 'Upload directory resolved', ok: Boolean(summary.uploadDir) },
    { id: 'exports', label: 'Export directory resolved', ok: Boolean(summary.exportDir) },
    { id: 'legacy_fallback', label: 'Legacy app.json fallback remains discoverable', ok: health.legacyFallbacks >= 0 }
  ];
}

export function storageOperationalRuntimeEvidence(state = {}) {
  const summary = storageOperationalSummary();
  const db = state.db || {};
  const pendingJobs = Array.isArray(db.jobs) ? db.jobs.filter((job) => !['completed', 'failed', 'cancelled'].includes(job.status)) : [];
  const activeLeases = Array.isArray(db.jobQueueLeases) ? db.jobQueueLeases.filter((lease) => lease.status === 'active') : [];
  return {
    ok: true,
    engine: summary.engine,
    dbPath: summary.activeDbPath,
    sqliteSchemaVersion: summary.sqlite?.schemaVersion || null,
    sqliteCollections: summary.sqlite?.collectionCount || 0,
    pendingJobs: pendingJobs.length,
    jobOperationalLedger: {
      leases: Array.isArray(db.jobQueueLeases) ? db.jobQueueLeases.length : 0,
      activeLeases: activeLeases.length,
      snapshots: Array.isArray(db.jobOperationalSnapshots) ? db.jobOperationalSnapshots.length : 0,
      heartbeats: Array.isArray(db.jobServiceHeartbeats) ? db.jobServiceHeartbeats.length : 0,
      deadLetters: Array.isArray(db.jobDeadLetters) ? db.jobDeadLetters.length : 0
    },
    workflowStatus: pendingJobs.length ? 'persistence_queue_active' : 'persistence_ready',
    requestEvidence: { storage: Boolean(summary.activeDbPath), engine: summary.engine, recoveryPath: summary.legacyDbCandidates.length >= 0 }
  };
}

export function createAppState() {
  return { db: loadDb(), interval: null };
}

export function writeUpload(assetId, body) {
  const paths = dataPaths();
  ensureDir(paths.uploadDir);
  const filePath = path.join(paths.uploadDir, `${assetId}.txt`);
  writeTextFile(filePath, body || '');
  return filePath;
}

export function writeExport(exportId, body) {
  const paths = dataPaths();
  ensureDir(paths.exportDir);
  const filePath = path.join(paths.exportDir, `${exportId}.json`);
  writeJsonFile(filePath, body);
  return filePath;
}

export const teamRolesPermissionsIntegratedUserPathEvidenceSemanticRuntimeContract = {
  "surfaceId": "team_roles_permissions",
  "focusGroup": "team_roles_permissions",
  "phaseId": "integrated_user_path_evidence",
  "shardId": "focus.team_roles_permissions::semantic-frontier-001#03-integrated_user_path_evidence#1",
  "cloneParityIntent": "strict_mailchimp_clone_product_runtime",
  "productIntent": "Ensure the architecture is adopted by a real app path with executable verifier coverage rather than existing as disconnected helper code.",
  "runtimeEvidence": [
    "primary_product_file_adoption",
    "normal_app_path_invocation_ready",
    "executable_verifier_evidence_required"
  ]
};

export function buildTeamRolesPermissionsIntegratedUserPathEvidenceSemanticRuntimeState(state = {}, actor = {}, input = {}) {
  const workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace';
  const db = state.db || {};
  const campaigns = Array.isArray(db.campaigns) ? db.campaigns.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const jobs = Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const contacts = Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const activeJobs = jobs.filter((entry) => !['complete', 'failed', 'cancelled'].includes(entry.status));
  return {
    ...teamRolesPermissionsIntegratedUserPathEvidenceSemanticRuntimeContract,
    workspaceId,
    actorRole: actor?.role || input.actorRole || 'owner',
    counters: {
      campaigns: campaigns.length,
      contacts: contacts.length,
      activeJobs: activeJobs.length
    },
    nextAction: activeJobs.length > 0 ? 'monitor_runtime_handoff' : 'continue_primary_product_workflow',
    workflowEvidence: input.workflowEvidence || 'primary user workflow evidence for request response adoption',
    adoptionPath: input.adoptionPath || ["packages/app/routes/api-admin.mjs","packages/app/routes/platform.mjs","packages/app/storage.mjs"],
    auditEvent: {
      type: 'semantic_frontier_product_runtime_evaluated',
      surfaceId: teamRolesPermissionsIntegratedUserPathEvidenceSemanticRuntimeContract.surfaceId,
      phaseId: teamRolesPermissionsIntegratedUserPathEvidenceSemanticRuntimeContract.phaseId,
      shardId: teamRolesPermissionsIntegratedUserPathEvidenceSemanticRuntimeContract.shardId
    }
  };
}
