import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const STRICT_DIR = path.join(ROOT, 'artifacts', 'strict_1to1');
const MATRIX_PATH = path.join(STRICT_DIR, 'surface_matrix.json');
const STATE_PATH = path.join(STRICT_DIR, 'supervisor_state.json');
const PROGRESS_PATH = path.join(STRICT_DIR, 'progress_log.json');
const BLOCKER_PATH = path.join(STRICT_DIR, 'blocker_report.json');
const CONTRACT_PATH = path.join(ROOT, 'strict_1to1_contract.json');
const DOC_MATRIX_PATH = path.join(ROOT, 'docs', 'MAILCHIMP_CANONICAL_PARITY_MATRIX_2026-04-11.json');
const AUDIT_PATH = path.join(ROOT, 'docs', 'MAILCHIMP_CANONICAL_PARITY_AUDIT_2026-04-11.md');
const EXECUTION_BRIEF_PATH = AUDIT_PATH;
const GAP_PLAN_PATH = AUDIT_PATH;
const WAVE1_PROOF_PATH = path.join(ROOT, 'artifacts', 'mailchimp_clone', 'real_world_indistinguishable', 'wave_1_browser_foundation', 'validation', 'browser_proof.json');
const CURRENT_PRODUCT_PROOF_PATH = path.join(STRICT_DIR, 'current_product_browser_proof', 'validation', 'current_product_browser_proof.json');
const LIVE_SMOKE_PATH = path.join(ROOT, 'artifacts', 'mailchimp_clone', 'full_clone', 'validation', 'live_smoke_full_clone.json');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readText(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

function readJson(filePath) {
  const text = readText(filePath);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function walkFiles(dir, visit) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(fullPath, visit);
    else if (entry.isFile()) visit(fullPath);
  }
}

function countClientFiles(rootDir) {
  const exts = new Set(['.tsx', '.jsx', '.ts', '.vue', '.svelte', '.css', '.scss']);
  let count = 0;
  walkFiles(rootDir, (filePath) => {
    if (exts.has(path.extname(filePath))) count += 1;
  });
  return count;
}

