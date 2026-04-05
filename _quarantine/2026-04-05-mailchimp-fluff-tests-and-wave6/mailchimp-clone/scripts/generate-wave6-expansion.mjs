import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);

const PACKAGE_DEFS = [
  { id: 'attribution-modeling', name: 'Attribution Modeling', focus: 'Attribution modeling, revenue influence mapping, and outcome calibration.', themes: ['attribution', 'measurement'], metrics: ['influence', 'spend', 'conversion', 'lag'], lanes: ['baseline', 'model', 'review', 'share'] },
  { id: 'benchmark-studio', name: 'Benchmark Studio', focus: 'Benchmark packs, peer comparisons, and workspace score ranges.', themes: ['benchmark', 'studio'], metrics: ['cohort', 'lift', 'variance', 'coverage'], lanes: ['collect', 'compare', 'review', 'publish'] },
  { id: 'calendar-approvals', name: 'Calendar Approvals', focus: 'Calendar-linked review windows, release holds, and launch approvals.', themes: ['calendar', 'approval'], metrics: ['windows', 'sla', 'blocks', 'throughput'], lanes: ['plan', 'review', 'approve', 'ship'] },
  { id: 'campaign-sandboxes', name: 'Campaign Sandboxes', focus: 'Preflight sandboxes, preview environments, and scenario rehearsal.', themes: ['campaign', 'sandbox'], metrics: ['rehearsal', 'preview', 'risk', 'confidence'], lanes: ['seed', 'draft', 'validate', 'launch'] },
  { id: 'channel-playbooks', name: 'Channel Playbooks', focus: 'Channel operating playbooks with readiness and escalation coverage.', themes: ['channel', 'playbook'], metrics: ['coverage', 'adoption', 'readiness', 'exceptions'], lanes: ['brief', 'prepare', 'coach', 'iterate'] },
  { id: 'compliance-incidents', name: 'Compliance Incidents', focus: 'Compliance case queues, remediation paths, and incident ownership.', themes: ['compliance', 'incident'], metrics: ['cases', 'exposure', 'sla', 'closure'], lanes: ['detect', 'triage', 'remediate', 'verify'] },
  { id: 'consent-ledger', name: 'Consent Ledger', focus: 'Consent receipts, legal basis tracking, and change history.', themes: ['consent', 'ledger'], metrics: ['receipts', 'proof', 'coverage', 'exceptions'], lanes: ['capture', 'verify', 'review', 'export'] },
  { id: 'creative-brief-builder', name: 'Creative Brief Builder', focus: 'Creative brief intake, approvals, and asset-ready summaries.', themes: ['creative', 'brief'], metrics: ['briefs', 'owners', 'turnaround', 'clarity'], lanes: ['intake', 'draft', 'align', 'handoff'] },
  { id: 'creative-qa', name: 'Creative QA', focus: 'Creative review scorecards, content QA, and issue triage.', themes: ['creative', 'qa'], metrics: ['coverage', 'issues', 'severity', 'pass-rate'], lanes: ['lint', 'review', 'fix', 'signoff'] },
  { id: 'customer-health', name: 'Customer Health', focus: 'Lifecycle health scores, churn signals, and success actions.', themes: ['customer', 'health'], metrics: ['health', 'risk', 'coverage', 'retention'], lanes: ['observe', 'score', 'act', 'review'] },
  { id: 'data-activation', name: 'Data Activation', focus: 'Audience activation pipelines, sync readiness, and destination controls.', themes: ['data', 'activation'], metrics: ['syncs', 'destinations', 'latency', 'quality'], lanes: ['map', 'activate', 'verify', 'observe'] },
  { id: 'deliverability-war-room', name: 'Deliverability War Room', focus: 'Deliverability incident coordination, sender triage, and follow-through.', themes: ['deliverability', 'war-room'], metrics: ['alerts', 'senders', 'remediation', 'recovery'], lanes: ['detect', 'contain', 'repair', 'report'] },
  { id: 'ecommerce-insights', name: 'Ecommerce Insights', focus: 'Commerce funnel analysis, revenue segmentation, and order cohorts.', themes: ['ecommerce', 'insights'], metrics: ['orders', 'gmv', 'ltv', 'lift'], lanes: ['ingest', 'segment', 'analyze', 'share'] },
  { id: 'engagement-forecasting', name: 'Engagement Forecasting', focus: 'Engagement forecasts, expected lift planning, and pacing checks.', themes: ['engagement', 'forecast'], metrics: ['opens', 'clicks', 'pace', 'confidence'], lanes: ['baseline', 'forecast', 'compare', 'adjust'] },
  { id: 'localization-qa', name: 'Localization QA', focus: 'Localized content checks, coverage gaps, and market signoff.', themes: ['localization', 'qa'], metrics: ['markets', 'coverage', 'issues', 'signoff'], lanes: ['scope', 'translate', 'review', 'approve'] },
  { id: 'multi-account-control', name: 'Multi-Account Control', focus: 'Cross-account controls, portfolio rollups, and tenancy governance.', themes: ['multi-account', 'control'], metrics: ['accounts', 'portfolios', 'coverage', 'exceptions'], lanes: ['map', 'govern', 'review', 'steward'] },
  { id: 'partner-certification', name: 'Partner Certification', focus: 'Partner certification tracks, readiness milestones, and evidence capture.', themes: ['partner', 'certification'], metrics: ['tracks', 'partners', 'pass-rate', 'evidence'], lanes: ['enroll', 'coach', 'assess', 'certify'] },
  { id: 'predictive-segments', name: 'Predictive Segments', focus: 'Predictive segment catalogs, signal scoring, and action readiness.', themes: ['predictive', 'segments'], metrics: ['signals', 'segments', 'confidence', 'coverage'], lanes: ['collect', 'score', 'activate', 'observe'] },
  { id: 'profile-enrichment', name: 'Profile Enrichment', focus: 'Profile enrichment jobs, attribute provenance, and quality reporting.', themes: ['profile', 'enrichment'], metrics: ['profiles', 'attributes', 'freshness', 'accuracy'], lanes: ['ingest', 'enrich', 'verify', 'publish'] },
  { id: 'release-command-center', name: 'Release Command Center', focus: 'Release command orchestration, launch readiness, and recovery posture.', themes: ['release', 'command'], metrics: ['launches', 'owners', 'readiness', 'rollback'], lanes: ['plan', 'stage', 'launch', 'stabilize'] },
  { id: 'retention-offers', name: 'Retention Offers', focus: 'Retention playbooks, incentive mixes, and customer rescue paths.', themes: ['retention', 'offers'], metrics: ['offers', 'acceptance', 'save-rate', 'margin'], lanes: ['segment', 'package', 'deliver', 'measure'] },
  { id: 'revenue-attribution', name: 'Revenue Attribution', focus: 'Revenue attribution snapshots, touchpoint weighting, and finance handoff.', themes: ['revenue', 'attribution'], metrics: ['revenue', 'touches', 'influence', 'confidence'], lanes: ['collect', 'attribute', 'reconcile', 'share'] },
  { id: 'segmentation-quality', name: 'Segmentation Quality', focus: 'Segment QA, overlap analysis, and rule-set integrity reporting.', themes: ['segmentation', 'quality'], metrics: ['segments', 'overlap', 'coverage', 'integrity'], lanes: ['inspect', 'compare', 'repair', 'certify'] },
  { id: 'sender-rotation', name: 'Sender Rotation', focus: 'Sender pools, warm-up posture, and rotation scheduling.', themes: ['sender', 'rotation'], metrics: ['senders', 'warmup', 'risk', 'coverage'], lanes: ['prepare', 'rotate', 'monitor', 'adjust'] },
  { id: 'service-recovery', name: 'Service Recovery', focus: 'Service recovery kits, rollback guides, and dependency restoration.', themes: ['service', 'recovery'], metrics: ['incidents', 'recovery', 'mttr', 'handoffs'], lanes: ['detect', 'stabilize', 'recover', 'retrospect'] },
  { id: 'subscription-intelligence', name: 'Subscription Intelligence', focus: 'Subscription cohorts, plan migration signals, and expansion posture.', themes: ['subscription', 'intelligence'], metrics: ['plans', 'churn', 'expansion', 'signals'], lanes: ['observe', 'score', 'nurture', 'review'] },
  { id: 'template-approvals', name: 'Template Approvals', focus: 'Template review workflows, approvals, and launch readiness.', themes: ['template', 'approval'], metrics: ['templates', 'reviews', 'turnaround', 'coverage'], lanes: ['draft', 'review', 'approve', 'release'] },
  { id: 'template-variants', name: 'Template Variants', focus: 'Template variant catalogs, testing cohorts, and performance summaries.', themes: ['template', 'variants'], metrics: ['variants', 'tests', 'lift', 'adoption'], lanes: ['compose', 'compare', 'promote', 'archive'] },
  { id: 'trust-automation', name: 'Trust Automation', focus: 'Trust workflows, control automation, and remediation proof chains.', themes: ['trust', 'automation'], metrics: ['controls', 'automation', 'exceptions', 'proof'], lanes: ['map', 'automate', 'review', 'attest'] },
  { id: 'webhook-inspector', name: 'Webhook Inspector', focus: 'Webhook traces, replay queues, and endpoint debugging summaries.', themes: ['webhook', 'inspector'], metrics: ['hooks', 'replays', 'latency', 'failures'], lanes: ['capture', 'inspect', 'replay', 'verify'] }
];

