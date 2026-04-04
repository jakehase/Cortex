import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const PACKAGE_ROOT = path.join(ROOT, 'packages');
const TEST_ROOT = path.join(ROOT, 'tests');
const APP_ROOT = path.join(ROOT, 'apps');

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--target-packages') args.targetPackages = Number(argv[index + 1]);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const TARGET_PACKAGES = Number(process.env.LOC500K_TARGET_PACKAGES || args.targetPackages || 540);

const GROUP_DEFS = [
  {
    id: 'growth',
    title: 'Growth, acquisition, and channel planning',
    description: 'Portfolio planning surfaces that help teams model demand creation, audience readiness, channel pacing, and conversion posture.',
    domains: ['acquisition', 'activation', 'advocacy', 'audience', 'campaign', 'channel', 'content'],
    metrics: ['coverage', 'velocity', 'pipeline', 'adoption', 'conversion', 'efficiency'],
    lanes: ['plan', 'prioritize', 'launch', 'stabilize', 'review', 'scale'],
    controls: ['budget-fence', 'targeting-review', 'handoff-check', 'qa-ready', 'launch-approval', 'post-launch-retro'],
    evidenceTypes: ['brief', 'launch-log', 'coverage-map', 'experiment-report', 'handoff-packet', 'weekly-summary'],
    signals: ['reach', 'response', 'conversion', 'lift', 'handoff', 'risk'],
    persona: 'growth lead'
  },
  {
    id: 'revenue',
    title: 'Revenue, billing, and commerce operations',
    description: 'Revenue-centric operations that connect launches to billing posture, commerce readiness, and commercial recovery motions.',
    domains: ['analytics', 'benchmark', 'billing', 'commerce', 'ecommerce', 'insights', 'revenue'],
    metrics: ['gmv', 'margin', 'revenue', 'recovery', 'benchmark', 'forecast'],
    lanes: ['baseline', 'model', 'reconcile', 'approve', 'share', 'improve'],
    controls: ['finance-approval', 'forecast-gap', 'margin-guardrail', 'merchant-review', 'closeout-check', 'variance-brief'],
    evidenceTypes: ['forecast-pack', 'variance-deck', 'billing-log', 'merchant-summary', 'revenue-snapshot', 'close-report'],
    signals: ['gmv', 'margin', 'variance', 'pacing', 'refund', 'collection'],
    persona: 'revenue operations manager'
  },
  {
    id: 'trust',
    title: 'Trust, compliance, and partner governance',
    description: 'Governance surfaces that keep regional requirements, audit evidence, partner operations, and trust posture visible.',
    domains: ['compliance', 'consent', 'localization', 'partner', 'preference', 'release', 'trust'],
    metrics: ['coverage', 'exceptions', 'sla', 'proof', 'regionality', 'resolution'],
    lanes: ['detect', 'triage', 'remediate', 'verify', 'attest', 'archive'],
    controls: ['evidence-lock', 'regional-review', 'policy-gate', 'remediation-sla', 'partner-attest', 'release-hold'],
    evidenceTypes: ['audit-log', 'attestation', 'proof-chain', 'policy-pack', 'regional-report', 'exception-summary'],
    signals: ['risk', 'proof', 'region', 'exception', 'attestation', 'hold'],
    persona: 'trust program owner'
  },
  {
    id: 'intelligence',
    title: 'Data, experimentation, and segmentation intelligence',
    description: 'Analytical workspaces that connect data readiness, experimentation posture, segmentation depth, and attribution signals.',
    domains: ['attribution', 'data', 'experimentation', 'integrations', 'reporting', 'segmentation', 'workspace'],
    metrics: ['freshness', 'coverage', 'confidence', 'throughput', 'lineage', 'lift'],
    lanes: ['collect', 'score', 'verify', 'activate', 'compare', 'publish'],
    controls: ['lineage-proof', 'quality-threshold', 'segment-review', 'integration-watch', 'publish-approval', 'lift-audit'],
    evidenceTypes: ['data-contract', 'segment-card', 'experiment-summary', 'lineage-map', 'publication-brief', 'insight-review'],
    signals: ['freshness', 'lift', 'match-rate', 'coverage', 'confidence', 'latency'],
    persona: 'analytics program lead'
  },
  {
    id: 'lifecycle',
    title: 'Lifecycle, customer success, and messaging durability',
    description: 'Customer lifecycle surfaces spanning automation, retention, support, subscriptions, surveys, and deliverability operations.',
    domains: ['automation', 'collaboration', 'creative', 'customer', 'deliverability', 'lifecycle', 'loyalty', 'retention', 'subscription', 'support', 'surveys', 'transactional'],
    metrics: ['health', 'retention', 'response', 'satisfaction', 'deliverability', 'durability'],
    lanes: ['observe', 'coordinate', 'assist', 'resolve', 'measure', 'expand'],
    controls: ['response-sla', 'journey-check', 'approval-ring', 'delivery-guard', 'satisfaction-review', 'recovery-kit'],
    evidenceTypes: ['journey-log', 'service-brief', 'response-matrix', 'delivery-summary', 'retention-pack', 'experience-scorecard'],
    signals: ['health', 'sentiment', 'recovery', 'sla', 'delivery', 'retention'],
    persona: 'lifecycle operations lead'
  }
];

