import fs from 'node:fs';
import path from 'node:path';
import { createId, nowIso } from './utils.mjs';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);

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
  const dataDir = process.env.MAILCLONE_DATA_DIR || path.join(ROOT, 'data');
  return { dataDir, dbPath: path.join(dataDir, 'app.json'), uploadDir: path.join(dataDir, 'uploads'), exportDir: path.join(dataDir, 'exports') };
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

export function initDb() {
  return {
    users: [], memberships: [], workspaces: [], invitations: [], sessions: [], auditEvents: [], events: [], notifications: [], jobs: [], assets: [], audiences: [], contacts: [], segments: [], campaigns: [], templates: DEFAULT_TEMPLATES,
    passwordResets: [], importPreviews: [], automations: [], automationRuns: [], journeyTemplates: DEFAULT_JOURNEY_TEMPLATES, forms: [], landingPages: [], apiKeys: [], webhooks: [], webhookDeliveries: [], exports: [],
    integrationInstallations: [], integrationSyncRuns: [], commerceStores: [], commerceProducts: [], commerceOrders: [], revenueAttributions: [], approvalRequests: [], approvalComments: [], brandKits: [], contentTemplates: [], templateCollections: [], suppressionEntries: [], complianceAlerts: [],
    conversations: [], conversationMessages: [], preferenceCenters: [], preferenceProfiles: [], transactionalJourneys: [], transactionalDeliveries: [], surveyPrograms: [], surveyResponses: []
  };
}

export function loadDb() {
  const paths = dataPaths();
  ensureDir(paths.dataDir);
  ensureDir(paths.uploadDir);
  ensureDir(paths.exportDir);
  if (!fs.existsSync(paths.dbPath)) {
    const db = initDb();
    fs.writeFileSync(paths.dbPath, JSON.stringify(db, null, 2));
    return db;
  }
  const db = JSON.parse(fs.readFileSync(paths.dbPath, 'utf8'));
  db.automationRuns ||= [];
  return db;
}

export function saveDb(db) {
  const paths = dataPaths();
  ensureDir(paths.dataDir);
  fs.writeFileSync(paths.dbPath, JSON.stringify(db, null, 2));
}

export function createAppState() {
  return { db: loadDb(), interval: null };
}

export function writeUpload(assetId, body) {
  const paths = dataPaths();
  ensureDir(paths.uploadDir);
  const filePath = path.join(paths.uploadDir, `${assetId}.txt`);
  fs.writeFileSync(filePath, body || '', 'utf8');
  return filePath;
}

export function writeExport(exportId, body) {
  const paths = dataPaths();
  ensureDir(paths.exportDir);
  const filePath = path.join(paths.exportDir, `${exportId}.json`);
  fs.writeFileSync(filePath, JSON.stringify(body, null, 2));
  return filePath;
}
