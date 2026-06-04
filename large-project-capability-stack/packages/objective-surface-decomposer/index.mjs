import fs from 'node:fs';
import path from 'node:path';

const PRODUCT_EXTENSIONS = /\.(?:mjs|js|jsx|ts|tsx|css|json|vue|svelte)$/i;
const TEXT_EXTENSIONS = /\.(?:mjs|js|jsx|ts|tsx|css|json|vue|svelte|md|mdx|txt|yaml|yml|toml)$/i;
const EXCLUDED_DIRS = new Set([
  '.git', 'node_modules', 'coverage', 'dist', 'build', '.next', '.turbo', '.cache',
  'artifacts', 'backups', '_backups', '_quarantine', '.pytest_cache'
]);
const DEFAULT_CORE_ROLES = ['ui', 'route_api', 'domain', 'storage', 'job_event', 'integration', 'security'];

const ARCHITECTURE_EPIC_DEFINITIONS = Object.freeze([
  {
    id: 'rich_client_editor_architecture',
    title: 'Rich client app shell and editor architecture',
    intent: 'Build a Mailchimp-grade browser/runtime shell with editor state, hydration, commands, recovery, and behavior proof.',
    roles: ['frontend_architect', 'editor_runtime_builder', 'browser_parity_verifier', 'truth_audit_supervisor'],
    requiredLayers: ['client_shell', 'route_api', 'domain'],
    keywords: ['client', 'shell', 'editor', 'builder', 'template', 'campaign', 'view', 'public', 'web'],
    preferredFiles: ['apps/web/public/app-shell.jsx', 'apps/web/public/app-shell.css', 'apps/web/server.mjs', 'packages/app/view.mjs', 'packages/app/routes/public.mjs', 'packages/app/routes/campaigns.mjs', 'packages/app/domain-campaigns.mjs']
  },
  {
    id: 'visual_website_builder',
    title: 'Visual website builder and revision workflow',
    intent: 'Turn website/landing-page surfaces into an editor-grade builder with draft state, revisions, publishing, analytics handoff, and undo/recovery semantics.',
    roles: ['frontend_architect', 'editor_runtime_builder', 'persistence_database_agent', 'browser_parity_verifier', 'truth_audit_supervisor'],
    requiredLayers: ['client_shell', 'route_api', 'domain', 'storage'],
    keywords: ['website', 'builder', 'landing', 'page', 'revision', 'publish', 'forms'],
    preferredFiles: ['packages/app/domain-website-builder.mjs', 'packages/app/routes/website-builder.mjs', 'packages/app/routes/forms.mjs', 'packages/app/domain-growth.mjs', 'apps/web/public/app-shell.jsx', 'apps/web/server.mjs']
  },
  {
    id: 'production_data_persistence',
    title: 'Production persistence, migrations, and concurrency model',
    intent: 'Replace shallow in-memory parity with durable state, schema/migration semantics, optimistic concurrency, audit trails, and recovery handoffs.',
    roles: ['persistence_database_agent', 'service_integration_agent', 'truth_audit_supervisor'],
    requiredLayers: ['storage', 'domain', 'job_event', 'route_api'],
    keywords: ['storage', 'persist', 'database', 'migration', 'schema', 'job', 'queue', 'audit', 'state'],
    preferredFiles: ['packages/app/storage.mjs', 'packages/app/persistence-io.mjs', 'packages/app/jobs.mjs', 'packages/app/job-runtime.mjs', 'packages/app/job-handlers.mjs', 'packages/app/routes/api-admin.mjs']
  },
  {
    id: 'workflow_automation_runtime',
    title: 'Workflow automation execution runtime',
    intent: 'Model automation/journey execution with triggers, branches, scheduling, retries, run history, and review/approval transitions.',
    roles: ['workflow_runtime_architect', 'persistence_database_agent', 'service_integration_agent', 'truth_audit_supervisor'],
    requiredLayers: ['domain', 'job_event', 'route_api', 'storage'],
    keywords: ['automation', 'journey', 'workflow', 'schedule', 'trigger', 'campaign', 'approval', 'calendar'],
    preferredFiles: ['packages/app/routes/automations.mjs', 'packages/app/domain-campaigns.mjs', 'packages/app/domain-growth.mjs', 'packages/app/job-runtime.mjs', 'packages/app/jobs.mjs', 'packages/app/routes/current-product-ops.mjs']
  },
  {
    id: 'reporting_analytics_evidence',
    title: 'Reporting, analytics, and browser-backed evidence pipeline',
    intent: 'Build analytics event capture, aggregation, report detail paths, attribution summaries, and executable behavior evidence.',
    roles: ['analytics_pipeline_agent', 'browser_parity_verifier', 'truth_audit_supervisor'],
    requiredLayers: ['domain', 'route_api', 'storage', 'client_shell'],
    keywords: ['report', 'analytics', 'metric', 'event', 'attribution', 'revenue', 'insight'],
    preferredFiles: ['packages/app/analytics-events.mjs', 'packages/app/routes/reports.mjs', 'packages/app/routes/api-admin.mjs', 'packages/app/domain-campaigns.mjs', 'apps/web/server.mjs']
  },
  {
    id: 'provider_service_integrations',
    title: 'Provider-backed AI, analytics, integration, and delivery seams',
    intent: 'Connect integration/provider/delivery seams to real request/response, retry, auth, telemetry, and failure-recovery behavior.',
    roles: ['provider_service_integration_agent', 'persistence_database_agent', 'truth_audit_supervisor'],
    requiredLayers: ['integration', 'route_api', 'job_event', 'domain'],
    keywords: ['integration', 'provider', 'webhook', 'oauth', 'api', 'delivery', 'ai', 'predictive'],
    preferredFiles: ['packages/app/integration-provider.mjs', 'packages/app/domain-integration-marketplace.mjs', 'packages/app/routes/integrations-marketplace.mjs', 'packages/app/routes/api-admin.mjs', 'packages/app/ai-provider.mjs', 'packages/app/jobs.mjs']
  }
]);

function nowIso() {
  return new Date().toISOString();
}

function stableList(values = []) {
  return [...new Set((Array.isArray(values) ? values : [values])
    .map((value) => String(value || '').trim())
    .filter(Boolean))].sort();
}

function orderedUnique(values = []) {
  const out = [];
  for (const value of Array.isArray(values) ? values : [values]) {
    const normalized = String(value || '').trim();
    if (!normalized || out.includes(normalized)) continue;
    out.push(normalized);
  }
  return out;
}

function slug(value = 'surface') {
  return String(value || 'surface')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'surface';
}

