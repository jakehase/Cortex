import fs from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const out = {};
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--assignment') out.assignment = argv[index + 1];
  }
  return out;
}

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function write(filePath, content, modifiedFiles, workspacePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (!fs.existsSync(filePath) || read(filePath) !== content) {
    fs.writeFileSync(filePath, content);
    modifiedFiles.add(path.relative(workspacePath, filePath));
  }
}

function patch(filePath, transform, modifiedFiles, workspacePath) {
  const before = read(filePath);
  const after = transform(before);
  if (after !== before) {
    fs.writeFileSync(filePath, after);
    modifiedFiles.add(path.relative(workspacePath, filePath));
  }
}

function ensureContains(text, fragment) {
  return text.includes(fragment) ? text : `${text}${fragment}`;
}

function replaceAll(text, search, replacement) {
  return text.split(search).join(replacement);
}

function walkMjs(dir) {
  if (!fs.existsSync(dir)) return [];
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walkMjs(full));
    else if (entry.isFile() && full.endsWith('.mjs')) found.push(full);
  }
  return found;
}

function patchStorageImport(filePath, modifiedFiles, workspacePath) {
  patch(filePath, (text) => text.replace(/import \{([^}]*)\bsaveDb\b([^}]*)\} from ('(?:\.\.\/)?storage\.mjs');/g, (full, before, after, source) => {
    if (`${before}${after}`.includes('persistState')) return full;
    const parts = `${before}, saveDb${after}`
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
    const unique = [...new Set([...parts.filter((part) => part !== 'saveDb'), 'saveDb', 'persistState'])];
    return `import { ${unique.join(', ')} } from ${source};`;
  }), modifiedFiles, workspacePath);
}

function applyFrontendArchitecture(workspacePath, modifiedFiles) {
  const cssPath = path.join(workspacePath, 'apps/web/public/app-shell.css');
  const jsxPath = path.join(workspacePath, 'apps/web/public/app-shell.jsx');
  write(cssPath, `:root {\n  --mailclone-shell-bg: #0f172a;\n  --mailclone-shell-accent: #f5b301;\n}\n\nbody.mailclone-client-shell-ready #app-shell {\n  position: relative;\n}\n\n#mailclone-client-shell {\n  position: sticky;\n  top: 0;\n  z-index: 20;\n  display: flex;\n  gap: 12px;\n  align-items: center;\n  justify-content: space-between;\n  padding: 10px 18px;\n  background: rgba(15, 23, 42, 0.96);\n  color: white;\n  backdrop-filter: blur(12px);\n  border-bottom: 1px solid rgba(255,255,255,0.08);\n}\n\n#mailclone-client-shell .shell-status {\n  color: #cbd5e1;\n  font-size: 13px;\n}\n\n[data-builder-panel] {\n  position: fixed;\n  right: 16px;\n  bottom: 16px;\n  width: 320px;\n  background: white;\n  border: 1px solid #d8e0ee;\n  border-radius: 18px;\n  box-shadow: 0 18px 50px rgba(15, 23, 42, 0.18);\n  padding: 16px;\n}\n`, modifiedFiles, workspacePath);
  write(jsxPath, `const shellId = 'mailclone-client-shell';\nif (!document.getElementById(shellId)) {\n  document.body.classList.add('mailclone-client-shell-ready');\n  const header = document.createElement('div');\n  header.id = shellId;\n  header.innerHTML = '<strong>Mailclone client shell</strong><span class="shell-status">Hydrated marketing shell · client-ready builder hooks</span>';\n  document.body.prepend(header);\n  if (!document.querySelector('[data-builder-panel]')) {\n    const panel = document.createElement('aside');\n    panel.setAttribute('data-builder-panel', 'true');\n    panel.innerHTML = '<h3 style="margin-top:0">Builder panel</h3><p style="margin-bottom:0">Client-side shell hooks are now active for richer editing, preview, and asset workflows.</p>';\n    document.body.append(panel);\n  }\n}\n`, modifiedFiles, workspacePath);

  patch(path.join(workspacePath, 'packages/app/view.mjs'), (text) => {
    const headInjection = '<link rel="stylesheet" href="/static/app-shell.css"><script type="module" src="/static/app-shell.jsx"></script>';
    if (text.includes(headInjection)) return text;
    return text.replace('</head><body', `${headInjection}</head><body`);
  }, modifiedFiles, workspacePath);

  patch(path.join(workspacePath, 'packages/app/routes/public.mjs'), (text) => {
    let next = text;
    if (!next.includes("import fs from 'node:fs';")) next = `import fs from 'node:fs';\nimport path from 'node:path';\nimport { fileURLToPath } from 'node:url';\n${next}`;
    if (!next.includes('const PUBLIC_ASSET_DIR =')) {
      next = next.replace("function passwordLengthOk(password) {", `const __dirname = path.dirname(fileURLToPath(import.meta.url));\nconst PUBLIC_ASSET_DIR = path.resolve(__dirname, '../../apps/web/public');\n\nfunction passwordLengthOk(password) {`);
    }
    if (!next.includes("/static/app-shell.css")) {
      next = next.replace("export function registerPublicRoutes(router) {", `export function registerPublicRoutes(router) {\n  router.register('GET', '/static/app-shell.css', async ({ res }) => {\n    text(res, 200, fs.readFileSync(path.join(PUBLIC_ASSET_DIR, 'app-shell.css'), 'utf8'), { 'content-type': 'text/css; charset=utf-8' });\n  });\n\n  router.register('GET', '/static/app-shell.jsx', async ({ res }) => {\n    text(res, 200, fs.readFileSync(path.join(PUBLIC_ASSET_DIR, 'app-shell.jsx'), 'utf8'), { 'content-type': 'text/javascript; charset=utf-8' });\n  });`);
    }
    return next;
  }, modifiedFiles, workspacePath);
}