const APP_DEFS = [
  { id: 'lifecycle-studio', title: 'Lifecycle Studio', packages: ['customer-health', 'engagement-forecasting', 'retention-offers', 'subscription-intelligence'] },
  { id: 'compliance-hub', title: 'Compliance Hub', packages: ['consent-ledger', 'compliance-incidents', 'trust-automation', 'service-recovery'] },
  { id: 'integrations-studio', title: 'Integrations Studio', packages: ['webhook-inspector', 'partner-certification', 'data-activation', 'predictive-segments'] }
];

const CLUSTER_GROUPS = [
  ['wave6-cluster-growth', ['attribution-modeling', 'benchmark-studio', 'campaign-sandboxes', 'channel-playbooks', 'creative-brief-builder', 'creative-qa']],
  ['wave6-cluster-compliance', ['calendar-approvals', 'compliance-incidents', 'consent-ledger', 'deliverability-war-room', 'service-recovery', 'trust-automation']],
  ['wave6-cluster-lifecycle', ['customer-health', 'engagement-forecasting', 'retention-offers', 'segmentation-quality', 'sender-rotation', 'subscription-intelligence']],
  ['wave6-cluster-data', ['data-activation', 'ecommerce-insights', 'multi-account-control', 'predictive-segments', 'profile-enrichment', 'revenue-attribution']],
  ['wave6-cluster-ecosystem', ['localization-qa', 'partner-certification', 'release-command-center', 'template-approvals', 'template-variants', 'webhook-inspector']]
];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function pascal(id) {
  return id.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('');
}

