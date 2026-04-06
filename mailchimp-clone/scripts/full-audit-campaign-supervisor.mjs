import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'full_audit_campaign');
const CONTRACT_PATH = path.join(ROOT, 'strict_1to1_contract.json');
const MATRIX_PATH = path.join(ARTIFACT_DIR, 'surface_matrix.json');
const PROGRAM_STATE_PATH = path.join(ARTIFACT_DIR, 'program_state.json');
const WORKER_STATE_PATH = path.join(ARTIFACT_DIR, 'worker_state.json');
const SUMMARY_PATH = path.join(ARTIFACT_DIR, 'completion_summary.json');
const NOTIFY_PATH = path.join(ARTIFACT_DIR, 'notification_state.json');
const BLOCKER_PATH = path.join(ARTIFACT_DIR, 'blocker_report.json');
const REPORTS_DIR = path.join(ARTIFACT_DIR, 'reports');
const STATUS_REPORT_PATH = path.join(REPORTS_DIR, 'supervisor_status.json');
const TRANSPORT_STATUS_PATH = path.join(ARTIFACT_DIR, 'cortex_transport', 'transport_status.json');
const DELEGATE_STATUS_PATH = path.join(REPORTS_DIR, '100_agent_worker_status.json');
const DELEGATE_ARTIFACT_ROOT = path.join(ROOT, 'artifacts', 'qualification', 'orchestrator_real_repo_clean_baseline');
const DELEGATE_COMPLETION_PATH = path.join(DELEGATE_ARTIFACT_ROOT, 'completion_summary.json');
const DELEGATE_PROGRAM_STATE_PATH = path.join(DELEGATE_ARTIFACT_ROOT, 'program_state.json');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readText(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function walkFiles(dir, visit) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(fullPath, visit);
    else if (entry.isFile()) visit(fullPath);
  }
}

function countClientFiles(rootDir) {
  const exts = new Set(['.tsx', '.ts', '.jsx', '.vue', '.svelte', '.css', '.scss']);
  let count = 0;
  walkFiles(rootDir, (filePath) => {
    if (exts.has(path.extname(filePath))) count += 1;
  });
  return count;
}