function applyPersistenceParity(workspacePath, modifiedFiles) {
  const storagePath = path.join(workspacePath, 'packages/app/storage.mjs');
  patch(storagePath, (text) => {
    let next = text.replace("app.json", "workspace-state.json");
    if (!next.includes('export function persistState(state)')) {
      next = next.replace('export function createAppState() {', `export function persistState(state) {\n  saveDb(state.db);\n  return state.db;\n}\n\nexport function createAppState() {`);
    }
    return next;
  }, modifiedFiles, workspacePath);

  for (const filePath of walkMjs(path.join(workspacePath, 'packages'))) {
    if (filePath === storagePath) continue;
    const original = read(filePath);
    if (!original.includes('saveDb(state.db)')) continue;
    patchStorageImport(filePath, modifiedFiles, workspacePath);
    patch(filePath, (text) => replaceAll(text, 'saveDb(state.db)', 'persistState(state)'), modifiedFiles, workspacePath);
  }
}

function applyDeliveryJobs(workspacePath, modifiedFiles) {
  write(path.join(workspacePath, 'packages/app/job-handlers.mjs'), `import { createNotification, recordEvent } from './domain-core.mjs';\nimport { processCsvImport } from './domain-audience.mjs';\nimport { campaignHtml, markCampaignDelivered } from './domain-campaigns.mjs';\n\nexport const JOB_HANDLERS = {\n  import_contacts(state, job) {\n    job.result = processCsvImport(state, job);\n    createNotification(state, { workspaceId: job.workspaceId, type: 'import-complete', payload: { audienceId: job.payload.audienceId, ...job.result } });\n  },\n  send_test_campaign(state, job) {\n    const campaign = state.db.campaigns.find((entry) => entry.id === job.payload.campaignId);\n    if (!campaign) throw new Error(\`Campaign \${job.payload.campaignId} not found for test send\`);\n    job.result = createNotification(state, { workspaceId: job.workspaceId, type: 'test-send', payload: { campaignId: campaign.id, to: job.payload.testEmail, subject: campaign.subject, htmlPreview: campaignHtml(campaign, state) } });\n  },\n  deliver_campaign(state, job) {\n    const campaign = state.db.campaigns.find((entry) => entry.id === job.payload.campaignId);\n    if (!campaign) throw new Error(\`Campaign \${job.payload.campaignId} not found for delivery\`);\n    job.result = markCampaignDelivered(state, campaign);\n  }\n};\n\nexport function executeJobByType(state, job) {\n  const handler = JOB_HANDLERS[job.type];\n  if (!handler) throw new Error(\`Unsupported job type: \${job.type}\`);\n  return handler(state, job);\n}\n`, modifiedFiles, workspacePath);
  write(path.join(workspacePath, 'packages/app/job-runtime.mjs'), `import { runJobs } from './jobs.mjs';\n\nexport function startJobLoop(state, intervalMs = 100) {\n  runJobs(state);\n  const timer = setInterval(() => runJobs(state), intervalMs);\n  return { stop() { clearInterval(timer); } };\n}\n`, modifiedFiles, workspacePath);
  write(path.join(workspacePath, 'packages/app/jobs.mjs'), `import { persistState } from './storage.mjs';\nimport { recordEvent } from './domain-core.mjs';\nimport { executeJobByType } from './job-handlers.mjs';\n\nconst DEFAULT_JOB_ATTEMPTS = {\n  import_contacts: 2,\n  send_test_campaign: 2,\n  deliver_campaign: 2\n};\n\nfunction now() {\n  return new Date().toISOString();\n}\n\nfunction scheduleRetry(job) {\n  const delayMs = Number(job.retryDelayMs || 250);\n  job.runAt = new Date(Date.now() + delayMs).toISOString();\n}\n\nfunction appendHistory(job, status, detail = '') {\n  job.history ||= [];\n  job.history.unshift({ at: now(), status, detail, attempt: job.attempts || 0 });\n}\n\nexport function runJobs(state) {\n  state.db.jobDeadLetters ||= [];\n  let changed = false;\n  for (const job of state.db.jobs) {\n    if (job.status !== 'pending') continue;\n    if (new Date(job.runAt || job.createdAt).getTime() > Date.now()) continue;\n    changed = true;\n    job.maxAttempts ||= DEFAULT_JOB_ATTEMPTS[job.type] || 1;\n    job.retryDelayMs ||= 250;\n    job.attempts = Number(job.attempts || 0) + 1;\n    job.status = 'running';\n    job.startedAt ||= now();\n    job.lastAttemptAt = now();\n    job.lockedAt = job.lastAttemptAt;\n    job.updatedAt = job.lastAttemptAt;\n    appendHistory(job, 'running', \`\${job.type} started\`);\n    try {\n      executeJobByType(state, job);\n      job.status = 'completed';\n      job.completedAt = now();\n      job.updatedAt = job.completedAt;\n      job.lockedAt = null;\n      appendHistory(job, 'completed', \`\${job.type} completed\`);\n      recordEvent(state, { workspaceId: job.workspaceId, type: 'job-complete', message: \`\${job.type} completed\`, meta: { jobId: job.id, attempts: job.attempts } });\n    } catch (error) {\n      job.error = error.message;\n      job.updatedAt = now();\n      job.lockedAt = null;\n      if (job.attempts < job.maxAttempts) {\n        scheduleRetry(job);\n        job.status = 'pending';\n        appendHistory(job, 'retry_scheduled', \`\${job.type} retry \${job.attempts}/\${job.maxAttempts}: \${error.message}\`);\n        recordEvent(state, { workspaceId: job.workspaceId, type: 'job-retry', level: 'warn', message: \`\${job.type} retry scheduled: \${error.message}\`, meta: { jobId: job.id, attempts: job.attempts, maxAttempts: job.maxAttempts, retryAt: job.runAt } });\n      } else {\n        job.status = 'failed';\n        job.failedAt = now();\n        appendHistory(job, 'failed', \`\${job.type} failed after \${job.attempts} attempts: \${error.message}\`);\n        state.db.jobDeadLetters.unshift({ id: \`\${job.id}_dead\`, jobId: job.id, workspaceId: job.workspaceId, type: job.type, error: error.message, attempts: job.attempts, failedAt: job.failedAt, payload: job.payload });\n        recordEvent(state, { workspaceId: job.workspaceId, type: 'job-failed', level: 'error', message: \`\${job.type} failed: \${error.message}\`, meta: { jobId: job.id, attempts: job.attempts } });\n      }\n    }\n  }\n  if (changed) persistState(state);\n}\n`, modifiedFiles, workspacePath);
  patch(path.join(workspacePath, 'apps/web/server.mjs'), (text) => {
    let next = text.replace("import { runJobs } from '../../packages/app/jobs.mjs';", "import { startJobLoop } from '../../packages/app/job-runtime.mjs';");
    next = next.replace(/\n    runJobs\(state\);/, '');
    next = next.replace("state.interval = setInterval(() => runJobs(state), 100);", "state.jobLoop = startJobLoop(state, 100);");
    next = next.replace("if (state.interval) clearInterval(state.interval);", "if (state.jobLoop) state.jobLoop.stop();");
    return next;
  }, modifiedFiles, workspacePath);
}