function quoteList(values) {
  return `[${values.map((value) => JSON.stringify(value)).join(', ')}]`;
}

function routePrefix(id) {
  return id;
}

function write(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content.trimStart() + '\n');
}

function renderPackage(def) {
  const p = pascal(def.id);
  const pkgDir = path.join(ROOT, 'packages', def.id);
  const routeDir = path.join(pkgDir, 'routes');
  ensureDir(routeDir);

  write(path.join(pkgDir, `domain-${def.id}.mjs`), `
const PROGRAM = {
  id: ${JSON.stringify(def.id)},
  name: ${JSON.stringify(def.name)},
  focus: ${JSON.stringify(`${def.name} extends the real-repo expansion with ${def.focus.toLowerCase()}`)},
  themes: ${quoteList(def.themes)},
  metrics: ${quoteList(def.metrics)},
  lanes: ${quoteList(def.lanes)}
};

export function create${p}Workspace(workspaceName = 'Wave 6 workspace') {
  return {
    ...PROGRAM,
    workspaceName,
    generatedAt: new Date().toISOString(),
    scorecards: PROGRAM.metrics.map((metric, index) => ({
      id: metric,
      label: metric.replace(/-/g, ' '),
      currentValue: 22 + (index * 5),
      targetValue: 34 + (index * 7),
      posture: index % 2 === 0 ? 'healthy' : 'watch',
      narrative: ${JSON.stringify(def.name)} + ' tracks ' + metric + ' for ' + workspaceName + '.'
    })),
    programs: PROGRAM.lanes.map((lane, index) => ({
      id: ${JSON.stringify(def.id)} + '-program-' + (index + 1),
      lane,
      owner: lane + '-owner',
      status: index === 0 ? 'active' : index === 1 ? 'planned' : index === 2 ? 'review' : 'monitoring',
      narrative: ${JSON.stringify(def.name)} + ' keeps ' + lane + ' execution visible.'
    }))
  };
}

export function summarize${p}(workspace = create${p}Workspace()) {
  return {
    id: workspace.id,
    name: workspace.name,
    focus: workspace.focus,
    workspaceName: workspace.workspaceName,
    metricCount: workspace.scorecards.length,
    activePrograms: workspace.programs.filter((entry) => entry.status === 'active').length,
    watchMetrics: workspace.scorecards.filter((entry) => entry.posture === 'watch').map((entry) => entry.id)
  };
}

export function create${p}Narratives(workspace = create${p}Workspace()) {
  return workspace.programs.map((program, index) => ({
    id: program.id + '-narrative',
    headline: workspace.name + ' ' + program.lane + ' sequence',
    summary: 'Wave 6 narrative ' + (index + 1) + ' for ' + workspace.workspaceName + '.',
    dependencies: workspace.scorecards.slice(0, 2).map((card) => card.id)
  }));
}
`);

  write(path.join(pkgDir, `domain-${def.id}-policies.mjs`), `
const DEFAULT_POLICIES = [
  { id: ${JSON.stringify(def.id + '-policy-1')}, title: ${JSON.stringify(def.name + ' guardrail')}, severity: 'medium' },
  { id: ${JSON.stringify(def.id + '-policy-2')}, title: ${JSON.stringify(def.name + ' approval ring')}, severity: 'high' },
  { id: ${JSON.stringify(def.id + '-policy-3')}, title: ${JSON.stringify(def.name + ' rollback lane')}, severity: 'medium' }
];

export function create${p}Policies(overrides = {}) {
  return DEFAULT_POLICIES.map((policy, index) => ({
    ...policy,
    owner: overrides.owner || 'wave6-owner',
    status: overrides.status || (index === 1 ? 'watch' : 'active'),
    controls: ['change-log', 'approval-ring', 'rollback-check'].slice(0, index + 1),
    notes: overrides.notes || ${JSON.stringify(def.name + ' policy pack for the real-repo expansion wave.')}
  }));
}

export function validate${p}Policies(policies = create${p}Policies()) {
  const issues = [];
  if (policies.length < 3) issues.push('insufficient_policy_depth');
  if (!policies.some((policy) => policy.severity === 'high')) issues.push('missing_high_severity_policy');
  if (!policies.every((policy) => policy.controls.length >= 1)) issues.push('missing_controls');
  return { ok: issues.length === 0, issues, policyCount: policies.length };
}

export function policySummary${p}(policies = create${p}Policies()) {
  return { total: policies.length, watch: policies.filter((policy) => policy.status === 'watch').length, active: policies.filter((policy) => policy.status === 'active').length };
}
`);

  write(path.join(pkgDir, `service-${def.id}.mjs`), `
import { create${p}Workspace, summarize${p}, create${p}Narratives } from './domain-${def.id}.mjs';
import { create${p}Policies, validate${p}Policies, policySummary${p} } from './domain-${def.id}-policies.mjs';

export function build${p}Snapshot(workspaceName = 'Wave 6 workspace') {
  const workspace = create${p}Workspace(workspaceName);
  const policies = create${p}Policies();
  return { workspace, summary: summarize${p}(workspace), narratives: create${p}Narratives(workspace), policies, policySummary: policySummary${p}(policies), validation: validate${p}Policies(policies) };
}

export function create${p}Checklist(snapshot = build${p}Snapshot()) {
  return [
    { id: ${JSON.stringify(def.id + '-check-1')}, label: 'Scope visible', ok: snapshot.summary.metricCount >= 3 },
    { id: ${JSON.stringify(def.id + '-check-2')}, label: 'Policy depth', ok: snapshot.validation.ok },
    { id: ${JSON.stringify(def.id + '-check-3')}, label: 'Narratives available', ok: snapshot.narratives.length >= 4 }
  ];
}

export function create${p}ApiDocument(snapshot = build${p}Snapshot()) {
  return {
    id: ${JSON.stringify(def.id + '-api')},
    headline: snapshot.summary.name + ' API contract',
    endpoints: [
      { method: 'GET', path: '/api/${routePrefix(def.id)}/overview' },
      { method: 'POST', path: '/api/${routePrefix(def.id)}/validate' },
      { method: 'GET', path: '/api/${routePrefix(def.id)}/policies' }
    ],
    checklist: create${p}Checklist(snapshot)
  };
}
`);

  write(path.join(pkgDir, `fixtures-${def.id}.mjs`), `
export function create${p}Fixtures() {
  return {
    contacts: [
      { id: ${JSON.stringify(def.id + '-contact-1')}, email: ${JSON.stringify(def.id + '+1@example.com')}, tier: 'growth' },
      { id: ${JSON.stringify(def.id + '-contact-2')}, email: ${JSON.stringify(def.id + '+2@example.com')}, tier: 'premium' }
    ],
    workspaces: [
      { id: ${JSON.stringify(def.id + '-ws-1')}, name: ${JSON.stringify(def.name + ' Demo East')} },
      { id: ${JSON.stringify(def.id + '-ws-2')}, name: ${JSON.stringify(def.name + ' Demo West')} }
    ],
    notes: [${JSON.stringify(def.name + ' fixture for the wave 6 route catalog')}, 'Supports targeted regression coverage']
  };
}

export function summarize${p}Fixtures(fixtures = create${p}Fixtures()) {
  return { contacts: fixtures.contacts.length, workspaces: fixtures.workspaces.length, notes: fixtures.notes.length };
}
`);

  write(path.join(routeDir, `${def.id}-dashboard.mjs`), `
import { build${p}Snapshot } from '../service-${def.id}.mjs';

export function create${p}DashboardRoutes(basePath = '/${routePrefix(def.id)}') { const snapshot = build${p}Snapshot(); return [{ id: '${def.id}.overview', method: 'GET', path: basePath, summary: snapshot.summary }, { id: '${def.id}.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs }, { id: '${def.id}.narratives', method: 'GET', path: basePath + '/narratives', narratives: snapshot.narratives }]; }
`);

  write(path.join(routeDir, `${def.id}-api.mjs`), `
import { build${p}Snapshot, create${p}ApiDocument } from '../service-${def.id}.mjs';

export function create${p}ApiRoutes(basePath = '/api/${routePrefix(def.id)}') { const snapshot = build${p}Snapshot(); return [{ id: '${def.id}.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary }, { id: '${def.id}.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation }, { id: '${def.id}.api.document', method: 'GET', path: basePath + '/document', document: create${p}ApiDocument(snapshot) }]; }
`);

  write(path.join(routeDir, `${def.id}-ops.mjs`), `
import { build${p}Snapshot, create${p}Checklist } from '../service-${def.id}.mjs';

export function create${p}OpsRoutes(basePath = '/ops/${routePrefix(def.id)}') { const snapshot = build${p}Snapshot(); return [{ id: '${def.id}.ops.health', method: 'GET', path: basePath + '/health', checklist: create${p}Checklist(snapshot) }, { id: '${def.id}.ops.policies', method: 'GET', path: basePath + '/policies', policies: snapshot.policies }, { id: '${def.id}.ops.metrics', method: 'GET', path: basePath + '/metrics', scorecards: snapshot.workspace.scorecards }]; }
`);

  write(path.join(routeDir, `${def.id}-public.mjs`), `
import { build${p}Snapshot } from '../service-${def.id}.mjs';
import { create${p}Fixtures } from '../fixtures-${def.id}.mjs';

export function create${p}PublicRoutes(basePath = '/public/${routePrefix(def.id)}') { const snapshot = build${p}Snapshot(); const fixtures = create${p}Fixtures(); return [{ id: '${def.id}.public.summary', method: 'GET', path: basePath, focus: snapshot.summary.focus }, { id: '${def.id}.public.catalog', method: 'GET', path: basePath + '/catalog', contacts: fixtures.contacts }, { id: '${def.id}.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }]; }
`);

  write(path.join(pkgDir, 'index.mjs'), `
export { create${p}Workspace, summarize${p}, create${p}Narratives } from './domain-${def.id}.mjs';
export { create${p}Policies, validate${p}Policies, policySummary${p} } from './domain-${def.id}-policies.mjs';
export { build${p}Snapshot, create${p}Checklist, create${p}ApiDocument } from './service-${def.id}.mjs';
export { create${p}Fixtures, summarize${p}Fixtures } from './fixtures-${def.id}.mjs';
export { create${p}DashboardRoutes } from './routes/${def.id}-dashboard.mjs';
export { create${p}ApiRoutes } from './routes/${def.id}-api.mjs';
export { create${p}OpsRoutes } from './routes/${def.id}-ops.mjs';
export { create${p}PublicRoutes } from './routes/${def.id}-public.mjs';
`);

  write(path.join(ROOT, 'tests', `${def.id}.test.mjs`), `
import test from 'node:test';
import assert from 'node:assert/strict';
import { build${p}Snapshot, create${p}DashboardRoutes, create${p}ApiRoutes, create${p}OpsRoutes, create${p}PublicRoutes, summarize${p}Fixtures } from '../packages/${def.id}/index.mjs';

test('${def.id} package expands the real-repo wave with route catalogs', () => {
  const snapshot = build${p}Snapshot('Wave 6 Anchor');
  assert.equal(snapshot.summary.workspaceName, 'Wave 6 Anchor');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(create${p}DashboardRoutes().length, 3);
  assert.equal(create${p}ApiRoutes().length, 3);
  assert.equal(create${p}OpsRoutes().length, 3);
  assert.equal(create${p}PublicRoutes().length, 3);
  assert.equal(summarize${p}Fixtures().contacts, 2);
});
`);

  write(path.join(ROOT, 'tests', `${def.id}-routes.test.mjs`), `
import test from 'node:test';
import assert from 'node:assert/strict';
import { create${p}DashboardRoutes, create${p}ApiRoutes, create${p}OpsRoutes, create${p}PublicRoutes } from '../packages/${def.id}/index.mjs';

test('${def.id} routes honor custom base paths and stable ids', () => {
  const dashboard = create${p}DashboardRoutes('/labs/${def.id}');
  const api = create${p}ApiRoutes('/api/labs/${def.id}');
  const ops = create${p}OpsRoutes('/ops/labs/${def.id}');
  const pub = create${p}PublicRoutes('/public/labs/${def.id}');
  assert.equal(dashboard[0].path, '/labs/${def.id}');
  assert.equal(api[0].path, '/api/labs/${def.id}/overview');
  assert.equal(ops[0].path, '/ops/labs/${def.id}/health');
  assert.equal(pub[0].path, '/public/labs/${def.id}');
  assert.match(dashboard[0].id, /${def.id.replace(/[-/]/g, '\\-')}/);
  assert.match(api[2].id, /${def.id.replace(/[-/]/g, '\\-')}/);
});
`);
}