function titleCase(value = '') {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function normalizeRelativePath(value = '') {
  const raw = String(value || '').replace(/\\/g, '/').replace(/^\.\//, '').trim();
  if (!raw || path.isAbsolute(raw) || raw.includes('\0')) return null;
  const normalized = path.posix.normalize(raw);
  if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../')) return null;
  return normalized;
}

function safeReadText(filePath, maxBytes = 80_000) {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size > maxBytes) return '';
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function walk(root, relative = '') {
  const out = [];
  const full = path.join(root, relative);
  if (!fs.existsSync(full)) return out;
  for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      const childFiles = walk(root, path.join(relative, entry.name));
      for (const child of childFiles) out.push(child);
    } else if (entry.isFile()) {
      out.push(path.join(relative, entry.name).replace(/\\/g, '/'));
    }
  }
  return out;
}

function isTestPath(rel = '') {
  return /(^|\/)(?:tests?|__tests__|spec)\//i.test(rel) || /(?:^|\/)[^/]+\.(?:test|spec)\.(?:mjs|js|jsx|ts|tsx)$/i.test(rel);
}

function isDocPath(rel = '') {
  return /(^|\/)(?:docs?|adr)\//i.test(rel) || /(?:^|\/)README\.md$/i.test(rel) || /\.(?:md|mdx|txt)$/i.test(rel);
}

function isScriptPath(rel = '') {
  return /(^|\/)(?:scripts?|benchmarks?|artifacts?|fixtures?|mocks?)\//i.test(rel);
}

function isProductPath(rel = '') {
  return PRODUCT_EXTENSIONS.test(rel) && !isTestPath(rel) && !isDocPath(rel) && !isScriptPath(rel);
}