function countStringOccurrences(rootDir, needle) {
  let count = 0;
  walkFiles(rootDir, (filePath) => {
    const text = readText(filePath);
    if (!text) return;
    const matches = text.match(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'));
    count += matches ? matches.length : 0;
  });
  return count;
}

function mapLaneStatus(status) {
  if (status === 'complete' || status === 'all_complete' || status === 'green') return 'complete';
  if (status === 'blocked') return 'blocked';
  if (status === 'missing') return 'missing';
  return 'partial';
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function evaluate() {
  ensureDir(STRICT_DIR);

  const now = new Date().toISOString();
  const contract = readJson(CONTRACT_PATH) || {};
  const docMatrix = readJson(DOC_MATRIX_PATH) || { lanes: [] };
  const blocker = readJson(BLOCKER_PATH);
  const wave1Proof = readJson(WAVE1_PROOF_PATH);
  const currentProductProof = readJson(CURRENT_PRODUCT_PROOF_PATH);
  const liveSmoke = readJson(LIVE_SMOKE_PATH);

  const storageText = readText(path.join(ROOT, 'packages', 'app', 'storage.mjs')) || '';
  const publicRoutesText = readText(path.join(ROOT, 'packages', 'app', 'routes', 'public.mjs')) || '';
  const currentProductOpsText = readText(path.join(ROOT, 'packages', 'app', 'domain-current-product-ops.mjs')) || '';
  const jobsText = readText(path.join(ROOT, 'packages', 'app', 'jobs.mjs')) || '';
  const campaignsText = readText(path.join(ROOT, 'packages', 'app', 'domain-campaigns.mjs')) || '';
  const integrationsText = readText(path.join(ROOT, 'packages', 'app', 'domain-integration-marketplace.mjs')) || '';
  const viewText = readText(path.join(ROOT, 'packages', 'app', 'view.mjs')) || '';

  const clientFileCount = countClientFiles(ROOT);
  const saveDbHits = countStringOccurrences(path.join(ROOT, 'packages'), 'saveDb(state.db)');

  const evidence = [];
  if (wave1Proof?.ok) {
    evidence.push(`Wave 1 browser proof passes with ${wave1Proof.browserJourneyFamilies} journey families and ${wave1Proof.realBrowserChecks} real-browser checks: ${WAVE1_PROOF_PATH}`);
  }
  if (currentProductProof?.ok) {
    evidence.push(`Current-product browser proof passes with ${currentProductProof.browserJourneyFamilies} journey families and ${currentProductProof.realBrowserChecks} real-browser checks: ${CURRENT_PRODUCT_PROOF_PATH}`);
  }
  if (liveSmoke?.ok) {
    evidence.push(`Live smoke passes across core/current-product checklist surfaces: ${LIVE_SMOKE_PATH}`);
  }
  evidence.push(`UI architecture evidence: ${clientFileCount} TS/JSX/Vue/Svelte/CSS client-surface files found; page shell is server-rendered HTML in packages/app/view.mjs.`);
  evidence.push(`Data-model evidence: packages/app/storage.mjs reads/writes a single JSON database file with sync fs operations; saveDb(state.db) appears ${saveDbHits} times under packages/.`);
  evidence.push('AI/optimization evidence: packages/app/domain-current-product-ops.mjs generates subject, preheader, journey, site-copy, experimentation, predictive, and omnichannel behavior locally in-process.');
  evidence.push('Delivery/reporting evidence: packages/app/jobs.mjs runs send/delivery jobs in-process and packages/app/domain-campaigns.mjs synthesizes opens/clicks from recipient counts.');
  evidence.push('Integration evidence: packages/app/domain-integration-marketplace.mjs installs connectors as local records and syncMarketplaceInstallation() fabricates sync totals in app state.');
  evidence.push('Operational evidence: packages/app/routes/public.mjs sets mailclone_session with HttpOnly only, lacks visible Secure/SameSite/CSRF hardening, and echoes password-reset tokens in HTML.');

  const baseLaneNotes = new Map((docMatrix.lanes || []).map((lane) => [lane.id, lane]));
  const lanes = [
    {
      id: 'ui_parity',
      label: 'UI parity',
      requiredForGreen: true,
      status: mapLaneStatus(baseLaneNotes.get('ui_parity')?.status),
      evidence: unique([
        wave1Proof?.ok ? `Wave 1 browser proof covers: ${(wave1Proof.coveredFamilies || []).join(', ')}` : null,
        currentProductProof?.ok ? `Current-product browser proof covers: ${(currentProductProof.coveredFamilies || []).join(', ')}` : null,
        clientFileCount === 0 ? 'No modern client-surface files found for richer Mailchimp-like interaction architecture.' : `Client-surface file count: ${clientFileCount}`,
        viewText.includes('<!doctype html>') ? 'packages/app/view.mjs assembles the app shell as server-rendered HTML with inline CSS.' : null
      ]),
      gaps: unique([
        'Replace form-only/server-rendered shell with a richer client interaction model comparable to Mailchimp.',
        'Provide product-surface evidence for drag/drop, persistent client state, and deeper JS-driven editing realism.'
      ]),
      notes: baseLaneNotes.get('ui_parity')?.notes || []
    },
    {
      id: 'workflow_parity',
      label: 'Workflow parity',
      requiredForGreen: true,
      status: mapLaneStatus(baseLaneNotes.get('workflow_parity')?.status),
      evidence: unique([
        currentProductProof?.ok ? `Fresh browser journeys exist for current-product families: ${(currentProductProof.coveredFamilies || []).join(', ')}` : null,
        wave1Proof?.ok ? `Existing browser journeys exist for core families: ${(wave1Proof.coveredFamilies || []).join(', ')}` : null,
        liveSmoke?.ok ? `Live smoke checklist covers ${liveSmoke.checklist?.length || 0} surfaces.` : null
      ]),
      gaps: unique([
        'Tighten multi-step review/approval/scheduling/reporting behavior to match Mailchimp more closely.',
        'Prove workflow realism with browser-backed behavior parity, not only repo-local route presence.'
      ]),
      notes: baseLaneNotes.get('workflow_parity')?.notes || []
    },
    {
      id: 'data_model_parity',
      label: 'Data-model parity',
      requiredForGreen: true,
      status: mapLaneStatus(baseLaneNotes.get('data_model_parity')?.status),
      evidence: unique([
        storageText.includes('dbPath: path.join(dataDir, \'app.json\')') ? 'Database path points to data/app.json.' : null,
        storageText.includes('fs.writeFileSync(paths.dbPath') ? 'Database persistence is synchronous JSON-file rewrite via fs.writeFileSync().' : null,
        `saveDb(state.db) usage count under packages/: ${saveDbHits}`
      ]),
      gaps: unique([
        'Replace single-file JSON persistence with a production-grade data model and storage layer.',
        'Add migration/concurrency realism commensurate with a true SaaS clone claim.'
      ]),
      notes: baseLaneNotes.get('data_model_parity')?.notes || []
    },
    {
      id: 'provider_integration_parity',
      label: 'Provider / integration parity',
      requiredForGreen: true,
      status: mapLaneStatus(baseLaneNotes.get('provider_integration_parity')?.status),
      evidence: unique([
        currentProductProof?.ok ? 'Browser proof shows integration detail pages render and mutate in a real browser.' : null,
        integrationsText.includes("authMode: 'oauth'") ? 'Marketplace installs record oauth mode as local app-state metadata.' : null,
        integrationsText.includes('syncedContacts: app.category === \'crm\' ? 12 : 0') ? 'Connector sync results are still hard-coded/synthetic inside syncMarketplaceInstallation().' : null
      ]),
      gaps: unique([
        'Replace mostly simulated connector auth/sync behavior with real provider-backed realism.',
        'Provide evidence of non-fixture delivery/integration behavior in primary app code paths.'
      ]),
      notes: baseLaneNotes.get('provider_integration_parity')?.notes || []
    },
    {
      id: 'operational_parity',
      label: 'Operational parity',
      requiredForGreen: true,
      status: mapLaneStatus(baseLaneNotes.get('operational_parity')?.status),
      evidence: unique([
        publicRoutesText.includes('Set-Cookie') ? 'Session cookies are issued directly from packages/app/routes/public.mjs.' : null,
        publicRoutesText.includes('Generated token: <code>${token}</code>') ? 'Password reset token is rendered directly into the HTML response.' : null,
        jobsText.includes("if (job.type === 'deliver_campaign')") ? 'Job execution is in-process inside packages/app/jobs.mjs.' : null,
        campaignsText.includes('Math.floor(recipientTotal * 0.6)') ? 'Campaign reporting still derives opens/clicks from fixed formulas in packages/app/domain-campaigns.mjs.' : null,
        currentProductOpsText.includes('function buildSubjectVariants') ? 'AI behavior is implemented as local deterministic helper functions in packages/app/domain-current-product-ops.mjs.' : null
      ]),
      gaps: unique([
        'Harden auth/session/reset semantics to production-grade expectations.',
        'Replace in-process jobs, synthetic analytics, and heuristic AI with operationally realistic systems.'
      ]),
      notes: baseLaneNotes.get('operational_parity')?.notes || []
    }
  ];

  const allComplete = lanes.every((lane) => lane.requiredForGreen ? lane.status === 'complete' : true);
  const anyMissing = lanes.some((lane) => lane.status === 'missing');
  const matrixStatus = blocker ? 'blocked' : allComplete ? 'all_complete' : anyMissing ? 'missing' : 'partial';
  const parityStatus = blocker ? 'blocked' : allComplete ? 'full' : 'partial';

  const remainingGaps = unique(lanes.filter((lane) => lane.status !== 'complete').flatMap((lane) => [lane.label, ...(lane.gaps || [])]));

  const matrix = {
    generatedAt: now,
    targetPath: ROOT,
    fidelity: 'full_clone',
    stopCondition: 'supervisor_green_or_blocker_report',
    anchors: [AUDIT_PATH, GAP_PLAN_PATH, EXECUTION_BRIEF_PATH, CONTRACT_PATH],
    contract,
    matrixStatus,
    browserProof: {
      wave1: wave1Proof ? {
        ok: Boolean(wave1Proof.ok),
        path: WAVE1_PROOF_PATH,
        generatedAt: wave1Proof.generatedAt || null,
        coveredFamilies: wave1Proof.coveredFamilies || []
      } : null,
      currentProduct: currentProductProof ? {
        ok: Boolean(currentProductProof.ok),
        path: CURRENT_PRODUCT_PROOF_PATH,
        generatedAt: currentProductProof.generatedAt || null,
        coveredFamilies: currentProductProof.coveredFamilies || []
      } : null
    },
    validation: {
      liveSmoke: liveSmoke ? {
        ok: Boolean(liveSmoke.ok),
        path: LIVE_SMOKE_PATH,
        generatedAt: liveSmoke.generatedAt || null,
        checklistCount: liveSmoke.checklist?.length || 0
      } : null
    },
    lanes,
    blocker: blocker || null
  };

  const state = {
    status: allComplete && !blocker ? 'green' : 'red',
    fidelity: 'full_clone',
    matrixStatus,
    parityStatus,
    remainingGaps,
    evidence,
    blocker: blocker || null,
    nextAction: blocker?.nextAction || blocker?.action || (allComplete ? 'Completion criteria satisfied.' : 'Keep campaign alive: close every non-complete parity lane with real product-surface and browser-backed evidence before claiming a true Mailchimp 1:1 clone.'),
    updatedAt: now
  };

  const progress = readJson(PROGRESS_PATH) || { history: [] };
  progress.history ||= [];
  progress.history.push({
    updatedAt: now,
    status: state.status,
    matrixStatus: state.matrixStatus,
    parityStatus: state.parityStatus,
    blocker: state.blocker ? true : false,
    evidence: state.evidence,
    remainingGaps: state.remainingGaps
  });
  if (progress.history.length > 50) progress.history = progress.history.slice(-50);

  writeJson(MATRIX_PATH, matrix);
  writeJson(STATE_PATH, state);
  writeJson(PROGRESS_PATH, progress);

  process.stdout.write(`${JSON.stringify(state, null, 2)}\n`);
}

const watchMode = process.argv.includes('--watch');
const pollMsArg = process.argv.find((arg) => arg.startsWith('--poll-ms='));
const pollMs = Number(pollMsArg?.split('=')[1] || 60000);

evaluate();
if (watchMode) {
  setInterval(evaluate, Number.isFinite(pollMs) && pollMs > 0 ? pollMs : 60000);
}