function renderAppServer(app) {
  const imports = app.packages.map((pkg, index) => {
    const p = pascal(pkg);
    return `import { summarize${p}, create${p}DashboardRoutes } from '../../packages/${pkg}/index.mjs';`;
  }).join('\n');

  const summaryBody = app.packages.map((pkg, index) => {
    const p = pascal(pkg);
    return `    summaries.push({ id: 'section-${index + 1}', ...summarize${p}() });\n    routes.push(...create${p}DashboardRoutes());`;
  }).join('\n');

  return `
import http from 'node:http';
${imports}

export function createServer() {
  const server = http.createServer((req, res) => {
    const summaries = [];
    const routes = [];
${summaryBody}

    if (req.url === '/catalog.json') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ app: '${app.id}', summaries, routes }, null, 2));
      return;
    }

    const html = '<!doctype html><html><body><h1>${app.title}</h1>' + summaries.map((summary) => '<section><h2>' + summary.name + '</h2><p>' + summary.focus + '</p><p>Active workstreams: ' + summary.activePrograms + '</p></section>').join('') + '</body></html>';
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  });

  server.start = ({ port = 0 } = {}) => new Promise((resolve) => server.listen(port, () => resolve(server.address())));
  server.stop = () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return server;
}
`;
}

function renderAppTest(app) {
  return `
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../apps/${app.id}/server.mjs';

test('${app.id} shell exposes a live catalog for wave 6 domains', async () => {
  const server = createServer();
  const address = await server.start({ port: 0 });
  const baseUrl = 'http://127.0.0.1:' + address.port;
  try {
    const home = await fetch(baseUrl + '/');
    assert.match(await home.text(), /${app.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/);
    const catalog = await fetch(baseUrl + '/catalog.json');
    const payload = await catalog.json();
    assert.equal(payload.summaries.length, ${app.packages.length});
    assert.ok(payload.routes.length >= ${app.packages.length * 3});
  } finally {
    await server.stop();
  }
});
`;
}

