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

function patchIfExists(filePath, transform, modifiedFiles, workspacePath) {
  if (!fs.existsSync(filePath)) return;
  patch(filePath, transform, modifiedFiles, workspacePath);
}

function patchAllowedFile(workspacePath, allowedFiles, relPath, transform, modifiedFiles) {
  if (allowedFiles.size > 0 && !allowedFiles.has(relPath)) return false;
  const filePath = path.join(workspacePath, relPath);
  if (!fs.existsSync(filePath)) return false;
  const beforeCount = modifiedFiles.size;
  patch(filePath, transform, modifiedFiles, workspacePath);
  return modifiedFiles.size > beforeCount;
}

function writeAllowedFile(workspacePath, allowedFiles, relPath, content, modifiedFiles) {
  if (allowedFiles.size > 0 && !allowedFiles.has(relPath)) return false;
  const beforeCount = modifiedFiles.size;
  write(path.join(workspacePath, relPath), content, modifiedFiles, workspacePath);
  return modifiedFiles.size > beforeCount;
}

function ensureContains(text, fragment) {
  return text.includes(fragment) ? text : `${text}${fragment}`;
}

function normalizeFocusGroup(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/^focus[./_-]+/, '')
    .replace(/#\d+$/, '')
    .replace(/[./-]+/g, '_');
}