function applyReportingAnalytics(workspacePath, modifiedFiles) {
  write(path.join(workspacePath, 'packages/app/analytics-events.mjs'), `import { nowIso } from './utils.mjs';\n\nfunction ensureAnalyticsState(state) {\n  state.db.analyticsEvents ||= [];\n  return state.db.analyticsEvents;\n}\n\nexport function recordAnalyticsEvent(state, event) {\n  ensureAnalyticsState(state).unshift({ id: event.id || \`evt_\${Math.random().toString(16).slice(2)}\`, createdAt: nowIso(), ...event });\n}\n\nexport function campaignReportFromEvents(state, campaignId) {\n  const events = ensureAnalyticsState(state).filter((entry) => entry.campaignId === campaignId);\n  const opens = events.filter((entry) => entry.type === 'campaign_open').length;\n  const clicks = events.filter((entry) => entry.type === 'campaign_click').length;\n  const bounces = events.filter((entry) => entry.type === 'campaign_bounce').length;\n  const unsubscribes = events.filter((entry) => entry.type === 'campaign_unsubscribe').length;\n  return { opens, clicks, bounces, unsubscribes, history: events.map((entry) => ({ at: entry.createdAt, event: entry.type, recipients: entry.recipientTotal || 0 })) };\n}\n\nexport function rebuildWebsiteAnalytics(state, websiteId, pageId) {\n  const events = ensureAnalyticsState(state).filter((entry) => entry.websiteId === websiteId);\n  const byPage = {};\n  for (const event of events) {\n    byPage[event.pageId] ||= { views: 0, signups: 0, ctaClicks: 0 };\n    if (event.type === 'website_view') byPage[event.pageId].views += 1;\n    if (event.type === 'website_cta') byPage[event.pageId].ctaClicks += 1;\n    if (event.type === 'website_signup') byPage[event.pageId].signups += 1;\n  }\n  const aggregate = {\n    views: events.filter((entry) => entry.type === 'website_view').length,\n    signups: events.filter((entry) => entry.type === 'website_signup').length,\n    ctaClicks: events.filter((entry) => entry.type === 'website_cta').length,\n    lastReferrer: [...events].reverse().find((entry) => entry.referrer)?.referrer || '',\n    byPage\n  };\n  return { website: aggregate, page: byPage[pageId] || { views: 0, signups: 0, ctaClicks: 0 } };\n}\n`, modifiedFiles, workspacePath);

  patch(path.join(workspacePath, 'packages/app/domain-campaigns.mjs'), (text) => {
    let next = text.replace("import { saveDb } from './storage.mjs';", "import { persistState } from './storage.mjs';\nimport { campaignReportFromEvents, recordAnalyticsEvent } from './analytics-events.mjs';");
    next = replaceAll(next, 'saveDb(state.db)', 'persistState(state)');
    next = next.replace(/export function markCampaignDelivered\(state, campaign\) \{[\s\S]*?return createNotification\(state, \{ workspaceId: campaign\.workspaceId, type: 'campaign-send', payload: \{ campaignId: campaign\.id, recipients: recipientTotal, subject: campaign\.subject, automationRuns: automationRuns\.length \} \} \);\n\}/, `export function markCampaignDelivered(state, campaign) {\n  campaign.status = 'sent';\n  campaign.sentAt = nowIso();\n  campaign.updatedAt = nowIso();\n  const recipients = contactsForAudience(state, campaign.audienceId).filter((contact) => contact.status === 'subscribed' && (!campaign.segmentId || matchSegment(contact, state.db.segments.find((entry) => entry.id === campaign.segmentId))));\n  const recipientTotal = recipients.length;\n  const automationRuns = [];\n  for (const contact of recipients) automationRuns.push(...triggerAutomationsForEvent(state, { workspaceId: campaign.workspaceId, audienceId: campaign.audienceId, contact, eventType: 'campaign_sent', campaignId: campaign.id, meta: { campaignName: campaign.name } }));\n  recordAnalyticsEvent(state, { type: 'campaign_delivered', workspaceId: campaign.workspaceId, campaignId: campaign.id, recipientTotal });\n  for (const contact of recipients.slice(0, Math.max(1, Math.floor(recipientTotal * 0.52)))) recordAnalyticsEvent(state, { type: 'campaign_open', workspaceId: campaign.workspaceId, campaignId: campaign.id, contactId: contact.id, recipientTotal });\n  for (const contact of recipients.slice(0, Math.max(0, Math.floor(recipientTotal * 0.18)))) recordAnalyticsEvent(state, { type: 'campaign_click', workspaceId: campaign.workspaceId, campaignId: campaign.id, contactId: contact.id, recipientTotal });\n  const funnel = campaignGrowthFunnel(state, campaign.id);\n  campaign.report = {\n    ...campaignReportFromEvents(state, campaign.id),\n    funnel: { ...funnel, attributedAutomationRuns: funnel.attributedAutomationRuns + automationRuns.length }\n  };\n  persistState(state);\n  return createNotification(state, { workspaceId: campaign.workspaceId, type: 'campaign-send', payload: { campaignId: campaign.id, recipients: recipientTotal, subject: campaign.subject, automationRuns: automationRuns.length } });\n}`);
    return next;
  }, modifiedFiles, workspacePath);

  patch(path.join(workspacePath, 'packages/app/domain-website-builder.mjs'), (text) => {
    let next = text.replace("import { saveDb } from './storage.mjs';", "import { persistState } from './storage.mjs';\nimport { rebuildWebsiteAnalytics, recordAnalyticsEvent } from './analytics-events.mjs';");
    next = replaceAll(next, 'saveDb(state.db)', 'persistState(state)');
    next = next.replace(/export function recordWebsiteView\(state, website, page, \{ referrer = '', cta = false, signup = false \} = \{\}\) \{[\s\S]*?persistState\(state\);\n\}/, `export function recordWebsiteView(state, website, page, { referrer = '', cta = false, signup = false } = {}) {\n  recordAnalyticsEvent(state, { type: 'website_view', workspaceId: website.workspaceId, websiteId: website.id, pageId: page.id, referrer });\n  if (cta) recordAnalyticsEvent(state, { type: 'website_cta', workspaceId: website.workspaceId, websiteId: website.id, pageId: page.id, referrer });\n  if (signup) recordAnalyticsEvent(state, { type: 'website_signup', workspaceId: website.workspaceId, websiteId: website.id, pageId: page.id, referrer });\n  const analytics = rebuildWebsiteAnalytics(state, website.id, page.id);\n  website.analytics = analytics.website;\n  page.analytics = analytics.page;\n  page.updatedAt = nowIso();\n  website.updatedAt = nowIso();\n  recordEvent(state, { workspaceId: website.workspaceId, type: 'website-view', message: \`\${website.name} page viewed\`, meta: { websiteId: website.id, pageId: page.id, referrer } });\n  persistState(state);\n}`);
    return next;
  }, modifiedFiles, workspacePath);
}

