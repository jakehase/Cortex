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
const INVENTORY_REDUCTION_PATH = path.join(STRICT_DIR, 'strict_1to1_gap_inventory_reduction.json');
const CONTRACT_PATH = path.join(ROOT, 'strict_1to1_contract.json');
const DOC_MATRIX_PATH = path.join(ROOT, 'docs', 'MAILCHIMP_CANONICAL_PARITY_MATRIX_2026-04-11.json');
const AUDIT_PATH = path.join(ROOT, 'docs', 'MAILCHIMP_CANONICAL_PARITY_AUDIT_2026-04-11.md');
const EXECUTION_BRIEF_PATH = AUDIT_PATH;
const GAP_PLAN_PATH = AUDIT_PATH;
const WAVE1_PROOF_PATH = path.join(ROOT, 'artifacts', 'mailchimp_clone', 'real_world_indistinguishable', 'wave_1_browser_foundation', 'validation', 'browser_proof.json');
const CURRENT_PRODUCT_PROOF_PATH = path.join(STRICT_DIR, 'current_product_browser_proof', 'validation', 'current_product_browser_proof.json');
const LIVE_SMOKE_PATH = path.join(ROOT, 'artifacts', 'mailchimp_clone', 'full_clone', 'validation', 'live_smoke_full_clone.json');
const STRICT_PROOF_DIR = path.join(ROOT, 'artifacts', 'real_parity_proofs');

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

function countFilesWithExtensions(rootDir, exts) {
  let count = 0;
  try {
    walkFiles(rootDir, (filePath) => {
      if (exts.has(path.extname(filePath))) count += 1;
    });
  } catch {
    return 0;
  }
  return count;
}