function inferRoleFromPath(rel = '', text = '') {
  const lower = rel.toLowerCase();
  if (isTestPath(lower)) return 'test';
  if (isDocPath(lower)) return 'doc_spec';
  if (/apps\/web\/public|\/public\/|app-shell|component|view\.|page\.|\.jsx$|\.tsx$|\.vue$|\.svelte$|\.css$/i.test(rel)) return 'ui';
  if (/\/routes?\/|server\.|http-runtime|api-|controller|handler/i.test(rel)) return 'route_api';
  if (/storage|persist|repository|sqlite|db|migration|schema/i.test(rel)) return 'storage';
  if (/jobs?|queue|worker|event|scheduler|cron/i.test(rel)) return 'job_event';
  if (/integration|provider|webhook|adapter|connector|external/i.test(rel)) return 'integration';
  if (/security|auth|permission|policy|session/i.test(rel)) return 'security';
  if (/domain-|model|service|entity|state|store/i.test(rel)) return 'domain';
  if (/route\(|router|fetch\(|app\.(?:get|post|put|delete)|createServer|Response\(/.test(text)) return 'route_api';
  if (/save|load|persist|database|sqlite|transaction|migration/i.test(text)) return 'storage';
  if (/enqueue|job|event|publish|subscribe|schedule/i.test(text)) return 'job_event';
  return isProductPath(rel) ? 'domain' : 'other';
}

function stripKnownPrefixes(name = '') {
  return String(name || '')
    .replace(/\.(?:mjs|js|jsx|ts|tsx|css|json|vue|svelte|md|mdx)$/i, '')
    .replace(/^(?:domain|routes|route|api|server|storage|store|repository|jobs|job|worker|integration|provider|adapter|security|auth|view|component|page)[-_]*/i, '')
    .replace(/(?:-route|-routes|-domain|-store|-storage|-provider|-adapter|-runtime|-client|-server)$/i, '')
    .replace(/^index$/i, 'core');
}

function inferDomain(rel = '') {
  const parts = rel.split('/').filter(Boolean);
  const base = stripKnownPrefixes(parts.at(-1) || 'surface');
  if (base && base !== 'core') return slug(base);
  if (parts[0] === 'packages' && parts[1] && parts[1] !== 'app') return slug(parts[1]);
  if (parts.includes('routes')) {
    const routeIndex = parts.indexOf('routes');
    const next = parts[routeIndex + 1] ? stripKnownPrefixes(parts[routeIndex + 1]) : '';
    if (next) return slug(next);
  }
  if (parts.includes('public')) {
    const next = parts.at(-1) ? stripKnownPrefixes(parts.at(-1)) : '';
    if (next) return slug(next);
  }
  if (parts.length >= 2) return slug(parts.slice(0, -1).join('_'));
  return 'core';
}

function laneForRoles(roles = []) {
  const set = new Set(roles);
  if (set.has('ui')) return 'user_experience';
  if (set.has('route_api')) return 'api_runtime';
  if (set.has('storage')) return 'data_persistence';
  if (set.has('job_event')) return 'async_runtime';
  if (set.has('integration')) return 'integration_provider';
  if (set.has('security')) return 'security_governance';
  return 'domain_runtime';
}

function verifierForSurface(surface) {
  if (surface.testFiles.length > 0) return {
    verifierType: 'targeted_tests',
    verification: surface.testFiles.slice(0, 3).map((file) => `node --test ${file}`)
  };
  const source = surface.targetFiles.find((file) => /\.(?:mjs|js)$/i.test(file));
  if (source) return { verifierType: 'syntax_check', verification: [`node --check ${source}`] };
  return { verifierType: 'manual_runtime_proof_required', verification: [] };
}

function roleCounts(files = []) {
  return files.reduce((acc, file) => {
    acc[file.role] = (acc[file.role] || 0) + 1;
    return acc;
  }, {});
}

function domainRecord(domain) {
  return {
    id: domain,
    files: [],
    roles: new Set(),
    productFiles: [],
    testFiles: [],
    docFiles: []
  };
}

export function surveyRepository({ repoPath, includeText = true } = {}) {
  const root = path.resolve(repoPath || '.');
  const all = walk(root)
    .map((rel) => normalizeRelativePath(rel))
    .filter(Boolean)
    .filter((rel) => TEXT_EXTENSIONS.test(rel));
  const domains = new Map();
  const files = all.map((rel) => {
    const fullPath = path.join(root, rel);
    const text = includeText ? safeReadText(fullPath) : '';
    const role = inferRoleFromPath(rel, text);
    const product = isProductPath(rel);
    const test = isTestPath(rel);
    const docSpec = isDocPath(rel);
    const domain = inferDomain(rel);
    if (!domains.has(domain)) domains.set(domain, domainRecord(domain));
    const record = { path: rel, role, domain, product, test, docSpec, sizeBytes: fs.statSync(fullPath).size };
    const domainEntry = domains.get(domain);
    domainEntry.files.push(rel);
    domainEntry.roles.add(role);
    if (product) domainEntry.productFiles.push(rel);
    if (test) domainEntry.testFiles.push(rel);
    if (docSpec) domainEntry.docFiles.push(rel);
    return record;
  });

  const domainSummaries = [...domains.values()].map((domain) => ({
    id: domain.id,
    fileCount: domain.files.length,
    productFileCount: domain.productFiles.length,
    testFileCount: domain.testFiles.length,
    docFileCount: domain.docFiles.length,
    roles: [...domain.roles].sort(),
    files: stableList(domain.files),
    productFiles: stableList(domain.productFiles),
    testFiles: stableList(domain.testFiles),
    docFiles: stableList(domain.docFiles)
  })).sort((a, b) => a.id.localeCompare(b.id));

  return {
    schemaVersion: 'claw.repo_survey.v1',
    generatedAt: nowIso(),
    repoPath: root,
    metrics: {
      fileCount: files.length,
      productFileCount: files.filter((file) => file.product).length,
      testFileCount: files.filter((file) => file.test).length,
      docSpecFileCount: files.filter((file) => file.docSpec).length,
      domainCount: domainSummaries.length,
      roleCounts: roleCounts(files)
    },
    files,
    domains: domainSummaries
  };
}

function expectedRolesForObjective(objective = {}) {
  const text = `${objective.title || ''} ${objective.description || ''} ${objective.prompt || ''}`.toLowerCase();
  const roles = new Set(['domain', 'route_api']);
  if (/clone|app|web|ui|dashboard|editor|builder|workflow|user/.test(text)) roles.add('ui');
  if (/persist|data|storage|database|state|account|record|history/.test(text)) roles.add('storage');
  if (/job|queue|event|automation|notification|schedule|async/.test(text)) roles.add('job_event');
  if (/integration|provider|webhook|api|external|third[- ]party/.test(text)) roles.add('integration');
  if (/auth|security|permission|governance|admin|team/.test(text)) roles.add('security');
  if (/mailchimp|marketing|commerce|crm|campaign|audience/.test(text)) DEFAULT_CORE_ROLES.forEach((role) => roles.add(role));
  return [...roles];
}

export function buildNegativeSpaceInventory({ survey, objective = {}, requestedAgentCount = null } = {}) {
  const expectedRoles = expectedRolesForObjective(objective);
  const presentRoles = new Set(survey.files.filter((file) => file.product).map((file) => file.role));
  const missingRoles = expectedRoles.filter((role) => !presentRoles.has(role));
  const weakDomains = survey.domains
    .filter((domain) => domain.productFileCount > 0)
    .map((domain) => {
      const gaps = [];
      if (domain.testFileCount === 0) gaps.push('missing_targeted_tests');
      if (!domain.roles.some((role) => ['route_api', 'ui', 'job_event'].includes(role))) gaps.push('no_runtime_entrypoint_detected');
      if (!domain.roles.includes('storage') && /persist|data|state|account|history|record/i.test(`${objective.title || ''} ${objective.description || ''}`)) gaps.push('no_storage_or_persistence_detected');
      return gaps.length ? { domainId: domain.id, gaps, productFiles: domain.productFiles.slice(0, 8), roles: domain.roles } : null;
    })
    .filter(Boolean);
  const candidateSurfaceCount = survey.domains.filter((domain) => domain.productFileCount > 0).length;
  const requested = Number(requestedAgentCount || objective.requestedAgentCount || 0);
  const inventoryGaps = [];
  if (missingRoles.length) inventoryGaps.push({ type: 'missing_expected_runtime_roles', roles: missingRoles });
  if (requested > 0 && candidateSurfaceCount < requested) inventoryGaps.push({
    type: 'insufficient_low_overlap_surface_inventory',
    requestedAgentCount: requested,
    candidateSurfaceCount
  });
  if (weakDomains.length) inventoryGaps.push({ type: 'weak_domain_surfaces', weakDomainCount: weakDomains.length });
  return {
    schemaVersion: 'claw.negative_space_inventory.v1',
    generatedAt: nowIso(),
    objective: {
      id: objective.id || null,
      title: objective.title || objective.prompt || null,
      requestedFidelity: objective.requestedFidelity || null
    },
    expectedRoles,
    missingRoles,
    candidateSurfaceCount,
    requestedAgentCount: requested || null,
    gaps: inventoryGaps,
    weakDomains
  };
}

function findAdjacentTests(domain, survey) {
  const domainWords = domain.id.split('_').filter(Boolean);
  return survey.files
    .filter((file) => file.test)
    .filter((file) => domainWords.some((word) => file.path.toLowerCase().includes(word)))
    .map((file) => file.path);
}

function collisionRiskForSurface(targetFiles = [], roleSet = []) {
  if (targetFiles.length > 8) return 'high';
  if (targetFiles.length > 3) return 'medium';
  if (targetFiles.some((file) => /(?:^|\/)(?:index|server|storage|security|routes?)\.(?:mjs|js|ts|tsx)$/i.test(file))) return 'medium';
  return 'low';
}

function productImpactForRoles(roles = []) {
  const set = new Set(roles);
  return {
    userVisible: set.has('ui') || set.has('route_api'),
    systemVisible: set.has('storage') || set.has('job_event') || set.has('integration') || set.has('security'),
    runtimePath: roles.some((role) => ['ui', 'route_api', 'job_event', 'integration'].includes(role))
  };
}

function architectureLayerForSurveyFile(file = {}) {
  const rel = String(file.path || '');
  if (file.role === 'ui' || /apps\/web\/public|app-shell|view\.|\.css$|\.jsx$|\.tsx$/i.test(rel)) return 'client_shell';
  if (file.role === 'route_api' || /\/routes?\/|server\.|http-runtime|api-/i.test(rel)) return 'route_api';
  if (file.role === 'storage' || /storage|persist|migration|schema|db/i.test(rel)) return 'storage';
  if (file.role === 'job_event' || /jobs?|queue|worker|scheduler/i.test(rel)) return 'job_event';
  if (file.role === 'integration' || /integration|provider|webhook|adapter|connector/i.test(rel)) return 'integration';
  if (file.role === 'security' || /security|auth|permission|session/i.test(rel)) return 'security';
  return 'domain';
}

function epicText(epic = {}) {
  return `${epic.id || ''} ${epic.title || ''} ${epic.intent || ''} ${(epic.keywords || []).join(' ')}`.toLowerCase();
}

function fileMatchesEpic(file = {}, epic = {}) {
  if (!file.product) return false;
  const text = epicText(epic);
  const rel = String(file.path || '').toLowerCase();
  if ((epic.preferredFiles || []).includes(file.path)) return true;
  if ((epic.keywords || []).some((keyword) => rel.includes(String(keyword).toLowerCase()))) return true;
  if (text.includes(file.domain)) return true;
  return (epic.requiredLayers || []).includes(architectureLayerForSurveyFile(file));
}

function roleAllowedLayers(role = '') {
  const normalized = String(role || 'architect').toLowerCase();
  if (/frontend|editor|browser/.test(normalized)) return ['client_shell', 'route_api', 'domain'];
  if (/persistence|database/.test(normalized)) return ['storage', 'domain', 'job_event'];
  if (/workflow|runtime/.test(normalized)) return ['domain', 'job_event', 'route_api'];
  if (/provider|service|integration/.test(normalized)) return ['integration', 'route_api', 'job_event', 'domain'];
  if (/analytics/.test(normalized)) return ['domain', 'route_api', 'storage', 'client_shell'];
  if (/truth|audit|verifier/.test(normalized)) return ['route_api', 'client_shell', 'domain', 'storage', 'job_event', 'integration'];
  return ['domain', 'route_api'];
}

function selectEpicTargetFiles({ survey, epic, maxFiles = 12 } = {}) {
  const filesByPath = new Map((survey.files || []).map((file) => [file.path, file]));
  const selected = [];
  const add = (filePath) => {
    const file = filesByPath.get(filePath);
    if (file?.product && !selected.includes(file.path)) selected.push(file.path);
  };
  for (const filePath of epic.preferredFiles || []) add(filePath);
  const candidates = (survey.files || [])
    .filter((file) => fileMatchesEpic(file, epic))
    .sort((left, right) => {
      const leftPreferred = (epic.preferredFiles || []).includes(left.path) ? 1 : 0;
      const rightPreferred = (epic.preferredFiles || []).includes(right.path) ? 1 : 0;
      return rightPreferred - leftPreferred
        || left.path.split('/').length - right.path.split('/').length
        || left.path.localeCompare(right.path);
    });
  for (const layer of epic.requiredLayers || []) {
    const match = candidates.find((file) => architectureLayerForSurveyFile(file) === layer && !selected.includes(file.path));
    if (match) selected.push(match.path);
  }
  for (const file of candidates) {
    if (selected.length >= maxFiles) break;
    if (!selected.includes(file.path)) selected.push(file.path);
  }
  return selected.slice(0, maxFiles);
}

function testsForEpic({ survey, epic, targetFiles = [] } = {}) {
  const words = new Set([
    ...String(epic.id || '').split('_'),
    ...(epic.keywords || [])
  ].map((word) => String(word).toLowerCase()).filter(Boolean));
  const targetDomains = new Set((survey.files || [])
    .filter((file) => targetFiles.includes(file.path))
    .map((file) => file.domain));
  return stableList((survey.files || [])
    .filter((file) => file.test)
    .filter((file) => {
      const rel = file.path.toLowerCase();
      return targetDomains.has(file.domain) || [...words].some((word) => word.length >= 4 && rel.includes(word));
    })
    .map((file) => file.path))
    .slice(0, 8);
}

function buildArchitectureEpicWorkUnits({ epic, targetFiles = [], testFiles = [], objective = {}, repoPath = null } = {}) {
  return (epic.roles || []).map((role, index) => {
    const allowedLayers = roleAllowedLayers(role);
    const roleFiles = targetFiles.filter((filePath) => {
      const pseudo = { path: filePath, role: inferRoleFromPath(filePath, ''), product: true };
      return allowedLayers.includes(architectureLayerForSurveyFile(pseudo));
    });
    const allowedFiles = stableList([...(roleFiles.length ? roleFiles : targetFiles.slice(0, 6)), ...testFiles]);
    const productFiles = allowedFiles.filter((filePath) => isProductPath(filePath));
    const id = `${epic.id}::${role}`;
    return {
      id,
      title: `${epic.title} — ${titleCase(role)}`,
      goal: `${epic.intent} Role: ${titleCase(role)}.`,
      lane: 'architecture_epic',
      domain: epic.id,
      architectureEpicId: epic.id,
      architectureRole: role,
      fileAreas: productFiles,
      allowedFiles,
      deps: index === 0 ? [] : [`${epic.id}::${epic.roles[0]}`],
      requiredVerifiers: testFiles.length ? testFiles.map((_, testIndex) => `${epic.id}__test_${testIndex + 1}`) : ['architecture_epic_manual_behavior_proof'],
      acceptanceChecks: [
        'Land a structural product-code delta in primary runtime files; docs/tests-only changes do not count.',
        'Modify at least two architecture layers when the role spans multiple layers.',
        'Attach browser/behavior, route, persistence, job, provider, or analytics evidence appropriate to the role.',
        'Do not claim full-clone completion; report remaining negative space explicitly.',
        ...testFiles.map((testPath) => `Preserve or extend executable evidence for ${testPath}`)
      ],
      inputs: {
        objective: objective.title || objective.prompt || objective.id || null,
        architectureEpic: {
          id: epic.id,
          title: epic.title,
          intent: epic.intent,
          role,
          requiredLayers: epic.requiredLayers
        }
      },
      metadata: {
        architectureEpic: true,
        architectureEpicId: epic.id,
        architectureRole: role,
        requiresStructuralProductDelta: true,
        browserBehaviorEvidenceRequired: /frontend|editor|browser/.test(role),
        artifactKind: 'product_diff',
        assignmentContract: {
          artifactKind: 'product_diff',
          targetFiles: productFiles,
          targetModules: productFiles,
          verifierRequirements: testFiles.length ? testFiles.map((_, testIndex) => `${epic.id}__test_${testIndex + 1}`) : ['architecture_epic_manual_behavior_proof'],
          successPredicate: [
            'structural product delta lands in canonical checkout',
            'primary runtime adoption evidence is present',
            'docs/tests/scripts-only changes are rejected for product credit'
          ]
        },
        verifierCatalog: Object.fromEntries(testFiles.map((command, testIndex) => [`${epic.id}__test_${testIndex + 1}`, {
          id: `${epic.id}__test_${testIndex + 1}`,
          command: `node --test ${command}`,
          architectureEpicId: epic.id,
          allowedFiles
        }])),
        repoPath
      }
    };
  });
}

export function buildSurfaceGraph({ survey, objective = {}, requestedAgentCount = null, maxSurfaces = 200 } = {}) {
  const productDomains = survey.domains
    .filter((domain) => domain.productFileCount > 0)
    .map((domain) => {
      const targetFiles = stableList(domain.productFiles);
      const testFiles = stableList([...domain.testFiles, ...findAdjacentTests(domain, survey)]);
      const roles = stableList(domain.roles.filter((role) => role !== 'test' && role !== 'doc_spec' && role !== 'other'));
      const verifier = verifierForSurface({ targetFiles, testFiles });
      const impact = productImpactForRoles(roles);
      const surfaceId = slug(domain.id);
      return {
        id: surfaceId,
        label: titleCase(domain.id),
        productArea: domain.id,
        lane: laneForRoles(roles),
        domain: domain.id,
        targetFiles,
        allowedFiles: stableList([...targetFiles, ...testFiles]),
        testFiles,
        roles,
        verifierType: verifier.verifierType,
        verification: verifier.verification,
        collisionRisk: collisionRiskForSurface(targetFiles, roles),
        dependencySurfaceIds: [],
        qualitySignals: {
          hasRuntimePath: impact.runtimePath,
          userVisible: impact.userVisible,
          systemVisible: impact.systemVisible,
          hasTargetedTest: testFiles.length > 0,
          productFileCount: targetFiles.length
        },
        qualityScore: Number(([
          impact.runtimePath,
          impact.userVisible || impact.systemVisible,
          testFiles.length > 0,
          targetFiles.length > 0,
          targetFiles.length <= 8
        ].filter(Boolean).length / 5).toFixed(2))
      };
    })
    .sort((a, b) => {
      const riskRank = { low: 0, medium: 1, high: 2 };
      return riskRank[a.collisionRisk] - riskRank[b.collisionRisk]
        || b.qualityScore - a.qualityScore
        || a.id.localeCompare(b.id);
    })
    .slice(0, maxSurfaces);

  const requested = Number(requestedAgentCount || objective.requestedAgentCount || 0);
  return {
    schemaVersion: 'claw.objective_surface_graph.v1',
    generatedAt: nowIso(),
    objective: {
      id: objective.id || null,
      title: objective.title || objective.prompt || null,
      requestedFidelity: objective.requestedFidelity || null
    },
    requestedAgentCount: requested || null,
    surfaceCount: productDomains.length,
    lowOverlapSurfaceCount: productDomains.filter((surface) => surface.collisionRisk !== 'high').length,
    surfaces: productDomains
  };
}

export function buildObjectiveSurfaceMatrix({ surfaceGraph, objective = {} } = {}) {
  const surfaces = (surfaceGraph?.surfaces || []).map((surface) => ({
    id: surface.id,
    label: surface.label,
    issueIds: [surface.id],
    requiredArtifacts: [],
    productArea: surface.productArea,
    lane: surface.lane,
    domain: surface.domain,
    targetFiles: surface.targetFiles,
    allowedFiles: surface.allowedFiles,
    verification: surface.verification,
    verifierType: surface.verifierType,
    collisionRisk: surface.collisionRisk,
    qualitySignals: surface.qualitySignals,
    qualityScore: surface.qualityScore,
    status: 'planned'
  }));
  return {
    schemaVersion: 'claw.objective_surface_matrix.v1',
    generatedAt: nowIso(),
    objective: {
      id: objective.id || surfaceGraph?.objective?.id || null,
      title: objective.title || objective.prompt || surfaceGraph?.objective?.title || null,
      requestedFidelity: objective.requestedFidelity || surfaceGraph?.objective?.requestedFidelity || null
    },
    status: surfaces.length > 0 ? 'planned' : 'blocked',
    surfaces
  };
}

export function buildObjectiveWorkGraph({ surfaceGraph, objective = {}, repoPath } = {}) {
  const workUnits = (surfaceGraph?.surfaces || []).map((surface) => ({
    id: surface.id,
    title: surface.label,
    goal: `Advance objective surface ${surface.label}: ${objective.title || objective.prompt || 'product objective'}`,
    lane: surface.lane,
    domain: surface.domain,
    fileAreas: surface.targetFiles,
    allowedFiles: surface.allowedFiles,
    deps: surface.dependencySurfaceIds || [],
    requiredVerifiers: surface.verification.length ? surface.verification.map((_, index) => `${surface.id}__verifier_${index + 1}`) : ['manual_runtime_proof'],
    acceptanceChecks: [
      'Produce a real product-runtime delta in the allowed files.',
      'Attach canonical landing evidence before merge credit.',
      surface.qualitySignals.hasRuntimePath ? 'Preserve or extend the detected runtime path.' : 'Add or prove a runtime path for this surface.',
      surface.verification.length ? `Verifier command passes: ${surface.verification.join(' && ')}` : 'Add executable verification evidence for the surface.'
    ],
    inputs: {
      surface,
      objective: {
        id: objective.id || null,
        title: objective.title || objective.prompt || null,
        requestedFidelity: objective.requestedFidelity || null
      }
    },
    metadata: {
      surfaceId: surface.id,
      artifactKind: 'product_diff',
      assignmentContract: {
        artifactKind: 'product_diff',
        targetFiles: surface.targetFiles,
        targetModules: surface.targetFiles,
        verifierRequirements: surface.verification.length ? surface.verification.map((_, index) => `${surface.id}__verifier_${index + 1}`) : ['manual_runtime_proof'],
        successPredicate: ['real product-runtime delta lands in canonical checkout', 'canonical landing evidence is green']
      },
      collisionRisk: surface.collisionRisk,
      verifierCatalog: Object.fromEntries(surface.verification.map((command, index) => [`${surface.id}__verifier_${index + 1}`, {
        id: `${surface.id}__verifier_${index + 1}`,
        command,
        surfaceId: surface.id,
        allowedFiles: surface.allowedFiles
      }]))
    }
  }));
  return {
    targetPath: path.resolve(repoPath || surveyPathFromGraph(surfaceGraph) || '.'),
    objectiveId: objective.id || slug(objective.title || objective.prompt || 'objective'),
    workUnits
  };
}

export function buildArchitectureEpicPlan({ survey, repoPath = null, objective = {}, requestedAgentCount = null, targetEpicIds = [], maxEpics = null, stage = 'full_clone_relaunch_readiness' } = {}) {
  const normalizedTargets = new Set(stableList(targetEpicIds));
  const objectiveText = `${objective.id || ''} ${objective.title || ''} ${objective.prompt || ''}`.toLowerCase();
  const requested = Number(requestedAgentCount || objective.requestedAgentCount || 0) || null;
  const defaultMax = stage === 'single_epic' ? 1 : stage === 'multi_epic' ? 5 : ARCHITECTURE_EPIC_DEFINITIONS.length;
  const limit = Math.max(1, Number(maxEpics || defaultMax) || defaultMax);
  const eligible = ARCHITECTURE_EPIC_DEFINITIONS
    .filter((epic) => normalizedTargets.size === 0 || normalizedTargets.has(epic.id))
    .filter((epic) => normalizedTargets.size > 0 || /mailchimp|clone|marketing|automation|campaign|editor|builder|full/.test(objectiveText) || epic.id === 'rich_client_editor_architecture')
    .slice(0, limit);
  const epics = eligible.map((definition, index) => {
    const targetFiles = selectEpicTargetFiles({ survey, epic: definition, maxFiles: 14 });
    const testFiles = testsForEpic({ survey, epic: definition, targetFiles });
    const layers = stableList(targetFiles.map((filePath) => architectureLayerForSurveyFile({ path: filePath, role: inferRoleFromPath(filePath, ''), product: true })));
    return {
      ...definition,
      order: index + 1,
      targetFiles,
      allowedFiles: stableList([...targetFiles, ...testFiles]),
      testFiles,
      detectedLayers: layers,
      missingLayers: (definition.requiredLayers || []).filter((layer) => !layers.includes(layer)),
      ready: targetFiles.length >= 2 && (definition.requiredLayers || []).some((layer) => layers.includes(layer)),
      workUnitIds: (definition.roles || []).map((role) => `${definition.id}::${role}`)
    };
  });
  const workUnits = epics.flatMap((epic) => buildArchitectureEpicWorkUnits({ epic, targetFiles: epic.targetFiles, testFiles: epic.testFiles, objective, repoPath }));
  const surfaces = epics.map((epic) => ({
    id: epic.id,
    label: epic.title,
    status: epic.ready ? 'planned' : 'blocked_missing_runtime_files',
    issueIds: epic.workUnitIds,
    lane: 'architecture_epic',
    productArea: epic.id,
    targetFiles: epic.targetFiles,
    allowedFiles: epic.allowedFiles,
    testFiles: epic.testFiles,
    architectureRoles: epic.roles,
    requiredLayers: epic.requiredLayers,
    detectedLayers: epic.detectedLayers,
    missingLayers: epic.missingLayers,
    acceptanceChecks: [
      'Credit only structural product-code deltas in primary runtime files.',
      'Require behavior/browser/route/persistence/provider evidence according to epic role.',
      'Keep full-clone truth separate from staged architecture proof.'
    ]
  }));
  const readyEpics = epics.filter((epic) => epic.ready);
  const blocker = readyEpics.length === 0
    ? {
      type: 'no_architecture_epic_runtime_targets',
      nextAction: 'Add or identify primary runtime files for at least one architecture epic before relaunch.'
    }
    : null;
  const stagedProofs = {
    singleEpicReady: readyEpics.length >= 1,
    multiEpicReady: !blocker && readyEpics.length >= 3,
    finalBossRelaunchReady: !blocker && readyEpics.length >= 5 && Number(requested || 0) >= 80
  };
  return {
    schemaVersion: 'claw.architecture_epic_plan.v1',
    generatedAt: nowIso(),
    repoPath: repoPath ? path.resolve(repoPath) : survey?.repoPath || null,
    objective: {
      id: objective.id || null,
      title: objective.title || objective.prompt || null,
      requestedFidelity: objective.requestedFidelity || null
    },
    stage,
    requestedAgentCount: requested,
    status: blocker ? 'blocked' : 'planned',
    epics,
    architectureRoles: stableList(epics.flatMap((epic) => epic.roles || [])),
    surfaceMatrix: {
      schemaVersion: 'claw.architecture_epic_surface_matrix.v1',
      generatedAt: nowIso(),
      objective: {
        id: objective.id || null,
        title: objective.title || objective.prompt || null,
        requestedFidelity: objective.requestedFidelity || null
      },
      status: blocker ? 'blocked' : 'planned',
      surfaces
    },
    workGraph: {
      schemaVersion: 'claw.architecture_epic_work_graph.v1',
      targetPath: path.resolve(repoPath || survey?.repoPath || '.'),
      objectiveId: objective.id || slug(objective.title || objective.prompt || 'architecture_epic_objective'),
      workUnits,
      summary: {
        architectureEpicMode: true,
        epicCount: epics.length,
        readyEpicCount: readyEpics.length,
        workUnitCount: workUnits.length,
        architectureRoles: stableList(epics.flatMap((epic) => epic.roles || [])),
        stagedProofs
      }
    },
    blocker,
    summary: {
      epicCount: epics.length,
      readyEpicCount: readyEpics.length,
      workUnitCount: workUnits.length,
      architectureRoles: stableList(epics.flatMap((epic) => epic.roles || [])),
      ...stagedProofs
    }
  };
}

export function decomposeObjectiveToArchitectureEpics({ repoPath, objective = {}, requestedAgentCount = objective.requestedAgentCount || null, targetEpicIds = [], maxEpics = null, stage = 'full_clone_relaunch_readiness' } = {}) {
  const survey = surveyRepository({ repoPath });
  const negativeSpace = buildNegativeSpaceInventory({ survey, objective, requestedAgentCount });
  const architectureEpicPlan = buildArchitectureEpicPlan({ survey, repoPath, objective, requestedAgentCount, targetEpicIds, maxEpics, stage });
  return {
    schemaVersion: 'claw.objective_architecture_epic_decomposition.v1',
    generatedAt: nowIso(),
    repoPath: path.resolve(repoPath || '.'),
    objective: architectureEpicPlan.objective,
    requestedAgentCount: architectureEpicPlan.requestedAgentCount,
    status: architectureEpicPlan.status,
    survey,
    negativeSpace,
    architectureEpicPlan,
    surfaceMatrix: architectureEpicPlan.surfaceMatrix,
    workGraph: architectureEpicPlan.workGraph,
    blocker: architectureEpicPlan.blocker,
    summary: {
      ...architectureEpicPlan.summary,
      productFileCount: survey.metrics.productFileCount,
      domainCount: survey.metrics.domainCount,
      missingExpectedRoles: negativeSpace.missingRoles,
      weakDomainCount: negativeSpace.weakDomains.length
    }
  };
}

function matrixSurfaces(surfaceMatrix = null) {
  if (Array.isArray(surfaceMatrix?.surfaces)) return surfaceMatrix.surfaces;
  if (Array.isArray(surfaceMatrix?.surfaceMatrix?.surfaces)) return surfaceMatrix.surfaceMatrix.surfaces;
  if (Array.isArray(surfaceMatrix?.matrix?.surfaces)) return surfaceMatrix.matrix.surfaces;
  return [];
}

function statusLooksComplete(status = '') {
  return /^(?:complete|completed|all_complete|green|proven_complete|product_satisfied|swarm_leaf_satisfied|structural_leaf_satisfied|frontier_leaf_satisfied|remediation_leaf_satisfied|continuation_leaf_satisfied)$/i.test(String(status || '').trim());
}

function normalizeCompletionIds(values = []) {
  return new Set((Array.isArray(values) ? values : [values])
    .flatMap((value) => {
      const raw = String(value || '').trim();
      if (!raw) return [];
      const withoutFocus = raw.replace(/^focus\./, '');
      const withoutSuffix = withoutFocus.replace(/(?:#|::).+$/, '');
      return stableList([raw, withoutFocus, withoutSuffix]);
    }));
}

function collectCompletedSurfaceIds({ currentSurfaceMatrix = null, completedSurfaceIds = [], completedWorkUnitIds = [] } = {}) {
  const completed = normalizeCompletionIds([...completedSurfaceIds, ...completedWorkUnitIds]);
  for (const surface of matrixSurfaces(currentSurfaceMatrix)) {
    if (!statusLooksComplete(surface?.status)) continue;
    for (const candidate of [surface.id, surface.focusId, ...(Array.isArray(surface.issueIds) ? surface.issueIds : [])]) {
      for (const normalized of normalizeCompletionIds([candidate])) completed.add(normalized);
    }
  }
  return completed;
}

function surfaceCompleted(surface = {}, completed = new Set()) {
  const candidates = [surface.id, surface.focusId, surface.architectureEpicId, ...(Array.isArray(surface.issueIds) ? surface.issueIds : [])];
  return candidates.some((candidate) => [...normalizeCompletionIds([candidate])].some((entry) => completed.has(entry)));
}

function workUnitBelongsToSurface(unit = {}, surfaceIds = new Set()) {
  const candidates = [
    unit.id,
    unit.surfaceId,
    unit.architectureEpicId,
    unit.metadata?.surfaceId,
    unit.metadata?.architectureEpicId,
    unit.metadata?.focusId,
    ...(Array.isArray(unit.issueIds) ? unit.issueIds : [])
  ];
  return candidates.some((candidate) => [...normalizeCompletionIds([candidate])].some((entry) => surfaceIds.has(entry)));
}

function supervisorIsObjectiveGreen(supervisorState = {}, objective = {}) {
  const status = String(supervisorState.status || supervisorState.supervisorStatus || '').trim();
  const matrixStatus = String(supervisorState.matrixStatus || supervisorState.surfaceMatrixStatus || '').trim();
  const parityStatus = String(supervisorState.parityStatus || '').trim();
  const fidelity = String(objective.requestedFidelity || supervisorState.requestedFidelity || '').trim();
  const statusGreen = status === 'green';
  const matrixGreen = ['all_complete', 'green'].includes(matrixStatus);
  if (fidelity === 'full_clone') return statusGreen && matrixGreen && ['full', 'full_clone'].includes(parityStatus);
  return statusGreen && matrixGreen;
}

function queueLooksExhausted({ currentWorkCount = null, scopeAlreadySatisfied = false, currentSurfaceMatrix = null, supervisorState = {} } = {}) {
  const workCount = Number(currentWorkCount);
  const noCurrentWork = Number.isFinite(workCount) ? workCount === 0 : false;
  const matrixStatus = String(supervisorState.matrixStatus || currentSurfaceMatrix?.matrixStatus || currentSurfaceMatrix?.status || '').trim();
  return scopeAlreadySatisfied === true
    || noCurrentWork
    || ['all_complete', 'scope_satisfied_zero_work', 'mechanical_green_zero_work'].includes(matrixStatus)
    || supervisorState.blockerKind === 'zero_work_scoped_green'
    || supervisorState.blockerKind === 'queue_exhausted_objective_remaining';
}

export function buildObjectiveExpansionPlan({
  repoPath,
  objective = {},
  requestedAgentCount = objective.requestedAgentCount || null,
  architectureEpics = null,
  targetEpicIds = [],
  maxEpics = null,
  stage = 'dynamic_objective_expansion',
  maxSurfaces = 200,
  currentSurfaceMatrix = null,
  currentWorkGraph = null,
  currentWorkCount = null,
  scopeAlreadySatisfied = false,
  supervisorState = {},
  completedSurfaceIds = [],
  completedWorkUnitIds = [],
  excludedSurfaceIds = [],
  expansionIndex = 1
} = {}) {
  const fidelity = objective.requestedFidelity || supervisorState.requestedFidelity || null;
  const useArchitectureEpics = architectureEpics == null
    ? String(fidelity || '') === 'full_clone'
    : Boolean(architectureEpics);
  const normalizedObjective = {
    id: objective.id || slug(objective.title || objective.prompt || 'objective'),
    title: objective.title || objective.prompt || objective.id || 'Objective expansion',
    requestedFidelity: fidelity
  };
  const decomposition = useArchitectureEpics
    ? decomposeObjectiveToArchitectureEpics({ repoPath, objective: normalizedObjective, requestedAgentCount, targetEpicIds, maxEpics, stage })
    : decomposeObjectiveToSurfaces({ repoPath, objective: normalizedObjective, requestedAgentCount, maxSurfaces });

  const completed = collectCompletedSurfaceIds({ currentSurfaceMatrix, completedSurfaceIds, completedWorkUnitIds });
  const excluded = normalizeCompletionIds(excludedSurfaceIds);
  const candidateSurfaces = matrixSurfaces(decomposition.surfaceMatrix);
  const remainingSurfaces = candidateSurfaces
    .filter((surface) => !surfaceCompleted(surface, completed))
    .filter((surface) => !surfaceCompleted(surface, excluded));
  const remainingSurfaceIds = normalizeCompletionIds(remainingSurfaces.flatMap((surface) => [surface.id, surface.focusId, surface.architectureEpicId, ...(Array.isArray(surface.issueIds) ? surface.issueIds : [])]));
  const candidateWorkUnits = Array.isArray(decomposition.workGraph?.workUnits) ? decomposition.workGraph.workUnits : [];
  const remainingWorkUnits = candidateWorkUnits.filter((unit) => workUnitBelongsToSurface(unit, remainingSurfaceIds));
  const objectiveGreen = supervisorIsObjectiveGreen(supervisorState, normalizedObjective);
  const exhausted = queueLooksExhausted({ currentWorkCount: currentWorkCount ?? currentWorkGraph?.workUnits?.length ?? null, scopeAlreadySatisfied, currentSurfaceMatrix, supervisorState });
  const shouldExpand = !objectiveGreen && exhausted && remainingWorkUnits.length > 0;
  const reason = shouldExpand
    ? supervisorState.blockerKind === 'strict_1to1_ceiling'
      ? 'strict_ceiling_red_objective_expansion_available'
      : 'scoped_graph_exhausted_objective_remaining'
    : objectiveGreen
      ? 'objective_supervisor_green'
      : remainingWorkUnits.length === 0
        ? 'no_uncompleted_expansion_work_units'
        : exhausted
          ? 'expansion_available_but_not_required'
          : 'current_work_graph_not_exhausted';
  const expansionSurfaceMatrix = {
    ...(decomposition.surfaceMatrix || {}),
    generatedAt: nowIso(),
    status: remainingSurfaces.length > 0 ? 'planned' : 'all_complete_for_expansion_scope',
    expansionIndex: Number(expansionIndex) || 1,
    surfaces: remainingSurfaces.map((surface) => ({ ...surface, status: 'planned' }))
  };
  const expansionWorkGraph = {
    ...(decomposition.workGraph || {}),
    generatedAt: nowIso(),
    expansionIndex: Number(expansionIndex) || 1,
    workUnits: remainingWorkUnits
  };
  return {
    schemaVersion: 'claw.objective_expansion_plan.v1',
    generatedAt: nowIso(),
    expansionId: `${normalizedObjective.id || 'objective'}::expansion-${String(Number(expansionIndex) || 1).padStart(3, '0')}`,
    repoPath: path.resolve(repoPath || '.'),
    objective: normalizedObjective,
    requestedAgentCount: Number(requestedAgentCount || 0) || null,
    mode: useArchitectureEpics ? 'architecture_epic_negative_space' : 'surface_negative_space',
    shouldExpand,
    reason,
    objectiveGreen,
    exhausted,
    scopeAlreadySatisfied: Boolean(scopeAlreadySatisfied),
    currentWorkCount: Number.isFinite(Number(currentWorkCount)) ? Number(currentWorkCount) : currentWorkGraph?.workUnits?.length ?? null,
    remainingObjectiveIds: remainingSurfaces.map((surface) => surface.id).filter(Boolean),
    expansionSurfaceCount: remainingSurfaces.length,
    expansionWorkUnitCount: remainingWorkUnits.length,
    survey: decomposition.survey,
    negativeSpace: decomposition.negativeSpace,
    decompositionSummary: decomposition.summary,
    surfaceMatrix: expansionSurfaceMatrix,
    workGraph: expansionWorkGraph,
    blocker: decomposition.blocker || null,
    truthBoundary: 'Objective expansion is a shared planning/control-plane artifact. It authorizes another implementation wave only when the requested objective is still red and the current scoped graph is exhausted; it is not a completion or parity claim.'
  };
}

function surveyPathFromGraph(surfaceGraph) {
  return surfaceGraph?.repoPath || null;
}

export function decomposeObjectiveToSurfaces({ repoPath, objective = {}, requestedAgentCount = objective.requestedAgentCount || null, maxSurfaces = 200 } = {}) {
  const survey = surveyRepository({ repoPath });
  const negativeSpace = buildNegativeSpaceInventory({ survey, objective, requestedAgentCount });
  const surfaceGraph = buildSurfaceGraph({ survey, objective, requestedAgentCount, maxSurfaces });
  surfaceGraph.repoPath = path.resolve(repoPath || '.');
  const surfaceMatrix = buildObjectiveSurfaceMatrix({ surfaceGraph, objective });
  const workGraph = buildObjectiveWorkGraph({ surfaceGraph, objective, repoPath });
  const requested = Number(requestedAgentCount || 0);
  const blocker = requested > 0 && surfaceGraph.lowOverlapSurfaceCount < requested
    ? {
      type: 'insufficient_parallel_surface_inventory',
      requestedAgentCount: requested,
      lowOverlapSurfaceCount: surfaceGraph.lowOverlapSurfaceCount,
      candidateSurfaceCount: surfaceGraph.surfaceCount,
      nextAction: 'Add more independent product-runtime surfaces, lower requestedAgentCount, or let objective expansion generate additional surfaces before launching a scale run.'
    }
    : null;
  return {
    schemaVersion: 'claw.objective_surface_decomposition.v1',
    generatedAt: nowIso(),
    objective: {
      id: objective.id || null,
      title: objective.title || objective.prompt || null,
      requestedFidelity: objective.requestedFidelity || null
    },
    repoPath: path.resolve(repoPath || '.'),
    requestedAgentCount: requested || null,
    status: blocker ? 'blocked_insufficient_surface_inventory' : surfaceMatrix.status,
    survey,
    negativeSpace,
    surfaceGraph,
    surfaceMatrix,
    workGraph,
    blocker,
    summary: {
      productFileCount: survey.metrics.productFileCount,
      domainCount: survey.metrics.domainCount,
      surfaceCount: surfaceGraph.surfaceCount,
      lowOverlapSurfaceCount: surfaceGraph.lowOverlapSurfaceCount,
      missingExpectedRoles: negativeSpace.missingRoles,
      weakDomainCount: negativeSpace.weakDomains.length,
      readyForRequestedAgentCount: !blocker
    }
  };
}

export function renderObjectiveDecompositionReport(decomposition) {
  const lines = [
    '# Objective Surface Decomposition',
    '',
    `- Generated at: ${decomposition.generatedAt}`,
    `- Repo: ${decomposition.repoPath}`,
    `- Objective: ${decomposition.objective.title || decomposition.objective.id || 'unspecified'}`,
    `- Status: ${decomposition.status}`,
    `- Product files: ${decomposition.summary.productFileCount}`,
    `- Candidate surfaces: ${decomposition.summary.surfaceCount}`,
    `- Low-overlap surfaces: ${decomposition.summary.lowOverlapSurfaceCount}`
  ];
  if (decomposition.blocker) {
    lines.push('', '## Blocker', `- ${decomposition.blocker.type}: requested ${decomposition.blocker.requestedAgentCount}, low-overlap ${decomposition.blocker.lowOverlapSurfaceCount}`, `- Next action: ${decomposition.blocker.nextAction}`);
  }
  if (decomposition.negativeSpace.missingRoles.length) lines.push('', '## Missing expected roles', ...decomposition.negativeSpace.missingRoles.map((role) => `- ${role}`));
  lines.push('', '## First surfaces', ...decomposition.surfaceGraph.surfaces.slice(0, 12).map((surface) => `- ${surface.id}: ${surface.targetFiles.join(', ')} (${surface.verifierType}, risk=${surface.collisionRisk})`));
  return `${lines.join('\n')}\n`;
}

export function renderArchitectureEpicReport(decomposition) {
  const plan = decomposition.architectureEpicPlan || decomposition;
  const lines = [
    '# Architecture Epic Decomposition',
    '',
    `- Generated at: ${plan.generatedAt}`,
    `- Repo: ${plan.repoPath}`,
    `- Objective: ${plan.objective?.title || plan.objective?.id || 'unspecified'}`,
    `- Status: ${plan.status}`,
    `- Epics: ${plan.summary?.epicCount ?? plan.epics?.length ?? 0}`,
    `- Ready epics: ${plan.summary?.readyEpicCount ?? 0}`,
    `- Work units: ${plan.summary?.workUnitCount ?? plan.workGraph?.workUnits?.length ?? 0}`,
    `- Roles: ${(plan.summary?.architectureRoles || plan.architectureRoles || []).join(', ') || 'none'}`,
    '',
    '## Staged proof readiness',
    `- Single epic: ${plan.summary?.singleEpicReady === true ? 'ready' : 'blocked'}`,
    `- 3–5 epics: ${plan.summary?.multiEpicReady === true ? 'ready' : 'blocked'}`,
    `- Final-boss relaunch: ${plan.summary?.finalBossRelaunchReady === true ? 'ready' : 'blocked'}`
  ];
  if (plan.blocker) lines.push('', '## Blocker', `- ${plan.blocker.type}`, `- Next action: ${plan.blocker.nextAction}`);
  lines.push('', '## Epics');
  for (const epic of plan.epics || []) {
    lines.push(`- ${epic.id}: ${epic.title} (${epic.ready ? 'ready' : 'blocked'})`);
    lines.push(`  - roles: ${(epic.roles || []).join(', ')}`);
    lines.push(`  - files: ${(epic.targetFiles || []).slice(0, 8).join(', ')}`);
    if ((epic.missingLayers || []).length) lines.push(`  - missing layers: ${epic.missingLayers.join(', ')}`);
  }
  return `${lines.join('\n')}\n`;
}
