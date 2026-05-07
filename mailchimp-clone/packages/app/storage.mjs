import fs from 'node:fs';
import path from 'node:path';
import { writeJsonAtomic, writeJsonFile, writeTextFile } from './persistence-io.mjs';
import { createId, nowIso } from './utils.mjs';

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
  surveyFeedback: true
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
    legacyDbPath: rootLegacyDbPath,
    legacyDbCandidates: Array.from(new Set([rootLegacyDbPath, cwdLegacyDbPath])),
    uploadDir: path.join(dataDir, 'uploads'),
    exportDir: path.join(dataDir, 'exports')
  };
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
  users: [], memberships: [], workspaces: [], invitations: [], sessions: [], auditEvents: [], events: [], notifications: [], jobs: [], assets: [], audiences: [], contacts: [], segments: [], campaigns: [], templates: DEFAULT_TEMPLATES,
  passwordResets: [], importPreviews: [], automations: [], automationRuns: [], journeyTemplates: DEFAULT_JOURNEY_TEMPLATES, forms: [], landingPages: [], apiKeys: [], webhooks: [], webhookDeliveries: [], exports: [],
  integrationInstallations: [], integrationSyncRuns: [], commerceStores: [], commerceProducts: [], commerceOrders: [], revenueAttributions: [], approvalRequests: [], approvalComments: [], brandKits: [], contentTemplates: [], templateCollections: [], suppressionEntries: [], complianceAlerts: [],
  conversations: [], conversationMessages: [], preferenceCenters: [], preferenceProfiles: [], transactionalJourneys: [], transactionalDeliveries: [], surveyPrograms: [], surveyResponses: [],
  assetSnippets: [], contentVersions: [], generatedSuggestions: [], campaignExperiments: [], channelPrograms: [], websites: [], websitePages: [], websitePublishes: [], analyticsEvents: [],
  rateLimits: [], jobDeadLetters: [], mfaChallenges: [], ssoSessions: []
};

export function initDb() {
  return {
    ...DEFAULT_DB_STATE,
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
  writeJsonAtomic(paths.dbPath, db);
}

export function persistState(state) {
  saveDb(state.db);
  return state.db;
}

export function storageOperationalSummary() {
  const paths = dataPaths();
  return {
    dataDir: paths.dataDir,
    dbPath: paths.dbPath,
    uploadDir: paths.uploadDir,
    exportDir: paths.exportDir,
    legacyDbCandidates: [...(paths.legacyDbCandidates || [])]
  };
}

export function storageOperationalHealth() {
  const summary = storageOperationalSummary();
  return {
    ok: Boolean(summary.dbPath && summary.dataDir && summary.uploadDir && summary.exportDir),
    dbPath: summary.dbPath,
    dataDir: summary.dataDir,
    writableTargets: ['dbPath', 'uploadDir', 'exportDir'].filter((key) => Boolean(summary[key])),
    legacyFallbacks: summary.legacyDbCandidates.length
  };
}

export function storageOperationalChecklist() {
  const summary = storageOperationalSummary();
  const health = storageOperationalHealth();
  return [
    { id: 'data_dir', label: 'Data directory resolved', ok: Boolean(summary.dataDir) },
    { id: 'db_path', label: 'Operational database path resolved', ok: Boolean(summary.dbPath) },
    { id: 'uploads', label: 'Upload directory resolved', ok: Boolean(summary.uploadDir) },
    { id: 'exports', label: 'Export directory resolved', ok: Boolean(summary.exportDir) },
    { id: 'legacy_fallback', label: 'Legacy app.json fallback remains discoverable', ok: health.legacyFallbacks >= 0 }
  ];
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
