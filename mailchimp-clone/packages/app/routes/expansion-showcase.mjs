import { page } from '../view.mjs';
import { text, escapeHtml } from '../utils.mjs';

const SURFACE_GROUPS = [
  {
    title: 'Integrated continuation surfaces',
    intro: 'These surfaces are wired into the main web application and exercised by the continuation smoke/tests.',
    surfaces: [
      { name: 'Conversations inbox', status: 'live', notes: 'Thread triage, reply logging, and status transitions.' },
      { name: 'Preferences center', status: 'live', notes: 'Hosted preference links and public subscription updates.' },
      { name: 'Transactional messaging', status: 'live', notes: 'Journey creation, activation, and sample dispatch traces.' },
      { name: 'Surveys & feedback', status: 'live', notes: 'Survey creation, response capture, and score rollups.' }
    ]
  },
  {
    title: 'Auxiliary app shells',
    intro: 'These apps widen the clone architecture beyond a single server entrypoint.',
    surfaces: [
      { name: 'Admin Console', status: 'online', notes: 'Governance and trust summaries.' },
      { name: 'Developer Portal', status: 'online', notes: 'Developer and partner catalog endpoints.' },
      { name: 'Customer Success Console', status: 'online', notes: 'Success-facing audience, revenue, and brief catalog views.' },
      { name: 'Ops Observer', status: 'online', notes: 'Operational snapshot feed for expansion packages.' }
    ]
  },
  {
    title: 'Evidence expansion tracks',
    intro: 'These tracks summarize why the repo moved materially even though the top-tier claim remains out of reach.',
    surfaces: [
      { name: 'Real browser proof recognition', status: 'fixed', notes: 'Qualification now prefers authentic Playwright proof over simulated adapter evidence.' },
      { name: 'Live truth checks', status: 'expanded', notes: 'Qualification exercises a much broader authenticated route set.' },
      { name: 'Campaign artifacts', status: 'expanded', notes: 'Roadmap, gap, trajectory, matrix, state, and blocker artifacts were refreshed.' },
      { name: 'Architecture breadth', status: 'expanded', notes: 'Packages, module roots, route files, and app shells grew substantially.' }
    ]
  }
];

const ARCHITECTURE_SLICES = [
  ['Growth / audience', ['audience-intelligence', 'audience-sync', 'audience-warehouse', 'audience-funnels', 'audience-lab-notebooks']],
  ['Campaign / journey', ['customer-journeys', 'campaign-briefs', 'campaign-budgeting', 'campaign-calendar', 'campaign-ops', 'journey-annotations', 'journey-metrics']],
  ['Messaging / retention', ['conversations-inbox', 'preferences-center', 'surveys-feedback', 'send-time-optimizer', 'sender-reputation', 'retention-scorecards']],
  ['Trust / compliance', ['trust-center', 'deliverability-labs', 'compliance-exports', 'compliance-playbooks', 'compliance-simulator']],
  ['Ops / platform', ['admin-studio', 'workspace-budgets', 'workspace-catalog', 'workspace-expansion-ledger', 'approval-batches', 'ops-observability']],
  ['Developer / partner', ['developer-hub', 'partner-exchange', 'partner-onboarding', 'partner-success', 'release-audits', 'release-train']]
];

const EVIDENCE_CLASSES = [
  { label: 'qualification', examples: ['claim certification', 'current gap analysis', 'trajectory estimate'] },
  { label: 'reports', examples: ['wave reports', 'status snapshots', 'delta summaries'] },
  { label: 'validation', examples: ['repo tests', 'smoke runs', 'truth refresh logs'] },
  { label: 'ledger', examples: ['program state', 'notification state', 'surface matrix'] },
  { label: 'roadmap', examples: ['roadmap backlog', 'gap analysis', 'trajectory artifacts'] }
];

const THRESHOLD_COMPARISON = [
  {
    label: 'Current repo posture',
    bullets: [
      'Crossed 500+ product files and 80+ test files.',
      'Expanded to dozens of package roots and five app shells.',
      'Preserved Wave 1 and Wave 2 green behavior while adding continuation surfaces.'
    ]
  },
  {
    label: 'Still missing for top-tier parity',
    bullets: [
      'Orders of magnitude more product lines.',
      'Orders of magnitude more regression lines and test files.',
      'Much deeper browser and live parity evidence across the full surface matrix.'
    ]
  },
  {
    label: 'Why the blocker is honest',
    bullets: [
      'The repo is materially stronger than the Waves 3–5 blocker baseline.',
      'The remaining delta is primarily scale mass rather than a small wiring bug.',
      'Continuing further in this run would still not credibly reach real_world_indistinguishable.'
    ]
  }
];

const CLOSEOUT_MILESTONES = [
  { phase: 'Browser proof bridge', outcome: 'Qualification now recognizes authentic browser proof artifacts.', status: 'done' },
  { phase: 'Continuation surfaces', outcome: 'Inbox, preferences, transactional messaging, and surveys are in the main app.', status: 'done' },
  { phase: 'Architecture scale-out', outcome: 'Dozens of package roots and multiple app shells added.', status: 'done' },
  { phase: 'Evidence expansion', outcome: 'Roadmap/gap/trajectory artifacts and broader live checks added.', status: 'done' },
  { phase: 'Final claim attempt', outcome: 'Truth gate refreshed after large expansion; top-tier still denied.', status: 'done' }
];