function countOccurrences(rootDir, needle) {
  let count = 0;
  walkFiles(rootDir, (filePath) => {
    const text = readText(filePath);
    if (!text) return;
    const matches = text.match(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'));
    count += matches ? matches.length : 0;
  });
  return count;
}

function statusFor(check) {
  return check ? 'complete' : 'red';
}

function partialOrRed(primary, secondary = false) {
  if (primary) return 'complete';
  if (secondary) return 'partial';
  return 'red';
}

function buildSurface(id, label, status, evidence, gaps) {
  return {
    id,
    label,
    requiredForGreen: true,
    status,
    evidence: evidence.filter(Boolean),
    gaps: gaps.filter(Boolean)
  };
}

ensureDir(ARTIFACT_DIR);
ensureDir(REPORTS_DIR);

const contract = readJson(CONTRACT_PATH, {});
const blocker = readJson(BLOCKER_PATH, null);
const transportStatus = readJson(TRANSPORT_STATUS_PATH, null);
const delegateStatus = readJson(DELEGATE_STATUS_PATH, null);
const delegateCompletion = readJson(DELEGATE_COMPLETION_PATH, null);
const delegateProgramState = readJson(DELEGATE_PROGRAM_STATE_PATH, null);
const delegateSupervisorStatus = delegateProgramState?.supervisorStatus || delegateProgramState?.supervisor?.status || delegateProgramState?.campaignState?.supervisor?.status || null;
const delegateGreen = Boolean(delegateCompletion?.supervisorConfirmedCompletion && delegateSupervisorStatus === 'green');
const viewText = readText(path.join(ROOT, 'packages', 'app', 'view.mjs'));
const publicRoutesText = readText(path.join(ROOT, 'packages', 'app', 'routes', 'public.mjs'));
const storageText = readText(path.join(ROOT, 'packages', 'app', 'storage.mjs'));
const jobsText = readText(path.join(ROOT, 'packages', 'app', 'jobs.mjs'));
const campaignsText = readText(path.join(ROOT, 'packages', 'app', 'domain-campaigns.mjs'));
const formsText = readText(path.join(ROOT, 'packages', 'app', 'routes', 'forms.mjs'));
const growthText = readText(path.join(ROOT, 'packages', 'app', 'domain-growth.mjs'));
const currentOpsText = readText(path.join(ROOT, 'packages', 'app', 'domain-current-product-ops.mjs'));
const integrationText = readText(path.join(ROOT, 'packages', 'app', 'domain-integration-marketplace.mjs'));
const websiteText = readText(path.join(ROOT, 'packages', 'app', 'domain-website-builder.mjs'));
const securityText = readText(path.join(ROOT, 'packages', 'app', 'security.mjs'));
const serverText = readText(path.join(ROOT, 'apps', 'web', 'server.mjs'));

const clientFileCount = countClientFiles(ROOT);
const saveDbHits = countOccurrences(path.join(ROOT, 'packages'), 'saveDb(state.db)');
const fetchHits = countOccurrences(path.join(ROOT, 'packages'), 'fetch(');

const surfaces = [];

surfaces.push(buildSurface(
  'A_public_brand_marketing_parity',
  'A. Public brand + marketing parity',
  statusFor(!viewText.includes('Anchor Mailer') && !publicRoutesText.includes('Program 1–3')),
  [
    viewText.includes('Anchor Mailer') ? 'packages/app/view.mjs still brands user-visible surfaces as Anchor Mailer.' : 'Anchor Mailer branding removed from user-visible surfaces.',
    publicRoutesText.includes('Program 1–3') ? 'packages/app/routes/public.mjs still serves an internal-summary style homepage.' : 'Public homepage no longer exposes the prior internal-summary placeholder.'
  ],
  [
    viewText.includes('Anchor Mailer') ? 'Remove or isolate Anchor Mailer branding from the Mailchimp clone surfaces.' : null,
    publicRoutesText.includes('Program 1–3') ? 'Replace the placeholder public homepage with Mailchimp-like marketing/pricing/help entry surfaces.' : null
  ]
));

surfaces.push(buildSurface(
  'B_frontend_architecture_parity',
  'B. Frontend architecture parity',
  statusFor(clientFileCount > 0),
  [
    `Client-surface file count: ${clientFileCount}.`,
    viewText.includes('<!doctype html>') ? 'packages/app/view.mjs still assembles the UI as server-rendered HTML with inline CSS.' : null
  ],
  [
    clientFileCount === 0 ? 'Introduce a real client application shell for interactive builders/editors.' : null,
    viewText.includes('<!doctype html>') ? 'Replace form-post editing with richer client interaction where Mailchimp depends on it.' : null
  ]
));

surfaces.push(buildSurface(
  'C_data_model_and_persistence_parity',
  'C. Data model + persistence parity',
  statusFor(!storageText.includes("app.json") && saveDbHits === 0),
  [
    storageText.includes("app.json") ? 'packages/app/storage.mjs still points primary persistence at data/app.json.' : 'Primary persistence no longer points at data/app.json.',
    `saveDb(state.db) call sites under packages/: ${saveDbHits}.`
  ],
  [
    storageText.includes("app.json") ? 'Move core state off the monolithic JSON file backend.' : null,
    saveDbHits > 0 ? 'Eliminate remaining saveDb(state.db) rewrite paths from critical product flows.' : null
  ]
));

surfaces.push(buildSurface(
  'D_delivery_jobs_operational_workflow_parity',
  'D. Delivery + jobs + operational workflow parity',
  statusFor(!serverText.includes('setInterval(() => runJobs(state), 100)') && !jobsText.includes("if (job.type === 'deliver_campaign')")),
  [
    serverText.includes('setInterval(() => runJobs(state), 100)') ? 'apps/web/server.mjs still runs jobs in-process on a setInterval loop.' : 'In-process interval-driven job execution removed from web process.',
    jobsText.includes("if (job.type === 'deliver_campaign')") ? 'packages/app/jobs.mjs still handles delivery inside the app runtime.' : 'Delivery no longer handled solely by in-process app jobs.'
  ],
  [
    serverText.includes('setInterval(() => runJobs(state), 100)') ? 'Separate worker execution from the web process.' : null,
    jobsText.includes("if (job.type === 'deliver_campaign')") ? 'Replace local delivery simulation with a real queue/provider flow.' : null
  ]
));

surfaces.push(buildSurface(
  'E_reporting_analytics_parity',
  'E. Reporting + analytics parity',
  statusFor(!campaignsText.includes('Math.floor(recipientTotal * 0.6)') && !websiteText.includes('website.analytics.views += 1')),
  [
    campaignsText.includes('Math.floor(recipientTotal * 0.6)') ? 'Campaign opens/clicks are still synthesized from recipient counts in domain-campaigns.mjs.' : 'Campaign metrics are no longer synthesized from simple formulas.',
    websiteText.includes('website.analytics.views += 1') ? 'Website analytics are still local counters in domain-website-builder.mjs.' : 'Website analytics are no longer local-only counters.'
  ],
  [
    campaignsText.includes('Math.floor(recipientTotal * 0.6)') ? 'Replace synthetic campaign metrics with event-backed measurement.' : null,
    websiteText.includes('website.analytics.views += 1') ? 'Replace local website counters with a more realistic analytics/event model.' : null
  ]
));

surfaces.push(buildSurface(
  'F_ai_predictive_optimization_parity',
  'F. AI / predictive / optimization parity',
  statusFor(!currentOpsText.includes('function buildSubjectVariants') && !currentOpsText.includes('predictiveScoreForContact')),
  [
    currentOpsText.includes('function buildSubjectVariants') ? 'AI assist is still generated from local helper functions in domain-current-product-ops.mjs.' : 'Local heuristic AI helpers removed from the primary product path.',
    currentOpsText.includes('predictiveScoreForContact') ? 'Predictive scoring is still deterministic local logic in domain-current-product-ops.mjs.' : 'Predictive scoring no longer uses the old deterministic helper path.'
  ],
  [
    currentOpsText.includes('function buildSubjectVariants') ? 'Replace heuristic content generation with a provider-backed or model-backed abstraction.' : null,
    currentOpsText.includes('predictiveScoreForContact') ? 'Replace local deterministic predictive scoring with a more realistic predictive system.' : null
  ]
));

surfaces.push(buildSurface(
  'G_integrations_api_oauth_parity',
  'G. Integrations + API + OAuth parity',
  statusFor(fetchHits > 0 && !integrationText.includes("syncedContacts: app.category === 'crm' ? 12 : 0")),
  [
    `fetch() occurrences under packages/: ${fetchHits}.`,
    integrationText.includes("syncedContacts: app.category === 'crm' ? 12 : 0") ? 'Integration sync totals are still fabricated in domain-integration-marketplace.mjs.' : 'Hard-coded integration sync totals removed from domain-integration-marketplace.mjs.'
  ],
  [
    fetchHits === 0 ? 'Add real provider/network interaction paths in the primary app runtime for supported integrations.' : null,
    integrationText.includes("syncedContacts: app.category === 'crm' ? 12 : 0") ? 'Replace synthetic integration sync results with real connector behavior.' : null
  ]
));

surfaces.push(buildSurface(
  'H_website_builder_parity',
  'H. Website builder parity',
  statusFor(clientFileCount > 0 && websiteText.includes('undo') && websiteText.includes('section')),
  [
    websiteText.includes('sectionStyle') ? 'Website builder currently stores pages/themes/sections as server-side records.' : null,
    clientFileCount === 0 ? 'No rich client editing layer exists for website builder interactions.' : `Client-surface file count available for richer website builder UX: ${clientFileCount}.`
  ],
  [
    clientFileCount === 0 ? 'Add a real visual/on-canvas website editing experience.' : null,
    !websiteText.includes('undo') ? 'Add undo/redo or equivalent revision interaction parity for website editing.' : null
  ]
));

surfaces.push(buildSurface(
  'I_forms_popup_forms_landing_pages_parity',
  'I. Forms / popup forms / landing pages parity',
  statusFor(formsText.includes('popup') && growthText.includes('geotarget') && growthText.includes('trigger')),
  [
    formsText.includes('/f/:slug') ? 'Hosted forms and landing pages exist and are executable.' : null,
    !formsText.includes('popup') ? 'No popup-form specific builder/editor flow is present in packages/app/routes/forms.mjs.' : 'Popup form flow detected in route layer.',
    !growthText.includes('geotarget') ? 'No geotargeting behavior detected in domain-growth.mjs.' : 'Geotargeting behavior detected in growth domain.'
  ],
  [
    !formsText.includes('popup') ? 'Implement popup-form specific product depth beyond hosted forms.' : null,
    !growthText.includes('geotarget') ? 'Implement geotargeting / advanced popup targeting behavior.' : null,
    !growthText.includes('trigger') ? 'Implement popup trigger rules such as time-on-page / inactivity / exit intent.' : null
  ]
));

surfaces.push(buildSurface(
  'J_campaign_experimentation_parity',
  'J. Campaign experimentation parity',
  statusFor(!currentOpsText.includes('variant.subject.length % 9') && !currentOpsText.includes('variant.bodyPreview.length % 11')),
  [
    currentOpsText.includes('variant.subject.length % 9') ? 'Experiment winners are still computed from deterministic string-length formulas.' : 'Experiment winner logic no longer depends on string-length formulas.'
  ],
  [
    currentOpsText.includes('variant.subject.length % 9') ? 'Replace formula-driven winner logic with event/metric-driven experimentation results.' : null
  ]
));

surfaces.push(buildSurface(
  'K_automation_journey_parity',
  'K. Automation / journey parity',
  partialOrRed(growthText.includes('wait_scheduled') && !growthText.includes("status: 'completed'"), growthText.includes('triggerAutomationsForEvent')),
  [
    growthText.includes('triggerAutomationsForEvent') ? 'Automation enrollment and trigger plumbing exist in domain-growth.mjs.' : null,
    growthText.includes("status: 'completed'") ? 'Runs still collapse immediately to completed lifecycle objects in the current implementation.' : 'Runs are no longer forced into immediate completed lifecycle objects.'
  ],
  [
    growthText.includes("status: 'completed'") ? 'Deepen the journey engine beyond immediate local lifecycle completion.' : null
  ]
));

surfaces.push(buildSurface(
  'L_audience_crm_segmentation_parity',
  'L. Audience / CRM / segmentation parity',
  partialOrRed(!currentOpsText.includes('predictiveScoreForContact') && growthText.includes('contactActivity') && !growthText.includes("status: 'subscribed'"), growthText.includes('contactActivity')),
  [
    growthText.includes('contactActivity') ? 'Audience/contact activity tracking exists.' : null,
    currentOpsText.includes('predictiveScoreForContact') ? 'Predictive segmentation behavior is still simplified local logic.' : 'Simplified predictive segmentation helper no longer detected.'
  ],
  [
    currentOpsText.includes('predictiveScoreForContact') ? 'Deepen predictive and CRM behavior beyond local heuristics.' : null
  ]
));

surfaces.push(buildSurface(
  'M_security_account_enterprise_parity',
  'M. Security / account / enterprise parity',
  partialOrRed(securityText.includes('mfa') || securityText.includes('sso') || securityText.includes('saml'), securityText.includes('SameSite=Lax') && securityText.includes('content-security-policy')),
  [
    securityText.includes('SameSite=Lax') ? 'Basic cookie and header hardening exists in packages/app/security.mjs.' : null,
    !securityText.includes('mfa') ? 'No MFA flow detected in packages/app/security.mjs.' : 'MFA-related security flow detected.',
    !securityText.includes('sso') && !securityText.includes('saml') ? 'No SSO/SAML enterprise auth flow detected in packages/app/security.mjs.' : 'Enterprise auth flow detected.'
  ],
  [
    !securityText.includes('mfa') ? 'Add stronger account security parity such as MFA-equivalent flows.' : null,
    !securityText.includes('sso') && !securityText.includes('saml') ? 'Add enterprise auth/session parity where required.' : null
  ]
));

surfaces.push(buildSurface(
  'N_ops_deployment_scale_parity',
  'N. Ops / deployment / scale parity',
  statusFor(!serverText.includes('http.createServer') && !storageText.includes('fs.writeFileSync') && !serverText.includes('server.start =')),
  [
    serverText.includes('http.createServer') ? 'apps/web/server.mjs still exposes a single-process node:http server runtime.' : 'Single-process node:http server runtime removed.',
    storageText.includes('fs.writeFileSync') ? 'Synchronous file writes still appear in the primary storage layer.' : 'Primary storage layer no longer uses sync file writes.'
  ],
  [
    serverText.includes('http.createServer') ? 'Move toward a more realistic deployment/runtime model than the current single-process server.' : null,
    storageText.includes('fs.writeFileSync') ? 'Remove sync file-write reliance from primary operational paths.' : null
  ]
));

const prior = surfaces.every((surface) => surface.status === 'complete');
surfaces.push(buildSurface(
  'O_final_parity_proof_gate',
  'O. Final parity proof gate',
  prior ? 'complete' : 'red',
  [
    prior ? 'All required surfaces are supervisor-complete.' : 'At least one required surface remains incomplete, so full-clone proof is not yet valid.'
  ],
  prior ? [] : ['Do not claim full_clone until every required surface above is complete with executable evidence.']
));

if (delegateGreen) {
  for (const surface of surfaces) {
    surface.evidence = [
      ...surface.evidence,
      `Delegated cleaned-baseline qualification completed green at tier ${delegateCompletion?.provenCoordinationScaleTier || 'unknown'}, but this only counts as supporting execution evidence and does not override unresolved parity gaps.`
    ];
  }
}

const allComplete = surfaces.every((surface) => surface.status === 'complete');
const summary = {
  generatedAt: new Date().toISOString(),
  fidelity: contract.requestedFidelity || 'full_clone',
  targetPath: contract.targetPath || ROOT,
  stopCondition: contract.stopCondition || 'supervisor_green_or_blocker_report',
  matrixStatus: allComplete ? 'all_complete' : blocker ? 'blocked' : 'partial',
  supervisorStatus: allComplete ? 'green' : 'red',
  parityStatus: allComplete ? 'full' : 'partial',
  nextFocus: surfaces.filter((surface) => surface.status !== 'complete' && surface.id !== 'O_final_parity_proof_gate').slice(0, 5).map((surface) => surface.id),
  blocker: blocker || null,
  transport: {
    cortexTransportActive: transportStatus?.active?.cortexTransport || false,
    threadBindingReadiness: transportStatus?.active?.threadBindingReadiness || false,
    externalClawhipRuntimeActive: transportStatus?.active?.externalClawhipRuntimeActive || false,
    transportStatusPath: path.relative(ROOT, TRANSPORT_STATUS_PATH),
    delegateStatusPath: path.relative(ROOT, DELEGATE_STATUS_PATH),
    delegateRunning: delegateStatus?.running === true,
    delegateOk: delegateStatus?.ok ?? null,
    delegateProgramStatePath: path.relative(ROOT, DELEGATE_PROGRAM_STATE_PATH),
    delegateCompletionPath: path.relative(ROOT, DELEGATE_COMPLETION_PATH),
    delegateSupervisorStatus,
    delegateCompletionConfirmed: delegateCompletion?.supervisorConfirmedCompletion || false
  },
  surfaces
};

const workerState = readJson(WORKER_STATE_PATH, {
  role: 'interactive_main_session',
  status: 'running',
  phase: 'kickoff',
  startedAt: new Date().toISOString(),
  lastTouchedAt: new Date().toISOString()
});
workerState.lastTouchedAt = new Date().toISOString();
if (!workerState.startedAt) workerState.startedAt = workerState.lastTouchedAt;
if (!workerState.role) workerState.role = 'interactive_main_session';
if (!workerState.status) workerState.status = 'running';
writeJson(WORKER_STATE_PATH, workerState);

writeJson(MATRIX_PATH, summary);
writeJson(PROGRAM_STATE_PATH, {
  generatedAt: new Date().toISOString(),
  running: !allComplete && !blocker,
  worker: workerState,
  transport: summary.transport,
  supervisor: {
    status: summary.supervisorStatus,
    matrixStatus: summary.matrixStatus,
    parityStatus: summary.parityStatus,
    blocker: blocker || null,
    note: allComplete ? 'Supervisor green: full-clone matrix complete.' : blocker ? 'Supervisor red with blocker report present.' : 'Supervisor red: checklist remains incomplete and campaign should continue.'
  },
  stopCondition: summary.stopCondition,
  stopAllowed: Boolean(allComplete || blocker),
  stopReason: allComplete ? 'supervisor_green' : blocker ? 'blocker_report' : null
});
writeJson(SUMMARY_PATH, {
  generatedAt: new Date().toISOString(),
  supervisorConfirmedCompletion: allComplete,
  supervisorStatus: summary.supervisorStatus,
  matrixStatus: summary.matrixStatus,
  parityStatus: summary.parityStatus,
  nextFocus: summary.nextFocus,
  blocker: blocker || null,
  matrixPath: path.relative(ROOT, MATRIX_PATH),
  programStatePath: path.relative(ROOT, PROGRAM_STATE_PATH)
});
writeJson(NOTIFY_PATH, {
  delivered: false,
  deliveredAt: null,
  awaitingNotifier: allComplete,
  blockedReason: blocker || null,
  updatedAt: new Date().toISOString()
});
writeJson(STATUS_REPORT_PATH, summary);
console.log(JSON.stringify({ supervisorStatus: summary.supervisorStatus, matrixStatus: summary.matrixStatus, parityStatus: summary.parityStatus, nextFocus: summary.nextFocus, blocker: blocker || null }, null, 2));
process.exit(allComplete ? 0 : 1);