function renderScaleWaveRoute() {
  const groups = [
    { title: 'Growth & planning', packages: PACKAGE_DEFS.slice(0, 6) },
    { title: 'Compliance & trust', packages: PACKAGE_DEFS.slice(6, 12) },
    { title: 'Lifecycle & retention', packages: PACKAGE_DEFS.slice(12, 18) },
    { title: 'Data & segmentation', packages: PACKAGE_DEFS.slice(18, 24) },
    { title: 'Templates & ecosystem', packages: PACKAGE_DEFS.slice(24) }
  ];

  const imports = PACKAGE_DEFS.map((def) => `import { summarize${pascal(def.id)} } from '../../${def.id}/index.mjs';`).join('\n');
  const cards = groups.map((group) => {
    const items = group.packages.map((def) => `{ id: ${JSON.stringify(def.id)}, ...summarize${pascal(def.id)}() }`).join(',\n      ');
    return `  { title: ${JSON.stringify(group.title)}, modules: [\n      ${items}\n    ] }`;
  }).join(',\n');

  return `
import { page } from '../view.mjs';
import { text, escapeHtml } from '../utils.mjs';
${imports}

const WAVE6_GROUPS = [
${cards}
];

const APP_SHELLS = ${JSON.stringify(APP_DEFS.map((app) => app.title))};

function renderGroup(group) {
  return '<section class="card"><h3>' + escapeHtml(group.title) + '</h3><div class="grid">' + group.modules.map((module) => '<div class="card"><h4>' + escapeHtml(module.name) + '</h4><p>' + escapeHtml(module.focus) + '</p><p>Metrics: ' + module.metricCount + ' · Active programs: ' + module.activePrograms + '</p></div>').join('') + '</div></section>';
}

export function registerScaleWaveSixRoutes(router, deps) {
  const { requireAuth } = deps;

  router.register('GET', '/scale-wave-six', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;

    const totalModules = WAVE6_GROUPS.reduce((sum, group) => sum + group.modules.length, 0);
    const totalMetrics = WAVE6_GROUPS.reduce((sum, group) => sum + group.modules.reduce((inner, module) => inner + module.metricCount, 0), 0);
    const body = [
      '<div class="grid">',
      '<section class="card">',
      '<h3>Wave 6 scale expansion</h3>',
      '<p>This page exposes the first true large-scale expansion wave wired into the main authenticated product shell.</p>',
      '<p>Total new modules: ' + totalModules + ' · Total scorecards: ' + totalMetrics + ' · New app shells: ' + APP_SHELLS.length + '</p>',
      '<p>App shells: ' + escapeHtml(APP_SHELLS.join(', ')) + '</p>',
      '</section>',
      '</div>',
      WAVE6_GROUPS.map(renderGroup).join('')
    ].join('');

    text(res, 200, page('Scale Wave Six', actor, body));
  });
}
`;
}