function collectStrictProofCoverage(proofDir) {
  const proofFiles = [];
  try {
    for (const name of fs.readdirSync(proofDir).sort()) {
      if (!/^phase\d+.*\.json$/.test(name)) continue;
      const fullPath = path.join(proofDir, name);
      const proof = readJson(fullPath);
      if (!proof || proof.testsPassed !== true) continue;
      const proofEntries = Object.values(proof.proofs || {}).filter((entry) => entry && typeof entry === 'object');
      const productFiles = unique(proofEntries.flatMap((entry) => Array.isArray(entry.productFiles) ? entry.productFiles : []));
      const targetedTests = unique([
        ...(Array.isArray(proof.targetedTests) ? proof.targetedTests : []),
        ...proofEntries.flatMap((entry) => Array.isArray(entry.targetedTests) ? entry.targetedTests : [])
      ]);
      proofFiles.push({
        file: path.relative(ROOT, fullPath),
        scope: proof.scope || null,
        fidelity: proof.fidelity || null,
        strictGap: proof.strictGap || null,
        runCommand: proof.runCommand || null,
        productFiles,
        targetedTests,
        testsPassed: true
      });
    }
  } catch {
    return {
      proofDir,
      proofCount: 0,
      productFileCount: 0,
      targetedTestCount: 0,
      fidelityCounts: {},
      files: [],
      truthBoundary: 'No strict real-parity proof directory was readable for this supervisor run.'
    };
  }

  const fidelityCounts = {};
  for (const proof of proofFiles) {
    const key = proof.fidelity || 'unknown';
    fidelityCounts[key] = (fidelityCounts[key] || 0) + 1;
  }
  const productFiles = unique(proofFiles.flatMap((proof) => proof.productFiles));
  const targetedTests = unique(proofFiles.flatMap((proof) => proof.targetedTests));
  return {
    proofDir,
    proofCount: proofFiles.length,
    productFileCount: productFiles.length,
    targetedTestCount: targetedTests.length,
    fidelityCounts,
    files: proofFiles,
    truthBoundary: 'These proof maps verify scoped product-backed waves and autonomous continuation slices. They reduce stale blocker uncertainty, but they are not by themselves a global Mailchimp full-clone pass.'
  };
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

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function summarizeInventoryReduction(reduction) {
  if (!reduction || typeof reduction !== 'object') {
    return {
      present: false,
      ok: false,
      path: INVENTORY_REDUCTION_PATH,
      status: 'missing',
      truthBoundary: 'No strict inventory reducer artifact has been installed for this supervisor run.'
    };
  }
  const baselineRemainingGapCount = numberOrZero(reduction.baselineRemainingGapCount);
  const creditedGapCount = numberOrZero(reduction.creditedGapCount);
  const rejectedCreditCount = numberOrZero(reduction.rejectedCreditCount);
  const remainingGapCount = numberOrZero(reduction.remainingGapCount);
  const runCreditOk = reduction.runCreditOk === true;
  const allInventoryGapsCredited = reduction.allInventoryGapsCredited === true
    || (baselineRemainingGapCount > 0 && creditedGapCount >= baselineRemainingGapCount && remainingGapCount === 0 && rejectedCreditCount === 0);
  const ok = runCreditOk && allInventoryGapsCredited && rejectedCreditCount === 0 && remainingGapCount === 0;
  return {
    present: true,
    ok,
    path: INVENTORY_REDUCTION_PATH,
    schemaVersion: reduction.schemaVersion || null,
    status: reduction.status || (ok ? 'all_inventory_gaps_credited' : 'partial_or_invalid_inventory_reduction'),
    generatedAt: reduction.generatedAt || null,
    artifactRoot: reduction.artifactRoot || null,
    targetPath: reduction.targetPath || null,
    inventoryPath: reduction.inventoryPath || null,
    baselineGapCount: numberOrZero(reduction.baselineGapCount),
    baselineRemainingGapCount,
    globalCreditAttemptCount: numberOrZero(reduction.globalCreditAttemptCount),
    creditedGapCount,
    rejectedCreditCount,
    remainingGapCount,
    runCreditOk,
    allInventoryGapsCredited,
    remainingGapIds: Array.isArray(reduction.remainingGaps)
      ? reduction.remainingGaps.map((gap) => gap?.id).filter(Boolean)
      : [],
    truthBoundary: reduction.truthBoundary || 'Strict inventory reduction proves only admitted global gap credit, not full Mailchimp clone completion by itself.'
  };
}

function evaluate() {
  ensureDir(STRICT_DIR);

  const now = new Date().toISOString();
  const contract = readJson(CONTRACT_PATH) || {};
  const docMatrix = readJson(DOC_MATRIX_PATH) || { lanes: [] };
  const blocker = readJson(BLOCKER_PATH);
  const inventoryReduction = summarizeInventoryReduction(readJson(INVENTORY_REDUCTION_PATH));
  const wave1Proof = readJson(WAVE1_PROOF_PATH);
  const currentProductProof = readJson(CURRENT_PRODUCT_PROOF_PATH);
  const liveSmoke = readJson(LIVE_SMOKE_PATH);
  const strictProofCoverage = collectStrictProofCoverage(STRICT_PROOF_DIR);

  const storageText = readText(path.join(ROOT, 'packages', 'app', 'storage.mjs')) || '';
  const publicRoutesText = readText(path.join(ROOT, 'packages', 'app', 'routes', 'public.mjs')) || '';
  const currentProductOpsText = readText(path.join(ROOT, 'packages', 'app', 'domain-current-product-ops.mjs')) || '';
  const jobsText = readText(path.join(ROOT, 'packages', 'app', 'jobs.mjs')) || '';
  const campaignsText = readText(path.join(ROOT, 'packages', 'app', 'domain-campaigns.mjs')) || '';
  const integrationsText = readText(path.join(ROOT, 'packages', 'app', 'domain-integration-marketplace.mjs')) || '';
  const viewText = readText(path.join(ROOT, 'packages', 'app', 'view.mjs')) || '';

  const legacyClientFileCount = countClientFiles(ROOT);
  const clientSurfaceFileCount = countFilesWithExtensions(path.join(ROOT, 'apps', 'web', 'public'), new Set(['.mjs', '.js', '.jsx', '.ts', '.tsx', '.vue', '.svelte', '.css', '.scss']));
  const saveDbHits = countStringOccurrences(path.join(ROOT, 'packages'), 'saveDb(state.db)');
  const storageHasSqliteAdapter = storageText.includes('storageEngine()') && storageText.includes('loadDbFromSqlite') && storageText.includes('saveDbToSqlite') && fs.existsSync(path.join(ROOT, 'packages', 'app', 'storage-sqlite.mjs'));
  const storageDefaultEngine = storageText.includes("process.env.MAILCLONE_STORAGE_ENGINE || 'json'") ? 'json' : 'unknown';
  const phase11SqliteProof = strictProofCoverage.files.find((proof) => proof.file.includes('phase11-sqlite-data-plane')) || null;
  const frontendProofCount = strictProofCoverage.files.filter((proof) => /frontend|client|editor|builder|designer|dashboard|calendar/i.test(`${proof.scope || ''} ${proof.strictGap || ''}`)).length;
  const providerProofCount = strictProofCoverage.files.filter((proof) => /provider|integration|ai|predictive|commerce|sms|social|ads|webhook|developer/i.test(`${proof.scope || ''} ${proof.strictGap || ''}`)).length;

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
  if (inventoryReduction.present) {
    evidence.push(`Strict global inventory reduction evidence: ${inventoryReduction.creditedGapCount}/${inventoryReduction.baselineRemainingGapCount} baseline remaining gaps credited, ${inventoryReduction.rejectedCreditCount} rejected, ${inventoryReduction.remainingGapCount} remaining: ${INVENTORY_REDUCTION_PATH}`);
  } else {
    evidence.push(`Strict global inventory reduction evidence is missing: ${INVENTORY_REDUCTION_PATH}`);
  }
  evidence.push(`Strict scoped proof coverage: ${strictProofCoverage.proofCount} passing proof maps, ${strictProofCoverage.productFileCount} unique product files, and ${strictProofCoverage.targetedTestCount} targeted tests under ${STRICT_PROOF_DIR}.`);
  evidence.push(`UI architecture evidence: ${clientSurfaceFileCount} client/static runtime files found under apps/web/public (legacy non-.mjs client-file counter would report ${legacyClientFileCount}); primary app rendering still flows through packages/app/view.mjs and route modules.`);
  evidence.push(storageHasSqliteAdapter
    ? `Data-model evidence: packages/app/storage.mjs supports a SQLite adapter via packages/app/storage-sqlite.mjs; default storage engine is ${storageDefaultEngine}; saveDb(state.db) appears ${saveDbHits} times under packages/. Phase 11 proof: ${phase11SqliteProof ? phase11SqliteProof.file : 'not found'}.`
    : `Data-model evidence: no active SQLite adapter was detected; saveDb(state.db) appears ${saveDbHits} times under packages/.`);
  evidence.push(currentProductOpsText.includes('runAiProviderOperation') && currentProductOpsText.includes('recordAiModelRun')
    ? 'AI/optimization evidence: primary AI calls now pass through a service request/model-run ledger, but the provider remains a local Mailclone runtime seam rather than a real external/model-backed production system.'
    : 'AI/optimization evidence: packages/app/domain-current-product-ops.mjs generates subject, preheader, journey, site-copy, experimentation, predictive, and omnichannel behavior locally in-process.');
  evidence.push(jobsText.includes('beginServiceRequest') && campaignsText.includes('recordAnalyticsEvent')
    ? 'Delivery/reporting evidence: jobs and campaign analytics now emit service request, delivery pipeline, and analytics pipeline records, but execution remains in-process and metrics are still deterministic product-slice telemetry.'
    : 'Delivery/reporting evidence: packages/app/jobs.mjs runs send/delivery jobs in-process and packages/app/domain-campaigns.mjs synthesizes opens/clicks from recipient counts.');
  evidence.push(integrationsText.includes('recordIntegrationProviderCursor') && integrationsText.includes('syncIntegrationProvider')
    ? 'Integration evidence: marketplace sync now passes through provider adapter requests and durable cursors, but it remains a simulated Mailclone provider seam rather than a real third-party OAuth/data-sync system.'
    : 'Integration evidence: packages/app/domain-integration-marketplace.mjs installs connectors as local records and syncMarketplaceInstallation() fabricates sync totals in app state.');
  evidence.push(publicRoutesText.includes('SameSite=Lax') || readText(path.join(ROOT, 'packages', 'app', 'security.mjs'))?.includes('SameSite=Lax')
    ? 'Operational evidence: session cookies/security headers/reset outbox are materially hardened, but full production CSRF/security-program parity is still not proven.'
    : 'Operational evidence: packages/app/routes/public.mjs sets mailclone_session with HttpOnly only, lacks visible Secure/SameSite/CSRF hardening, and echoes password-reset tokens in HTML.');

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
        strictProofCoverage.proofCount ? `${frontendProofCount} passing scoped proof maps touch frontend/client/editor/builder/designer/dashboard style work.` : null,
        clientSurfaceFileCount === 0 ? 'No client/static runtime files found under apps/web/public.' : `Client/static runtime files under apps/web/public: ${clientSurfaceFileCount}`,
        viewText.includes('<!doctype html>') ? 'packages/app/view.mjs still participates in app-shell rendering, so scoped client modules do not yet prove whole-app Mailchimp rich-client equivalence.' : null
      ]),
      gaps: unique([
        'Extend scoped client/editor/builder modules into comprehensive rich-client parity across every canonical surface.',
        'Provide broad browser-backed evidence for drag/drop, persistent client state, collaboration, previews, and edge-case interaction realism.'
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
        storageHasSqliteAdapter ? 'storage.mjs can load/save through packages/app/storage-sqlite.mjs when MAILCLONE_STORAGE_ENGINE=sqlite.' : null,
        phase11SqliteProof ? `Passing scoped SQLite proof map: ${phase11SqliteProof.file}` : null,
        storageDefaultEngine === 'json' ? 'The default storage engine remains JSON unless MAILCLONE_STORAGE_ENGINE=sqlite is set.' : null,
        `saveDb(state.db) usage count under packages/: ${saveDbHits}`
      ]),
      gaps: unique([
        'Make production-grade storage behavior the default verified path, not only an optional/scoped SQLite wave.',
        'Add migration, concurrency, backup/restore, queue, and operational proof commensurate with a true SaaS clone claim.'
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
        providerProofCount ? `${providerProofCount} passing scoped proof maps cover provider-like AI/integration/commerce/SMS/social/ads/developer surfaces.` : null,
        integrationsText.includes("authMode: 'oauth'") ? 'Marketplace installs record oauth mode as local app-state metadata.' : null,
        integrationsText.includes('recordIntegrationProviderCursor') ? 'Connector sync now records provider cursor state and service request evidence.' : null,
        integrationsText.includes('syncedContacts: app.category === \'crm\' ? 12 : 0') ? 'Connector sync results are still hard-coded/synthetic inside syncMarketplaceInstallation().' : null
      ]),
      gaps: unique([
        'Replace simulated provider adapter behavior with real third-party auth/sync behavior for full clone parity.',
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
        jobsText.includes('beginServiceRequest') ? 'Job execution emits service request and delivery pipeline records from packages/app/jobs.mjs.' : jobsText.includes("if (job.type === 'deliver_campaign')") ? 'Job execution is in-process inside packages/app/jobs.mjs.' : null,
        campaignsText.includes('recordAnalyticsEvent') ? 'Campaign reporting now records analytics pipeline events before deriving report summaries.' : campaignsText.includes('Math.floor(recipientTotal * 0.6)') ? 'Campaign reporting still derives opens/clicks from fixed formulas in packages/app/domain-campaigns.mjs.' : null,
        currentProductOpsText.includes('runAiProviderOperation') ? 'AI behavior now records provider request/model-run ledger entries around local recommendation helpers.' : currentProductOpsText.includes('function buildSubjectVariants') ? 'AI behavior is implemented as local deterministic helper functions in packages/app/domain-current-product-ops.mjs.' : null
      ]),
      gaps: unique([
        'Harden auth/session/reset semantics to production-grade expectations.',
        'Replace in-process jobs, deterministic analytics, and local provider seams with production-realistic external systems for full-clone parity.'
      ]),
      notes: baseLaneNotes.get('operational_parity')?.notes || []
    }
  ];

  const allComplete = lanes.every((lane) => lane.requiredForGreen ? lane.status === 'complete' : true);
  const anyMissing = lanes.some((lane) => lane.status === 'missing');
  const inventoryBlocksFullClone = !inventoryReduction.ok;
  const matrixStatus = blocker || inventoryBlocksFullClone ? 'blocked' : allComplete ? 'all_complete' : anyMissing ? 'missing' : 'partial';
  const parityStatus = blocker || inventoryBlocksFullClone ? 'blocked' : allComplete ? 'full' : 'partial';

  const inventoryRemainingGaps = inventoryReduction.ok
    ? []
    : [
      'Strict global gap inventory reduction',
      ...(inventoryReduction.remainingGapIds || []).map((gapId) => `strict_1to1_gap_inventory id ${gapId}`)
    ];
  const remainingGaps = unique([
    ...inventoryRemainingGaps,
    ...lanes.filter((lane) => lane.status !== 'complete').flatMap((lane) => [lane.label, ...(lane.gaps || [])])
  ]);

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
    strictInventoryReduction: inventoryReduction,
    strictProofCoverage,
    truthBoundary: 'Strict supervisor reconciliation separates scoped proof-map progress from global full-clone parity. Passing scoped proofs reduce stale blocker noise, but the supervisor stays red while aggregate canonical lanes remain partial or an explicit strict blocker exists.',
    lanes,
    blocker: blocker || null
  };

  const state = {
    status: allComplete && inventoryReduction.ok && !blocker ? 'green' : 'red',
    fidelity: 'full_clone',
    matrixStatus,
    parityStatus,
    strictInventoryReduction: inventoryReduction,
    strictProofCoverage,
    remainingGaps,
    evidence,
    blocker: blocker || null,
    truthBoundary: matrix.truthBoundary,
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
    strictInventoryReduction: state.strictInventoryReduction,
    strictProofCoverage: {
      proofCount: strictProofCoverage.proofCount,
      productFileCount: strictProofCoverage.productFileCount,
      targetedTestCount: strictProofCoverage.targetedTestCount,
      fidelityCounts: strictProofCoverage.fidelityCounts
    },
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