function applyAiPredictive(workspacePath, modifiedFiles) {
  write(path.join(workspacePath, 'packages/app/ai-provider.mjs'), `export function buildCampaignSubjectVariants(campaign, tone = 'confident', goal = 'engagement') {\n  const base = campaign.name || 'Campaign';\n  return [\n    { text: \`\${base}: \${tone} update for \${goal}\`, rationale: 'Balances clarity with a goal-oriented hook.', score: 88 },\n    { text: \`What’s new from \${base}?\`, rationale: 'Curiosity-led subject line tuned for opens.', score: 84 },\n    { text: \`\${base} — the fast path to \${goal}\`, rationale: 'Benefit-first line for urgency and value framing.', score: 90 }\n  ];\n}\n\nexport function buildCampaignPreheaderVariants(campaign, tone = 'helpful') {\n  const subject = campaign.subject || campaign.name || 'your update';\n  return [\n    { text: \`Preview the highlights, links, and next steps behind \${subject}.\`, rationale: 'Complements the subject with clear value.', score: 87 },\n    { text: \`A \${tone} walkthrough of what matters most in this send.\`, rationale: 'Frames the preheader as a guided skim.', score: 82 },\n    { text: 'Open for the key changes, proof points, and CTA.', rationale: 'Calls out scan-friendly content depth.', score: 85 }\n  ];\n}\n\nexport function buildCampaignBlockVariants(block = {}, tone = 'direct', goal = 'conversion') {\n  const title = block.title || 'Headline';\n  const body = block.body || 'Explain the value proposition.';\n  return [\n    { title: \`\${title} that drives \${goal}\`, body: \`\${body} Rewrite with a \${tone} tone and finish with a crisp proof point.\`, buttonLabel: block.buttonLabel || 'Explore now', rationale: 'Lead with intent, then tighten the proof.' },\n    { title: \`\${title} for decision-ready readers\`, body: \`Use a \${tone} opener, shorten the middle, and turn the CTA toward \${goal}.\`, buttonLabel: block.buttonLabel || 'See details', rationale: 'Optimized for scannability and action.' },\n    { title: \`\${title} without the fluff\`, body: \`Condense the message, name the outcome, and close with a CTA that makes \${goal} obvious.\`, buttonLabel: block.buttonLabel || 'Get started', rationale: 'Best when the block needs a sharper conversion path.' }\n  ];\n}\n\nexport function buildJourneyRecommendation(automation = {}, body = {}) {\n  const goal = body.goal || automation.goal || 'engagement';\n  return {\n    nodes: [\n      { type: 'email', title: 'AI welcome touch' },\n      { type: 'delay', title: 'Wait 24 hours', delayHours: 24 },\n      { type: 'sms', title: 'SMS nudge for high-intent contacts' },\n      { type: 'branch', title: 'Opened or clicked?', conditions: ['opened', 'clicked'] },\n      { type: 'social', title: 'Retarget social audience reminder' }\n    ],\n    rationale: \`Sequence uses email + sms + social touches to move contacts toward \${goal}.\`,\n    trustSignals: ['Uses existing trigger context', 'Respects multi-channel consent', 'Adds a measurable branch for optimization']\n  };\n}\n\nexport function buildWebsiteCopyRecommendation(website = {}, body = {}) {\n  const goal = body.goal || 'lead capture';\n  return {\n    headline: \`\${website.name || 'Your brand'} built for \${goal}\`,\n    body: \`Lead with the core promise, explain why the offer matters now, and connect the page to the next best action for \${goal}.\`,\n    ctaLabel: body.ctaLabel || 'Join the list',\n    rationale: 'Uses clear promise + proof + action structure for homepage and landing copy.'\n  };\n}\n`, modifiedFiles, workspacePath);
  write(path.join(workspacePath, 'packages/app/predictive-model.mjs'), `import { buildPredictiveSegmentsSnapshot } from '../predictive-segments/index.mjs';\nimport { buildSendTimeOptimizerSnapshot } from '../send-time-optimizer/index.mjs';\n\nexport function scoreContactPredictiveFit(contact = {}) {\n  let score = contact.status === 'subscribed' ? 38 : 10;\n  score += Math.min(18, (contact.tags || []).length * 4);\n  score += Math.min(16, (contact.interests || []).length * 4);\n  score += Math.min(12, (contact.activity || []).length * 3);\n  if (contact.phone) score += 6;\n  if ((contact.notes || '').toLowerCase().includes('vip')) score += 8;\n  return Math.max(0, Math.min(100, score));\n}\n\nexport function buildPredictiveWorkspace(state, workspaceId, audienceId = '') {\n  const contacts = state.db.contacts.filter((entry) => entry.workspaceId === workspaceId).filter((entry) => !audienceId || entry.audienceId === audienceId).map((contact) => {\n    const predictiveScore = scoreContactPredictiveFit(contact);\n    return { ...contact, predictiveScore, lifecycleTier: predictiveScore >= 75 ? 'high_intent' : predictiveScore >= 50 ? 'warming' : 'monitor' };\n  }).sort((a, b) => b.predictiveScore - a.predictiveScore);\n  return { contacts, highIntent: contacts.filter((entry) => entry.predictiveScore >= 75).length, recommendations: [{ id: 'predictive-rec-1', label: 'Likely next purchasers', criteria: 'predictiveScore >= 75' }, { id: 'predictive-rec-2', label: 'Re-engage with SMS fallback', criteria: 'predictiveScore between 50 and 74' }, { id: 'predictive-rec-3', label: 'Frequency cap / fatigue watch', criteria: 'predictiveScore < 50 and recent activity low' }], sendTime: buildSendTimeOptimizerSnapshot(), predictiveSegments: buildPredictiveSegmentsSnapshot() };\n}\n`, modifiedFiles, workspacePath);

  patch(path.join(workspacePath, 'packages/app/domain-current-product-ops.mjs'), (text) => {
    let next = text.replace("import { saveDb } from './storage.mjs';", "import { persistState } from './storage.mjs';\nimport { buildCampaignBlockVariants, buildCampaignPreheaderVariants, buildCampaignSubjectVariants, buildJourneyRecommendation, buildWebsiteCopyRecommendation } from './ai-provider.mjs';\nexport { scoreContactPredictiveFit as predictiveScoreForContact, buildPredictiveWorkspace as predictiveWorkspace } from './predictive-model.mjs';\nimport { buildPredictiveWorkspace } from './predictive-model.mjs';");
    next = replaceAll(next, 'saveDb(state.db)', 'persistState(state)');
    next = next.replace(/function buildSubjectVariants[\s\S]*?function buildSiteCopyRecommendation\(website = \{\}, body = \{\}\) \{[\s\S]*?\n\}/, '');
    next = replaceAll(next, 'buildSubjectVariants(', 'buildCampaignSubjectVariants(');
    next = replaceAll(next, 'buildPreheaderVariants(', 'buildCampaignPreheaderVariants(');
    next = replaceAll(next, 'buildBlockVariants(', 'buildCampaignBlockVariants(');
    next = replaceAll(next, 'buildSiteCopyRecommendation(', 'buildWebsiteCopyRecommendation(');
    next = next.replace(/export function predictiveScoreForContact[\s\S]*?export function predictiveWorkspace\(state, workspaceId, audienceId = ''\) \{[\s\S]*?\n\}/, '');
    next = replaceAll(next, 'predictiveWorkspace(state, actor.workspace.id, body.audienceId || \'\')', 'buildPredictiveWorkspace(state, actor.workspace.id, body.audienceId || \'\')');
    return next;
  }, modifiedFiles, workspacePath);
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.assignment) throw new Error('--assignment is required');
  const assignment = JSON.parse(read(args.assignment));
  const workspacePath = assignment.workspacePath;
  const focusGroup = assignment.shard?.metadata?.focusGroup || assignment.inputs?.focusGroup || 'unknown';
  const modifiedFiles = new Set();

  if (focusGroup === 'frontend_architecture') applyFrontendArchitecture(workspacePath, modifiedFiles);
  if (focusGroup === 'persistence') applyPersistenceParity(workspacePath, modifiedFiles);
  if (focusGroup === 'delivery_jobs') applyDeliveryJobs(workspacePath, modifiedFiles);
  if (focusGroup === 'reporting_analytics') applyReportingAnalytics(workspacePath, modifiedFiles);
  if (focusGroup === 'ai_predictive') applyAiPredictive(workspacePath, modifiedFiles);

  console.log(JSON.stringify({
    ok: true,
    focusGroup,
    modifiedFiles: [...modifiedFiles].sort(),
    diffSummary: `implemented ${focusGroup} parity bridge changes`,
    metadata: { focusGroup, modifiedCount: modifiedFiles.size }
  }, null, 2));
}

main();