function renderScaleWaveTest() {
  return `
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { CookieJar, createTempDataDir, followRedirect, postForm, request } from './helpers.mjs';

test('scale wave six route exposes the generated expansion families inside the product shell', async () => {
  const dir = createTempDataDir('wave6-scale-');
  process.env.MAILCLONE_DATA_DIR = dir;
  const server = createServer();
  const address = await server.start({ port: 0 });
  const baseUrl = 'http://127.0.0.1:' + address.port;
  const jar = new CookieJar();
  try {
    await followRedirect(baseUrl, jar, await postForm(baseUrl, jar, '/signup', {
      name: 'Wave Six Owner',
      email: 'wave6@example.com',
      password: 'secret123',
      workspaceName: 'Wave Six Lab'
    }));
    const response = await request(baseUrl, jar, '/scale-wave-six');
    const html = await response.text();
    assert.match(html, /Scale Wave Six/);
    assert.match(html, /Attribution Modeling/);
    assert.match(html, /Webhook Inspector/);
    assert.match(html, /Lifecycle Studio/);
  } finally {
    await server.stop();
    delete process.env.MAILCLONE_DATA_DIR;
  }
});
`;
}

function renderClusterTest(testId, ids) {
  const imports = ids.map((id) => {
    const p = pascal(id);
    return `import { summarize${p}, build${p}Snapshot } from '../packages/${id}/index.mjs';`;
  }).join('\n');
  const checks = ids.map((id) => {
    const p = pascal(id);
    return `  assert.ok(summarize${p}().metricCount >= 4);\n  assert.equal(build${p}Snapshot().validation.ok, true);`;
  }).join('\n');
  return `
import test from 'node:test';
import assert from 'node:assert/strict';
${imports}

test('${testId} keeps the generated wave 6 modules executable and policy-complete', () => {
${checks}
});
`;
}

for (const def of PACKAGE_DEFS) renderPackage(def);

for (const app of APP_DEFS) {
  write(path.join(ROOT, 'apps', app.id, 'server.mjs'), renderAppServer(app));
  write(path.join(ROOT, 'tests', `${app.id}.test.mjs`), renderAppTest(app));
}

write(path.join(ROOT, 'packages', 'app', 'routes', 'scale-wave-six.mjs'), renderScaleWaveRoute());
write(path.join(ROOT, 'tests', 'scale-wave-six.test.mjs'), renderScaleWaveTest());
for (const [testId, ids] of CLUSTER_GROUPS) {
  write(path.join(ROOT, 'tests', `${testId}.test.mjs`), renderClusterTest(testId, ids));
}

console.log(JSON.stringify({ ok: true, packageCount: PACKAGE_DEFS.length, appCount: APP_DEFS.length, extraTests: CLUSTER_GROUPS.length + 1 + APP_DEFS.length }, null, 2));