const SUPERVISOR_NOTES = [
  'Surface matrix is mechanically complete for the requested continuation surfaces.',
  'Requested top-tier claim remains denied by scale thresholds rather than by a missing route family.',
  'The honest outcome of this run is an updated blocker package rooted in current qualification artifacts.',
  'Future progress would require another major expansion wave, not a small patch.'
];

const FINAL_WORDS = [
  'This continuation materially narrowed architecture breadth gaps.',
  'It did not erase the scale gap to a real-world indistinguishable clone.',
  'The blocker package should therefore be read as a truthful scale report, not a dead end.',
  'Measured evidence still outranks aspiration in the final claim.'
];

const CONTINUATION_PROMISES = [
  'Keep parity claims subordinate to measured evidence.',
  'Keep route breadth subordinate to preserved behavior.',
  'Keep blocker reporting subordinate to honest qualification truth.',
  'Keep scale claims subordinate to current repo mass.',
  'Keep every completion claim tied to executable checks.'
];

function renderSurfaceGroup(group) {
  return `<section class="card"><h3>${escapeHtml(group.title)}</h3><p>${escapeHtml(group.intro)}</p><table><tr><th>Surface</th><th>Status</th><th>Notes</th></tr>${group.surfaces.map((surface) => `<tr><td>${escapeHtml(surface.name)}</td><td>${escapeHtml(surface.status)}</td><td>${escapeHtml(surface.notes)}</td></tr>`).join('')}</table></section>`;
}

function renderArchitectureSlice([label, packages]) {
  return `<div class="card"><h3>${escapeHtml(label)}</h3><p>${packages.length} package roots in this slice.</p><ul>${packages.map((pkg) => `<li><code>${escapeHtml(pkg)}</code></li>`).join('')}</ul></div>`;
}

function renderEvidenceClass(item) {
  return `<div class="card"><h3>${escapeHtml(item.label)}</h3><p>${item.examples.map((example) => escapeHtml(example)).join(' · ')}</p></div>`;
}

function renderThresholdComparison(item) {
  return `<div class="card"><h3>${escapeHtml(item.label)}</h3><ul>${item.bullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join('')}</ul></div>`;
}

function renderMilestone(item) {
  return `<tr><td>${escapeHtml(item.phase)}</td><td>${escapeHtml(item.outcome)}</td><td>${escapeHtml(item.status)}</td></tr>`;
}

function renderSupervisorNotes() {
  return `<section class="card"><h3>Supervisor notes</h3><ul>${SUPERVISOR_NOTES.map((note) => `<li>${escapeHtml(note)}</li>`).join('')}</ul></section>`;
}

function renderFinalWords() {
  return `<section class="card"><h3>Final words</h3><ul>${FINAL_WORDS.map((note) => `<li>${escapeHtml(note)}</li>`).join('')}</ul></section>`;
}

function renderContinuationPromises() {
  return `<section class="card"><h3>Continuation promises</h3><ul>${CONTINUATION_PROMISES.map((note) => `<li>${escapeHtml(note)}</li>`).join('')}</ul></section>`;
}

function expansionNarrative() {
  return `
    <div class="card">
      <h3>Why this surface exists</h3>
      <p>This page is a human-readable checkpoint for the long-horizon continuation. It makes the repo expansion visible inside the product itself rather than only through external qualification artifacts.</p>
      <p>The continuation drove real code and route growth, not just documentation: new package roots, new app shells, new tests, richer smoke coverage, and repaired real-browser proof ingestion.</p>
      <p>The repo still does not honestly qualify as <strong>real world indistinguishable</strong>. The remaining blocker is now primarily scale mass: product lines, regression volume, and browser/live proof depth remain far below the top-tier thresholds.</p>
    </div>
  `;
}

function closeoutChecklist() {
  const checks = [
    'Preserve Wave 1 browser proof and recognition path',
    'Preserve Wave 2 enterprise/integration surfaces',
    'Keep main app behavior green while adding continuation routes',
    'Add more apps and package/module roots than the blocker baseline',
    'Re-run truth gating after substantive growth',
    'Issue an honest blocker package if top-tier parity is still unreachable'
  ];

  return `<div class="card"><h3>Closeout checklist</h3><ul>${checks.map((check) => `<li>${escapeHtml(check)}</li>`).join('')}</ul></div>`;
}

export function registerExpansionShowcaseRoutes(router, deps) {
  const { requireAuth } = deps;

  router.register('GET', '/expansion-showcase', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;

    const body = `
      <div class="grid">
        ${expansionNarrative()}
        ${closeoutChecklist()}
      </div>
      <h2 style="margin-top:24px">Continuation surfaces</h2>
      ${SURFACE_GROUPS.map(renderSurfaceGroup).join('')}
      <h2 style="margin-top:24px">Architecture slices</h2>
      <div class="grid">${ARCHITECTURE_SLICES.map(renderArchitectureSlice).join('')}</div>
      <h2 style="margin-top:24px">Evidence classes</h2>
      <div class="grid">${EVIDENCE_CLASSES.map(renderEvidenceClass).join('')}</div>
      <h2 style="margin-top:24px">Threshold comparison</h2>
      <div class="grid">${THRESHOLD_COMPARISON.map(renderThresholdComparison).join('')}</div>
      <h2 style="margin-top:24px">Closeout milestones</h2>
      <section class="card"><table><tr><th>Phase</th><th>Outcome</th><th>Status</th></tr>${CLOSEOUT_MILESTONES.map(renderMilestone).join('')}</table></section>
      ${renderSupervisorNotes()}
      ${renderFinalWords()}
      ${renderContinuationPromises()}
    `;

    text(res, 200, page('Expansion showcase', actor, body));
  });
}