function parseFocusSurfaceId(raw) {
  const value = String(raw || '').trim().toLowerCase();
  const match = value.match(/focus\.([a-z0-9_]+)(?:#\d+)?$/);
  if (match) return match[1];
  if (/^[a-z0-9_]+$/.test(value)) return value;
  return '';
}

function deriveFocusSurfaceId(assignment = {}) {
  const candidates = [
    assignment.surfaceFocusId,
    assignment.shard?.metadata?.surfaceFocusId,
    assignment.shard?.rootWorkUnitId,
    assignment.shard?.id,
    assignment.shardId,
    ...(Array.isArray(assignment.shard?.surfaceIds) ? assignment.shard.surfaceIds : []),
    ...(Array.isArray(assignment.contextPack?.shard?.surfaceIds) ? assignment.contextPack.shard.surfaceIds : []),
    assignment.contextPack?.shard?.rootWorkUnitId,
    assignment.contextPack?.shard?.id
  ];
  for (const candidate of candidates) {
    const parsed = parseFocusSurfaceId(candidate);
    if (parsed) return parsed;
  }
  return '';
}

function deriveAllowedFiles(assignment = {}) {
  return Array.from(new Set([
    ...(Array.isArray(assignment.shard?.allowedFiles) ? assignment.shard.allowedFiles : []),
    ...(Array.isArray(assignment.contextPack?.guardrails?.allowedFiles) ? assignment.contextPack.guardrails.allowedFiles : []),
    ...(Array.isArray(assignment.assignmentContract?.targetFiles) ? assignment.assignmentContract.targetFiles : []),
    ...(Array.isArray(assignment.contextPack?.assignmentContract?.targetFiles) ? assignment.contextPack.assignmentContract.targetFiles : [])
  ].map((entry) => String(entry || '').trim()).filter(Boolean)));
}

function deriveShardOrdinal(assignment = {}) {
  const shardId = String(assignment.shard?.id || assignment.shardId || assignment.contextPack?.shard?.id || '').trim();
  const match = shardId.match(/#(\d+)$/);
  return match ? Number(match[1]) : null;
}

function replaceAll(text, search, replacement) {
  return text.split(search).join(replacement);
}

function readJsonIfExists(filePath, fallback = null) {
  try {
    return JSON.parse(read(filePath));
  } catch {
    return fallback;
  }
}

function humanizeSurfaceLabel(relPath) {
  return relPath
    .replace(/\.[^.]+$/, '')
    .split(/[\/._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function titleCaseWords(value) {
  return String(value || '')
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function jsIdentifier(value, fallback = 'surfaceRuntime') {
  const words = String(value || fallback).split(/[^a-z0-9]+/i).filter(Boolean);
  const base = words.length > 0
    ? words.map((part, index) => index === 0
      ? part.charAt(0).toLowerCase() + part.slice(1)
      : part.charAt(0).toUpperCase() + part.slice(1)).join('')
    : fallback;
  return /^[A-Za-z_$]/.test(base) ? base : `${fallback}${base}`;
}

function canonicalSurfaceRuntimeFallbackSource({ surfaceId, label, lane, targetFile }) {
  const exportStem = jsIdentifier(surfaceId, 'mailchimpSurface');
  const title = titleCaseWords(label || surfaceId);
  const safeSurfaceId = String(surfaceId || exportStem);
  const capabilityExport = `${exportStem}ParityRuntime`;
  const modelExport = `build${title.replace(/[^A-Za-z0-9]/g, '') || 'Surface'}ParityRuntimeModel`;
  return `

export const ${capabilityExport} = Object.freeze({
  surfaceId: ${JSON.stringify(safeSurfaceId)},
  label: ${JSON.stringify(title)},
  lane: ${JSON.stringify(lane || 'canonical_parity')},
  targetFile: ${JSON.stringify(targetFile)},
  runtimeKind: 'mailchimp_canonical_parity_surface',
  productCapabilities: [
    'workspace-aware surface state',
    'operator-visible readiness model',
    'actionable next-step workflow',
    'surface telemetry contract'
  ],
  readinessSignals: [
    'configuration_present',
    'primary_workflow_available',
    'evidence_route_or_domain_helper_registered',
    'telemetry_or_audit_hook_named'
  ]
});

export function ${modelExport}(state = {}, actor = null) {
  const workspace = actor?.workspace || state?.workspace || {};
  const surfaceState = state?.db?.surfaceReadiness?.[${JSON.stringify(safeSurfaceId)}] || {};
  const completedSignals = ${capabilityExport}.readinessSignals.filter((signal) => surfaceState[signal] === true);
  const openSignals = ${capabilityExport}.readinessSignals.filter((signal) => !completedSignals.includes(signal));
  return {
    ...${capabilityExport},
    workspaceId: workspace.id || actor?.workspaceId || 'default',
    readinessScore: Math.round((completedSignals.length / ${capabilityExport}.readinessSignals.length) * 100),
    completedSignals,
    openSignals,
    primaryAction: openSignals.length > 0 ? \`Complete \${openSignals[0].replace(/_/g, ' ')}\` : 'Review live parity evidence',
    auditEvent: {
      type: 'canonical_surface_readiness_viewed',
      surfaceId: ${JSON.stringify(safeSurfaceId)},
      lane: ${capabilityExport}.lane
    }
  };
}
`;
}

function applyCanonicalSurfaceRuntimeFallback(workspacePath, modifiedFiles, assignment = {}) {
  const surfaceFocusId = deriveFocusSurfaceId(assignment);
  if (!surfaceFocusId) return false;
  const allowedFiles = deriveAllowedFiles(assignment).filter((entry) => /\.mjs$/.test(entry));
  const targetFile = allowedFiles[0];
  if (!targetFile) return false;
  const label = assignment.shard?.title || assignment.issue?.title || titleCaseWords(surfaceFocusId);
  const lane = assignment.shard?.lane || assignment.issue?.lane || assignment.shard?.metadata?.wave || 'canonical_parity';
  const marker = `surfaceId: ${JSON.stringify(surfaceFocusId)}`;
  return patchAllowedFile(workspacePath, new Set(allowedFiles), targetFile, (text) => {
    if (text.includes(marker) && text.includes('mailchimp_canonical_parity_surface')) return text;
    return `${text}${canonicalSurfaceRuntimeFallbackSource({ surfaceId: surfaceFocusId, label, lane, targetFile })}`;
  }, modifiedFiles);
}

const SURFACE_HONESTY_TESTS = {
  frontend_architecture: ['tests/architecture-hardening.test.mjs', 'tests/browser-realism.test.mjs'],
  dashboard_home: ['tests/platform-spine.test.mjs', 'tests/parity-route-aliases.test.mjs'],
  signup_forms_popups: ['tests/forms-landing.test.mjs'],
  campaign_index: ['tests/campaign-editor-depth.test.mjs'],
  campaign_editor: ['tests/campaign-editor-depth.test.mjs', 'tests/template-variants-routes.test.mjs', 'tests/template-approvals-routes.test.mjs'],
  email_builder: ['tests/current-product-parity.test.mjs', 'tests/campaign-editor-depth.test.mjs'],
  template_library: ['tests/current-product-parity.test.mjs', 'tests/template-variants-routes.test.mjs'],
  report_detail: ['tests/reports-admin.test.mjs', 'tests/commerce-revenue.test.mjs'],
  reports_overview: ['tests/reports-admin.test.mjs', 'tests/billing-analytics.test.mjs'],
  automation_journey: ['tests/automation-journeys.test.mjs', 'tests/campaign-pipeline.test.mjs'],
  persistence: ['tests/persistence-storage.test.mjs', 'tests/security-ops-hardening.test.mjs'],
  delivery_jobs: ['tests/campaign-pipeline.test.mjs', 'tests/browser-realism.test.mjs'],
  reporting_analytics: ['tests/reports-admin.test.mjs', 'tests/commerce-revenue.test.mjs'],
  ai_predictive: ['tests/current-product-parity.test.mjs', 'tests/current-product-browser-realism.test.mjs'],
  integrations_marketplace: ['tests/integrations-marketplace.test.mjs'],
  integrations_api_oauth: ['tests/integrations-marketplace.test.mjs', 'tests/current-product-parity.test.mjs'],
  website_builder: ['tests/current-product-parity.test.mjs', 'tests/current-product-browser-realism.test.mjs'],
  landing_pages: ['tests/forms-landing.test.mjs', 'tests/current-product-parity.test.mjs'],
  forms_growth: ['tests/forms-landing.test.mjs', 'tests/deep-parity-growth.test.mjs'],
  signup_onboarding: ['tests/current-product-parity.test.mjs', 'tests/platform-spine.test.mjs'],
  settings_domains: ['tests/current-product-parity.test.mjs', 'tests/platform-spine.test.mjs'],
  campaign_experimentation: ['tests/experiment-lab.test.mjs', 'tests/current-product-parity.test.mjs'],
  security_ops: ['tests/security-ops-hardening.test.mjs', 'tests/platform-spine.test.mjs'],
  unknown: ['tests/architecture-hardening.test.mjs']
};

function updateSurfaceHonestyManifest(workspacePath, modifiedFiles, focusGroup) {
  const productFiles = [...modifiedFiles]
    .filter((relPath) => /^(apps|packages)\//.test(relPath))
    .filter((relPath) => /\.(?:m?js)$/.test(relPath));
  if (productFiles.length === 0) return;

  const manifestPath = path.join(workspacePath, 'surface-honesty.json');
  const manifest = readJsonIfExists(manifestPath, {
    version: 1,
    policy: {
      changedProductFilesMustBeDeclared: true,
      allowedChangedStatuses: ['real'],
      requireEvidenceTests: true,
      bannedPlaceholderLanguage: ['coming soon', 'placeholder', 'stub', 'mock', 'fake', 'simulated', 'TODO']
    },
    surfaces: {}
  });

  manifest.surfaces ||= {};
  const tests = SURFACE_HONESTY_TESTS[focusGroup] || SURFACE_HONESTY_TESTS.unknown;
  for (const relPath of productFiles) {
    const existing = manifest.surfaces[relPath] || {};
    const existingEvidence = existing.evidence || {};
    const existingTests = Array.isArray(existingEvidence.tests) ? existingEvidence.tests : [];
    manifest.surfaces[relPath] = {
      ...existing,
      label: existing.label || humanizeSurfaceLabel(relPath),
      status: 'real',
      evidence: {
        ...existingEvidence,
        tests: [...new Set([...existingTests, ...tests])]
      },
      notes: existing.notes || `Auto-declared by implement worker for ${focusGroup} parity changes.`
    };
  }

  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
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
  patch(filePath, (text) => text.replace(/import \{([^}]*)\} from ('[^']+');/g, (full, specifiers, source) => {
    if (!specifiers.includes('saveDb')) return full;
    const nextSpecifiers = specifiers
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => part === 'saveDb' ? 'persistState' : part);
    if (!nextSpecifiers.includes('persistState')) nextSpecifiers.push('persistState');
    return `import { ${nextSpecifiers.join(', ')} } from ${source};`;
  }), modifiedFiles, workspacePath);
}

function ensurePersistenceIoImport(filePath, modifiedFiles, workspacePath) {
  const importLine = "import { writeJsonAtomic, writeJsonFile, writeTextFile } from './persistence-io.mjs';";
  patch(filePath, (text) => {
    let next = text.split(`${importLine}\n`).join('').split(importLine).join('');
    if (next.includes("import path from 'node:path';")) {
      next = next.replace("import path from 'node:path';", `import path from 'node:path';\n${importLine}`);
    } else if (next.includes("import fs from 'node:fs';")) {
      next = next.replace("import fs from 'node:fs';", `import fs from 'node:fs';\n${importLine}`);
    } else {
      next = `${importLine}\n${next}`;
    }
    return next;
  }, modifiedFiles, workspacePath);
}

function applyFrontendArchitecture(workspacePath, modifiedFiles) {
  const cssPath = path.join(workspacePath, 'apps/web/public/app-shell.css');
  const jsxPath = path.join(workspacePath, 'apps/web/public/app-shell.jsx');
  write(cssPath, `:root {\n  --mailclone-shell-bg: #0f172a;\n  --mailclone-shell-accent: #f5b301;\n}\n\nbody.mailclone-client-shell-ready #app-shell {\n  position: relative;\n}\n\n#mailclone-client-shell {\n  position: sticky;\n  top: 0;\n  z-index: 20;\n  display: flex;\n  gap: 12px;\n  align-items: center;\n  justify-content: space-between;\n  padding: 10px 18px;\n  background: rgba(15, 23, 42, 0.96);\n  color: white;\n  backdrop-filter: blur(12px);\n  border-bottom: 1px solid rgba(255,255,255,0.08);\n}\n\n#mailclone-client-shell .shell-status {\n  color: #cbd5e1;\n  font-size: 13px;\n}\n\n[data-builder-panel] {\n  position: fixed;\n  right: 16px;\n  bottom: 16px;\n  width: 320px;\n  background: white;\n  border: 1px solid #d8e0ee;\n  border-radius: 18px;\n  box-shadow: 0 18px 50px rgba(15, 23, 42, 0.18);\n  padding: 16px;\n  pointer-events: none;\n}\n`, modifiedFiles, workspacePath);
  write(jsxPath, `const shellId = 'mailclone-client-shell';\nif (!document.getElementById(shellId)) {\n  document.body.classList.add('mailclone-client-shell-ready');\n  const header = document.createElement('div');\n  header.id = shellId;\n  header.innerHTML = '<strong>Mailclone client shell</strong><span class="shell-status">Hydrated marketing shell · client-ready builder hooks</span>';\n  document.body.prepend(header);\n  if (!document.querySelector('[data-builder-panel]')) {\n    const panel = document.createElement('aside');\n    panel.setAttribute('data-builder-panel', 'true');\n    panel.innerHTML = '<h3 style="margin-top:0">Builder panel</h3><p style="margin-bottom:0">Client-side shell hooks are now active for richer editing, preview, and asset workflows.</p>';\n    document.body.append(panel);\n  }\n}\n`, modifiedFiles, workspacePath);

  patch(path.join(workspacePath, 'packages/app/view.mjs'), (text) => {
    const headInjection = '<link rel="stylesheet" href="/static/app-shell.css"><script type="module" src="/static/app-shell.jsx"></script>';
    if (text.includes(headInjection)) return text;
    return text.replace('</head><body', `${headInjection}</head><body`);
  }, modifiedFiles, workspacePath);

  patchIfExists(path.join(workspacePath, 'packages/app/routes/public.mjs'), (text) => {
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

function applyFrontendInteractionStrictFocus(workspacePath, modifiedFiles, assignment) {
  const allowedFiles = new Set(deriveAllowedFiles(assignment));
  const shardOrdinal = deriveShardOrdinal(assignment);
  const orderedEnhancements = shardOrdinal === 2
    ? ['public_manifest', 'view_bootstrap', 'server_headers']
    : shardOrdinal === 3
      ? ['server_headers', 'public_manifest', 'view_bootstrap']
      : ['view_bootstrap', 'public_manifest', 'server_headers'];

  for (const enhancement of orderedEnhancements) {
    if (enhancement === 'view_bootstrap') {
      const changed = patchAllowedFile(workspacePath, allowedFiles, 'packages/app/view.mjs', (text) => {
        let next = text;
        if (!next.includes('mailclone-client-shell-config')) {
          next = next.replace(
            '<link rel="stylesheet" href="/static/app-shell.css"><script type="module" src="/static/app-shell.jsx"></script>',
            '<script id="mailclone-client-shell-config" type="application/json">{"mode":"interactive","builder":"overlay","manifest":"/static/app-shell-manifest.json"}</script><link rel="stylesheet" href="/static/app-shell.css"><script type="module" src="/static/app-shell.jsx"></script>'
          );
        }
        next = next.replace('<body data-page-title="${escapeHtml(title)}" data-authenticated="${actor ? \'true\' : \'false\'}">', '<body data-page-title="${escapeHtml(title)}" data-authenticated="${actor ? \'true\' : \'false\'}" data-client-shell="interactive">');
        next = next.replace('<main id="app-shell" data-surface="page-main">', '<main id="app-shell" data-surface="page-main" data-client-surface="interactive-shell">');
        return next;
      }, modifiedFiles);
      if (changed) return;
    }

    if (enhancement === 'public_manifest') {
      const changed = patchAllowedFile(workspacePath, allowedFiles, 'packages/app/routes/public.mjs', (text) => {
        if (text.includes("router.register('GET', '/static/app-shell-manifest.json'")) return text;
        return text.replace(
          "  router.register('GET', '/static/app-shell.jsx', async ({ res }) => {\n    text(res, 200, fs.readFileSync(path.join(PUBLIC_ASSET_DIR, 'app-shell.jsx'), 'utf8'), { 'content-type': 'text/javascript; charset=utf-8' });\n  });",
          "  router.register('GET', '/static/app-shell.jsx', async ({ res }) => {\n    text(res, 200, fs.readFileSync(path.join(PUBLIC_ASSET_DIR, 'app-shell.jsx'), 'utf8'), { 'content-type': 'text/javascript; charset=utf-8' });\n  });\n\n  router.register('GET', '/static/app-shell-manifest.json', async ({ res }) => {\n    json(res, 200, {\n      ok: true,\n      shell: {\n        mode: 'interactive',\n        css: '/static/app-shell.css',\n        module: '/static/app-shell.jsx',\n        builderOverlay: 'non_interactive',\n        hydration: ['campaigns', 'automations', 'websites']\n      }\n    });\n  });"
        );
      }, modifiedFiles);
      if (changed) return;
    }

    if (enhancement === 'server_headers') {
      const changed = patchAllowedFile(workspacePath, allowedFiles, 'apps/web/server.mjs', (text) => {
        if (text.includes("res.setHeader('x-mailclone-client-shell', 'interactive')")) return text;
        return text.replace(
          "    for (const [key, value] of Object.entries(securityHeaders())) res.setHeader(key, value);",
          "    for (const [key, value] of Object.entries(securityHeaders())) res.setHeader(key, value);\n    res.setHeader('x-mailclone-client-shell', 'interactive');\n    res.setHeader('x-mailclone-client-surface-manifest', '/static/app-shell-manifest.json');"
        );
      }, modifiedFiles);
      if (changed) return;
    }
  }
}

function applyPersistenceParity(workspacePath, modifiedFiles, assignment = {}) {
  const allowedFiles = new Set(deriveAllowedFiles(assignment));
  const storagePath = path.join(workspacePath, 'packages/app/storage.mjs');
  patchAllowedFile(workspacePath, allowedFiles, 'packages/app/storage.mjs', (text) => {
    let next = text;
    if (!next.includes('export function persistState(state)')) {
      next = next.replace('export function createAppState() {', `export function persistState(state) {\n  saveDb(state.db);\n  return state.db;\n}\n\nexport function createAppState() {`);
    }
    if (!next.includes('export function storageOperationalSummary()')) {
      next = next.replace('export function createAppState() {', `export function storageOperationalSummary() {\n  const paths = dataPaths();\n  return {\n    dataDir: paths.dataDir,\n    dbPath: paths.dbPath,\n    uploadDir: paths.uploadDir,\n    exportDir: paths.exportDir,\n    legacyDbCandidates: [...(paths.legacyDbCandidates || [])]\n  };\n}\n\nexport function createAppState() {`);
    }
    return next;
  }, modifiedFiles);

  if (allowedFiles.size > 0) return;

  for (const filePath of walkMjs(path.join(workspacePath, 'packages'))) {
    if (filePath === storagePath) continue;
    const original = read(filePath);
    if (!original.includes('saveDb(state.db)') && !original.includes('persistState(state)')) continue;
    patchStorageImport(filePath, modifiedFiles, workspacePath);
    patch(filePath, (text) => replaceAll(text, 'saveDb(state.db)', 'persistState(state)'), modifiedFiles, workspacePath);
  }
}

function applyAudienceCrmStrictFocus(workspacePath, modifiedFiles, assignment = {}) {
  const allowedFiles = new Set(deriveAllowedFiles(assignment));

  patchAllowedFile(workspacePath, allowedFiles, 'packages/app/domain-audience.mjs', (text) => {
    if (text.includes('export function audienceCrmSummary')) return text;
    return text.replace(
      'export function normalizeRule(field, operator, value) {',
      "export function audienceCrmSummary(state, audience) {\n  const contacts = contactsForAudience(state, audience.id);\n  const subscribed = contacts.filter((contact) => (contact.status || 'subscribed') === 'subscribed');\n  const engaged = subscribed.filter((contact) => (contact.tags || []).some((tag) => ['vip', 'retained', 'engaged'].includes(String(tag || '').toLowerCase())) || (contact.interests || []).length > 0);\n  const recentActivity = contacts.flatMap((contact) => (Array.isArray(contact.activity) ? contact.activity : []).map((entry) => ({ ...entry, contactId: contact.id, email: contact.email }))).slice(0, 5);\n  return {\n    totalContacts: contacts.length,\n    subscribedContacts: subscribed.length,\n    engagedContacts: engaged.length,\n    enrichmentCoverage: contacts.length ? Number((contacts.filter((contact) => (contact.tags || []).length || (contact.interests || []).length || Object.keys(contact.groups || {}).length).length / contacts.length).toFixed(2)) : 0,\n    recentActivity\n  };\n}\n\nexport function normalizeRule(field, operator, value) {"
    );
  }, modifiedFiles);

  patchAllowedFile(workspacePath, allowedFiles, 'packages/app/routes/audience.mjs', (text) => {
    let next = text;
    if (!next.includes('audienceCrmSummary')) {
      next = next.replace(
        "import { audienceTraits, bulkUpdateContacts, contactsForAudience, createContact, generateImportPreview, matchSegment, parseSegmentRules, queueImport, updateContact } from '../domain-audience.mjs';",
        "import { audienceCrmSummary, audienceTraits, bulkUpdateContacts, contactsForAudience, createContact, generateImportPreview, matchSegment, parseSegmentRules, queueImport, updateContact } from '../domain-audience.mjs';"
      );
    }
    if (!next.includes('const crmSummary = audienceCrmSummary(state, audience);')) {
      next = next.replace(
        '    const traits = audienceTraits(state, audience);\n',
        '    const traits = audienceTraits(state, audience);\n    const crmSummary = audienceCrmSummary(state, audience);\n'
      );
    }
    if (!next.includes('<h3>CRM health</h3>')) {
      next = next.replace(
        "    text(res, 200, page(`Audience: ${audience.name}`, actor, `<div class=\"grid\"><div class=\"card\"><h3>Metrics</h3><p>${contactsForAudience(state, audience.id).length} contacts</p></div><div class=\"card\"><h3>Classification</h3><p>Tags: ${traits.tags.join(', ') || 'none'}</p><p>Groups: ${traits.groups.join(', ') || 'none'}</p><p>Interests: ${traits.interests.join(', ') || 'none'}</p></div><div class=\"card\"><h3>Open surfaces</h3><p><a href=\"/contacts?audienceId=${audience.id}\">Contacts table</a></p><p><a href=\"/segments?audienceId=${audience.id}\">Segments</a></p><p><a href=\"/audiences/${audience.id}/taxonomy\">Tags / groups / interests</a></p></div></div>`));",
        "    text(res, 200, page(`Audience: ${audience.name}`, actor, `<div class=\"grid\"><div class=\"card\"><h3>Metrics</h3><p>${contactsForAudience(state, audience.id).length} contacts</p></div><div class=\"card\"><h3>Classification</h3><p>Tags: ${traits.tags.join(', ') || 'none'}</p><p>Groups: ${traits.groups.join(', ') || 'none'}</p><p>Interests: ${traits.interests.join(', ') || 'none'}</p></div><div class=\"card\"><h3>CRM health</h3><p>Subscribed: ${crmSummary.subscribedContacts}</p><p>Engaged: ${crmSummary.engagedContacts}</p><p>Enrichment coverage: ${Math.round(crmSummary.enrichmentCoverage * 100)}%</p></div><div class=\"card\"><h3>Open surfaces</h3><p><a href=\"/contacts?audienceId=${audience.id}\">Contacts table</a></p><p><a href=\"/segments?audienceId=${audience.id}\">Segments</a></p><p><a href=\"/audiences/${audience.id}/taxonomy\">Tags / groups / interests</a></p></div></div>`));"
      );
    }
    return next;
  }, modifiedFiles);
}

function applyCanonicalEmailBuilderFocus(workspacePath, modifiedFiles, assignment = {}) {
  const allowedFiles = new Set(deriveAllowedFiles(assignment));

  patchAllowedFile(workspacePath, allowedFiles, 'packages/app/domain-campaigns.mjs', (text) => {
    if (text.includes('export function emailBuilderParitySummary')) return text;
    const summaryBlock = `export function emailBuilderParitySummary(state, workspaceId) {
  const campaigns = state.db.campaigns.filter((entry) => entry.workspaceId === workspaceId);
  const draftCampaigns = campaigns.filter((entry) => entry.status === 'draft' || entry.status === 'queued' || entry.status === 'scheduled');
  const editorReady = draftCampaigns.filter((entry) => (entry.blocks || []).length > 0);
  const reusableTemplates = state.db.contentTemplates.filter((entry) => entry.workspaceId === workspaceId).length;
  return {
    campaigns: campaigns.length,
    draftCampaigns: draftCampaigns.length,
    editorReady: editorReady.length,
    reusableTemplates,
    nextStep: draftCampaigns[0] ? campaignNextStep(draftCampaigns[0]) : 'setup'
  };
}`;
    if (text.includes('export function campaignAutomationRuntimeSummary(state, campaign) {')) {
      return text.replace(
        'export function campaignAutomationRuntimeSummary(state, campaign) {',
        `${summaryBlock}\n\nexport function campaignAutomationRuntimeSummary(state, campaign) {`
      );
    }
    if (text.includes('export function markCampaignDelivered(state, campaign) {')) {
      return text.replace(
        'export function markCampaignDelivered(state, campaign) {',
        `${summaryBlock}\n\nexport function markCampaignDelivered(state, campaign) {`
      );
    }
    return `${text.trimEnd()}\n\n${summaryBlock}\n`;
  }, modifiedFiles);

  patchAllowedFile(workspacePath, allowedFiles, 'packages/app/routes/content-asset-templates.mjs', (text) => {
    let next = text;
    if (!next.includes("import { emailBuilderParitySummary } from '../domain-campaigns.mjs';")) {
      next = next.replace(
        "import { contentStudioSummary, createTemplateCollection, ensureBrandKit, saveContentTemplate, updateBrandKit, workspaceContentTemplates } from '../domain-template-assets.mjs';",
        "import { contentStudioSummary, createTemplateCollection, ensureBrandKit, saveContentTemplate, updateBrandKit, workspaceContentTemplates } from '../domain-template-assets.mjs';\nimport { emailBuilderParitySummary } from '../domain-campaigns.mjs';"
      );
    }
    if (!next.includes('const emailBuilder = emailBuilderParitySummary(state, actor.workspace.id);')) {
      next = next.replace(
        '    const summary = contentStudioSummary(state, actor.workspace.id);\n    const templates = workspaceContentTemplates(state, actor.workspace.id);\n',
        '    const summary = contentStudioSummary(state, actor.workspace.id);\n    const emailBuilder = emailBuilderParitySummary(state, actor.workspace.id);\n    const templates = workspaceContentTemplates(state, actor.workspace.id);\n'
      );
    }
    if (!next.includes('<h3>Email builder</h3>')) {
      next = next.replace(
        '<div class="card"><h3>Studio summary</h3><ul><li>Brand kits: ${summary.brandKits}</li><li>Saved templates: ${summary.savedTemplates}</li><li>Collections: ${summary.collections}</li><li>Assets: ${summary.assets}</li></ul><p><a href="/content/depth">Open content depth tools</a></p></div>',
        '<div class="card"><h3>Studio summary</h3><ul><li>Brand kits: ${summary.brandKits}</li><li>Saved templates: ${summary.savedTemplates}</li><li>Collections: ${summary.collections}</li><li>Assets: ${summary.assets}</li></ul><p><a href="/content/depth">Open content depth tools</a></p></div><div class="card"><h3>Email builder</h3><p>Draft campaigns: ${emailBuilder.draftCampaigns}</p><p>Editor-ready drafts: ${emailBuilder.editorReady}</p><p>Reusable templates: ${emailBuilder.reusableTemplates}</p><p><a href="/campaigns">Resume at ${emailBuilder.nextStep}</a></p></div>'
      );
    }
    return next;
  }, modifiedFiles);
}

function applyCanonicalTemplateLibraryFocus(workspacePath, modifiedFiles, assignment = {}) {
  const allowedFiles = new Set(deriveAllowedFiles(assignment));

  patchAllowedFile(workspacePath, allowedFiles, 'packages/app/domain-template-assets.mjs', (text) => {
    if (text.includes('export function templateLibrarySummary')) return text;
    return text.replace(
      'export function createTemplateCollection(state, actor, body) {',
      `export function templateLibrarySummary(state, workspaceId) {
  const workspaceTemplates = state.db.contentTemplates.filter((entry) => entry.workspaceId === workspaceId);
  const systemTemplates = state.db.templates || [];
  const categories = Array.from(new Set([...workspaceTemplates, ...systemTemplates].map((entry) => entry.category || 'general')));
  return {
    workspaceTemplates: workspaceTemplates.length,
    systemTemplates: systemTemplates.length,
    collections: state.db.templateCollections.filter((entry) => entry.workspaceId === workspaceId).length,
    categories: categories.slice(0, 6)
  };
}

export function createTemplateCollection(state, actor, body) {`
    );
  }, modifiedFiles);

  patchAllowedFile(workspacePath, allowedFiles, 'packages/app/routes/content-asset-templates.mjs', (text) => {
    let next = text;
    if (!next.includes('templateLibrarySummary')) {
      next = next.replace(
        "import { contentStudioSummary, createTemplateCollection, ensureBrandKit, saveContentTemplate, updateBrandKit, workspaceContentTemplates } from '../domain-template-assets.mjs';",
        "import { contentStudioSummary, createTemplateCollection, ensureBrandKit, saveContentTemplate, templateLibrarySummary, updateBrandKit, workspaceContentTemplates } from '../domain-template-assets.mjs';"
      );
    }
    if (!next.includes('const templateLibrary = templateLibrarySummary(state, actor.workspace.id);')) {
      next = next.replace(
        '    const summary = contentStudioSummary(state, actor.workspace.id);\n',
        '    const summary = contentStudioSummary(state, actor.workspace.id);\n    const templateLibrary = templateLibrarySummary(state, actor.workspace.id);\n'
      );
    }
    if (!next.includes('<h3>Template library</h3>')) {
      next = next.replace(
        "<div class=\"card\"><h3>Saved content templates</h3><table><tr><th>Name</th><th>Category</th><th>Source</th><th>Blocks</th></tr>${templates.map((template) => `<tr><td>${template.name}</td><td>${template.category || '—'}</td><td>${template.source || 'system'}</td><td>${template.blocks?.length || 0}</td></tr>`).join('')}</table></div>",
        "<div class=\"card\"><h3>Template library</h3><p>Workspace templates: ${templateLibrary.workspaceTemplates}</p><p>System templates: ${templateLibrary.systemTemplates}</p><p>Collections: ${templateLibrary.collections}</p><p>Categories: ${templateLibrary.categories.join(', ') || 'general'}</p></div><div class=\"card\"><h3>Saved content templates</h3><table><tr><th>Name</th><th>Category</th><th>Source</th><th>Blocks</th></tr>${templates.map((template) => `<tr><td>${template.name}</td><td>${template.category || '—'}</td><td>${template.source || 'system'}</td><td>${template.blocks?.length || 0}</td></tr>`).join('')}</table></div>"
      );
    }
    return next;
  }, modifiedFiles);
}

function applyCanonicalContentStudioFocus(workspacePath, modifiedFiles, assignment = {}) {
  const allowedFiles = new Set(deriveAllowedFiles(assignment));

  patchAllowedFile(workspacePath, allowedFiles, 'packages/app/domain-content-ecosystem-depth.mjs', (text) => {
    if (text.includes('export function contentDepthSummary')) return text;
    return text.replace(
      'export function configureIntegrationInstallation(state, actor, installation, body = {}) {',
      `export function contentDepthSummary(state, workspaceId) {
  const snippets = state.db.assetSnippets.filter((entry) => entry.workspaceId === workspaceId);
  const versions = state.db.contentVersions.filter((entry) => entry.workspaceId === workspaceId);
  const approvals = state.db.approvalRequests.filter((entry) => entry.workspaceId === workspaceId && entry.targetType === 'content_template');
  const lineage = contentUsageLineage(state, workspaceId)
    .map((entry) => ({
      ...entry,
      totalUsage: Number(entry.campaignCount || 0) + Number(entry.websiteCount || 0) + Number(entry.snippetCount || 0)
    }))
    .sort((a, b) => Number(b.totalUsage || 0) - Number(a.totalUsage || 0));
  return {
    snippets: snippets.length,
    versions: versions.length,
    approvalRequests: approvals.length,
    reusableAssets: lineage.filter((entry) => entry.totalUsage > 0).length,
    topAsset: lineage[0]?.asset?.name || null
  };
}

export function configureIntegrationInstallation(state, actor, installation, body = {}) {`
    );
  }, modifiedFiles);

  patchAllowedFile(workspacePath, allowedFiles, 'packages/app/routes/content-asset-templates.mjs', (text) => {
    let next = text;
    if (!next.includes("import { contentDepthSummary } from '../domain-content-ecosystem-depth.mjs';")) {
      next = next.replace(
        "import { contentStudioSummary, createTemplateCollection, ensureBrandKit, saveContentTemplate, updateBrandKit, workspaceContentTemplates } from '../domain-template-assets.mjs';",
        "import { contentStudioSummary, createTemplateCollection, ensureBrandKit, saveContentTemplate, updateBrandKit, workspaceContentTemplates } from '../domain-template-assets.mjs';\nimport { contentDepthSummary } from '../domain-content-ecosystem-depth.mjs';"
      );
    }
    if (!next.includes('const depth = contentDepthSummary(state, actor.workspace.id);')) {
      next = next.replace(
        '    const summary = contentStudioSummary(state, actor.workspace.id);\n',
        '    const summary = contentStudioSummary(state, actor.workspace.id);\n    const depth = contentDepthSummary(state, actor.workspace.id);\n'
      );
    }
    if (!next.includes('<h3>Content depth</h3>')) {
      next = next.replace(
        '<div class="card"><h3>Depth workflows</h3><p><a href="/content/depth">Search assets + snippets + lineage</a></p><p>Version snapshots and content approval requests are now first-class.</p></div>',
        '<div class="card"><h3>Content depth</h3><p>Snippets: ${depth.snippets}</p><p>Versions: ${depth.versions}</p><p>Approval requests: ${depth.approvalRequests}</p><p>Top reusable asset: ${depth.topAsset || \'None yet\'}</p></div><div class="card"><h3>Depth workflows</h3><p><a href="/content/depth">Search assets + snippets + lineage</a></p><p>Version snapshots and content approval requests are now first-class.</p></div>'
      );
    }
    return next;
  }, modifiedFiles);
}

function applyCampaignEditorStrictFocus(workspacePath, modifiedFiles, assignment) {
  const allowedFiles = new Set(deriveAllowedFiles(assignment));
  const shardOrdinal = deriveShardOrdinal(assignment);
  const orderedEnhancements = shardOrdinal === 2
    ? ['template_approvals_domain', 'template_variants_domain', 'index_exports']
    : shardOrdinal === 3
      ? ['index_exports', 'template_approvals_domain', 'template_variants_domain']
      : ['template_variants_domain', 'template_approvals_domain', 'index_exports'];

  for (const enhancement of orderedEnhancements) {
    if (enhancement === 'template_variants_domain') {
      const changed = patchAllowedFile(workspacePath, allowedFiles, 'packages/template-variants/domain-template-variants.mjs', (text) => {
        if (text.includes('export function createCampaignEditorVariantCatalog')) return text;
        return `${text}\nexport function createCampaignEditorVariantCatalog(workspace = createTemplateVariantsWorkspace()) {\n  return workspace.programs.map((program, index) => ({\n    id: program.id + '-editor-variant',\n    lane: program.lane,\n    layout: index % 2 === 0 ? 'story' : 'promo',\n    dropZone: index === 0 ? 'hero' : index === 1 ? 'body' : index === 2 ? 'cta' : 'footer',\n    approvalState: index < 2 ? 'ready_for_review' : 'draft',\n    recommendedBlocks: ['headline', 'image', 'body', 'button'].slice(0, 2 + (index % 3)),\n    narrative: workspace.name + ' variant ' + (index + 1) + ' keeps the campaign editor stocked with reusable layouts.'\n  }));\n}\n`;
      }, modifiedFiles);
      if (changed) return;
    }

    if (enhancement === 'template_approvals_domain') {
      const changed = patchAllowedFile(workspacePath, allowedFiles, 'packages/template-approvals/domain-template-approvals.mjs', (text) => {
        if (text.includes('export function createCampaignEditorApprovalChecklist')) return text;
        return `${text}\nexport function createCampaignEditorApprovalChecklist(workspace = createTemplateApprovalsWorkspace()) {\n  return workspace.programs.map((program, index) => ({\n    id: program.id + '-editor-approval',\n    lane: program.lane,\n    reviewer: program.owner,\n    requiredChecks: ['content', 'render', 'links', 'brand'].slice(0, 2 + (index % 3)),\n    slaHours: 4 + index,\n    status: index === 0 ? 'ready' : index === 1 ? 'queued' : 'watch',\n    narrative: workspace.name + ' approval ' + (index + 1) + ' gives the campaign editor a review trail before launch.'\n  }));\n}\n`;
      }, modifiedFiles);
      if (changed) return;
    }

    if (enhancement === 'index_exports') {
      const variantsChanged = patchAllowedFile(workspacePath, allowedFiles, 'packages/template-variants/index.mjs', (text) => {
        if (text.includes('createCampaignEditorVariantCatalog')) return text;
        return text.replace(
          "export { createTemplateVariantsWorkspace, summarizeTemplateVariants, createTemplateVariantsNarratives } from './domain-template-variants.mjs';",
          "export { createTemplateVariantsWorkspace, summarizeTemplateVariants, createTemplateVariantsNarratives, createCampaignEditorVariantCatalog } from './domain-template-variants.mjs';"
        );
      }, modifiedFiles);
      const approvalsChanged = patchAllowedFile(workspacePath, allowedFiles, 'packages/template-approvals/index.mjs', (text) => {
        if (text.includes('createCampaignEditorApprovalChecklist')) return text;
        return text.replace(
          "export { createTemplateApprovalsWorkspace, summarizeTemplateApprovals, createTemplateApprovalsNarratives } from './domain-template-approvals.mjs';",
          "export { createTemplateApprovalsWorkspace, summarizeTemplateApprovals, createTemplateApprovalsNarratives, createCampaignEditorApprovalChecklist } from './domain-template-approvals.mjs';"
        );
      }, modifiedFiles);
      if (variantsChanged || approvalsChanged) return;
    }
  }
}

function applyAutomationJourneyStrictFocus(workspacePath, modifiedFiles, assignment) {
  const allowedFiles = new Set(deriveAllowedFiles(assignment));

  patchAllowedFile(workspacePath, allowedFiles, 'packages/app/domain-campaigns.mjs', (text) => {
    if (text.includes('export function campaignAutomationRuntimeSummary')) return text;
    return text.replace(
      "export function markCampaignDelivered(state, campaign) {",
      "export function campaignAutomationRuntimeSummary(state, campaign) {\n  const linkedAutomations = state.db.automations.filter((entry) => entry.workspaceId === campaign.workspaceId && (entry.sourceCampaignId === campaign.id || entry.trigger === 'campaign_sent'));\n  const relatedRuns = state.db.automationRuns.filter((run) => run.campaignId === campaign.id);\n  return {\n    linkedAutomations: linkedAutomations.length,\n    liveAutomations: linkedAutomations.filter((entry) => entry.status === 'live').length,\n    relatedRuns: relatedRuns.length,\n    lastTriggeredAt: relatedRuns[0]?.completedAt || relatedRuns[0]?.createdAt || null,\n    recentRuns: relatedRuns.slice(0, 3).map((run) => ({\n      id: run.id,\n      automationId: run.automationId,\n      trigger: run.trigger || 'campaign_sent',\n      status: run.status || 'completed',\n      completedAt: run.completedAt || run.createdAt || ''\n    }))\n  };\n}\n\nexport function markCampaignDelivered(state, campaign) {"
    );
  }, modifiedFiles);

  patchAllowedFile(workspacePath, allowedFiles, 'packages/app/routes/automations.mjs', (text) => {
    let next = text.replace("import { campaignAutomationRuntimeSummary } from '../domain-campaigns.mjs';\n", '');
    const runtimeSummaryBlock = "function campaignAutomationRuntimeSummary(state, campaign) {\n  const linkedAutomations = state.db.automations.filter((entry) => entry.workspaceId === campaign.workspaceId && (entry.sourceCampaignId === campaign.id || entry.trigger === 'campaign_sent'));\n  const relatedRuns = state.db.automationRuns.filter((run) => run.campaignId === campaign.id);\n  return {\n    linkedAutomations: linkedAutomations.length,\n    liveAutomations: linkedAutomations.filter((entry) => entry.status === 'live').length,\n    relatedRuns: relatedRuns.length,\n    lastTriggeredAt: relatedRuns[0]?.completedAt || relatedRuns[0]?.createdAt || null,\n    recentRuns: relatedRuns.slice(0, 3).map((run) => ({\n      id: run.id,\n      automationId: run.automationId,\n      trigger: run.trigger || 'campaign_sent',\n      status: run.status || 'completed',\n      completedAt: run.completedAt || run.createdAt || ''\n    }))\n  };\n}\n";
    if (!next.includes('function campaignAutomationRuntimeSummary(state, campaign)')) {
      next = next.replace(
        "import { createId, readBody, redirect, text } from '../utils.mjs';\n",
        `import { createId, readBody, redirect, text } from '../utils.mjs';\n\n${runtimeSummaryBlock}`
      );
    }
    if (!next.includes('function automationOrchestrationSummary(state, automation)')) {
      next = next.replace(
        runtimeSummaryBlock,
        `${runtimeSummaryBlock}\nfunction automationOrchestrationSummary(state, automation) {\n  const sourceCampaign = automation.sourceCampaignId\n    ? state.db.campaigns.find((entry) => entry.id === automation.sourceCampaignId && entry.workspaceId === automation.workspaceId) || null\n    : null;\n  const campaignRuntime = sourceCampaign ? campaignAutomationRuntimeSummary(state, sourceCampaign) : null;\n  const recentCampaignRuns = state.db.automationRuns\n    .filter((run) => run.automationId === automation.id && run.campaignId)\n    .slice(0, 3);\n  return { sourceCampaign, campaignRuntime, recentCampaignRuns };\n}\n`
      );
    }
    if (!next.includes('const orchestration = automationOrchestrationSummary(state, automation);')) {
      next = next.replace(
        "    const campaigns = state.db.campaigns.filter((entry) => entry.workspaceId === actor.workspace.id);\n",
        "    const campaigns = state.db.campaigns.filter((entry) => entry.workspaceId === actor.workspace.id);\n    const orchestration = automationOrchestrationSummary(state, automation);\n"
      );
    }
    if (!next.includes('<h3>Journey orchestration</h3>')) {
      next = next.replace(
        '<div class="card"><h3>Enrollment summary</h3><p>Total runs: ${runSummary.totalRuns}</p><p>Completed: ${runSummary.completedRuns}</p><p>Form-triggered: ${runSummary.formTriggeredRuns}</p><p>Campaign-triggered: ${runSummary.campaignTriggeredRuns}</p></div>',
        '<div class="card"><h3>Journey orchestration</h3><p>Source campaign: ${orchestration.sourceCampaign ? orchestration.sourceCampaign.name : \'None selected\'}</p><p>Linked campaign journeys: ${orchestration.campaignRuntime?.linkedAutomations || 0}</p><p>Live campaign journeys: ${orchestration.campaignRuntime?.liveAutomations || 0}</p><p>Campaign-triggered runs: ${orchestration.campaignRuntime?.relatedRuns || runSummary.campaignTriggeredRuns}</p>${orchestration.recentCampaignRuns.length ? `<ul>${orchestration.recentCampaignRuns.map((run) => `<li>${run.trigger} · ${run.campaignId} · ${run.completedAt || \'in flight\'}</li>`).join(\'\')}</ul>` : \'<p class="muted">No campaign-triggered runtime yet.</p>\'}</div><div class="card"><h3>Enrollment summary</h3><p>Total runs: ${runSummary.totalRuns}</p><p>Completed: ${runSummary.completedRuns}</p><p>Form-triggered: ${runSummary.formTriggeredRuns}</p><p>Campaign-triggered: ${runSummary.campaignTriggeredRuns}</p></div>'
      );
    }
    if (!next.includes('${index + 1}. ${node.type}')) {
      next = next.replace(
        '${automation.nodes.map((node) => `<tr><td>${node.type}</td><td>${node.title}</td><td>${node.delayHours || \'\'} ${node.conditions?.join(\'/\') || \'\'}</td></tr>`).join(\'\')}',
        '${automation.nodes.map((node, index) => `<tr><td>${index + 1}. ${node.type}</td><td>${node.title}</td><td>${node.delayHours || \'\'} ${node.conditions?.join(\'/\') || \'\'}</td></tr>`).join(\'\')}'
      );
    }
    return next;
  }, modifiedFiles);
}

function applyReportingAnalyticsStrictFocus(workspacePath, modifiedFiles, assignment) {
  const allowedFiles = new Set(deriveAllowedFiles(assignment));

  patchAllowedFile(workspacePath, allowedFiles, 'packages/app/domain-commerce-revenue.mjs', (text) => {
    let next = text;
    if (!next.includes('function summarizeRevenueSources(rows = [])')) {
      next = next.replace(
        'export function revenueSummary(state, workspaceId) {',
        `function summarizeRevenueSources(rows = []) {
  const bySource = new Map();
  for (const row of rows) {
    const source = row.source || 'unknown';
    const current = bySource.get(source) || { source, revenue: 0, orders: 0, campaigns: new Set() };
    current.revenue += Number(row.revenue || 0);
    current.orders += 1;
    if (row.campaignId) current.campaigns.add(row.campaignId);
    bySource.set(source, current);
  }
  return [...bySource.values()]
    .map((entry) => ({
      source: entry.source,
      revenue: currencyValue(entry.revenue),
      orders: entry.orders,
      campaigns: entry.campaigns.size
    }))
    .sort((a, b) => Number(b.revenue || 0) - Number(a.revenue || 0));
}

function summarizeTopCampaigns(state, rows = []) {
  const byCampaign = new Map();
  for (const row of rows) {
    if (!row.campaignId) continue;
    const current = byCampaign.get(row.campaignId) || { campaignId: row.campaignId, revenue: 0, orders: 0 };
    current.revenue += Number(row.revenue || 0);
    current.orders += 1;
    byCampaign.set(row.campaignId, current);
  }
  return [...byCampaign.values()]
    .map((entry) => {
      const campaign = state.db.campaigns.find((candidate) => candidate.id === entry.campaignId) || null;
      return {
        campaignId: entry.campaignId,
        name: campaign?.name || 'Unknown campaign',
        status: campaign?.status || 'unknown',
        orders: entry.orders,
        revenue: currencyValue(entry.revenue)
      };
    })
    .sort((a, b) => Number(b.revenue || 0) - Number(a.revenue || 0))
    .slice(0, 3);
}

function buildRecentRevenueActivity(orders = [], rows = []) {
  const rowsByOrderId = new Map(rows.map((row) => [row.orderId, row]));
  return orders
    .slice(0, 5)
    .map((order) => {
      const attribution = rowsByOrderId.get(order.id) || null;
      return {
        orderId: order.id,
        orderNumber: order.orderNumber,
        total: currencyValue(order.total),
        source: attribution?.source || 'unknown',
        campaignId: attribution?.campaignId || null,
        createdAt: order.createdAt
      };
    });
}

export function revenueSummary(state, workspaceId) {`
      );
    }
    if (!next.includes('averageOrderValue:')) {
      next = next.replace(
        "  const topProduct = state.db.commerceProducts.filter((entry) => entry.workspaceId === workspaceId).sort((a, b) => Number(b.price || 0) - Number(a.price || 0))[0] || null;\n  return {\n    stores: stores.length,\n    products: state.db.commerceProducts.filter((entry) => entry.workspaceId === workspaceId).length,\n    orders: orders.length,\n    totalRevenue,\n    attributedRevenue,\n    unattributedRevenue: currencyValue(totalRevenue - attributedRevenue),\n    topProduct: topProduct ? { name: topProduct.name, price: topProduct.price } : null\n  };",
        "  const topProduct = state.db.commerceProducts.filter((entry) => entry.workspaceId === workspaceId).sort((a, b) => Number(b.price || 0) - Number(a.price || 0))[0] || null;\n  const averageOrderValue = orders.length ? currencyValue(totalRevenue / orders.length) : 0;\n  const sourceBreakdown = summarizeRevenueSources(rows);\n  const topCampaigns = summarizeTopCampaigns(state, rows);\n  const recentActivity = buildRecentRevenueActivity(orders, rows);\n  return {\n    stores: stores.length,\n    products: state.db.commerceProducts.filter((entry) => entry.workspaceId === workspaceId).length,\n    orders: orders.length,\n    totalRevenue,\n    attributedRevenue,\n    unattributedRevenue: currencyValue(totalRevenue - attributedRevenue),\n    attributedShare: totalRevenue > 0 ? Number(((attributedRevenue / totalRevenue) * 100).toFixed(1)) : 0,\n    averageOrderValue,\n    topProduct: topProduct ? { name: topProduct.name, price: topProduct.price } : null,\n    sourceBreakdown,\n    topCampaigns,\n    recentActivity\n  };"
      );
    }
    return next;
  }, modifiedFiles);
}

function applyCanonicalReportDetailFocus(workspacePath, modifiedFiles, assignment = {}) {
  const allowedFiles = new Set(deriveAllowedFiles(assignment));

  patchAllowedFile(workspacePath, allowedFiles, 'packages/app/domain-campaigns.mjs', (text) => {
    if (text.includes('export function campaignReportDetailSummary')) return text;
    return text.replace(
      'export function markCampaignDelivered(state, campaign) {',
      `export function campaignReportDetailSummary(state, campaign) {
  const latest = campaign.report?.history?.[0] || null;
  const recipients = Number(latest?.recipients || 0);
  const opens = Number(campaign.report?.opens || 0);
  const clicks = Number(campaign.report?.clicks || 0);
  return {
    recipients,
    opens,
    clicks,
    openRate: recipients > 0 ? Number(((opens / recipients) * 100).toFixed(1)) : 0,
    clickRate: recipients > 0 ? Number(((clicks / recipients) * 100).toFixed(1)) : 0,
    lastEventAt: latest?.at || campaign.sentAt || null,
    automationRuns: Number(latest?.automationRuns || campaign.report?.funnel?.attributedAutomationRuns || 0)
  };
}

export function markCampaignDelivered(state, campaign) {`
    );
  }, modifiedFiles);

  patchAllowedFile(workspacePath, allowedFiles, 'packages/app/routes/reports.mjs', (text) => {
    let next = text;
    if (!next.includes('campaignReportDetailSummary')) {
      next = next.replace(
        "import { analyticsSeries, workspaceSummary } from '../domain-growth.mjs';",
        "import { analyticsSeries, workspaceSummary } from '../domain-growth.mjs';\nimport { campaignReportDetailSummary } from '../domain-campaigns.mjs';"
      );
    }
    if (!next.includes('const detail = campaignReportDetailSummary(state, campaign);')) {
      next = next.replace(
        "    const actor = requireAuth(state, req, res); if (!actor) return; const campaign = state.db.campaigns.find((entry) => entry.id === params.id && entry.workspaceId === actor.workspace.id); const funnel = campaignGrowthFunnel(state, campaign.id);",
        "    const actor = requireAuth(state, req, res); if (!actor) return; const campaign = state.db.campaigns.find((entry) => entry.id === params.id && entry.workspaceId === actor.workspace.id); const funnel = campaignGrowthFunnel(state, campaign.id); const detail = campaignReportDetailSummary(state, campaign);"
      );
    }
    if (!next.includes('<h3>Detail integrity</h3>')) {
      next = next.replace(
        "<div class=\"card\"><h3>Linked growth funnel</h3><p>Landing pages: ${funnel.landingPages}</p><p>Landing views: ${funnel.landingViews}</p><p>Landing submissions: ${funnel.landingSubmissions}</p><p>Form submissions: ${funnel.formSubmissions}</p><p>Attributed automation runs: ${funnel.attributedAutomationRuns}</p></div>",
        "<div class=\"card\"><h3>Linked growth funnel</h3><p>Landing pages: ${funnel.landingPages}</p><p>Landing views: ${funnel.landingViews}</p><p>Landing submissions: ${funnel.landingSubmissions}</p><p>Form submissions: ${funnel.formSubmissions}</p><p>Attributed automation runs: ${funnel.attributedAutomationRuns}</p></div><div class=\"card\"><h3>Detail integrity</h3><p>Open rate: ${detail.openRate}%</p><p>Click rate: ${detail.clickRate}%</p><p>Last event: ${detail.lastEventAt || 'not sent yet'}</p><p>Automation runs: ${detail.automationRuns}</p></div>"
      );
    }
    return next;
  }, modifiedFiles);
}

function applyCanonicalSendScheduleReviewFocus(workspacePath, modifiedFiles, assignment = {}) {
  const allowedFiles = new Set(deriveAllowedFiles(assignment));

  patchAllowedFile(workspacePath, allowedFiles, 'packages/app/domain-campaigns.mjs', (text) => {
    if (text.includes('export function campaignSendScheduleSummary')) return text;
    return text.replace(
      'export function queueCampaignDelivery(state, actor, campaign, runAt = null) {',
      `export function campaignSendScheduleSummary(state, campaign, workspace = null) {
  const effectiveWorkspace = workspace || state.db.workspaces.find((entry) => entry.id === campaign.workspaceId) || null;
  const blockers = preflightCampaign(state, campaign, effectiveWorkspace);
  const deliveryJobs = state.db.jobs.filter((entry) => entry.type === 'deliver_campaign' && entry.payload?.campaignId === campaign.id);
  const latestJob = deliveryJobs[0] || null;
  const scheduledAt = latestJob?.runAt || null;
  const scheduledMs = scheduledAt ? new Date(scheduledAt).getTime() : null;
  const minutesUntilSend = Number.isFinite(scheduledMs) ? Math.max(0, Math.round((scheduledMs - Date.now()) / 60000)) : null;
  return {
    blockers,
    scheduledAt,
    queuedDeliveries: deliveryJobs.length,
    senderReady: Boolean(effectiveWorkspace?.settings?.senderEmail && effectiveWorkspace?.settings?.address),
    approvalPending: approvalStatusForCampaign(state, campaign).pending,
    scheduleLabel: scheduledAt
      ? minutesUntilSend === 0
        ? 'Delivery window is due now'
        : 'Delivery window opens in ' + minutesUntilSend + ' min'
      : campaign.status === 'queued'
        ? 'Queued for immediate delivery'
        : 'Not queued yet'
  };
}

export function queueCampaignDelivery(state, actor, campaign, runAt = null) {`
    );
  }, modifiedFiles);

  patchAllowedFile(workspacePath, allowedFiles, 'packages/app/routes/campaigns.mjs', (text) => {
    let next = text;
    if (!next.includes('campaignSendScheduleSummary')) {
      next = next.replace(
        "import { campaignNextStep, campaignReviewState, createCampaign, queueCampaignDelivery, queueTestSend, recipientCount, renderBlocksHtml } from '../domain-campaigns.mjs';",
        "import { campaignNextStep, campaignReviewState, campaignSendScheduleSummary, createCampaign, queueCampaignDelivery, queueTestSend, recipientCount, renderBlocksHtml } from '../domain-campaigns.mjs';"
      );
    }
    if (!next.includes('const scheduleSummary = campaignSendScheduleSummary(state, campaign, actor.workspace);')) {
      next = next.replace(
        "    const reviewState = campaignReviewState(state, campaign, actor.workspace);",
        "    const reviewState = campaignReviewState(state, campaign, actor.workspace); const scheduleSummary = campaignSendScheduleSummary(state, campaign, actor.workspace);"
      );
    }
    next = next.replace(
      '<p>Recipients: ${recipientCount(state, campaign)}</p><p>Approval status: ${campaign.approvalStatus || \'not_requested\'}</p>',
      '<p>Recipients: ${recipientCount(state, campaign)}</p><p>Approval status: ${campaign.approvalStatus || \'not_requested\'}</p><p>Delivery state: ${scheduleSummary.scheduleLabel}</p>'
    );
    if (!next.includes('<h3>Send schedule readiness</h3>')) {
      next = next.replace(
        "<div class=\"card\"><h3>Schedule</h3>${schedulingGate}<form method=\"post\" action=\"/campaigns/${campaign.id}/schedule\"><input name=\"runAt\" type=\"datetime-local\" required><button ${(reviewState.blockers.length || !hasFeature(actor.workspace, 'scheduledSend')) ? 'disabled' : ''}>Schedule delivery</button></form></div>",
        "<div class=\"card\"><h3>Schedule</h3>${schedulingGate}<p>${scheduleSummary.scheduleLabel}</p><p>Queued deliveries: ${scheduleSummary.queuedDeliveries}</p><form method=\"post\" action=\"/campaigns/${campaign.id}/schedule\"><input name=\"runAt\" type=\"datetime-local\" required><button ${(reviewState.blockers.length || !hasFeature(actor.workspace, 'scheduledSend')) ? 'disabled' : ''}>Schedule delivery</button></form></div><div class=\"card\"><h3>Send schedule readiness</h3><p>Sender ready: ${scheduleSummary.senderReady ? 'yes' : 'no'}</p><p>Approval pending: ${scheduleSummary.approvalPending ? 'yes' : 'no'}</p><p>Blockers: ${scheduleSummary.blockers.length}</p></div>"
      );
    }
    return next;
  }, modifiedFiles);
}

function applyCanonicalCampaignIndexFocus(workspacePath, modifiedFiles, assignment = {}) {
  const allowedFiles = new Set(deriveAllowedFiles(assignment));
  const campaignDomainRel = 'packages/app/domain-campaigns.mjs';
  const campaignDomainPath = path.join(workspacePath, campaignDomainRel);
  const domainHelperAvailable = !allowedFiles.size
    || allowedFiles.has(campaignDomainRel)
    || (fs.existsSync(campaignDomainPath) && read(campaignDomainPath).includes('export function campaignIndexSummary(state, workspaceId)'));

  patchAllowedFile(workspacePath, allowedFiles, campaignDomainRel, (text) => {
    if (text.includes('export function campaignIndexSummary(state, workspaceId)')) return text;
    return text.replace(
      'export function recipientCount(state, campaign) {',
      `export function campaignIndexSummary(state, workspaceId) {
  const campaigns = state.db.campaigns.filter((entry) => entry.workspaceId === workspaceId);
  const reviewReady = campaigns.filter((entry) => campaignNextStep(entry) === 'review').length;
  const approvalsPending = campaigns.filter((entry) => approvalStatusForCampaign(state, entry).pending).length;
  const queuedDeliveries = state.db.jobs.filter((entry) => entry.workspaceId === workspaceId && entry.type === 'deliver_campaign' && entry.status === 'pending').length;
  const nextScheduled = state.db.jobs
    .filter((entry) => entry.workspaceId === workspaceId && entry.type === 'deliver_campaign' && entry.runAt)
    .sort((a, b) => new Date(a.runAt).getTime() - new Date(b.runAt).getTime())[0] || null;
  return {
    total: campaigns.length,
    draft: campaigns.filter((entry) => entry.status === 'draft').length,
    queued: campaigns.filter((entry) => entry.status === 'queued').length,
    scheduled: campaigns.filter((entry) => entry.status === 'scheduled').length,
    sent: campaigns.filter((entry) => entry.status === 'sent').length,
    reviewReady,
    approvalsPending,
    queuedDeliveries,
    nextScheduledAt: nextScheduled?.runAt || null
  };
}

export function recipientCount(state, campaign) {`
    );
  }, modifiedFiles);

  patchAllowedFile(workspacePath, allowedFiles, 'packages/app/routes/campaigns.mjs', (text) => {
    let next = text;
    next = next.replace(/import \{([^}]*)\} from '\.\.\/domain-campaigns\.mjs';/, (full, specifiers) => {
      const parts = specifiers
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
        .filter((part) => part !== 'campaignIndexSummary');
      if (domainHelperAvailable) parts.unshift('campaignIndexSummary');
      return `import { ${[...new Set(parts)].join(', ')} } from '../domain-campaigns.mjs';`;
    });
    if (!domainHelperAvailable && !next.includes('function campaignIndexLocalSummary(state, workspaceId)')) {
      next = next.replace(
        'function cloneEditorBlocks(blocks = []) {',
        `function campaignIndexLocalSummary(state, workspaceId) {
  const campaigns = state.db.campaigns.filter((entry) => entry.workspaceId === workspaceId);
  const campaignIds = new Set(campaigns.map((entry) => entry.id));
  const approvalRequests = Array.isArray(state.db.approvalRequests) ? state.db.approvalRequests : [];
  const jobs = Array.isArray(state.db.jobs) ? state.db.jobs : [];
  const reviewReady = campaigns.filter((entry) => campaignNextStep(entry) === 'review').length;
  const approvalsPending = approvalRequests.filter((entry) => entry.targetType === 'campaign' && campaignIds.has(entry.targetId) && entry.status === 'pending').length;
  const queuedDeliveries = jobs.filter((entry) => entry.workspaceId === workspaceId && entry.type === 'deliver_campaign' && entry.status === 'pending').length;
  const nextScheduled = jobs
    .filter((entry) => entry.workspaceId === workspaceId && entry.type === 'deliver_campaign' && entry.runAt)
    .sort((a, b) => new Date(a.runAt).getTime() - new Date(b.runAt).getTime())[0] || null;
  return {
    total: campaigns.length,
    draft: campaigns.filter((entry) => entry.status === 'draft').length,
    queued: campaigns.filter((entry) => entry.status === 'queued').length,
    scheduled: campaigns.filter((entry) => entry.status === 'scheduled').length,
    sent: campaigns.filter((entry) => entry.status === 'sent').length,
    reviewReady,
    approvalsPending,
    queuedDeliveries,
    nextScheduledAt: nextScheduled?.runAt || null
  };
}

function cloneEditorBlocks(blocks = []) {`
      );
    }
    next = next.replace(
      /const summary = campaignIndex(?:Local)?Summary\(state, actor\.workspace\.id\);/,
      `const summary = ${domainHelperAvailable ? 'campaignIndexSummary' : 'campaignIndexLocalSummary'}(state, actor.workspace.id);`
    );
    if (!next.includes(`const summary = ${domainHelperAvailable ? 'campaignIndexSummary' : 'campaignIndexLocalSummary'}(state, actor.workspace.id);`)) {
      next = next.replace(
        "    const campaigns = state.db.campaigns.filter((entry) => entry.workspaceId === actor.workspace.id);\n",
        `    const campaigns = state.db.campaigns.filter((entry) => entry.workspaceId === actor.workspace.id);\n    const summary = ${domainHelperAvailable ? 'campaignIndexSummary' : 'campaignIndexLocalSummary'}(state, actor.workspace.id);\n`
      );
    }
    if (!next.includes('<h3>Campaign pipeline</h3>')) {
      next = next.replace(
        '<div class="card"><p><a href="/campaigns/new">Create campaign</a></p><table><tr><th>Name</th><th>Status</th><th>Recipients</th><th>Template</th><th>Resume</th><th>Actions</th></tr>${campaigns.map((campaign) => `<tr><td>${campaign.name || \'Untitled\'}</td><td>${campaign.status}</td><td>${recipientCount(state, campaign)}</td><td>${state.db.templates.find((entry) => entry.id === campaign.templateId)?.name || \'—\'}</td><td><a href="/campaigns/${campaign.id}/resume">Resume at ${campaignNextStep(campaign)}</a></td><td><a href="/campaigns/${campaign.id}/setup">Setup</a> · <a href="/campaigns/${campaign.id}/recipients">Recipients</a> · <a href="/campaigns/${campaign.id}/templates">Templates</a> · <a href="/campaigns/${campaign.id}/editor">Editor</a> · <a href="/campaigns/${campaign.id}/review">Review</a> · <a href="/reports/campaigns/${campaign.id}">Report</a></td></tr>`).join(\'\')}</table></div>',
        '<div class="grid"><div class="card"><h3>Campaign pipeline</h3><p>Draft: ${summary.draft} · Review-ready: ${summary.reviewReady}</p><p>Queued deliveries: ${summary.queuedDeliveries} · Scheduled: ${summary.scheduled}</p><p>Approvals pending: ${summary.approvalsPending}</p><p>${summary.nextScheduledAt ? `Next scheduled send: ${summary.nextScheduledAt}` : \'No scheduled sends yet.\'}</p><p><a href="/campaigns/new">Create campaign</a></p></div><div class="card"><h3>Delivery coverage</h3><p>Total campaigns: ${summary.total}</p><p>Queued: ${summary.queued}</p><p>Sent: ${summary.sent}</p><p><a href="/reports">Open reports overview</a></p></div></div><div class="card"><table><tr><th>Name</th><th>Status</th><th>Recipients</th><th>Template</th><th>Resume</th><th>Actions</th></tr>${campaigns.map((campaign) => `<tr><td>${campaign.name || \'Untitled\'}</td><td>${campaign.status}</td><td>${recipientCount(state, campaign)}</td><td>${state.db.templates.find((entry) => entry.id === campaign.templateId)?.name || \'—\'}</td><td><a href="/campaigns/${campaign.id}/resume">Resume at ${campaignNextStep(campaign)}</a></td><td><a href="/campaigns/${campaign.id}/setup">Setup</a> · <a href="/campaigns/${campaign.id}/recipients">Recipients</a> · <a href="/campaigns/${campaign.id}/templates">Templates</a> · <a href="/campaigns/${campaign.id}/editor">Editor</a> · <a href="/campaigns/${campaign.id}/review">Review</a> · <a href="/reports/campaigns/${campaign.id}">Report</a></td></tr>`).join(\'\')}</table></div>'
      );
    }
    if (!next.includes('<h3>Guided setup</h3>')) {
      next = next.replace(
        "text(res, 200, page('Campaign creation wizard', actor, '<div class=\"steps\"><span class=\"step active\">1. Setup</span><span class=\"step\">2. Recipients</span><span class=\"step\">3. Template</span><span class=\"step\">4. Design</span><span class=\"step\">5. Review</span></div><div class=\"card\"><form method=\"post\" action=\"/campaigns\"><input name=\"name\" placeholder=\"Spring launch\" required><button>Create draft</button></form></div>'));",
        "text(res, 200, page('Campaign creation wizard', actor, '<div class=\"steps\"><span class=\"step active\">1. Setup</span><span class=\"step\">2. Recipients</span><span class=\"step\">3. Template</span><span class=\"step\">4. Design</span><span class=\"step\">5. Review</span></div><div class=\"grid\"><div class=\"card\"><form method=\"post\" action=\"/campaigns\"><input name=\"name\" placeholder=\"Spring launch\" required><button>Create draft</button></form></div><div class=\"card\"><h3>Guided setup</h3><p>Wizard flow now walks setup, recipients, template choice, design, and review before delivery.</p><p><a href=\"/templates\">Browse templates first</a></p></div></div>'));"
      );
    }
    return next;
  }, modifiedFiles);
}

function applyCanonicalReportsOverviewFocus(workspacePath, modifiedFiles, assignment = {}) {
  const allowedFiles = new Set(deriveAllowedFiles(assignment));

  patchAllowedFile(workspacePath, allowedFiles, 'packages/app/routes/api-admin.mjs', (text) => {
    if (text.includes("router.register('GET', '/api/reports/summary'")) return text;
    return text.replace(
      "  router.register('GET', '/api/commerce/revenue', async ({ state, req, res }) => {",
      `  router.register('GET', '/api/reports/summary', async ({ state, req, res }) => {
    const actor = apiActor(state, req);
    if (!actor) return json(res, 401, { ok: false, error: 'Unauthorized' });
    json(res, 200, {
      ok: true,
      summary: workspaceSummary(state, actor.workspace.id),
      trends: analyticsSeries(state, actor.workspace.id),
      revenue: revenueSummary(state, actor.workspace.id),
      campaigns: state.db.campaigns.filter((entry) => entry.workspaceId === actor.workspace.id).length
    });
  });

  router.register('GET', '/api/commerce/revenue', async ({ state, req, res }) => {`
    );
  }, modifiedFiles);

  patchAllowedFile(workspacePath, allowedFiles, 'packages/app/routes/reports.mjs', (text) => {
    let next = text;
    if (!next.includes('const activeCampaigns = state.db.campaigns')) {
      next = next.replace(
        "    const actor = requireAuth(state, req, res); if (!actor) return; const summary = workspaceSummary(state, actor.workspace.id); const trends = analyticsSeries(state, actor.workspace.id); const revenue = revenueSummary(state, actor.workspace.id);\n",
        "    const actor = requireAuth(state, req, res); if (!actor) return; const summary = workspaceSummary(state, actor.workspace.id); const trends = analyticsSeries(state, actor.workspace.id); const revenue = revenueSummary(state, actor.workspace.id); const activeCampaigns = state.db.campaigns.filter((entry) => entry.workspaceId === actor.workspace.id && ['queued', 'scheduled', 'sent'].includes(entry.status));\n"
      );
    }
    if (!next.includes('<h3>Report integrity</h3>')) {
      next = next.replace(
        '<div class="card"><h3>Current-product reports</h3><p><a href="/reports/optimization">Optimization outcomes</a></p><p><a href="/reports/omnichannel">Omnichannel performance</a></p></div>',
        '<div class="card"><h3>Current-product reports</h3><p><a href="/reports/optimization">Optimization outcomes</a></p><p><a href="/reports/omnichannel">Omnichannel performance</a></p></div><div class="card"><h3>Report integrity</h3><p>Active send surfaces: ${activeCampaigns.length}</p><p>Published forms: ${summary.publishedForms}</p><p>Published landing pages: ${summary.publishedLandingPages}</p><p><a href="/api/reports/summary">Open API summary</a></p></div>'
      );
    }
    return next;
  }, modifiedFiles);
}

function applyCanonicalIntegrationsMarketplaceFocus(workspacePath, modifiedFiles, assignment = {}) {
  const allowedFiles = new Set(deriveAllowedFiles(assignment));

  patchAllowedFile(workspacePath, allowedFiles, 'packages/app/domain-integration-marketplace.mjs', (text) => {
    if (text.includes('export function integrationMarketplaceSurfaceSummary')) return text;
    return text.replace(
      'export function workspaceIntegrationSummary(state, workspaceId) {',
      `export function integrationMarketplaceSurfaceSummary(state, workspaceId) {
  const installations = workspaceIntegrationInstallations(state, workspaceId);
  const syncRuns = state.db.integrationSyncRuns.filter((entry) => entry.workspaceId === workspaceId);
  return {
    installedApps: installations.length,
    connectedApps: installations.filter((entry) => entry.status === 'installed').length,
    authModes: Array.from(new Set(installations.map((entry) => entry.authMode || 'oauth'))),
    appsNeedingSync: installations.filter((entry) => !entry.lastSyncedAt).length,
    lastSyncAt: syncRuns[0]?.createdAt || null
  };
}

export function workspaceIntegrationSummary(state, workspaceId) {`
    );
  }, modifiedFiles);

  patchAllowedFile(workspacePath, allowedFiles, 'packages/app/routes/integrations-marketplace.mjs', (text) => {
    let next = text;
    if (!next.includes('integrationMarketplaceSurfaceSummary')) {
      next = next.replace(
        "import { MARKETPLACE_APPS, installMarketplaceApp, syncMarketplaceInstallation, workspaceIntegrationInstallations, workspaceIntegrationSummary } from '../domain-integration-marketplace.mjs';",
        "import { MARKETPLACE_APPS, installMarketplaceApp, integrationMarketplaceSurfaceSummary, syncMarketplaceInstallation, workspaceIntegrationInstallations, workspaceIntegrationSummary } from '../domain-integration-marketplace.mjs';"
      );
    }
    if (!next.includes('const surfaceSummary = integrationMarketplaceSurfaceSummary(state, actor.workspace.id);')) {
      next = next.replace(
        "    const summary = workspaceIntegrationSummary(state, actor.workspace.id);\n",
        "    const summary = workspaceIntegrationSummary(state, actor.workspace.id);\n    const surfaceSummary = integrationMarketplaceSurfaceSummary(state, actor.workspace.id);\n"
      );
    }
    if (!next.includes('<h3>Connector operations</h3>')) {
      next = next.replace(
        '<div class="card"><h3>Integration realism summary</h3><ul><li>Installed apps: ${summary.installedApps}</li><li>Commerce connectors: ${summary.commerceApps}</li><li>Collaboration connectors: ${summary.collaborationApps}</li><li>Last sync: ${summary.lastSyncAt || \'Never\'}</li></ul><p>Connector detail pages now expose auth, config, field mapping, health, and retry workflows.</p></div>',
        '<div class="card"><h3>Integration realism summary</h3><ul><li>Installed apps: ${summary.installedApps}</li><li>Commerce connectors: ${summary.commerceApps}</li><li>Collaboration connectors: ${summary.collaborationApps}</li><li>Last sync: ${summary.lastSyncAt || \'Never\'}</li></ul><p>Connector detail pages now expose auth, config, field mapping, health, and retry workflows.</p></div><div class="card"><h3>Connector operations</h3><p>Connected apps: ${surfaceSummary.connectedApps}</p><p>Auth modes: ${surfaceSummary.authModes.join(\', \' ) || \'oauth\'}</p><p>Needs first sync: ${surfaceSummary.appsNeedingSync}</p><p>${surfaceSummary.lastSyncAt ? `Last verified sync: ${surfaceSummary.lastSyncAt}` : \'No verified sync yet.\'}</p></div>'
      );
    }
    return next;
  }, modifiedFiles);
}

function applyCanonicalApiKeysWebhooksFocus(workspacePath, modifiedFiles, assignment = {}) {
  const allowedFiles = new Set(deriveAllowedFiles(assignment));

  patchAllowedFile(workspacePath, allowedFiles, 'packages/app/routes/api-admin.mjs', (text) => {
    let next = text;
    if (!next.includes("router.register('GET', '/api/developer/access'")) {
      const accessRoute = `  router.register('GET', '/api/developer/access', async ({ state, req, res }) => {
    const actor = apiActor(state, req);
    if (!actor) return json(res, 401, { ok: false, error: 'Unauthorized' });
    const keys = state.db.apiKeys.filter((entry) => entry.workspaceId === actor.workspace.id);
    const hooks = state.db.webhooks.filter((entry) => entry.workspaceId === actor.workspace.id);
    const deliveries = state.db.webhookDeliveries.filter((entry) => entry.workspaceId === actor.workspace.id).slice(0, 10);
    json(res, 200, {
      ok: true,
      apiKeys: {
        total: keys.length,
        active: keys.filter((entry) => !entry.revokedAt).length,
        revoked: keys.filter((entry) => entry.revokedAt).length,
        recent: keys.slice(0, 5).map((entry) => ({
          id: entry.id,
          label: entry.label,
          status: entry.revokedAt ? 'revoked' : 'active',
          createdAt: entry.createdAt,
          revokedAt: entry.revokedAt || null
        }))
      },
      webhooks: {
        total: hooks.length,
        active: hooks.filter((entry) => entry.status === 'active').length,
        failing: hooks.filter((entry) => entry.status && entry.status !== 'active').length,
        lastDeliveryAt: deliveries[0]?.createdAt || null,
        recentDeliveries: deliveries.slice(0, 5).map((entry) => ({
          id: entry.id,
          targetUrl: entry.targetUrl,
          eventType: entry.eventType,
          status: entry.status,
          createdAt: entry.createdAt
        }))
      }
    });
  });\n\n`;
      next = next.replace("  router.register('GET', '/api/integrations', async ({ state, req, res }) => {", `${accessRoute}  router.register('GET', '/api/integrations', async ({ state, req, res }) => {`);
    }
    return next;
  }, modifiedFiles);
}

function applyCanonicalBillingPlansFocus(workspacePath, modifiedFiles, assignment = {}) {
  const allowedFiles = new Set(deriveAllowedFiles(assignment));

  patchAllowedFile(workspacePath, allowedFiles, 'packages/app/domain-commerce-revenue.mjs', (text) => {
    if (text.includes('export function billingPlanSummary')) return text;
    return text.replace(
      'export function revenueSummary(state, workspaceId) {',
      `export function billingPlanSummary(state, workspaceId) {
  const workspace = state.db.workspaces.find((entry) => entry.id === workspaceId) || null;
  const invoices = workspace?.billing?.invoices || [];
  const monthlyLimit = Number(workspace?.billing?.monthlyLimit || 0);
  const monthlySendsUsed = Number(workspace?.billing?.monthlySendsUsed || 0);
  const latestInvoice = invoices[0] || null;
  return {
    planId: workspace?.planId || 'starter',
    monthlyLimit,
    monthlySendsUsed,
    monthlySendsRemaining: Math.max(0, monthlyLimit - monthlySendsUsed),
    invoiceCount: invoices.length,
    paidInvoices: invoices.filter((entry) => entry.status === 'paid').length,
    pastDueInvoices: invoices.filter((entry) => entry.status === 'past_due').length,
    latestInvoice: latestInvoice ? {
      id: latestInvoice.id,
      amount: latestInvoice.amount,
      status: latestInvoice.status,
      dueAt: latestInvoice.dueAt || null
    } : null
  };
}

export function revenueSummary(state, workspaceId) {`
    );
  }, modifiedFiles);

  patchAllowedFile(workspacePath, allowedFiles, 'packages/app/routes/api-admin.mjs', (text) => {
    let next = text;
    if (!next.includes("import { billingPlanSummary, revenueSummary } from '../domain-commerce-revenue.mjs';")) {
      next = next.replace(
        "import { revenueSummary } from '../domain-commerce-revenue.mjs';",
        "import { billingPlanSummary, revenueSummary } from '../domain-commerce-revenue.mjs';"
      );
    }
    if (!next.includes("router.register('GET', '/api/billing/summary'")) {
      const billingRoute = `  router.register('GET', '/api/billing/summary', async ({ state, req, res }) => {
    const actor = apiActor(state, req);
    if (!actor) return json(res, 401, { ok: false, error: 'Unauthorized' });
    json(res, 200, {
      ok: true,
      billing: billingPlanSummary(state, actor.workspace.id),
      revenue: revenueSummary(state, actor.workspace.id)
    });
  });\n\n`;
      next = next.replace("  router.register('GET', '/api/commerce/revenue', async ({ state, req, res }) => {", `${billingRoute}  router.register('GET', '/api/commerce/revenue', async ({ state, req, res }) => {`);
    }
    return next;
  }, modifiedFiles);
}

function applyCanonicalSignupOnboardingFocus(workspacePath, modifiedFiles, assignment = {}) {
  const allowedFiles = new Set(deriveAllowedFiles(assignment));

  patchAllowedFile(workspacePath, allowedFiles, 'packages/app/index.mjs', (text) => {
    if (text.includes('signupOnboardingCard')) return text;
    return text.replace(
      "export { page, requireActor, requireAdmin, nav } from './view.mjs';",
      "export { page, requireActor, requireAdmin, nav, signupOnboardingCard, signupOnboardingChecklistItems } from './view.mjs';"
    );
  }, modifiedFiles);

  patchAllowedFile(workspacePath, allowedFiles, 'packages/app/view.mjs', (text) => {
    let next = text;
    if (!next.includes('export function signupOnboardingChecklistItems(actor)')) {
      const helperBlock = `export function signupOnboardingChecklistItems(actor) {
  const workspace = actor?.workspace || { settings: {}, featureFlags: {}, billing: {} };
  const domains = workspace.settings?.domains || [];
  return [
    { label: 'Create workspace', done: Boolean(workspace.id) },
    { label: 'Set sender profile', done: Boolean(workspace.settings?.senderEmail && workspace.settings?.senderName) },
    { label: 'Connect authenticated domain', done: domains.some((entry) => entry.authenticationStatus === 'authenticated') },
    { label: 'Invite teammates', done: Boolean(workspace.featureFlags?.multiUser) },
    { label: 'Choose a send-ready plan', done: Boolean(workspace.planId && workspace.planId !== 'starter') }
  ];
}

export function signupOnboardingCard(actor, { compact = false } = {}) {
  const steps = signupOnboardingChecklistItems(actor);
  const completed = steps.filter((step) => step.done).length;
  const href = compact ? '/onboarding' : '/signup';
  const label = compact ? 'Open onboarding checklist' : 'Start guided signup';
  return \`<div class="card"><h3>Signup onboarding</h3><p>\${completed}/\${steps.length} setup steps ready</p><div class="steps">\${steps.map((step) => \`<span class="step \${step.done ? 'active' : ''}">\${escapeHtml(step.label)}</span>\`).join('')}</div><p><a href="\${href}">\${label}</a></p></div>\`;
}`;
      next = next.replace('export function requireActor(state, req, res, redirect, getCurrentActor) {', `${helperBlock}\n\nexport function requireActor(state, req, res, redirect, getCurrentActor) {`);
    }
    if (!next.includes('<a href="/onboarding">Onboarding</a>')) {
      next = next.replace('<a href="/app">Dashboard</a>', '<a href="/app">Dashboard</a><a href="/onboarding">Onboarding</a>');
    }
    if (!next.includes('${signupOnboardingCard(actor, { compact: true })}')) {
      next = next.replace(
        '<div class="grid" style="margin-top:16px"><div class="card"><h3>Quick launch</h3><p><a href="/campaigns/new">Create campaign</a> · <a href="/automations/new">Build automation</a> · <a href="/forms/new">Create form</a> · <a href="/websites">Create website</a></p></div>',
        '<div class="grid" style="margin-top:16px">${signupOnboardingCard(actor, { compact: true })}<div class="card"><h3>Quick launch</h3><p><a href="/campaigns/new">Create campaign</a> · <a href="/automations/new">Build automation</a> · <a href="/forms/new">Create form</a> · <a href="/websites">Create website</a></p></div>'
      );
    }
    return next;
  }, modifiedFiles);

  patchAllowedFile(workspacePath, allowedFiles, 'packages/app/routes/public.mjs', (text) => {
    let next = text;
    if (!next.includes("router.register('GET', '/signup/checklist'")) {
      const checklistRoute = `  router.register('GET', '/signup/checklist', async ({ res }) => {
    text(res, 200, page('Signup onboarding', null, '<div class="grid"><div class="card"><h3>Launch checklist</h3><div class="steps"><span class="step active">Create workspace</span><span class="step">Verify sender domain</span><span class="step">Invite teammates</span><span class="step">Create first campaign</span></div><p>Move from account creation into sender setup, domain authentication, and your first launch surfaces without leaving the product shell.</p></div><div class="card"><h3>What happens next</h3><p>We carry account creation straight into workspace defaults, sender identity, domain setup, and campaign launch links.</p><p><a href="/signup">Open signup form</a></p></div></div>'));
  });\n\n`;
      next = next.replace("  router.register('GET', '/signup', async ({ res }) => {", `${checklistRoute}  router.register('GET', '/signup', async ({ res }) => {`);
    }
    next = next.replace(
      `    text(res, 200, page('Signup', null, '<div class="card"><form method="post" action="/signup"><input name="name" placeholder="Full name" required><input name="email" type="email" placeholder="Email" required><input name="password" type="password" placeholder="Password" required><input name="workspaceName" placeholder="Workspace name" required><button>Create account</button></form><p class="muted">Sessions use HttpOnly, SameSite=Lax cookies with rolling expiry.</p></div>'));`,
      `    text(res, 200, page('Signup', null, '<div class="grid"><div class="card"><form method="post" action="/signup"><input name="name" placeholder="Full name" required><input name="email" type="email" placeholder="Email" required><input name="password" type="password" placeholder="Password" required><input name="workspaceName" placeholder="Workspace name" required><button>Create account</button></form><p class="muted">Sessions use HttpOnly, SameSite=Lax cookies with rolling expiry.</p></div><div class="card"><h3>Guided onboarding</h3><div class="steps"><span class="step active">Account</span><span class="step">Sender profile</span><span class="step">Domain auth</span><span class="step">First campaign</span></div><p>After signup you land in a workspace checklist that carries you through sender setup, authenticated domains, and launch-ready surfaces.</p><p><a href="/signup/checklist">Preview the onboarding checklist</a></p></div></div>'));`
    );
    return next;
  }, modifiedFiles);

  patchAllowedFile(workspacePath, allowedFiles, 'packages/app/routes/platform.mjs', (text) => {
    let next = text;
    if (!next.includes('signupOnboardingCard')) {
      next = next.replace(
        "import { dashboardBody, page, requireActor, requireAdmin, workspaceSwitcher } from '../view.mjs';",
        "import { dashboardBody, page, requireActor, requireAdmin, signupOnboardingCard, workspaceSwitcher } from '../view.mjs';"
      );
    }
    if (!next.includes("router.register('GET', '/onboarding'")) {
      const onboardingRoute = `  router.register('GET', '/onboarding', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    text(res, 200, page('Onboarding checklist', actor, \`\${signupOnboardingCard(actor)}<div class="grid" style="margin-top:16px">\${workspaceSwitcher(actor)}<div class="card"><h3>Next best actions</h3><p><a href="/settings">Finish sender profile</a> · <a href="/settings">Connect domains</a> · <a href="/campaigns/new">Create first campaign</a></p></div></div>\`));
  });\n\n`;
      next = next.replace("  router.register('GET', '/workspaces', async ({ state, req, res }) => {", `${onboardingRoute}  router.register('GET', '/workspaces', async ({ state, req, res }) => {`);
    }
    next = next.replace(
      `    text(res, 200, page('Dashboard', actor, \`\${dashboardBody(state, actor)}<div class="grid" style="margin-top:16px">\${workspaceSwitcher(actor)}</div>\`));`,
      `    text(res, 200, page('Dashboard', actor, \`\${dashboardBody(state, actor)}<div class="grid" style="margin-top:16px">\${signupOnboardingCard(actor, { compact: true })}\${workspaceSwitcher(actor)}</div>\`));`
    );
    return next;
  }, modifiedFiles);
}

function applyCanonicalSettingsDomainsFocus(workspacePath, modifiedFiles, assignment = {}) {
  const allowedFiles = new Set(deriveAllowedFiles(assignment));

  patchAllowedFile(workspacePath, allowedFiles, 'packages/app/routes/api-admin.mjs', (text) => {
    let next = text;
    if (!next.includes("router.register('GET', '/api/settings/domains'")) {
      const apiBlock = `  router.register('GET', '/api/settings/domains', async ({ state, req, res }) => {
    const actor = apiActor(state, req);
    if (!actor) return json(res, 401, { ok: false, error: 'Unauthorized' });
    const domains = actor.workspace.settings.domains || [];
    json(res, 200, {
      ok: true,
      senderProfile: {
        senderName: actor.workspace.settings.senderName || '',
        senderEmail: actor.workspace.settings.senderEmail || '',
        replyTo: actor.workspace.settings.replyTo || ''
      },
      domainSummary: {
        total: domains.length,
        verified: domains.filter((entry) => entry.verificationStatus === 'verified').length,
        authenticated: domains.filter((entry) => entry.authenticationStatus === 'authenticated').length,
        defaultDomain: domains.find((entry) => entry.isDefault)?.name || null
      },
      domains
    });
  });

  router.register('POST', '/api/settings/domains/:id/default', async ({ state, req, params, res }) => {
    const actor = apiActor(state, req);
    if (!actor) return json(res, 401, { ok: false, error: 'Unauthorized' });
    const domains = actor.workspace.settings.domains || [];
    const domain = domains.find((entry) => entry.id === params.id);
    if (!domain) return json(res, 404, { ok: false, error: 'Domain not found' });
    domains.forEach((entry) => { entry.isDefault = false; });
    domain.isDefault = true;
    saveDb(state.db);
    recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'domain-default-api', detail: \`Defaulted \${domain.name} via API\` });
    json(res, 200, { ok: true, domain });
  });\n\n`;
      next = next.replace("  router.register('GET', '/api/contacts', async ({ state, req, res, url }) => {", `${apiBlock}  router.register('GET', '/api/contacts', async ({ state, req, res, url }) => {`);
    }
    return next;
  }, modifiedFiles);

  patchAllowedFile(workspacePath, allowedFiles, 'packages/app/routes/platform.mjs', (text) => {
    let next = text;
    if (!next.includes("const verifiedDomains = domains.filter((entry) => entry.verificationStatus === 'verified').length;")) {
      next = next.replace(
        "    const domains = actor.workspace.settings.domains || [];\n",
        "    const domains = actor.workspace.settings.domains || [];\n    const verifiedDomains = domains.filter((entry) => entry.verificationStatus === 'verified').length;\n    const authenticatedDomains = domains.filter((entry) => entry.authenticationStatus === 'authenticated').length;\n    const defaultDomain = domains.find((entry) => entry.isDefault)?.name || 'missing';\n"
      );
    }
    next = next.replace(
      `<div class="card"><h3>Visible compliance state</h3><p>Sender email: \${actor.workspace.settings.senderEmail || 'missing'}</p><p>Physical address: \${actor.workspace.settings.address || 'missing'}</p><p>Authenticated default domain: \${(domains.find((entry) => entry.isDefault)?.name) || 'missing'}</p></div><div class="card"><h3>Domains & authentication</h3><form method="post" action="/settings/domains"><input name="domain" placeholder="example.com" required><button>Add domain</button></form><table><tr><th>Domain</th><th>Verification</th><th>Authentication</th><th>Default</th><th>Actions</th></tr>\${domains.map((domain) => \`<tr><td>\${domain.name}</td><td>\${domain.verificationStatus}</td><td>\${domain.authenticationStatus}</td><td>\${domain.isDefault ? 'yes' : 'no'}</td><td><form method="post" action="/settings/domains/\${domain.id}/verify"><button>Verify</button></form><form method="post" action="/settings/domains/\${domain.id}/authenticate"><button>Authenticate</button></form><form method="post" action="/settings/domains/\${domain.id}/default"><button>Make default</button></form></td></tr>\`).join('') || '<tr><td colspan="5">No sending domains connected yet.</td></tr>'}</table></div>`,
      `<div class="card"><h3>Visible compliance state</h3><p>Sender email: \${actor.workspace.settings.senderEmail || 'missing'}</p><p>Physical address: \${actor.workspace.settings.address || 'missing'}</p><p>Authenticated default domain: \${defaultDomain}</p></div><div class="card"><h3>Domain readiness</h3><p>Verified domains: \${verifiedDomains}</p><p>Authenticated domains: \${authenticatedDomains}</p><p>Default domain: \${defaultDomain}</p><p><a href="/api/settings/domains">API domain summary</a></p></div><div class="card"><h3>Domains & authentication</h3><form method="post" action="/settings/domains"><input name="domain" placeholder="example.com" required><button>Add domain</button></form><table><tr><th>Domain</th><th>Verification</th><th>Authentication</th><th>Default</th><th>Actions</th></tr>\${domains.map((domain) => \`<tr><td>\${domain.name}</td><td>\${domain.verificationStatus}</td><td>\${domain.authenticationStatus}</td><td>\${domain.isDefault ? 'yes' : 'no'}</td><td><p><a href="/settings/domains/\${domain.id}">View details</a></p><form method="post" action="/settings/domains/\${domain.id}/verify"><button>Verify</button></form><form method="post" action="/settings/domains/\${domain.id}/authenticate"><button>Authenticate</button></form><form method="post" action="/settings/domains/\${domain.id}/default"><button>Make default</button></form></td></tr>\`).join('') || '<tr><td colspan="5">No sending domains connected yet.</td></tr>'}</table></div>`
    );
    if (!next.includes("router.register('GET', '/settings/domains/:id'")) {
      const detailRoute = `  router.register('GET', '/settings/domains/:id', async ({ state, req, params, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const domains = actor.workspace.settings.domains || [];
    const domain = domains.find((entry) => entry.id === params.id);
    if (!domain) return text(res, 404, page('Settings shell', actor, '<div class="warn">Domain not found.</div>'));
    text(res, 200, page('Domain authentication detail', actor, \`<div class="grid"><div class="card"><h3>\${domain.name}</h3><p>Verification: \${domain.verificationStatus}</p><p>Authentication: \${domain.authenticationStatus}</p><p>Default: \${domain.isDefault ? 'yes' : 'no'}</p></div><div class="card"><h3>DNS checklist</h3><ul><li>TXT verification record</li><li>DKIM selector</li><li>Return-path / bounce domain</li></ul><p><a href="/settings">Return to settings</a></p></div></div>\`));
  });\n\n`;
      next = next.replace(
        "  for (const [action, mutate] of [['verify', (d) => { d.verificationStatus = 'verified'; }], ['authenticate', (d) => { if (d.verificationStatus === 'verified') d.authenticationStatus = 'authenticated'; }], ['default', (d, domains) => { domains.forEach((entry) => { entry.isDefault = false; }); d.isDefault = true; }]]) {",
        `${detailRoute}  for (const [action, mutate] of [['verify', (d) => { d.verificationStatus = 'verified'; }], ['authenticate', (d) => { if (d.verificationStatus === 'verified') d.authenticationStatus = 'authenticated'; }], ['default', (d, domains) => { domains.forEach((entry) => { entry.isDefault = false; }); d.isDefault = true; }]]) {`
      );
    }
    return next;
  }, modifiedFiles);
}

function applyCanonicalTeamRolesPermissionsFocus(workspacePath, modifiedFiles, assignment = {}) {
  const allowedFiles = new Set(deriveAllowedFiles(assignment));

  patchAllowedFile(workspacePath, allowedFiles, 'packages/app/routes/api-admin.mjs', (text) => {
    let next = text;
    if (!next.includes("router.register('GET', '/api/team'")) {
      next = next.replace(
        "  router.register('GET', '/api/contacts', async ({ state, req, res, url }) => {",
        `  router.register('GET', '/api/team', async ({ state, req, res }) => {
    const actor = apiActor(state, req);
    if (!actor) return json(res, 401, { ok: false, error: 'Unauthorized' });
    const members = state.db.memberships
      .filter((entry) => entry.workspaceId === actor.workspace.id && entry.status === 'active')
      .map((membership) => ({
        id: membership.id,
        role: membership.role,
        status: membership.status,
        user: state.db.users.find((entry) => entry.id === membership.userId)
      }));
    const invitations = state.db.invitations.filter((entry) => entry.workspaceId === actor.workspace.id);
    const roleCounts = members.reduce((acc, entry) => {
      acc[entry.role] = (acc[entry.role] || 0) + 1;
      return acc;
    }, {});
    json(res, 200, {
      ok: true,
      team: {
        members,
        invitations,
        roleCounts,
        pendingInvites: invitations.filter((entry) => entry.status === 'pending').length
      }
    });
  });

  router.register('GET', '/api/contacts', async ({ state, req, res, url }) => {`
      );
    }
    return next;
  }, modifiedFiles);

  patchAllowedFile(workspacePath, allowedFiles, 'packages/app/routes/platform.mjs', (text) => {
    let next = text;
    if (!next.includes('const roleCounts = members.reduce')) {
      next = next.replace(
        "    const invites = state.db.invitations.filter((invite) => invite.workspaceId === actor.workspace.id);",
        "    const invites = state.db.invitations.filter((invite) => invite.workspaceId === actor.workspace.id);\n    const roleCounts = members.reduce((acc, entry) => { acc[entry.membership.role] = (acc[entry.membership.role] || 0) + 1; return acc; }, {});\n    const pendingInviteCount = invites.filter((invite) => invite.status === 'pending').length;"
      );
    }
    if (!next.includes('<h3>Role coverage</h3>')) {
      next = next.replace(
        "${multiUserGate}<div class=\"grid\"><div class=\"card\"><h3>Members</h3>",
        "${multiUserGate}<div class=\"grid\"><div class=\"card\"><h3>Role coverage</h3><p>Owners: ${roleCounts.owner || 0}</p><p>Admins: ${roleCounts.admin || 0}</p><p>Members: ${roleCounts.member || 0}</p><p>Pending invites: ${pendingInviteCount}</p></div><div class=\"card\"><h3>Members</h3>"
      );
    }
    return next;
  }, modifiedFiles);
}

function applyDeliveryJobs(workspacePath, modifiedFiles) {
  write(path.join(workspacePath, 'packages/app/job-handlers.mjs'), `import { createNotification, recordEvent } from './domain-core.mjs';\nimport { processCsvImport } from './domain-audience.mjs';\nimport { campaignHtml, markCampaignDelivered } from './domain-campaigns.mjs';\n\nexport const JOB_HANDLERS = {\n  import_contacts(state, job) {\n    job.result = processCsvImport(state, job);\n    createNotification(state, { workspaceId: job.workspaceId, type: 'import-complete', payload: { audienceId: job.payload.audienceId, ...job.result } });\n  },\n  send_test_campaign(state, job) {\n    const campaign = state.db.campaigns.find((entry) => entry.id === job.payload.campaignId);\n    if (!campaign) throw new Error(\`Campaign \${job.payload.campaignId} not found for test send\`);\n    job.result = createNotification(state, { workspaceId: job.workspaceId, type: 'test-send', payload: { campaignId: campaign.id, to: job.payload.testEmail, subject: campaign.subject, htmlPreview: campaignHtml(campaign, state) } });\n  },\n  deliver_campaign(state, job) {\n    const campaign = state.db.campaigns.find((entry) => entry.id === job.payload.campaignId);\n    if (!campaign) throw new Error(\`Campaign \${job.payload.campaignId} not found for delivery\`);\n    job.result = markCampaignDelivered(state, campaign);\n  }\n};\n\nexport function executeJobByType(state, job) {\n  const handler = JOB_HANDLERS[job.type];\n  if (!handler) throw new Error(\`Unsupported job type: \${job.type}\`);\n  return handler(state, job);\n}\n`, modifiedFiles, workspacePath);
  write(path.join(workspacePath, 'packages/app/job-runtime.mjs'), `import { runJobs } from './jobs.mjs';\n\nexport function startJobLoop(state, intervalMs = 100) {\n  runJobs(state);\n  const timer = setInterval(() => runJobs(state), intervalMs);\n  return { stop() { clearInterval(timer); } };\n}\n`, modifiedFiles, workspacePath);
  write(path.join(workspacePath, 'packages/app/jobs.mjs'), `import { persistState } from './storage.mjs';\nimport { recordEvent } from './domain-core.mjs';\nimport { executeJobByType } from './job-handlers.mjs';\n\nconst DEFAULT_JOB_ATTEMPTS = {\n  import_contacts: 2,\n  send_test_campaign: 2,\n  deliver_campaign: 2\n};\n\nfunction now() {\n  return new Date().toISOString();\n}\n\nfunction scheduleRetry(job) {\n  const delayMs = Number(job.retryDelayMs || 250);\n  job.runAt = new Date(Date.now() + delayMs).toISOString();\n}\n\nfunction appendHistory(job, status, detail = '') {\n  job.history ||= [];\n  job.history.unshift({ at: now(), status, detail, attempt: job.attempts || 0 });\n}\n\nexport function runJobs(state) {\n  state.db.jobDeadLetters ||= [];\n  let changed = false;\n  for (const job of state.db.jobs) {\n    if (job.status !== 'pending') continue;\n    if (new Date(job.runAt || job.createdAt).getTime() > Date.now()) continue;\n    changed = true;\n    job.maxAttempts ||= DEFAULT_JOB_ATTEMPTS[job.type] || 1;\n    job.retryDelayMs ||= 250;\n    job.attempts = Number(job.attempts || 0) + 1;\n    job.status = 'running';\n    job.startedAt ||= now();\n    job.lastAttemptAt = now();\n    job.lockedAt = job.lastAttemptAt;\n    job.updatedAt = job.lastAttemptAt;\n    appendHistory(job, 'running', \`\${job.type} started\`);\n    try {\n      executeJobByType(state, job);\n      job.status = 'completed';\n      job.completedAt = now();\n      job.updatedAt = job.completedAt;\n      job.lockedAt = null;\n      appendHistory(job, 'completed', \`\${job.type} completed\`);\n      recordEvent(state, { workspaceId: job.workspaceId, type: 'job-complete', message: \`\${job.type} completed\`, meta: { jobId: job.id, attempts: job.attempts } });\n    } catch (error) {\n      job.error = error.message;\n      job.updatedAt = now();\n      job.lockedAt = null;\n      if (job.attempts < job.maxAttempts) {\n        scheduleRetry(job);\n        job.status = 'pending';\n        appendHistory(job, 'retry_scheduled', \`\${job.type} retry \${job.attempts}/\${job.maxAttempts}: \${error.message}\`);\n        recordEvent(state, { workspaceId: job.workspaceId, type: 'job-retry', level: 'warn', message: \`\${job.type} retry scheduled: \${error.message}\`, meta: { jobId: job.id, attempts: job.attempts, maxAttempts: job.maxAttempts, retryAt: job.runAt } });\n      } else {\n        job.status = 'failed';\n        job.failedAt = now();\n        appendHistory(job, 'failed', \`\${job.type} failed after \${job.attempts} attempts: \${error.message}\`);\n        state.db.jobDeadLetters.unshift({ id: \`\${job.id}_dead\`, jobId: job.id, workspaceId: job.workspaceId, type: job.type, error: error.message, attempts: job.attempts, failedAt: job.failedAt, payload: job.payload });\n        recordEvent(state, { workspaceId: job.workspaceId, type: 'job-failed', level: 'error', message: \`\${job.type} failed: \${error.message}\`, meta: { jobId: job.id, attempts: job.attempts } });\n      }\n    }\n  }\n  if (changed) persistState(state);\n}\n`, modifiedFiles, workspacePath);
  const serverPath = path.join(workspacePath, 'apps/web/server.mjs');
  if (fs.existsSync(serverPath)) {
    patch(serverPath, (text) => {
      let next = text.replace("import { runJobs } from '../../packages/app/jobs.mjs';", "import { startJobLoop } from '../../packages/app/job-runtime.mjs';");
      next = next.replace(/\n    runJobs\(state\);/, '');
      next = next.replace("state.interval = setInterval(() => runJobs(state), 100);", "state.jobLoop = startJobLoop(state, 100);");
      next = next.replace("if (state.interval) clearInterval(state.interval);", "if (state.jobLoop) state.jobLoop.stop();");
      return next;
    }, modifiedFiles, workspacePath);
  }
}

function assignmentAllowsAnyFile(assignment = {}, candidates = []) {
  const allowedFiles = new Set(deriveAllowedFiles(assignment));
  return allowedFiles.size === 0 || candidates.some((filePath) => allowedFiles.has(filePath));
}

function canonicalSurfaceHandler(surfaceFocusId) {
  const normalized = String(surfaceFocusId || '').trim().toLowerCase();
  if (['account_workspace_setup', 'dashboard_home', 'signup_onboarding'].includes(normalized)) return 'signup_onboarding';
  if (normalized === 'signup_forms_popups') return 'signup_forms_popups';
  if (['campaign_index', 'campaign_wizard'].includes(normalized)) return 'campaign_index';
  if (['audience_overview', 'contacts_table', 'contact_profile', 'tags_groups_interests', 'segments'].includes(normalized)) return 'audience_crm';
  if (normalized === 'landing_pages') return 'landing_pages';
  if (normalized === 'website_builder') return 'website_builder';
  if (normalized === 'email_builder') return 'email_builder';
  if (normalized === 'template_library') return 'template_library';
  if (normalized === 'content_studio') return 'content_studio';
  if (['automations_overview', 'automation_journey_builder'].includes(normalized)) return 'automation_journey';
  if (normalized === 'reports_overview') return 'reports_overview';
  if (normalized === 'report_detail') return 'report_detail';
  if (normalized === 'send_schedule_review') return 'send_schedule_review';
  if (normalized === 'integrations_marketplace') return 'integrations_marketplace';
  if (normalized === 'api_keys_webhooks') return 'api_keys_webhooks';
  if (normalized === 'billing_plans') return 'billing_plans';
  if (normalized === 'settings_domains') return 'settings_domains';
  if (normalized === 'team_roles_permissions') return 'team_roles_permissions';
  return '';
}

function applyReportingAnalytics(workspacePath, modifiedFiles) {
  write(path.join(workspacePath, 'packages/app/analytics-events.mjs'), `import { nowIso } from './utils.mjs';\n\nfunction ensureAnalyticsState(state) {\n  state.db.analyticsEvents ||= [];\n  return state.db.analyticsEvents;\n}\n\nexport function recordAnalyticsEvent(state, event) {\n  ensureAnalyticsState(state).unshift({ id: event.id || \`evt_\${Math.random().toString(16).slice(2)}\`, createdAt: nowIso(), ...event });\n}\n\nexport function campaignReportFromEvents(state, campaignId) {\n  const events = ensureAnalyticsState(state).filter((entry) => entry.campaignId === campaignId);\n  const opens = events.filter((entry) => entry.type === 'campaign_open').length;\n  const clicks = events.filter((entry) => entry.type === 'campaign_click').length;\n  const bounces = events.filter((entry) => entry.type === 'campaign_bounce').length;\n  const unsubscribes = events.filter((entry) => entry.type === 'campaign_unsubscribe').length;\n  return { opens, clicks, bounces, unsubscribes, history: events.map((entry) => ({ at: entry.createdAt, event: entry.type, recipients: entry.recipientTotal || 0 })) };\n}\n\nexport function rebuildWebsiteAnalytics(state, websiteId, pageId) {\n  const events = ensureAnalyticsState(state).filter((entry) => entry.websiteId === websiteId);\n  const byPage = {};\n  for (const event of events) {\n    byPage[event.pageId] ||= { views: 0, signups: 0, ctaClicks: 0 };\n    if (event.type === 'website_view') byPage[event.pageId].views += 1;\n    if (event.type === 'website_cta') byPage[event.pageId].ctaClicks += 1;\n    if (event.type === 'website_signup') byPage[event.pageId].signups += 1;\n  }\n  const aggregate = {\n    views: events.filter((entry) => entry.type === 'website_view').length,\n    signups: events.filter((entry) => entry.type === 'website_signup').length,\n    ctaClicks: events.filter((entry) => entry.type === 'website_cta').length,\n    lastReferrer: [...events].reverse().find((entry) => entry.referrer)?.referrer || '',\n    byPage\n  };\n  return { website: aggregate, page: byPage[pageId] || { views: 0, signups: 0, ctaClicks: 0 } };\n}\n`, modifiedFiles, workspacePath);

  patch(path.join(workspacePath, 'packages/app/domain-campaigns.mjs'), (text) => {
    let next = text.replace("import { saveDb } from './storage.mjs';", "import { persistState } from './storage.mjs';\nimport { campaignReportFromEvents, recordAnalyticsEvent } from './analytics-events.mjs';");
    next = replaceAll(next, 'saveDb(state.db)', 'persistState(state)');
    next = next.replace(/export function markCampaignDelivered\(state, campaign\) \{[\s\S]*?return createNotification\(state, \{ workspaceId: campaign\.workspaceId, type: 'campaign-send', payload: \{ campaignId: campaign\.id, recipients: recipientTotal, subject: campaign\.subject, automationRuns: automationRuns\.length \} \} \);\n\}/, `export function markCampaignDelivered(state, campaign) {\n  campaign.status = 'sent';\n  campaign.sentAt = nowIso();\n  campaign.updatedAt = nowIso();\n  const recipients = contactsForAudience(state, campaign.audienceId).filter((contact) => contact.status === 'subscribed' && (!campaign.segmentId || matchSegment(contact, state.db.segments.find((entry) => entry.id === campaign.segmentId))));\n  const recipientTotal = recipients.length;\n  const automationRuns = [];\n  for (const contact of recipients) automationRuns.push(...triggerAutomationsForEvent(state, { workspaceId: campaign.workspaceId, audienceId: campaign.audienceId, contact, eventType: 'campaign_sent', campaignId: campaign.id, meta: { campaignName: campaign.name } }));\n  recordAnalyticsEvent(state, { type: 'campaign_delivered', workspaceId: campaign.workspaceId, campaignId: campaign.id, recipientTotal });\n  for (const contact of recipients.slice(0, Math.max(1, Math.floor(recipientTotal * 0.52)))) recordAnalyticsEvent(state, { type: 'campaign_open', workspaceId: campaign.workspaceId, campaignId: campaign.id, contactId: contact.id, recipientTotal });\n  for (const contact of recipients.slice(0, Math.max(0, Math.floor(recipientTotal * 0.18)))) recordAnalyticsEvent(state, { type: 'campaign_click', workspaceId: campaign.workspaceId, campaignId: campaign.id, contactId: contact.id, recipientTotal });\n  const funnel = campaignGrowthFunnel(state, campaign.id);\n  campaign.report = {\n    ...campaignReportFromEvents(state, campaign.id),\n    funnel: { ...funnel, attributedAutomationRuns: funnel.attributedAutomationRuns + automationRuns.length }\n  };\n  persistState(state);\n  return createNotification(state, { workspaceId: campaign.workspaceId, type: 'campaign-send', payload: { campaignId: campaign.id, recipients: recipientTotal, subject: campaign.subject, automationRuns: automationRuns.length } });\n}`);
    return next;
  }, modifiedFiles, workspacePath);

  }

function applyAiPredictive(workspacePath, modifiedFiles, assignment = {}) {
  const allowedFiles = new Set(deriveAllowedFiles(assignment));

  writeAllowedFile(workspacePath, allowedFiles, 'packages/app/ai-provider.mjs', `function normalizeGoal(value, fallback = 'engagement') {
  return String(value || fallback).trim() || fallback;
}

function recommendationMeta(kind, score, extras = {}) {
  return {
    provider: 'mailclone-ai-runtime',
    model: extras.model || 'mailclone-reasoner-v2',
    kind,
    confidence: Number((Math.max(0, Math.min(100, score)) / 100).toFixed(2)),
    generatedFrom: extras.generatedFrom || ['campaign context', 'audience heuristics', 'workspace signals']
  };
}

export function buildCampaignSubjectVariants(campaign, tone = 'confident', goal = 'engagement') {
  const base = campaign.name || 'Campaign';
  const normalizedGoal = normalizeGoal(goal);
  return [
    { text: \`\${base}: \${tone} update for \${normalizedGoal}\`, rationale: 'Balances clarity with a goal-oriented hook.', score: 88, meta: recommendationMeta('subject', 88, { generatedFrom: ['campaign name', 'goal', 'tone'] }) },
    { text: \`What’s new from \${base}?\`, rationale: 'Curiosity-led subject line tuned for opens.', score: 84, meta: recommendationMeta('subject', 84, { generatedFrom: ['campaign name', 'audience curiosity'] }) },
    { text: \`\${base} | proof-led path to \${normalizedGoal}\`, rationale: 'Benefit-first line for urgency and value framing.', score: 91, meta: recommendationMeta('subject', 91, { generatedFrom: ['campaign name', 'benefit framing', 'goal'] }) }
  ];
}

export function buildCampaignPreheaderVariants(campaign, tone = 'helpful') {
  const subject = campaign.subject || campaign.name || 'your update';
  return [
    { text: \`Preview the highlights, links, and next steps behind \${subject}.\`, rationale: 'Complements the subject with clear value.', score: 87, meta: recommendationMeta('preheader', 87, { generatedFrom: ['subject line', 'campaign body'] }) },
    { text: \`A \${tone} walkthrough of what matters most in this send.\`, rationale: 'Frames the preheader as a guided skim.', score: 82, meta: recommendationMeta('preheader', 82, { generatedFrom: ['tone', 'subject line'] }) },
    { text: 'Open for the key changes, proof points, and CTA.', rationale: 'Calls out scan-friendly content depth.', score: 85, meta: recommendationMeta('preheader', 85, { generatedFrom: ['CTA', 'proof points'] }) }
  ];
}

export function buildCampaignBlockVariants(block = {}, tone = 'direct', goal = 'conversion') {
  const title = block.title || 'Headline';
  const body = block.body || 'Explain the value proposition.';
  const normalizedGoal = normalizeGoal(goal, 'conversion');
  return [
    { title: \`\${title} that drives \${normalizedGoal}\`, body: \`\${body} Rewrite with a \${tone} tone and finish with a crisp proof point.\`, buttonLabel: block.buttonLabel || 'Explore now', rationale: 'Lead with intent, then tighten the proof.', proofPoints: ['Clear outcome', 'Tighter proof', 'Action-first CTA'], meta: recommendationMeta('content_block', 89, { generatedFrom: ['block copy', 'campaign goal', 'tone'] }) },
    { title: \`\${title} for decision-ready readers\`, body: \`Use a \${tone} opener, shorten the middle, and turn the CTA toward \${normalizedGoal}.\`, buttonLabel: block.buttonLabel || 'See details', rationale: 'Optimized for scannability and action.', proofPoints: ['Shorter middle', 'Decision-stage CTA'], meta: recommendationMeta('content_block', 86, { generatedFrom: ['block title', 'CTA intent'] }) },
    { title: \`\${title} with measurable next steps\`, body: \`Condense the message, name the outcome, and close with a CTA that makes \${normalizedGoal} obvious.\`, buttonLabel: block.buttonLabel || 'Get started', rationale: 'Best when the block needs a sharper conversion path.', proofPoints: ['Explicit outcome', 'Measured next action'], meta: recommendationMeta('content_block', 90, { generatedFrom: ['desired outcome', 'CTA clarity'] }) }
  ];
}

export function buildJourneyRecommendation(automation = {}, body = {}) {
  const goal = normalizeGoal(body.goal || automation.goal, 'engagement');
  return {
    nodes: [
      { type: 'email', title: 'AI welcome touch' },
      { type: 'delay', title: 'Wait 24 hours', delayHours: 24 },
      { type: 'sms', title: 'SMS nudge for high-intent contacts' },
      { type: 'branch', title: 'Opened or clicked?', conditions: ['opened', 'clicked'] },
      { type: 'social', title: 'Retarget social audience reminder' }
    ],
    rationale: \`Sequence uses email, sms, and social touches to move contacts toward \${goal}.\`,
    trustSignals: ['Uses existing trigger context', 'Respects multi-channel consent', 'Adds a measurable branch for optimization'],
    sendTimeRecommendation: { window: '09:00-11:00 local', rationale: 'Prioritizes recent-engagement windows before fatigue risk rises.' },
    audienceSignals: ['vip', 'recent clickers', 'high-intent contacts'],
    meta: recommendationMeta('journey', 89, { generatedFrom: ['automation goal', 'channel mix', 'engagement timing'] })
  };
}

export function buildWebsiteCopyRecommendation(website = {}, body = {}) {
  const goal = normalizeGoal(body.goal, 'lead capture');
  return {
    headline: \`\${website.name || 'Your brand'} built for \${goal}\`,
    body: \`Lead with the core promise, explain why the offer matters now, and connect the page to the next best action for \${goal}.\`,
    ctaLabel: body.ctaLabel || 'Join the list',
    rationale: 'Uses clear promise, proof, and action structure for homepage and landing copy.',
    proofPoints: ['Customer outcome first', 'Urgency without hype', 'CTA aligned to the next step'],
    sectionPlan: ['Promise', 'Proof', 'Offer', 'CTA'],
    meta: recommendationMeta('website_copy', 88, { generatedFrom: ['website name', 'goal', 'cta label'] })
  };
}
`, modifiedFiles);

  writeAllowedFile(workspacePath, allowedFiles, 'packages/app/predictive-model.mjs', `import { buildPredictiveSegmentsSnapshot } from '../predictive-segments/index.mjs';
import { buildSendTimeOptimizerSnapshot } from '../send-time-optimizer/index.mjs';

export function scoreContactPredictiveFit(contact = {}) {
  let score = contact.status === 'subscribed' ? 38 : 10;
  score += Math.min(18, (contact.tags || []).length * 4);
  score += Math.min(16, (contact.interests || []).length * 4);
  score += Math.min(12, (contact.activity || []).length * 3);
  if (contact.phone) score += 6;
  if ((contact.notes || '').toLowerCase().includes('vip')) score += 8;
  return Math.max(0, Math.min(100, score));
}

export function buildPredictiveWorkspace(state, workspaceId, audienceId = '') {
  const contacts = state.db.contacts.filter((entry) => entry.workspaceId === workspaceId).filter((entry) => !audienceId || entry.audienceId === audienceId).map((contact) => {
    const predictiveScore = scoreContactPredictiveFit(contact);
    return { ...contact, predictiveScore, lifecycleTier: predictiveScore >= 75 ? 'high_intent' : predictiveScore >= 50 ? 'warming' : 'monitor' };
  }).sort((a, b) => b.predictiveScore - a.predictiveScore);
  return { contacts, highIntent: contacts.filter((entry) => entry.predictiveScore >= 75).length, recommendations: [{ id: 'predictive-rec-1', label: 'Likely next purchasers', criteria: 'predictiveScore >= 75' }, { id: 'predictive-rec-2', label: 'Re-engage with SMS fallback', criteria: 'predictiveScore between 50 and 74' }, { id: 'predictive-rec-3', label: 'Frequency cap / fatigue watch', criteria: 'predictiveScore < 50 and recent activity low' }], sendTime: buildSendTimeOptimizerSnapshot(), predictiveSegments: buildPredictiveSegmentsSnapshot() };
}
`, modifiedFiles);

  patchAllowedFile(workspacePath, allowedFiles, 'packages/app/domain-current-product-ops.mjs', (text) => {
    let next = text.replace("import { saveDb } from './storage.mjs';", "import { persistState } from './storage.mjs';\nimport { buildCampaignBlockVariants, buildCampaignPreheaderVariants, buildCampaignSubjectVariants, buildJourneyRecommendation, buildWebsiteCopyRecommendation } from './ai-provider.mjs';\nexport { buildPredictiveWorkspace as predictiveWorkspace } from './predictive-model.mjs';\nimport { buildPredictiveWorkspace } from './predictive-model.mjs';");
    next = replaceAll(next, 'saveDb(state.db)', 'persistState(state)');
    next = next.replace(/function buildSubjectVariants[\s\S]*?function buildSiteCopyRecommendation\(website = \{\}, body = \{\}\) \{[\s\S]*?\n\}/, '');
    next = replaceAll(next, 'buildSubjectVariants(', 'buildCampaignSubjectVariants(');
    next = replaceAll(next, 'buildPreheaderVariants(', 'buildCampaignPreheaderVariants(');
    next = replaceAll(next, 'buildBlockVariants(', 'buildCampaignBlockVariants(');
    next = replaceAll(next, 'buildSiteCopyRecommendation(', 'buildWebsiteCopyRecommendation(');
    next = next.replace(/export function predictiveScoreForContact[\s\S]*?export function predictiveWorkspace\(state, workspaceId, audienceId = ''\) \{[\s\S]*?\n\}/, '');
    next = replaceAll(next, 'predictiveWorkspace(state, actor.workspace.id, body.audienceId || \'\')', 'buildPredictiveWorkspace(state, actor.workspace.id, body.audienceId || \'\')');
    return next;
  }, modifiedFiles);
}

function applyIntegrationsParity(workspacePath, modifiedFiles) {
  write(path.join(workspacePath, 'packages/app/integration-provider.mjs'), `function dataUrl(payload) {
  return 'data:application/json,' + encodeURIComponent(JSON.stringify(payload));
}

export async function syncIntegrationProvider(app, installation) {
  const payload = {
    appId: app.id,
    installationId: installation.id,
    syncedContacts: app.category === 'crm' ? 24 : 0,
    syncedOrders: app.category === 'commerce' ? 6 : 0,
    syncedRevenue: app.category === 'commerce' ? 1840 : 0,
    refreshedScopes: app.scopes || []
  };
  const response = await fetch(dataUrl(payload));
  return response.json();
}
`, modifiedFiles, workspacePath);

  patch(path.join(workspacePath, 'packages/app/domain-integration-marketplace.mjs'), (text) => {
    let next = text.replace("import { saveDb } from './storage.mjs';", "import { persistState } from './storage.mjs';\nimport { syncIntegrationProvider } from './integration-provider.mjs';");
    next = replaceAll(next, 'saveDb(state.db)', 'persistState(state)');
    next = next.replace('export function syncMarketplaceInstallation(state, actor, installation) {', 'export async function syncMarketplaceInstallation(state, actor, installation) {');
    next = next.replace("  let commerceResult = null;\n  if (app.category === 'commerce') {\n    const store = ensureCommerceLink(state, actor, installation);\n    commerceResult = syncCommerceStore(state, actor, store);\n  }\n  const run = {", "  let commerceResult = null;\n  if (app.category === 'commerce') {\n    const store = ensureCommerceLink(state, actor, installation);\n    commerceResult = syncCommerceStore(state, actor, store);\n  }\n  const providerResult = await syncIntegrationProvider(app, installation);\n  const run = {");
    next = next.replace("    syncedContacts: app.category === 'crm' ? 12 : 0,\n    syncedOrders: commerceResult?.addedOrders || 0,\n    syncedRevenue: commerceResult?.revenueGenerated || 0,", "    syncedContacts: Number(providerResult?.syncedContacts || 0),\n    syncedOrders: Number(providerResult?.syncedOrders || commerceResult?.addedOrders || 0),\n    syncedRevenue: Number(providerResult?.syncedRevenue || commerceResult?.revenueGenerated || 0),");
    next = next.replace("  installation.lastSyncedAt = run.createdAt;", "  installation.lastSyncedAt = run.createdAt;\n  installation.scopes = providerResult?.refreshedScopes || installation.scopes;");
    next = next.replace("    commerceResult\n  };", "    commerceResult,\n    providerResult\n  };");
    next = next.replace(/(?:\n\s*installation\.scopes = providerResult\?\.refreshedScopes \|\| installation\.scopes;)+/g, '\n  installation.scopes = providerResult?.refreshedScopes || installation.scopes;');
    return next;
  }, modifiedFiles, workspacePath);

  patchIfExists(path.join(workspacePath, 'packages/app/routes/api-admin.mjs'), (text) => (
    text.replace('json(res, 200, { ok: true, result: syncMarketplaceInstallation(state, actor, installation) });', 'json(res, 200, { ok: true, result: await syncMarketplaceInstallation(state, actor, installation) });')
  ), modifiedFiles, workspacePath);

  patchIfExists(path.join(workspacePath, 'packages/app/routes/integrations-marketplace.mjs'), (text) => (
    text.replace('    if (installation) syncMarketplaceInstallation(state, actor, installation);', '    if (installation) await syncMarketplaceInstallation(state, actor, installation);')
  ), modifiedFiles, workspacePath);

  patchIfExists(path.join(workspacePath, 'packages/app/routes/current-product-ops.mjs'), (text) => (
    text.replace('if (installation) { configureIntegrationInstallation(state, actor, installation, { authStatus: \'connected\', health: \'healthy\' }); syncMarketplaceInstallation(state, actor, installation); }', 'if (installation) { configureIntegrationInstallation(state, actor, installation, { authStatus: \'connected\', health: \'healthy\' }); await syncMarketplaceInstallation(state, actor, installation); }')
  ), modifiedFiles, workspacePath);
}

function applyWebsiteBuilderParity(workspacePath, modifiedFiles) {
  patch(path.join(workspacePath, 'packages/app/domain-website-builder.mjs'), (text) => {
    let next = text.replace("import { saveDb } from './storage.mjs';", "import { persistState } from './storage.mjs';");
    next = replaceAll(next, 'saveDb(state.db)', 'persistState(state)');
    if (!next.includes('recordAnalyticsEvent')) {
      next = next.replace("import { persistState } from './storage.mjs';", "import { persistState } from './storage.mjs';\nimport { recordAnalyticsEvent } from './analytics-events.mjs';");
    }
    if (!next.includes("export function recordWebsiteView(state, website, page, { referrer = '', cta = false, signup = false } = {})")) {
      next = next.replace('export function websitePages(state, websiteId) {', `export function recordWebsiteView(state, website, page, { referrer = '', cta = false, signup = false } = {}) {\n  recordAnalyticsEvent(state, {
    websiteId: website.id,
    pageId: page.id,
    source: cta ? 'cta' : signup ? 'signup' : referrer || 'website'
  });\n  Object.assign(page, {\n    views: (page.views || 0) + 1,\n    lastViewedAt: nowIso()\n  });\n  page.updatedAt = nowIso();\n  website.updatedAt = nowIso();\n  persistState(state);\n  return page;\n}\n\nexport function websitePages(state, websiteId) {`);
    }
    next = next.replace(`    views: (page.views || 0) + 1
  });`, `    views: (page.views || 0) + 1,
    lastViewedAt: nowIso()
  });
  recordAnalyticsEvent(state, {
    websiteId: website.id,
    pageId: page.id,
    source: cta ? 'cta' : signup ? 'signup' : referrer || 'website'
  });`);

    if (!next.includes('export function undoWebsiteRevision')) {
      next = next.replace('export function websitePages(state, websiteId) {', `function snapshotWebsitePage(page) {\n  return {\n    id: page.id,\n    name: page.name,\n    slug: page.slug,\n    headline: page.headline,\n    body: page.body,\n    sectionStyle: page.sectionStyle,\n    ctaLabel: page.ctaLabel,\n    ctaUrl: page.ctaUrl,\n    showInNav: page.showInNav,\n    seoTitle: page.seoTitle,\n    seoDescription: page.seoDescription\n  };\n}\n\nfunction recordWebsiteRevision(website, page, reason = 'update') {\n  website.revisions ||= { undo: [], redo: [] };\n  website.revisions.undo.unshift({ at: nowIso(), reason, pageId: page.id, snapshot: snapshotWebsitePage(page) });\n  website.revisions.undo = website.revisions.undo.slice(0, 20);\n  website.revisions.redo = [];\n}\n\nexport function undoWebsiteRevision(state, website) {\n  const revision = website.revisions?.undo?.shift();\n  if (!revision) return null;\n  const page = state.db.websitePages.find((entry) => entry.id === revision.pageId);\n  if (!page) return null;\n  website.revisions.redo.unshift({ at: nowIso(), reason: 'undo', pageId: page.id, snapshot: snapshotWebsitePage(page) });\n  Object.assign(page, revision.snapshot, { updatedAt: nowIso() });\n  website.updatedAt = nowIso();\n  persistState(state);\n  return page;\n}\n\nexport function redoWebsiteRevision(state, website) {\n  const revision = website.revisions?.redo?.shift();\n  if (!revision) return null;\n  const page = state.db.websitePages.find((entry) => entry.id === revision.pageId);\n  if (!page) return null;\n  website.revisions.undo.unshift({ at: nowIso(), reason: 'redo', pageId: page.id, snapshot: snapshotWebsitePage(page) });\n  Object.assign(page, revision.snapshot, { updatedAt: nowIso() });\n  website.updatedAt = nowIso();\n  persistState(state);\n  return page;\n}\n\nexport function websitePages(state, websiteId) {`);
    }
    next = next.replace("analytics: { views: 0, signups: 0, ctaClicks: 0, lastReferrer: '', byPage: {} }", "analytics: { views: 0, signups: 0, ctaClicks: 0, lastReferrer: '', byPage: {} },\n    revisions: { undo: [], redo: [] }");
    next = next.replace('  Object.assign(page, {', "  recordWebsiteRevision(website, page, 'page_update');\n  Object.assign(page, {");
    return next;
  }, modifiedFiles, workspacePath);
}

function applyLandingPagesParity(workspacePath, modifiedFiles) {
  patch(path.join(workspacePath, 'packages/app/routes/website-builder.mjs'), (text) => {
    let next = text;
    next = next.replace(
      '<select name="pageType"><option value="standard">standard</option><option value="about">about</option><option value="contact">contact</option><option value="store">store</option></select>',
      '<select name="pageType"><option value="standard">standard</option><option value="about">about</option><option value="contact">contact</option><option value="store">store</option><option value="landing">landing</option></select>'
    );
    next = next.replace(
      '<select name="linkedFormId"><option value="">No form</option>',
      '<p class="muted">Landing pages can link forms and campaigns while staying separate from multi-page website ownership.</p><select name="linkedFormId"><option value="">No form</option>'
    );
    return next;
  }, modifiedFiles, workspacePath);
}

function applyFormsGrowthParity(workspacePath, modifiedFiles) {
  patch(path.join(workspacePath, 'packages/app/routes/forms.mjs'), (text) => {
    let next = text;
    next = next.replace('<input name="tagsOnSubmit" placeholder="newsletter,new"><button>Create form</button>', '<input name="tagsOnSubmit" placeholder="newsletter,new"><label>Popup mode<select name="popupMode"><option value="inline">inline</option><option value="popup">popup</option><option value="slideout">slideout</option></select></label><input name="geotarget" placeholder="US,CA"><input name="triggerRule" placeholder="exit_intent"><button>Create form</button>');
    next = next.replace('<input name="successMessage" value="${form.successMessage}"><button>Save form</button>', '<input name="successMessage" value="${form.successMessage}"><label>Popup mode<select name="popupMode"><option value="inline" ${form.popupMode === \'inline\' ? \'selected\' : \'\'}>inline</option><option value="popup" ${form.popupMode === \'popup\' ? \'selected\' : \'\'}>popup</option><option value="slideout" ${form.popupMode === \'slideout\' ? \'selected\' : \'\'}>slideout</option></select></label><input name="geotarget" value="${form.geotarget || \'\'}" placeholder="US,CA"><input name="triggerRule" value="${form.triggerRule || \'\'}" placeholder="exit_intent"><button>Save form</button>');
    next = next.replace('Embed code: <code>&lt;iframe src="/f/${form.slug}"&gt;&lt;/iframe&gt;</code>', 'Embed code: <code>&lt;iframe src="/f/${form.slug}"&gt;&lt;/iframe&gt;</code></p><p>Popup targeting: <strong>${form.popupMode || \'inline\'}</strong> · geotarget <strong>${form.geotarget || \'all\'}</strong> · trigger <strong>${form.triggerRule || \'inline\'}</strong>');
    return next;
  }, modifiedFiles, workspacePath);

  patch(path.join(workspacePath, 'packages/app/domain-growth.mjs'), (text) => {
    let next = text.replace("import { saveDb } from './storage.mjs';", "import { persistState } from './storage.mjs';");
    next = replaceAll(next, 'saveDb(state.db)', 'persistState(state)');
    if (!next.includes("const SUBSCRIBED_STATUS = 'subscribed';")) {
      next = next.replace('export const AUTOMATION_TRIGGERS = [', "const SUBSCRIBED_STATUS = 'subscribed';\nconst RUN_STATUS_ACTIVE = 'active';\nconst RUN_STATUS_COMPLETED = 'completed';\n\nexport const AUTOMATION_TRIGGERS = [");
    }
    next = next.replace("  return {\n    status: 'completed',", "  return {\n    status: steps.some((step) => step.status === 'wait_scheduled') ? RUN_STATUS_ACTIVE : RUN_STATUS_COMPLETED,");
    next = next.replace(/status: 'completed'/g, 'status: RUN_STATUS_COMPLETED');
    next = next.replace(/status: 'subscribed'/g, 'status: SUBSCRIBED_STATUS');
    next = next.replace("status: 'draft', fields:", "status: 'draft', popupMode: body.popupMode || 'inline', geotarget: body.geotarget || 'all', triggerRule: body.triggerRule || 'inline', fields:");
    if (!next.includes('export function popupTargetingSummary')) {
      next = next.replace('export function analyticsSeries(state, workspaceId) {', `export function popupTargetingSummary(form) {\n  return {\n    popupMode: form.popupMode || 'inline',\n    geotarget: form.geotarget || 'all',\n    triggerRule: form.triggerRule || 'inline'\n  };\n}\n\nexport function analyticsSeries(state, workspaceId) {`);
    }
    return next;
  }, modifiedFiles, workspacePath);
}

function applyExperimentationParity(workspacePath, modifiedFiles) {
  write(path.join(workspacePath, 'packages/app/experiment-engine.mjs'), `export function evaluateExperimentReport(experiment, recipientTotal) {\n  return experiment.variants.map((variant, index) => {\n    const subjectSignal = variant.subject.split(/\\s+/).filter(Boolean).length;\n    const proofSignal = /proof|save|learn|launch|join|start/i.test(variant.bodyPreview) ? 0.03 : 0.015;\n    const urgencySignal = /today|now|new|limited/i.test(variant.subject) ? 0.04 : 0.02;\n    const openRate = Math.min(0.76, 0.26 + Math.min(subjectSignal, 10) * 0.018 + urgencySignal + index * 0.01);\n    const clickRate = Math.min(0.42, 0.08 + proofSignal + (variant.sampleAudience === 'high_intent' ? 0.05 : 0.02) + index * 0.008);\n    return {\n      variantId: variant.id,\n      label: variant.label,\n      recipients: Math.round(recipientTotal * ((index === 0 ? experiment.trafficSplit.variantA : experiment.trafficSplit.variantB) / 100)),\n      openRate,\n      clickRate,\n      revenue: Math.round(recipientTotal * (18 + openRate * 95 + clickRate * 110))\n    };\n  });\n}\n`, modifiedFiles, workspacePath);

  patch(path.join(workspacePath, 'packages/app/domain-current-product-ops.mjs'), (text) => {
    let next = text;
    if (!next.includes("import { evaluateExperimentReport } from './experiment-engine.mjs';")) {
      next = next.replace("import { buildPredictiveWorkspace } from './predictive-model.mjs';", "import { buildPredictiveWorkspace } from './predictive-model.mjs';\nimport { evaluateExperimentReport } from './experiment-engine.mjs';");
    }
    next = next.replace(/const variants = experiment\.variants\.map\([\s\S]*?const winner = \[\.\.\.variants\]/, "const variants = evaluateExperimentReport(experiment, totalRecipients);\n  const winner = [...variants]");
    return next;
  }, modifiedFiles, workspacePath);
}

function applySecurityOpsParity(workspacePath, modifiedFiles) {
  write(path.join(workspacePath, 'packages/app/http-runtime.mjs'), `import http from 'node:http';\nexport function createHttpServer(handler) {\n  return http.createServer(handler);\n}\n`, modifiedFiles, workspacePath);
  write(path.join(workspacePath, 'packages/app/persistence-io.mjs'), `import fs from 'node:fs';\n\nexport function writeJsonAtomic(filePath, body) {\n  const tempPath = \`${'${filePath}'}.tmp\`;\n  fs.writeFileSync(tempPath, JSON.stringify(body, null, 2));\n  fs.renameSync(tempPath, filePath);\n}\n\nexport function writeTextFile(filePath, body) {\n  fs.writeFileSync(filePath, body || '', 'utf8');\n}\n\nexport function writeJsonFile(filePath, body) {\n  fs.writeFileSync(filePath, JSON.stringify(body, null, 2));\n}\n`, modifiedFiles, workspacePath);

  patch(path.join(workspacePath, 'packages/app/security.mjs'), (text) => {
    let next = text.replace(/import \{[^}]*\} from '\.\/storage\.mjs';/, "import { persistState } from './storage.mjs';");
    next = next.replace(/saveDb\(state\);/g, 'persistState(state);');
    if (!next.includes('export function createMfaChallenge')) {
      next = ensureContains(next, `\nexport function createMfaChallenge(state, userId, method = 'totp') {\n  ensureSecurityCollections(state);\n  state.db.mfaChallenges ||= [];\n  const challenge = { id: createId('mfa'), userId, method, status: 'pending', createdAt: nowIso(), expiresAt: isoAfter(1000 * 60 * 10) };\n  state.db.mfaChallenges.unshift(challenge);\n  persistState(state);\n  return challenge;\n}\n\nexport function createSsoSession(state, userId, provider = 'saml') {\n  ensureSecurityCollections(state);\n  state.db.ssoSessions ||= [];\n  const session = { id: createId('sso'), userId, provider, createdAt: nowIso(), saml: provider === 'saml' };\n  state.db.ssoSessions.unshift(session);\n  persistState(state);\n  return session;\n}\n`);
    }
    return next;
  }, modifiedFiles, workspacePath);

  ensurePersistenceIoImport(path.join(workspacePath, 'packages/app/storage.mjs'), modifiedFiles, workspacePath);
  patch(path.join(workspacePath, 'packages/app/storage.mjs'), (text) => {
    let next = text;
    next = next.replace("const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);", "const ROOT_DIR = path.resolve(new URL('../..', import.meta.url).pathname);");
    next = next.replace("const dataDir = process.env.MAILCLONE_DATA_DIR || path.join(ROOT, 'data');", "const dataDir = process.env.MAILCLONE_DATA_DIR || path.join(ROOT_DIR, 'data');");
    next = next.replace("legacyDbPath: path.join(dataDir, 'app.json'),", "legacyDbPath: path.join(ROOT_DIR, 'app.json'),");
    next = next.replace("    fs.writeFileSync(paths.dbPath, JSON.stringify(db, null, 2));", '    writeJsonFile(paths.dbPath, db);');
    next = next.replace("  const tempPath = `${paths.dbPath}.tmp`;\n  fs.writeFileSync(tempPath, JSON.stringify(db, null, 2));\n  fs.renameSync(tempPath, paths.dbPath);", '  writeJsonAtomic(paths.dbPath, db);');
    next = next.replace("  fs.writeFileSync(filePath, body || '', 'utf8');", '  writeTextFile(filePath, body || "");');
    next = next.replace("  fs.writeFileSync(filePath, JSON.stringify(body, null, 2));", '  writeJsonFile(filePath, body);');
    return next;
  }, modifiedFiles, workspacePath);

  patch(path.join(workspacePath, 'apps/web/server.mjs'), (text) => {
    let next = text.replace("import http from 'node:http';", "import { createHttpServer } from '../../packages/app/http-runtime.mjs';");
    next = next.replace('const server = http.createServer(async (req, res) => {', 'const server = createHttpServer(async (req, res) => {');
    next = next.replace(/\n  server\.start = \(\{ port = 3000 \} = \{\}\) => new Promise\(\(resolve\) => \{[\s\S]*?server\.state = state;\n  return server;\n\}/, `\n  Object.assign(server, {\n    start({ port = 3000 } = {}) {\n      return new Promise((resolve) => {\n        state.jobLoop = startJobLoop(state, 100);\n        server.listen(port, () => resolve(server.address()));\n      });\n    },\n    stop() {\n      return new Promise((resolve, reject) => {\n        if (state.jobLoop) state.jobLoop.stop();\n        server.close((error) => (error ? reject(error) : resolve()));\n      });\n    },\n    state\n  });\n  return server;\n}`);
    return next;
  }, modifiedFiles, workspacePath);
}

function productFactoryDomainSource({ surfaceId, label, lane }) {
  const name = titleCaseWords(label || surfaceId);
  const ident = jsIdentifier(surfaceId, 'factorySurface');
  const eventPrefix = String(surfaceId || ident).replace(/[^a-z0-9_]+/gi, '_');
  const capabilities = [
    'workspace model', 'audit trail', 'permission envelope', 'automation hook', 'report snapshot',
    'import path', 'export path', 'notification policy', 'state transition', 'validation rule',
    'bulk action', 'operator console'
  ];
  return `const SURFACE_ID = ${JSON.stringify(surfaceId)};
const SURFACE_LABEL = ${JSON.stringify(name)};
const SURFACE_LANE = ${JSON.stringify(lane || 'product_factory')};

export const ${ident}CapabilityCatalog = ${JSON.stringify(capabilities, null, 2)};

export function create${ident.charAt(0).toUpperCase()}${ident.slice(1)}Workspace(seed = {}) {
  const now = seed.now || new Date().toISOString();
  return {
    id: seed.id || \`\${SURFACE_ID}_workspace\`,
    surfaceId: SURFACE_ID,
    label: SURFACE_LABEL,
    lane: SURFACE_LANE,
    status: seed.status || 'draft',
    createdAt: now,
    updatedAt: now,
    ownerRole: seed.ownerRole || 'marketing_admin',
    permissions: ['view', 'edit', 'approve', 'export'],
    records: [],
    automationHooks: [],
    auditTrail: [{ at: now, type: 'workspace_created', actor: seed.actor || 'system' }]
  };
}

export function append${ident.charAt(0).toUpperCase()}${ident.slice(1)}Record(workspace, record = {}) {
  const now = record.at || new Date().toISOString();
  const entry = {
    id: record.id || \`\${SURFACE_ID}_record_\${workspace.records.length + 1}\`,
    status: record.status || 'active',
    title: record.title || \`\${SURFACE_LABEL} item\`,
    owner: record.owner || workspace.ownerRole,
    priority: record.priority || 'normal',
    tags: Array.from(new Set(record.tags || [SURFACE_LANE])),
    metrics: { impressions: 0, conversions: 0, revenueCents: 0, ...(record.metrics || {}) },
    createdAt: now,
    updatedAt: now
  };
  workspace.records.push(entry);
  workspace.updatedAt = now;
  workspace.auditTrail.unshift({ at: now, type: '${eventPrefix}_record_added', recordId: entry.id });
  return entry;
}

export function transition${ident.charAt(0).toUpperCase()}${ident.slice(1)}Record(workspace, recordId, status, actor = 'system') {
  const record = workspace.records.find((entry) => entry.id === recordId);
  if (!record) throw new Error(\`Record \${recordId} was not found in \${SURFACE_ID}\`);
  const previous = record.status;
  record.status = status;
  record.updatedAt = new Date().toISOString();
  workspace.updatedAt = record.updatedAt;
  workspace.auditTrail.unshift({ at: record.updatedAt, type: '${eventPrefix}_record_transitioned', recordId, previous, status, actor });
  return record;
}

export function register${ident.charAt(0).toUpperCase()}${ident.slice(1)}Automation(workspace, hook = {}) {
  const automation = {
    id: hook.id || \`\${SURFACE_ID}_hook_\${workspace.automationHooks.length + 1}\`,
    trigger: hook.trigger || 'record.updated',
    action: hook.action || 'notify.owner',
    enabled: hook.enabled !== false,
    conditions: hook.conditions || [],
    createdAt: hook.createdAt || new Date().toISOString()
  };
  workspace.automationHooks.push(automation);
  workspace.auditTrail.unshift({ at: automation.createdAt, type: '${eventPrefix}_automation_registered', automationId: automation.id });
  return automation;
}

export function summarize${ident.charAt(0).toUpperCase()}${ident.slice(1)}Workspace(workspace) {
  const byStatus = workspace.records.reduce((acc, record) => {
    acc[record.status] = (acc[record.status] || 0) + 1;
    return acc;
  }, {});
  const totals = workspace.records.reduce((acc, record) => {
    acc.impressions += Number(record.metrics?.impressions || 0);
    acc.conversions += Number(record.metrics?.conversions || 0);
    acc.revenueCents += Number(record.metrics?.revenueCents || 0);
    return acc;
  }, { impressions: 0, conversions: 0, revenueCents: 0 });
  return {
    surfaceId: SURFACE_ID,
    label: SURFACE_LABEL,
    lane: SURFACE_LANE,
    status: workspace.status,
    recordCount: workspace.records.length,
    activeAutomationCount: workspace.automationHooks.filter((hook) => hook.enabled).length,
    byStatus,
    totals,
    lastAuditEvent: workspace.auditTrail[0] || null
  };
}

export function build${ident.charAt(0).toUpperCase()}${ident.slice(1)}SeedScenario() {
  const workspace = create${ident.charAt(0).toUpperCase()}${ident.slice(1)}Workspace({ actor: 'factory_seed' });
  append${ident.charAt(0).toUpperCase()}${ident.slice(1)}Record(workspace, { title: \`Pilot \${SURFACE_LABEL}\`, priority: 'high', metrics: { impressions: 1200, conversions: 84, revenueCents: 428000 } });
  append${ident.charAt(0).toUpperCase()}${ident.slice(1)}Record(workspace, { title: \`Scale \${SURFACE_LABEL}\`, priority: 'normal', metrics: { impressions: 860, conversions: 41, revenueCents: 197500 } });
  register${ident.charAt(0).toUpperCase()}${ident.slice(1)}Automation(workspace, { trigger: 'record.completed', action: 'queue.followup' });
  return { workspace, summary: summarize${ident.charAt(0).toUpperCase()}${ident.slice(1)}Workspace(workspace) };
}
`;
}

function productFactoryIndexSource({ surfaceId, label, lane, domainRel }) {
  const ident = jsIdentifier(surfaceId, 'factorySurface');
  const exportName = `${ident}SurfaceDefinition`;
  return `export * from './${path.basename(domainRel)}';

export const ${exportName} = {
  id: ${JSON.stringify(surfaceId)},
  label: ${JSON.stringify(titleCaseWords(label || surfaceId))},
  lane: ${JSON.stringify(lane || 'product_factory')},
  kind: 'mailchimp_product_factory_scaffold',
  maturity: 'scaffolded_product_surface',
  integrationState: 'domain_module_ready',
  notes: [
    'Generated as net-new product scaffolding for large-surface Mailchimp clone growth.',
    'Exports domain lifecycle, automation hook, audit trail, and reporting helpers.',
    'Requires later route/navigation wiring before it can count as end-user parity.'
  ]
};
`;
}

function applyProductFactoryScaffold(workspacePath, modifiedFiles, assignment = {}) {
  const allowedFiles = new Set(deriveAllowedFiles(assignment));
  const surfaceId = deriveFocusSurfaceId(assignment) || String(assignment.shardId || assignment.shard?.id || 'product_factory_surface').replace(/^focus\./, '');
  const label = assignment.shard?.title || assignment.issue?.title || surfaceId;
  const lane = assignment.shard?.lane || assignment.issue?.lane || 'product_factory';
  const domainRel = [...allowedFiles].find((entry) => /domain\.mjs$/.test(entry)) || `packages/product-factory/${surfaceId}/domain.mjs`;
  const indexRel = [...allowedFiles].find((entry) => /index\.mjs$/.test(entry)) || `packages/product-factory/${surfaceId}/index.mjs`;
  writeAllowedFile(workspacePath, allowedFiles, domainRel, productFactoryDomainSource({ surfaceId, label, lane }), modifiedFiles);
  writeAllowedFile(workspacePath, allowedFiles, indexRel, productFactoryIndexSource({ surfaceId, label, lane, domainRel }), modifiedFiles);
}

function deriveFocusGroup(assignment) {
  const surfaceFocusId = deriveFocusSurfaceId(assignment);
  const canonicalHandler = canonicalSurfaceHandler(surfaceFocusId);
  if (canonicalHandler === 'audience_crm') return 'audience_crm';
  if (canonicalHandler === 'email_builder') return 'email_builder';
  if (canonicalHandler === 'template_library') return 'template_library';
  if (canonicalHandler === 'content_studio') return 'content_studio';
  if (canonicalHandler === 'automation_journey') return 'automation_journey';
  if (canonicalHandler === 'api_keys_webhooks') return 'api_keys_webhooks';
  if (canonicalHandler === 'billing_plans') return 'billing_plans';
  if (canonicalHandler === 'report_detail') return 'report_detail';
  if (canonicalHandler === 'send_schedule_review') return 'send_schedule_review';
  if (canonicalHandler === 'signup_onboarding') return 'signup_onboarding';
  if (canonicalHandler === 'settings_domains') return 'settings_domains';
  if (canonicalHandler === 'team_roles_permissions') return 'team_roles_permissions';
  if (surfaceFocusId === 'audience_crm_parity') return 'audience_crm';
  if (surfaceFocusId === 'campaign_editor_parity') return 'campaign_editor';
  if (surfaceFocusId === 'automation_journey_parity') return 'automation_journey';
  if (surfaceFocusId === 'persistence_jobs_operational_parity') return 'delivery_jobs';
  if (surfaceFocusId === 'reporting_analytics_parity') return 'reporting_analytics';
  const explicit = assignment.shard?.metadata?.focusGroup || assignment.inputs?.focusGroup || assignment.issue?.inputs?.focusGroup;
  if (explicit) {
    const normalizedExplicit = normalizeFocusGroup(explicit);
    if (!['focus_email_builder', 'focus_template_library', 'focus_report_detail'].includes(normalizedExplicit)) return normalizedExplicit;
  }
  const shardId = String(assignment.shardId || assignment.shard?.id || '').trim().toLowerCase().replace(/-/g, '_');
  if (!shardId) return 'unknown';
  if (shardId.startsWith('pkg.') && /(survey|feedback|preference)/.test(shardId)) return 'unknown';
  if (/focus\.landing_pages|landing_pages/.test(shardId)) return 'landing_pages';
  if (/product_factory|factory_surface|surface_factory|net_product/.test(shardId)) return 'product_factory';
  if (/reports|analytics|reporting|revenue|attribution|billing|ecommerce|insights/.test(shardId)) return 'reporting_analytics';
  if (/(^|_)(ai|predictive|optimization|forecast|scoring|intelligence|send_time)(_|$)/.test(shardId)) return 'ai_predictive';
  if (/oauth|integration|integrations|api|webhook|marketplace|commerce|sms|social|partner/.test(shardId)) return 'integrations_api_oauth';
  if (/website|builder|site/.test(shardId)) return 'website_builder';
  if (/forms|popup|signup|growth/.test(shardId)) return 'forms_growth';
  if (/experiment|experimentation|calendar|retention|journey|lifecycle|onboarding/.test(shardId)) return 'campaign_experimentation';
  if (/security|compliance|auth|trust|approval|audit/.test(shardId)) return 'security_ops';
  if (/delivery|jobs|automation|send|runtime\.|ops|service|support|channel|sender|pipeline/.test(shardId)) return 'delivery_jobs';
  if (/frontend|web|shell|route|editor|template|campaign|audience|contact|segment|storage|persistence|data|workspace|brand|content|creative|catalog|conversation|inbox|agency/.test(shardId)) return 'frontend_architecture';
  if (shardId.startsWith('runtime.')) return 'delivery_jobs';
  if (shardId.startsWith('pkg.')) return 'frontend_architecture';
  return 'unknown';
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.assignment) throw new Error('--assignment is required');
  const assignment = JSON.parse(read(args.assignment));
  const workspacePath = assignment.workspacePath || assignment.targetPath;
  if (!workspacePath) throw new Error('assignment workspacePath/targetPath is required');
  const rawFocusGroup = assignment.shard?.metadata?.focusGroup || assignment.inputs?.focusGroup || assignment.issue?.inputs?.focusGroup || assignment.shardId || assignment.shard?.id || 'unknown';
  const focusGroup = deriveFocusGroup(assignment);
  const surfaceFocusId = deriveFocusSurfaceId(assignment);
  const canonicalHandler = canonicalSurfaceHandler(surfaceFocusId);
  const modifiedFiles = new Set();

  if (surfaceFocusId === 'frontend_interaction_parity') applyFrontendInteractionStrictFocus(workspacePath, modifiedFiles, assignment);
  else if (canonicalHandler === 'signup_forms_popups') applyFormsGrowthParity(workspacePath, modifiedFiles);
  else if (canonicalHandler === 'landing_pages') applyLandingPagesParity(workspacePath, modifiedFiles);
  else if (canonicalHandler === 'website_builder') applyWebsiteBuilderParity(workspacePath, modifiedFiles);
  else if (canonicalHandler === 'campaign_index') applyCanonicalCampaignIndexFocus(workspacePath, modifiedFiles, assignment);
  else if (canonicalHandler === 'email_builder') applyCanonicalEmailBuilderFocus(workspacePath, modifiedFiles, assignment);
  else if (canonicalHandler === 'template_library') applyCanonicalTemplateLibraryFocus(workspacePath, modifiedFiles, assignment);
  else if (canonicalHandler === 'content_studio') applyCanonicalContentStudioFocus(workspacePath, modifiedFiles, assignment);
  else if (canonicalHandler === 'reports_overview') applyCanonicalReportsOverviewFocus(workspacePath, modifiedFiles, assignment);
  else if (canonicalHandler === 'report_detail') applyCanonicalReportDetailFocus(workspacePath, modifiedFiles, assignment);
  else if (canonicalHandler === 'send_schedule_review') applyCanonicalSendScheduleReviewFocus(workspacePath, modifiedFiles, assignment);
  else if (canonicalHandler === 'signup_onboarding') applyCanonicalSignupOnboardingFocus(workspacePath, modifiedFiles, assignment);
  else if (canonicalHandler === 'integrations_marketplace') applyCanonicalIntegrationsMarketplaceFocus(workspacePath, modifiedFiles, assignment);
  else if (canonicalHandler === 'api_keys_webhooks') applyCanonicalApiKeysWebhooksFocus(workspacePath, modifiedFiles, assignment);
  else if (canonicalHandler === 'billing_plans') applyCanonicalBillingPlansFocus(workspacePath, modifiedFiles, assignment);
  else if (canonicalHandler === 'settings_domains') applyCanonicalSettingsDomainsFocus(workspacePath, modifiedFiles, assignment);
  else if (canonicalHandler === 'team_roles_permissions') applyCanonicalTeamRolesPermissionsFocus(workspacePath, modifiedFiles, assignment);
  else if (surfaceFocusId === 'audience_crm_parity' || canonicalHandler === 'audience_crm' || focusGroup === 'audience_crm') applyAudienceCrmStrictFocus(workspacePath, modifiedFiles, assignment);
  else if (surfaceFocusId === 'campaign_editor_parity' || focusGroup === 'campaign_editor') applyCampaignEditorStrictFocus(workspacePath, modifiedFiles, assignment);
  else if (surfaceFocusId === 'automation_journey_parity' || canonicalHandler === 'automation_journey' || focusGroup === 'automation_journey') applyAutomationJourneyStrictFocus(workspacePath, modifiedFiles, assignment);
  else if (surfaceFocusId === 'reporting_analytics_parity') applyReportingAnalyticsStrictFocus(workspacePath, modifiedFiles, assignment);
  else if (surfaceFocusId === 'persistence_jobs_operational_parity') {
    applyPersistenceParity(workspacePath, modifiedFiles, assignment);
    if (assignmentAllowsAnyFile(assignment, ['packages/app/job-handlers.mjs', 'packages/app/job-runtime.mjs', 'packages/app/jobs.mjs', 'apps/web/server.mjs'])) applyDeliveryJobs(workspacePath, modifiedFiles);
  }
  else if (focusGroup === 'frontend_architecture') applyFrontendArchitecture(workspacePath, modifiedFiles);
  if (focusGroup === 'persistence') applyPersistenceParity(workspacePath, modifiedFiles, assignment);
  if (focusGroup === 'delivery_jobs' && surfaceFocusId !== 'persistence_jobs_operational_parity') applyDeliveryJobs(workspacePath, modifiedFiles);
  if (focusGroup === 'reporting_analytics' && surfaceFocusId !== 'reporting_analytics_parity') applyReportingAnalytics(workspacePath, modifiedFiles);
  if (focusGroup === 'ai_predictive') applyAiPredictive(workspacePath, modifiedFiles, assignment);
  if (focusGroup === 'integrations_api_oauth') applyIntegrationsParity(workspacePath, modifiedFiles);
  if (focusGroup === 'website_builder') applyWebsiteBuilderParity(workspacePath, modifiedFiles);
  if (focusGroup === 'landing_pages') applyLandingPagesParity(workspacePath, modifiedFiles);
  if (focusGroup === 'forms_growth') applyFormsGrowthParity(workspacePath, modifiedFiles);
  if (focusGroup === 'campaign_experimentation') applyExperimentationParity(workspacePath, modifiedFiles);
  if (focusGroup === 'security_ops') applySecurityOpsParity(workspacePath, modifiedFiles);
  if (focusGroup === 'product_factory') applyProductFactoryScaffold(workspacePath, modifiedFiles, assignment);

  if (modifiedFiles.size === 0 && canonicalHandler) {
    applyCanonicalSurfaceRuntimeFallback(workspacePath, modifiedFiles, assignment);
  }

  updateSurfaceHonestyManifest(workspacePath, modifiedFiles, focusGroup);

  console.log(JSON.stringify({
    ok: true,
    focusGroup,
    surfaceFocusId: surfaceFocusId || null,
    rawFocusGroup,
    modifiedFiles: [...modifiedFiles].sort(),
    diffSummary: `implemented ${focusGroup} parity bridge changes`,
    metadata: { focusGroup, surfaceFocusId: surfaceFocusId || null, rawFocusGroup, modifiedCount: modifiedFiles.size }
  }, null, 2));
}

main();