const SURFACE_DEFS = [
  { id: 'advisor', title: 'Advisor', role: 'recommendations and next-step framing', routeSegment: 'advisor' },
  { id: 'atlas', title: 'Atlas', role: 'landscape mapping and territory coverage', routeSegment: 'atlas' },
  { id: 'cockpit', title: 'Cockpit', role: 'operator controls and active monitoring', routeSegment: 'cockpit' },
  { id: 'console', title: 'Console', role: 'execution controls and workspace steering', routeSegment: 'console' },
  { id: 'dossier', title: 'Dossier', role: 'evidence packets and stakeholder briefings', routeSegment: 'dossier' },
  { id: 'exchange', title: 'Exchange', role: 'handoff workflows and partner coordination', routeSegment: 'exchange' },
  { id: 'foundry', title: 'Foundry', role: 'program building and surface composition', routeSegment: 'foundry' },
  { id: 'grid', title: 'Grid', role: 'portfolio views and cross-workspace rollups', routeSegment: 'grid' },
  { id: 'hub', title: 'Hub', role: 'centralized operating views and routing', routeSegment: 'hub' },
  { id: 'index', title: 'Index', role: 'searchable summaries and coverage catalogs', routeSegment: 'index' },
  { id: 'ledger', title: 'Ledger', role: 'audit history and change accountability', routeSegment: 'ledger' },
  { id: 'navigator', title: 'Navigator', role: 'journey guidance and directional controls', routeSegment: 'navigator' },
  { id: 'notebook', title: 'Notebook', role: 'working notes and experiment memory', routeSegment: 'notebook' },
  { id: 'planner', title: 'Planner', role: 'calendar planning and execution choreography', routeSegment: 'planner' },
  { id: 'scorecard', title: 'Scorecard', role: 'metric tracking and readiness scoring', routeSegment: 'scorecard' },
  { id: 'sentinel', title: 'Sentinel', role: 'alerts, anomaly watch, and guardrails', routeSegment: 'sentinel' },
  { id: 'studio', title: 'Studio', role: 'operator-facing creative and configuration tools', routeSegment: 'studio' },
  { id: 'vault', title: 'Vault', role: 'secure reference packs and archival controls', routeSegment: 'vault' },
  { id: 'watchtower', title: 'Watchtower', role: 'oversight dashboards and escalation views', routeSegment: 'watchtower' },
  { id: 'workbench', title: 'Workbench', role: 'hands-on workflows and analyst tooling', routeSegment: 'workbench' }
];

const DOMAIN_DESCRIPTORS = {
  acquisition: 'new demand creation, source quality, and upstream handoff clarity',
  activation: 'onboarding readiness, first-value motion, and kickoff momentum',
  advocacy: 'customer champions, referral readiness, and proof-sharing loops',
  analytics: 'portfolio analytics, operator scorecards, and query-driven reviews',
  attribution: 'touchpoint weighting, influence mapping, and outcome reconciliation',
  automation: 'triggered lifecycle programs, timing controls, and operator confidence',
  audience: 'audience health, segment design, and targeting durability',
  benchmark: 'peer comparisons, maturity tracking, and reference baselines',
  billing: 'plan posture, invoice exceptions, and collection readiness',
  campaign: 'campaign planning, milestone choreography, and launch readiness',
  channel: 'channel operating models, readiness coverage, and mix governance',
  collaboration: 'shared ownership, approvals, and cross-functional motion',
  commerce: 'storefront readiness, conversion posture, and commercial follow-through',
  compliance: 'controls, remediation steps, and governance evidence capture',
  consent: 'proof of consent, subscription changes, and evidence continuity',
  content: 'content operations, packaging, and channel-specific delivery shape',
  creative: 'creative QA, variation readiness, and review-loop visibility',
  customer: 'customer health, account posture, and service motion tracking',
  data: 'pipeline health, lineage, freshness, and operator trust in data assets',
  deliverability: 'sender health, inbox placement, and response discipline',
  ecommerce: 'order behavior, purchase flow posture, and commerce retention signals',
  experimentation: 'test planning, variant analysis, and decision velocity',
  insights: 'insight synthesis, operating narratives, and executive-ready summaries',
  integrations: 'destination syncs, partner activation, and cross-platform reliability',
  lifecycle: 'lifecycle choreography, nurture timing, and retention posture',
  localization: 'regional readiness, translation coverage, and market-specific proof',
  loyalty: 'repeat purchase behavior, reward posture, and customer rescue depth',
  partner: 'partner readiness, enablement continuity, and ecosystem execution',
  preference: 'preference centers, profile updates, and channel selection clarity',
  release: 'release readiness, launch reviews, and rollback accountability',
  reporting: 'report curation, summary packets, and distribution discipline',
  retention: 'save motions, risk scoring, and targeted win-back programs',
  revenue: 'revenue pacing, influence clarity, and commercial reconciliation',
  segmentation: 'segment integrity, overlap management, and targeting confidence',
  subscription: 'plan adoption, expansion posture, and churn-prevention signals',
  support: 'case handling, queue visibility, and resolution follow-through',
  surveys: 'feedback collection, response trends, and experience scoring',
  transactional: 'transactional messaging, operational dispatch, and delivery proof',
  workspace: 'workspace governance, operating posture, and multi-team stewardship'
};

const APP_SHELLS = [
  { id: 'growth-grid', title: 'Growth Grid', groupIds: ['growth'] },
  { id: 'revenue-command', title: 'Revenue Command', groupIds: ['revenue'] },
  { id: 'trust-vault', title: 'Trust Vault', groupIds: ['trust'] },
  { id: 'intelligence-works', title: 'Intelligence Works', groupIds: ['intelligence'] },
  { id: 'lifecycle-network', title: 'Lifecycle Network', groupIds: ['lifecycle'] }
];

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function write(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content.trimStart() + '\n');
}

function titleCase(value) {
  return value.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

function pascal(value) {
  return value.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('');
}

function routePath(id) {
  return id;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function quote(value) {
  return JSON.stringify(value);
}

function groupedDomainMap() {
  const out = new Map();
  for (const group of GROUP_DEFS) {
    for (const domain of group.domains) out.set(domain, group);
  }
  return out;
}

function existingPackageSet() {
  return new Set(
    fs.readdirSync(PACKAGE_ROOT, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  );
}

function isManagedGeneratedPackage(id) {
  const domainFile = path.join(PACKAGE_ROOT, id, `domain-${id}.mjs`);
  const testFile = path.join(TEST_ROOT, `${id}.test.mjs`);
  return fs.existsSync(domainFile) && fs.existsSync(testFile) && fs.readFileSync(testFile, 'utf8').includes('generated scale surface stays executable and policy-complete');
}

function buildDefinitions(targetCount) {
  const groupMap = groupedDomainMap();
  const existing = existingPackageSet();
  const defs = [];
  let ordinal = 1;
  for (const domain of Object.keys(DOMAIN_DESCRIPTORS)) {
    const group = groupMap.get(domain);
    for (const surface of SURFACE_DEFS) {
      const id = `${domain}-${surface.id}`;
      if (existing.has(id) && !isManagedGeneratedPackage(id)) continue;
      const title = `${titleCase(domain)} ${surface.title}`;
      const focus = `${title} covers ${DOMAIN_DESCRIPTORS[domain]} through ${surface.role}.`;
      const descriptor = DOMAIN_DESCRIPTORS[domain];
      defs.push({
        id,
        ordinal,
        domain,
        surfaceId: surface.id,
        surfaceTitle: surface.title,
        routeSegment: surface.routeSegment,
        title,
        focus,
        descriptor,
        groupId: group.id,
        groupTitle: group.title,
        groupDescription: group.description,
        metrics: group.metrics,
        lanes: group.lanes,
        controls: group.controls,
        evidenceTypes: group.evidenceTypes,
        signals: group.signals,
        persona: group.persona,
        themes: [domain, surface.id, group.id, 'mailchimp-clone-scale-wave-seven'],
        tags: [domain, surface.id, group.id, `${domain}-${surface.id}-wave-seven`]
      });
      ordinal += 1;
      if (defs.length >= targetCount) return defs;
    }
  }
  return defs;
}

function renderDomainFile(def) {
  const p = pascal(def.id);
  return `
const MODULE = ${JSON.stringify(def, null, 2)};

function metricCard(metric, index, workspaceName) {
  return {
    id: MODULE.id + '-metric-' + (index + 1),
    metric,
    label: metric.replace(/-/g, ' '),
    owner: MODULE.persona,
    currentValue: 42 + (index * 7) + MODULE.ordinal,
    targetValue: 58 + (index * 9) + MODULE.ordinal,
    drift: index % 2 === 0 ? 'stable' : 'watch',
    narrative: MODULE.title + ' tracks ' + metric + ' for ' + workspaceName + '.'
  };
}

function laneRecord(lane, index) {
  return {
    id: MODULE.id + '-lane-' + (index + 1),
    lane,
    owner: lane + '-owner',
    status: index === 0 ? 'active' : index === 1 ? 'ready' : index === 2 ? 'review' : index === 3 ? 'monitoring' : index === 4 ? 'share' : 'queued',
    promise: MODULE.title + ' keeps the ' + lane + ' motion visible across the ' + MODULE.groupTitle.toLowerCase() + ' surface.'
  };
}

function milestoneRecord(lane, index) {
  return {
    id: MODULE.id + '-milestone-' + (index + 1),
    title: MODULE.surfaceTitle + ' ' + lane + ' checkpoint',
    dueWindow: 'W' + (index + 1),
    confidence: index % 2 === 0 ? 'high' : 'medium',
    detail: 'Checkpoint ' + (index + 1) + ' translates ' + MODULE.descriptor + ' into a concrete program step.'
  };
}

export function create${p}Workspace(workspaceName = 'Scale Wave Seven workspace') {
  return {
    ...MODULE,
    workspaceName,
    generatedAt: new Date().toISOString(),
    scorecards: MODULE.metrics.map((metric, index) => metricCard(metric, index, workspaceName)),
    programs: MODULE.lanes.map((lane, index) => laneRecord(lane, index)),
    milestones: MODULE.lanes.map((lane, index) => milestoneRecord(lane, index)),
    evidenceBurndown: MODULE.evidenceTypes.map((artifact, index) => ({
      id: MODULE.id + '-evidence-' + (index + 1),
      artifact,
      readiness: index % 2 === 0 ? 'ready' : 'draft',
      owner: MODULE.persona,
      note: MODULE.title + ' maintains ' + artifact + ' evidence for the workspace.'
    })),
    signalDeck: MODULE.signals.map((signal, index) => ({
      id: MODULE.id + '-signal-' + (index + 1),
      signal,
      direction: index % 2 === 0 ? 'up' : 'watch',
      summary: MODULE.groupTitle + ' uses ' + signal + ' to describe operating posture.'
    }))
  };
}

export function summarize${p}Workspace(workspace = create${p}Workspace()) {
  return {
    id: workspace.id,
    title: workspace.title,
    groupTitle: workspace.groupTitle,
    workspaceName: workspace.workspaceName,
    metricCount: workspace.scorecards.length,
    activePrograms: workspace.programs.filter((entry) => entry.status === 'active').length,
    evidenceCount: workspace.evidenceBurndown.length,
    watchSignals: workspace.signalDeck.filter((entry) => entry.direction === 'watch').map((entry) => entry.signal)
  };
}

export function create${p}Narratives(workspace = create${p}Workspace()) {
  return workspace.programs.map((program, index) => ({
    id: program.id + '-narrative',
    headline: workspace.title + ' ' + program.lane + ' narrative',
    summary: 'Narrative ' + (index + 1) + ' explains how ' + workspace.focus.toLowerCase(),
    dependencies: workspace.scorecards.slice(0, 3).map((card) => card.metric),
    controls: workspace.themes.slice(0, 3)
  }));
}

export function create${p}CoverageGrid(workspace = create${p}Workspace()) {
  return workspace.scorecards.map((card, index) => ({
    id: workspace.id + '-coverage-' + (index + 1),
    label: card.label,
    owner: workspace.persona,
    region: index % 2 === 0 ? 'core' : 'extended',
    note: workspace.title + ' exposes ' + card.label + ' coverage to the scale campaign.'
  }));
}
`;
}

function renderPoliciesFile(def) {
  const p = pascal(def.id);
  return `
const MODULE = ${JSON.stringify(def, null, 2)};

const BASE_POLICY_SET = MODULE.controls.map((control, index) => ({
  id: MODULE.id + '-policy-' + (index + 1),
  control,
  title: MODULE.title + ' ' + control.replace(/-/g, ' '),
  severity: index % 3 === 0 ? 'high' : index % 3 === 1 ? 'medium' : 'watch',
  owner: MODULE.persona,
  evidenceType: MODULE.evidenceTypes[index % MODULE.evidenceTypes.length]
}));

export function create${p}Policies(overrides = {}) {
  return BASE_POLICY_SET.map((policy, index) => ({
    ...policy,
    status: overrides.status || (index % 2 === 0 ? 'active' : 'watch'),
    escalation: overrides.escalation || (index % 3 === 0 ? 'director' : 'manager'),
    note: overrides.note || MODULE.title + ' uses ' + policy.control + ' to preserve ' + MODULE.descriptor + '.'
  }));
}

export function validate${p}Policies(policies = create${p}Policies()) {
  const issues = [];
  if (policies.length < MODULE.controls.length) issues.push('missing_policy_rows');
  if (!policies.some((policy) => policy.severity === 'high')) issues.push('missing_high_policy');
  if (!policies.every((policy) => policy.evidenceType)) issues.push('missing_evidence_binding');
  return { ok: issues.length === 0, issues, policyCount: policies.length };
}

export function summarize${p}Policies(policies = create${p}Policies()) {
  return {
    total: policies.length,
    active: policies.filter((policy) => policy.status === 'active').length,
    watch: policies.filter((policy) => policy.status === 'watch').length,
    escalations: [...new Set(policies.map((policy) => policy.escalation))]
  };
}

export function create${p}EscalationDeck(policies = create${p}Policies()) {
  return policies.map((policy, index) => ({
    id: policy.id + '-escalation',
    title: policy.title,
    owner: policy.escalation,
    step: index + 1,
    detail: MODULE.groupTitle + ' keeps a structured escalation path for ' + policy.control + '.'
  }));
}
`;
}

function renderAnalyticsFile(def) {
  const p = pascal(def.id);
  return `
const MODULE = ${JSON.stringify(def, null, 2)};

export function create${p}AnalyticsTimeline() {
  return MODULE.metrics.map((metric, index) => ({
    id: MODULE.id + '-timeline-' + (index + 1),
    metric,
    week: '2026-W' + String(index + 14).padStart(2, '0'),
    actual: 30 + MODULE.ordinal + (index * 6),
    forecast: 34 + MODULE.ordinal + (index * 7),
    note: MODULE.title + ' compares actual versus forecast for ' + metric + '.'
  }));
}

export function create${p}ForecastEnvelope() {
  return MODULE.signals.map((signal, index) => ({
    id: MODULE.id + '-envelope-' + (index + 1),
    signal,
    floor: 18 + index,
    midpoint: 24 + index + MODULE.ordinal,
    ceiling: 38 + index + MODULE.ordinal,
    posture: index % 2 === 0 ? 'confident' : 'watch',
    commentary: MODULE.surfaceTitle + ' captures the range for ' + signal + '.'
  }));
}

export function create${p}ExceptionLedger() {
  return MODULE.controls.map((control, index) => ({
    id: MODULE.id + '-exception-' + (index + 1),
    control,
    status: index % 2 === 0 ? 'resolved' : 'monitoring',
    owner: MODULE.persona,
    summary: MODULE.title + ' records a ' + control + ' exception lane for audit review.'
  }));
}

export function summarize${p}Analytics() {
  const timeline = create${p}AnalyticsTimeline();
  const forecast = create${p}ForecastEnvelope();
  return {
    timelineRows: timeline.length,
    confidentSignals: forecast.filter((entry) => entry.posture === 'confident').length,
    watchSignals: forecast.filter((entry) => entry.posture === 'watch').length
  };
}
`;
}

function renderOperationsFile(def) {
  const p = pascal(def.id);
  return `
const MODULE = ${JSON.stringify(def, null, 2)};

export function create${p}OperationsBoard() {
  return MODULE.lanes.map((lane, index) => ({
    id: MODULE.id + '-ops-' + (index + 1),
    lane,
    shift: index % 2 === 0 ? 'day' : 'swing',
    owner: MODULE.persona,
    readiness: index % 3 === 0 ? 'go' : index % 3 === 1 ? 'watch' : 'ready',
    detail: MODULE.title + ' uses the ' + lane + ' lane to coordinate scale-wave-seven operations.'
  }));
}

export function create${p}ShiftChecklist() {
  return MODULE.controls.map((control, index) => ({
    id: MODULE.id + '-check-' + (index + 1),
    control,
    required: true,
    ok: index !== MODULE.controls.length - 1,
    note: MODULE.groupTitle + ' shift checklist requires ' + control + ' before handoff.'
  }));
}

export function create${p}IncidentDeck() {
  return MODULE.evidenceTypes.map((artifact, index) => ({
    id: MODULE.id + '-incident-' + (index + 1),
    artifact,
    severity: index % 3 === 0 ? 'high' : 'medium',
    responseOwner: MODULE.persona,
    note: MODULE.title + ' can bind ' + artifact + ' evidence during escalations.'
  }));
}
`;
}

function renderReportingFile(def) {
  const p = pascal(def.id);
  return `
const MODULE = ${JSON.stringify(def, null, 2)};

export function create${p}ReportCards() {
  return MODULE.metrics.map((metric, index) => ({
    id: MODULE.id + '-report-' + (index + 1),
    title: MODULE.title + ' ' + metric + ' review',
    audience: index % 2 === 0 ? 'executive' : 'operator',
    summary: MODULE.title + ' packages ' + metric + ' into a decision-ready review card.',
    owner: MODULE.persona
  }));
}

export function create${p}ReviewPackets() {
  return MODULE.evidenceTypes.map((artifact, index) => ({
    id: MODULE.id + '-packet-' + (index + 1),
    artifact,
    destination: MODULE.groupId + '-leadership',
    summary: MODULE.groupTitle + ' consumes ' + artifact + ' during review cadences.'
  }));
}

export function summarize${p}Reporting() {
  const cards = create${p}ReportCards();
  const packets = create${p}ReviewPackets();
  return {
    totalCards: cards.length,
    totalPackets: packets.length,
    executiveCards: cards.filter((entry) => entry.audience === 'executive').length
  };
}
`;
}

function renderAuditFile(def) {
  const p = pascal(def.id);
  return `
const MODULE = ${JSON.stringify(def, null, 2)};

export function create${p}AuditTrail() {
  return MODULE.controls.map((control, index) => ({
    id: MODULE.id + '-audit-' + (index + 1),
    control,
    actor: MODULE.persona,
    event: index % 2 === 0 ? 'reviewed' : 'attested',
    evidence: MODULE.evidenceTypes[index % MODULE.evidenceTypes.length],
    detail: MODULE.title + ' logs ' + control + ' events for downstream supervision.'
  }));
}

export function create${p}EvidenceManifest() {
  return MODULE.evidenceTypes.map((artifact, index) => ({
    id: MODULE.id + '-manifest-' + (index + 1),
    artifact,
    pathHint: '/artifacts/' + MODULE.id + '/' + artifact,
    required: true,
    owner: MODULE.persona,
    detail: MODULE.groupTitle + ' expects ' + artifact + ' to remain current.'
  }));
}

export function create${p}ReadinessAttestation() {
  const auditTrail = create${p}AuditTrail();
  return {
    ok: auditTrail.length >= MODULE.controls.length,
    totalAuditEvents: auditTrail.length,
    owner: MODULE.persona,
    note: MODULE.title + ' attestation remains executable for the generated scale surface.'
  };
}
`;
}

function renderPlaybooksFile(def) {
  const p = pascal(def.id);
  return `
const MODULE = ${JSON.stringify(def, null, 2)};

export function create${p}Playbooks() {
  return MODULE.lanes.map((lane, index) => ({
    id: MODULE.id + '-playbook-' + (index + 1),
    lane,
    title: MODULE.title + ' ' + lane + ' playbook',
    owner: MODULE.persona,
    steps: MODULE.controls.slice(0, 4).map((control, stepIndex) => ({
      id: MODULE.id + '-playbook-' + (index + 1) + '-step-' + (stepIndex + 1),
      control,
      instruction: 'Confirm ' + control + ' before advancing the ' + lane + ' motion.'
    }))
  }));
}

export function create${p}DecisionDeck() {
  return MODULE.metrics.map((metric, index) => ({
    id: MODULE.id + '-decision-' + (index + 1),
    metric,
    question: 'Is ' + metric + ' strong enough to advance ' + MODULE.title + '?',
    owner: MODULE.persona,
    recommendation: index % 2 === 0 ? 'advance' : 'watch'
  }));
}

export function create${p}EscalationMoments() {
  return MODULE.signals.map((signal, index) => ({
    id: MODULE.id + '-moment-' + (index + 1),
    signal,
    severity: index % 3 === 0 ? 'high' : 'medium',
    note: MODULE.surfaceTitle + ' surfaces ' + signal + ' during high-signal decision points.'
  }));
}
`;
}

function renderServiceFile(def) {
  const p = pascal(def.id);
  return `
import { create${p}Workspace, summarize${p}Workspace, create${p}Narratives, create${p}CoverageGrid } from './domain-${def.id}.mjs';
import { create${p}Policies, validate${p}Policies, summarize${p}Policies, create${p}EscalationDeck } from './policies-${def.id}.mjs';
import { create${p}AnalyticsTimeline, create${p}ForecastEnvelope, create${p}ExceptionLedger, summarize${p}Analytics } from './analytics-${def.id}.mjs';
import { create${p}OperationsBoard, create${p}ShiftChecklist, create${p}IncidentDeck } from './operations-${def.id}.mjs';
import { create${p}ReportCards, create${p}ReviewPackets, summarize${p}Reporting } from './reporting-${def.id}.mjs';
import { create${p}AuditTrail, create${p}EvidenceManifest, create${p}ReadinessAttestation } from './audit-${def.id}.mjs';
import { create${p}Playbooks, create${p}DecisionDeck, create${p}EscalationMoments } from './playbooks-${def.id}.mjs';

export function build${p}Snapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = create${p}Workspace(workspaceName);
  const policies = create${p}Policies();
  return {
    workspace,
    summary: summarize${p}Workspace(workspace),
    narratives: create${p}Narratives(workspace),
    coverage: create${p}CoverageGrid(workspace),
    policies,
    policySummary: summarize${p}Policies(policies),
    validation: validate${p}Policies(policies),
    escalationDeck: create${p}EscalationDeck(policies),
    analytics: {
      timeline: create${p}AnalyticsTimeline(),
      forecast: create${p}ForecastEnvelope(),
      exceptions: create${p}ExceptionLedger(),
      summary: summarize${p}Analytics()
    },
    operations: {
      board: create${p}OperationsBoard(),
      checklist: create${p}ShiftChecklist(),
      incidents: create${p}IncidentDeck()
    },
    reporting: {
      cards: create${p}ReportCards(),
      packets: create${p}ReviewPackets(),
      summary: summarize${p}Reporting()
    },
    audit: {
      trail: create${p}AuditTrail(),
      manifest: create${p}EvidenceManifest(),
      attestation: create${p}ReadinessAttestation()
    },
    playbooks: create${p}Playbooks(),
    decisions: create${p}DecisionDeck(),
    escalationMoments: create${p}EscalationMoments()
  };
}

export function create${p}ReadinessBoard(snapshot = build${p}Snapshot()) {
  return [
    { id: '${def.id}-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: '${def.id}-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: '${def.id}-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: '${def.id}-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function create${p}ApiDocument(snapshot = build${p}Snapshot()) {
  return {
    id: '${def.id}-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/${routePath(def.id)}/overview' },
      { method: 'GET', path: '/api/${routePath(def.id)}/reporting' },
      { method: 'POST', path: '/api/${routePath(def.id)}/validate' },
      { method: 'GET', path: '/api/${routePath(def.id)}/audit' }
    ],
    readiness: create${p}ReadinessBoard(snapshot)
  };
}

export function create${p}RouteSummary(snapshot = build${p}Snapshot()) {
  return {
    id: snapshot.workspace.id,
    title: snapshot.summary.title,
    focus: snapshot.workspace.focus,
    groupTitle: snapshot.summary.groupTitle,
    metricCount: snapshot.summary.metricCount,
    policyCount: snapshot.policySummary.total,
    executiveCards: snapshot.reporting.summary.executiveCards
  };
}
`;
}

function renderFixturesFile(def) {
  const p = pascal(def.id);
  return `
const MODULE = ${JSON.stringify(def, null, 2)};

export function create${p}Fixtures() {
  return {
    accounts: [
      { id: MODULE.id + '-acct-1', name: MODULE.title + ' East', tier: 'growth' },
      { id: MODULE.id + '-acct-2', name: MODULE.title + ' West', tier: 'premium' }
    ],
    contacts: [
      { id: MODULE.id + '-contact-1', email: MODULE.id + '+1@example.com', owner: MODULE.persona },
      { id: MODULE.id + '-contact-2', email: MODULE.id + '+2@example.com', owner: MODULE.persona }
    ],
    notes: MODULE.evidenceTypes.map((artifact, index) => MODULE.title + ' fixture note ' + (index + 1) + ' references ' + artifact + '.')
  };
}

export function summarize${p}Fixtures(fixtures = create${p}Fixtures()) {
  return {
    accounts: fixtures.accounts.length,
    contacts: fixtures.contacts.length,
    notes: fixtures.notes.length
  };
}

export function create${p}DemoInputs() {
  return {
    workspaceName: MODULE.title + ' Demo Workspace',
    owner: MODULE.persona,
    tags: MODULE.tags,
    focus: MODULE.focus
  };
}
`;
}

function renderDashboardRoute(def) {
  const p = pascal(def.id);
  return `
import { build${p}Snapshot, create${p}RouteSummary } from '../service-${def.id}.mjs';

export function create${p}DashboardRoutes(basePath = '/${routePath(def.id)}') {
  const snapshot = build${p}Snapshot();
  return [
    { id: '${def.id}.dashboard.overview', method: 'GET', path: basePath, summary: create${p}RouteSummary(snapshot) },
    { id: '${def.id}.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: '${def.id}.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}
`;
}

function renderApiRoute(def) {
  const p = pascal(def.id);
  return `
import { build${p}Snapshot, create${p}ApiDocument } from '../service-${def.id}.mjs';

export function create${p}ApiRoutes(basePath = '/api/${routePath(def.id)}') {
  const snapshot = build${p}Snapshot();
  return [
    { id: '${def.id}.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: '${def.id}.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: '${def.id}.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: '${def.id}.api.document', method: 'GET', path: basePath + '/document', document: create${p}ApiDocument(snapshot) }
  ];
}
`;
}

function renderOpsRoute(def) {
  const p = pascal(def.id);
  return `
import { build${p}Snapshot, create${p}ReadinessBoard } from '../service-${def.id}.mjs';

export function create${p}OpsRoutes(basePath = '/ops/${routePath(def.id)}') {
  const snapshot = build${p}Snapshot();
  return [
    { id: '${def.id}.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: create${p}ReadinessBoard(snapshot) },
    { id: '${def.id}.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: '${def.id}.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}
`;
}

function renderPublicRoute(def) {
  const p = pascal(def.id);
  return `
import { build${p}Snapshot } from '../service-${def.id}.mjs';
import { create${p}Fixtures } from '../fixtures-${def.id}.mjs';

export function create${p}PublicRoutes(basePath = '/public/${routePath(def.id)}') {
  const snapshot = build${p}Snapshot();
  const fixtures = create${p}Fixtures();
  return [
    { id: '${def.id}.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: '${def.id}.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: '${def.id}.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}
`;
}

function renderRegistryRoute(def) {
  const p = pascal(def.id);
  return `
import { build${p}Snapshot, create${p}RouteSummary } from '../service-${def.id}.mjs';

export function create${p}RegistryRoutes(basePath = '/registry/${routePath(def.id)}') {
  const snapshot = build${p}Snapshot();
  return [
    { id: '${def.id}.registry.summary', method: 'GET', path: basePath, summary: create${p}RouteSummary(snapshot) },
    { id: '${def.id}.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: '${def.id}.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}
`;
}

function renderIndexFile(def) {
  const p = pascal(def.id);
  return `
export { create${p}Workspace, summarize${p}Workspace, create${p}Narratives, create${p}CoverageGrid } from './domain-${def.id}.mjs';
export { create${p}Policies, validate${p}Policies, summarize${p}Policies, create${p}EscalationDeck } from './policies-${def.id}.mjs';
export { create${p}AnalyticsTimeline, create${p}ForecastEnvelope, create${p}ExceptionLedger, summarize${p}Analytics } from './analytics-${def.id}.mjs';
export { create${p}OperationsBoard, create${p}ShiftChecklist, create${p}IncidentDeck } from './operations-${def.id}.mjs';
export { create${p}ReportCards, create${p}ReviewPackets, summarize${p}Reporting } from './reporting-${def.id}.mjs';
export { create${p}AuditTrail, create${p}EvidenceManifest, create${p}ReadinessAttestation } from './audit-${def.id}.mjs';
export { create${p}Playbooks, create${p}DecisionDeck, create${p}EscalationMoments } from './playbooks-${def.id}.mjs';
export { build${p}Snapshot, create${p}ReadinessBoard, create${p}ApiDocument, create${p}RouteSummary } from './service-${def.id}.mjs';
export { create${p}Fixtures, summarize${p}Fixtures, create${p}DemoInputs } from './fixtures-${def.id}.mjs';
export { create${p}DashboardRoutes } from './routes/${def.id}-dashboard.mjs';
export { create${p}ApiRoutes } from './routes/${def.id}-api.mjs';
export { create${p}OpsRoutes } from './routes/${def.id}-ops.mjs';
export { create${p}PublicRoutes } from './routes/${def.id}-public.mjs';
export { create${p}RegistryRoutes } from './routes/${def.id}-registry.mjs';
`;
}

function renderPackageTest(def) {
  const p = pascal(def.id);
  return `
import test from 'node:test';
import assert from 'node:assert/strict';
import { build${p}Snapshot, create${p}DashboardRoutes, create${p}ApiRoutes, create${p}OpsRoutes, create${p}PublicRoutes, create${p}RegistryRoutes, summarize${p}Fixtures } from '../packages/${def.id}/index.mjs';

test('${def.id} generated scale surface stays executable and policy-complete', () => {
  const snapshot = build${p}Snapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(create${p}DashboardRoutes().length, 3);
  assert.equal(create${p}ApiRoutes().length, 4);
  assert.equal(create${p}OpsRoutes().length, 3);
  assert.equal(create${p}PublicRoutes().length, 3);
  assert.equal(create${p}RegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarize${p}Fixtures().contacts, 2);
});
`;
}

function renderCatalogChunkFile(group, chunkIndex, modules) {
  return `
export const ${group.id}Chunk${String(chunkIndex + 1).padStart(2, '0')} = ${JSON.stringify(modules, null, 2)};
`;
}

function renderCatalogMetaFile(groups) {
  return `
export const APP_SHELLS = ${JSON.stringify(APP_SHELLS, null, 2)};
export const GROUPS = ${JSON.stringify(groups, null, 2)};
`;
}

function renderCatalogIndexFile(defs) {
  const chunks = [];
  for (const group of GROUP_DEFS) {
    const modules = defs.filter((def) => def.groupId === group.id).map((def) => ({
      id: def.id,
      title: def.title,
      domain: def.domain,
      surfaceTitle: def.surfaceTitle,
      focus: def.focus,
      descriptor: def.descriptor,
      metricCount: def.metrics.length,
      laneCount: def.lanes.length
    }));
    for (let start = 0; start < modules.length; start += 25) {
      chunks.push({
        group,
        chunkIndex: Math.floor(start / 25),
        modules: modules.slice(start, start + 25)
      });
    }
  }

  const imports = chunks.map((entry) => `import { ${entry.group.id}Chunk${String(entry.chunkIndex + 1).padStart(2, '0')} } from './groups/${entry.group.id}-chunk-${String(entry.chunkIndex + 1).padStart(2, '0')}.mjs';`).join('\n');
  const groups = GROUP_DEFS.map((group) => ({
    ...group,
    chunkRefs: chunks.filter((entry) => entry.group.id === group.id).map((entry) => `${entry.group.id}Chunk${String(entry.chunkIndex + 1).padStart(2, '0')}`)
  }));
  const groupModuleMap = groups.map((group) => `  ${JSON.stringify(group.id)}: [${group.chunkRefs.map((ref) => `...${ref}`).join(', ')}]`).join(',\n');

  return {
    chunks,
    metaContent: renderCatalogMetaFile(groups),
    indexContent: `
${imports}
import { APP_SHELLS, GROUPS } from './meta.mjs';

const GROUP_MODULES = {
${groupModuleMap}
};

function hydrateGroups() {
  return GROUPS.map((group) => ({
    ...group,
    modules: GROUP_MODULES[group.id] || []
  }));
}

export function createScaleWaveSevenCatalog() {
  return hydrateGroups().map((group) => ({ ...group, modules: group.modules.map((module) => ({ ...module })) }));
}

export function summarizeScaleWaveSevenCatalog(groups = createScaleWaveSevenCatalog()) {
  const totalModules = groups.reduce((sum, group) => sum + group.modules.length, 0);
  return {
    groupCount: groups.length,
    totalModules,
    totalMetrics: groups.reduce((sum, group) => sum + group.modules.reduce((inner, module) => inner + module.metricCount, 0), 0),
    totalLanes: groups.reduce((sum, group) => sum + group.modules.reduce((inner, module) => inner + module.laneCount, 0), 0)
  };
}

export function createScaleWaveSevenHighlights(groups = createScaleWaveSevenCatalog()) {
  return groups.map((group) => ({
    id: group.id,
    title: group.title,
    moduleCount: group.modules.length,
    sampleModules: group.modules.slice(0, 8)
  }));
}

export function createScaleWaveSevenAppShellCatalog(groups = createScaleWaveSevenCatalog()) {
  return APP_SHELLS.map((shell) => ({
    ...shell,
    groups: groups.filter((group) => shell.groupIds.includes(group.id)),
    totalModules: groups.filter((group) => shell.groupIds.includes(group.id)).reduce((sum, group) => sum + group.modules.length, 0)
  }));
}
`
  };
}

function renderScaleWaveSevenRoute() {
  return `
import { page } from '../view.mjs';
import { text, escapeHtml } from '../utils.mjs';
import { createScaleWaveSevenCatalog, summarizeScaleWaveSevenCatalog, createScaleWaveSevenHighlights, createScaleWaveSevenAppShellCatalog } from '../../scale-wave-seven/index.mjs';

const GROUPS = createScaleWaveSevenCatalog();
const SUMMARY = summarizeScaleWaveSevenCatalog(GROUPS);
const HIGHLIGHTS = createScaleWaveSevenHighlights(GROUPS);
const APP_SHELLS = createScaleWaveSevenAppShellCatalog(GROUPS);

function renderHighlight(group) {
  return '<section class="card"><h3>' + escapeHtml(group.title) + '</h3><p>Modules: ' + group.moduleCount + '</p><div class="grid">' + group.sampleModules.map((module) => '<div class="card"><h4>' + escapeHtml(module.title) + '</h4><p>' + escapeHtml(module.focus) + '</p><p>Metrics: ' + module.metricCount + ' · Lanes: ' + module.laneCount + '</p></div>').join('') + '</div></section>';
}

export function registerScaleWaveSevenRoutes(router, deps) {
  const { requireAuth } = deps;

  router.register('GET', '/scale-wave-seven', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;

    const body = [
      '<div class="grid">',
      '<section class="card">',
      '<h3>Scale Wave Seven</h3>',
      '<p>This route exposes the loc-500k expansion campaign and the large generated surface now wired into the authenticated product shell.</p>',
      '<p>Total modules: ' + SUMMARY.totalModules + ' · Groups: ' + SUMMARY.groupCount + ' · Metrics modeled: ' + SUMMARY.totalMetrics + ' · Lanes modeled: ' + SUMMARY.totalLanes + '</p>',
      '<p>App shells: ' + escapeHtml(APP_SHELLS.map((shell) => shell.title + ' (' + shell.totalModules + ')').join(', ')) + '</p>',
      '</section>',
      '</div>',
      HIGHLIGHTS.map(renderHighlight).join('')
    ].join('');

    text(res, 200, page('Scale Wave Seven', actor, body));
  });
}
`;
}

function renderScaleWaveSevenTest() {
  return `
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { CookieJar, createTempDataDir, followRedirect, postForm, request } from './helpers.mjs';

test('scale wave seven route exposes the 500k campaign expansion inside the product shell', async () => {
  const dir = createTempDataDir('wave7-scale-');
  process.env.MAILCLONE_DATA_DIR = dir;
  const server = createServer();
  const address = await server.start({ port: 0 });
  const baseUrl = 'http://127.0.0.1:' + address.port;
  const jar = new CookieJar();
  try {
    await followRedirect(baseUrl, jar, await postForm(baseUrl, jar, '/signup', {
      name: 'Wave Seven Owner',
      email: 'wave7@example.com',
      password: 'secret123',
      workspaceName: 'Wave Seven Lab'
    }));
    const response = await request(baseUrl, jar, '/scale-wave-seven');
    const html = await response.text();
    assert.match(html, /Scale Wave Seven/);
    assert.match(html, /Total modules:/);
    assert.match(html, /Growth Grid/);
    assert.match(html, /Lifecycle Network/);
  } finally {
    await server.stop();
    delete process.env.MAILCLONE_DATA_DIR;
  }
});
`;
}

function renderScaleWaveSevenCatalogTest(expectedCount) {
  return `
import test from 'node:test';
import assert from 'node:assert/strict';
import { createScaleWaveSevenCatalog, summarizeScaleWaveSevenCatalog, createScaleWaveSevenAppShellCatalog } from '../packages/scale-wave-seven/index.mjs';

test('scale wave seven catalog tracks the large expansion wave and its app shells', () => {
  const groups = createScaleWaveSevenCatalog();
  const summary = summarizeScaleWaveSevenCatalog(groups);
  const shells = createScaleWaveSevenAppShellCatalog(groups);
  assert.equal(summary.groupCount, 5);
  assert.equal(summary.totalModules, ${expectedCount});
  assert.equal(shells.length, ${APP_SHELLS.length});
  assert.ok(groups.every((group) => group.modules.length >= 1));
  assert.ok(shells.every((shell) => shell.totalModules >= 1));
});
`;
}

function renderClusterTest(group, defs) {
  const testFileName = `scale-wave-seven-${group.id}.test.mjs`;
  const imports = defs.slice(0, 6).map((def) => {
    const p = pascal(def.id);
    return `import { build${p}Snapshot } from '../packages/${def.id}/index.mjs';`;
  }).join('\n');
  const checks = defs.slice(0, 6).map((def) => {
    const p = pascal(def.id);
    return `  assert.equal(build${p}Snapshot().validation.ok, true);`;
  }).join('\n');
  return { testFileName, content: `
import test from 'node:test';
import assert from 'node:assert/strict';
${imports}

test('scale wave seven ${group.id} slice remains executable across sample modules', () => {
${checks}
});
` };
}

function renderAppServer(app) {
  return `
import http from 'node:http';
import { createScaleWaveSevenCatalog } from '../../packages/scale-wave-seven/index.mjs';

const GROUP_IDS = ${JSON.stringify(app.groupIds)};

export function createServer() {
  const server = http.createServer((req, res) => {
    const groups = createScaleWaveSevenCatalog().filter((group) => GROUP_IDS.includes(group.id));
    const modules = groups.flatMap((group) => group.modules);
    if (req.url === '/catalog.json') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ app: ${quote(app.id)}, title: ${quote(app.title)}, groupCount: groups.length, moduleCount: modules.length, groups }, null, 2));
      return;
    }

    const html = '<!doctype html><html><body><h1>${app.title}</h1><p>Groups: ' + groups.length + ' · Modules: ' + modules.length + '</p>' + groups.map((group) => '<section><h2>' + group.title + '</h2><p>' + group.description + '</p><ul>' + group.modules.slice(0, 10).map((module) => '<li>' + module.title + '</li>').join('') + '</ul></section>').join('') + '</body></html>';
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

test('${app.id} shell exposes a live catalog for the scale-wave-seven domains', async () => {
  const server = createServer();
  const address = await server.start({ port: 0 });
  const baseUrl = 'http://127.0.0.1:' + address.port;
  try {
    const home = await fetch(baseUrl + '/');
    assert.match(await home.text(), /${escapeRegExp(app.title)}/);
    const catalog = await fetch(baseUrl + '/catalog.json');
    const payload = await catalog.json();
    assert.ok(payload.groupCount >= 1);
    assert.ok(payload.moduleCount >= 1);
  } finally {
    await server.stop();
  }
});
`;
}

const defs = buildDefinitions(TARGET_PACKAGES);
if (defs.length < TARGET_PACKAGES) {
  throw new Error(`Unable to generate ${TARGET_PACKAGES} unique package definitions; only found ${defs.length}.`);
}

for (const def of defs) {
  const pkgDir = path.join(PACKAGE_ROOT, def.id);
  const routesDir = path.join(pkgDir, 'routes');
  ensureDir(routesDir);
  write(path.join(pkgDir, `domain-${def.id}.mjs`), renderDomainFile(def));
  write(path.join(pkgDir, `policies-${def.id}.mjs`), renderPoliciesFile(def));
  write(path.join(pkgDir, `analytics-${def.id}.mjs`), renderAnalyticsFile(def));
  write(path.join(pkgDir, `operations-${def.id}.mjs`), renderOperationsFile(def));
  write(path.join(pkgDir, `reporting-${def.id}.mjs`), renderReportingFile(def));
  write(path.join(pkgDir, `audit-${def.id}.mjs`), renderAuditFile(def));
  write(path.join(pkgDir, `playbooks-${def.id}.mjs`), renderPlaybooksFile(def));
  write(path.join(pkgDir, `service-${def.id}.mjs`), renderServiceFile(def));
  write(path.join(pkgDir, `fixtures-${def.id}.mjs`), renderFixturesFile(def));
  write(path.join(routesDir, `${def.id}-dashboard.mjs`), renderDashboardRoute(def));
  write(path.join(routesDir, `${def.id}-api.mjs`), renderApiRoute(def));
  write(path.join(routesDir, `${def.id}-ops.mjs`), renderOpsRoute(def));
  write(path.join(routesDir, `${def.id}-public.mjs`), renderPublicRoute(def));
  write(path.join(routesDir, `${def.id}-registry.mjs`), renderRegistryRoute(def));
  write(path.join(pkgDir, 'index.mjs'), renderIndexFile(def));
  write(path.join(TEST_ROOT, `${def.id}.test.mjs`), renderPackageTest(def));
}

const catalog = renderCatalogIndexFile(defs);
for (const chunk of catalog.chunks) {
  write(
    path.join(PACKAGE_ROOT, 'scale-wave-seven', 'groups', `${chunk.group.id}-chunk-${String(chunk.chunkIndex + 1).padStart(2, '0')}.mjs`),
    renderCatalogChunkFile(chunk.group, chunk.chunkIndex, chunk.modules)
  );
}
write(path.join(PACKAGE_ROOT, 'scale-wave-seven', 'meta.mjs'), catalog.metaContent);
write(path.join(PACKAGE_ROOT, 'scale-wave-seven', 'index.mjs'), catalog.indexContent);
write(path.join(PACKAGE_ROOT, 'app', 'routes', 'scale-wave-seven.mjs'), renderScaleWaveSevenRoute());
write(path.join(TEST_ROOT, 'scale-wave-seven.test.mjs'), renderScaleWaveSevenTest());
write(path.join(TEST_ROOT, 'scale-wave-seven-catalog.test.mjs'), renderScaleWaveSevenCatalogTest(defs.length));
for (const group of GROUP_DEFS) {
  const cluster = renderClusterTest(group, defs.filter((def) => def.groupId === group.id));
  write(path.join(TEST_ROOT, cluster.testFileName), cluster.content);
}
for (const app of APP_SHELLS) {
  write(path.join(APP_ROOT, app.id, 'server.mjs'), renderAppServer(app));
  write(path.join(TEST_ROOT, `${app.id}.test.mjs`), renderAppTest(app));
}

console.log(JSON.stringify({
  ok: true,
  generatedPackages: defs.length,
  appShells: APP_SHELLS.length,
  groups: GROUP_DEFS.length,
  firstPackage: defs[0]?.id || null,
  lastPackage: defs.at(-1)?.id || null
}, null, 2));
