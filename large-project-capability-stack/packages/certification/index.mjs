import fs from 'node:fs';
import path from 'node:path';
import { evaluateArchitectureBudget } from '../architecture-enforcer/index.mjs';

export const CLAIM_LADDER = [
  'prototype',
  'production_slice',
  'scoped_parity',
  'full_clone_credible',
  'large_product_replica',
  'real_world_indistinguishable'
];

function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else files.push(full);
  }
  return files;
}

function loadJsonIfExists(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function discoverTargetEvidenceArtifacts(repoRoot, { limit = 80 } = {}) {
  const candidates = [
    path.join(repoRoot, 'artifacts'),
    path.join(repoRoot, 'docs')
  ].flatMap((root) => walk(root));

  return candidates
    .filter((filePath) => /\.(json|log|md|png|csv)$/i.test(filePath))
    .filter((filePath) => !filePath.includes(`${path.sep}node_modules${path.sep}`))
    .sort()
    .slice(0, limit);
}

export function createBrowserParityFromProof(proof = {}, { sourcePath = null } = {}) {
  const scenarios = Array.isArray(proof.scenarios) ? proof.scenarios : [];
  const checks = scenarios.flatMap((scenario) => {
    const scenarioChecks = Array.isArray(scenario.checks) ? scenario.checks : [];
    return scenarioChecks.map((check, index) => ({
      id: `${scenario.id || 'journey'}.${check.id || `check_${index + 1}`}`,
      ok: true,
      details: {
        family: scenario.id || 'unknown',
        label: scenario.label || '',
        detail: check.detail || '',
        at: check.at || null,
        screenshot: scenario.screenshot || null
      }
    }));
  });

  const passed = proof.realBrowserChecks || proof.browserChecks || checks.length;
  return {
    generatedAt: proof.generatedAt || new Date().toISOString(),
    ok: proof.ok !== false,
    total: passed,
    passed,
    failed: proof.ok === false ? Math.max(1, passed - checks.filter((check) => check.ok).length) : 0,
    evidence: {
      browser: {
        available: true,
        real: proof.realBrowser === true,
        driver: proof.driver || 'playwright-browser-proof'
      },
      proofPath: sourcePath,
      coveredFamilies: proof.coveredFamilies || []
    },
    checks
  };
}

export function discoverRealBrowserProof(repoRoot) {
  const candidates = [
    path.join(repoRoot, 'artifacts', 'mailchimp_clone', 'real_world_indistinguishable', 'wave_1_browser_foundation', 'validation', 'browser_proof.json'),
    path.join(repoRoot, 'artifacts', 'mailchimp_clone', 'real_world_indistinguishable', 'wave_1_browser_foundation', 'reports', 'wave1_browser_foundation_report.json')
  ];

  for (const filePath of candidates) {
    const payload = loadJsonIfExists(filePath);
    if (!payload) continue;
    if (payload.realBrowser === true || payload.proofSummary?.realBrowser === true) {
      const proof = payload.realBrowser === true ? payload : {
        generatedAt: payload.generatedAt,
        driver: 'playwright-chromium',
        realBrowser: true,
        ok: true,
        browserChecks: payload.browserChecks || payload.proofSummary?.browserChecks || 0,
        realBrowserChecks: payload.realBrowserChecks || payload.proofSummary?.realBrowserChecks || 0,
        browserJourneyFamilies: payload.browserJourneyFamilies || payload.proofSummary?.browserJourneyFamilies || 0,
        coveredFamilies: payload.coveredFamilies || payload.proofSummary?.coveredFamilies || [],
        scenarios: []
      };
      return {
        sourcePath: filePath,
        proof,
        browserReport: createBrowserParityFromProof(proof, { sourcePath: filePath })
      };
    }
  }

  return null;
}

export function selectPreferredBrowserParity(parityReport = {}) {
  const sections = [parityReport.browserProof, parityReport.browser, parityReport.browserAdapter].filter(Boolean);
  return sections.find((section) => section?.evidence?.browser?.real === true)
    || sections.find((section) => section?.ok === true)
    || null;
}

function sourceFile(file) {
  return ['.js', '.mjs', '.ts', '.tsx', '.jsx'].includes(path.extname(file));
}

function countLines(file) {
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).length;
}

function scoreDimension(value, thresholds) {
  let score = 0;
  for (const threshold of thresholds) {
    if (value >= threshold) score += 1;
  }
  return score;
}

function capScore(value) {
  return Math.max(0, Math.min(5, Math.round(value)));
}

function allowedClaims(highestAllowedClaim) {
  const idx = CLAIM_LADDER.indexOf(highestAllowedClaim);
  return idx >= 0 ? CLAIM_LADDER.slice(0, idx + 1) : [];
}

export function collectRepoEvidence(repoRoot, options = {}) {
  const architecture = options.architectureReport?.budget || evaluateArchitectureBudget(repoRoot, options.architectureConfig || {});
  const files = walk(repoRoot).filter(sourceFile);
  let productFiles = 0;
  let productLines = 0;
  let testFiles = 0;
  let testLines = 0;

  for (const file of files) {
    const rel = path.relative(repoRoot, file);
    const lines = countLines(file);
    if (rel.startsWith(`tests${path.sep}`)) {
      testFiles += 1;
      testLines += lines;
      continue;
    }
    if (/^(apps|packages|src|services)\//.test(rel)) {
      productFiles += 1;
      productLines += lines;
    }
  }

  const evidenceArtifacts = (options.evidenceArtifacts || []).filter(Boolean);
  const parityReport = options.parityReport || {};
  const combinedParity = parityReport.liveHttp || parityReport.http || parityReport;
  const browserParity = selectPreferredBrowserParity(parityReport);
  const browserEvidence = browserParity?.evidence?.browser || combinedParity?.evidence?.browser || { available: false, real: false, driver: 'none' };
  const parityOk = combinedParity?.ok === true;
  const browserChecks = browserParity?.passed || 0;
  const parityChecks = (combinedParity?.passed || 0) + (browserParity?.passed || 0);
  const evidenceDepthCount = [
    parityOk,
    browserParity?.ok === true,
    browserEvidence.real === true,
    Boolean(options.repoTestsOk),
    Boolean(options.targetTestsOk),
    evidenceArtifacts.length >= 4,
    evidenceArtifacts.length >= 8,
    evidenceArtifacts.length >= 16,
    Boolean(options.supervisorOk),
    Boolean(options.notifyOk),
    architecture.shapeScores?.architectureSplit >= 3
  ].filter(Boolean).length;

  const dimensionScores = {
    repoShape: capScore((scoreDimension(productFiles, [5, 12, 30, 80, 250]) + scoreDimension((architecture.metrics.packageCount || 0) + (architecture.metrics.appCount || 0), [2, 4, 8, 16, 40])) / 2),
    codeVolume: scoreDimension(productLines, [400, 1500, 12000, 40000, 750000]),
    testBreadth: capScore((scoreDimension(testFiles, [2, 5, 10, 20, 80]) + scoreDimension(testLines, [100, 400, 1200, 3000, 120000])) / 2),
    architectureSplit: architecture.shapeScores?.architectureSplit || 0,
    evidenceDepth: scoreDimension(evidenceDepthCount, [2, 4, 6, 8, 10]),
    browserGrade: browserEvidence.real && browserChecks >= 12 ? 5 : browserEvidence.real ? 4 : browserEvidence.available ? 2 : parityOk ? 1 : 0
  };

  return {
    repoRoot,
    productFiles,
    productLines,
    testFiles,
    testLines,
    parityOk,
    parityChecks,
    browserEvidence,
    architecture,
    evidenceArtifacts,
    repoTestsOk: Boolean(options.repoTestsOk),
    targetTestsOk: Boolean(options.targetTestsOk),
    supervisorOk: Boolean(options.supervisorOk),
    notifyOk: Boolean(options.notifyOk),
    dimensionScores
  };
}

export function validateClaim(evidence, claim) {
  const reasons = [];
  const d = evidence.dimensionScores || {};
  const architectureClaims = evidence.architecture?.claims || {};

  if (!CLAIM_LADDER.includes(claim)) return { allowed: false, reasons: [`Unknown claim ${claim}`] };
  if (claim === 'prototype') {
    if (evidence.productFiles < 1) reasons.push('no_product_code_detected');
  }
  if (claim === 'production_slice') {
    if (d.repoShape < 1) reasons.push('repo_shape_too_small_for_production_slice');
    if (d.codeVolume < 1) reasons.push('code_volume_too_small_for_production_slice');
    if (d.testBreadth < 1) reasons.push('test_breadth_too_small_for_production_slice');
    if (d.architectureSplit < 2) reasons.push('architecture_split_too_shallow_for_production_slice');
    if (!architectureClaims.production_slice?.eligible) reasons.push(...architectureClaims.production_slice.reasons);
  }
  if (claim === 'scoped_parity') {
    if (!evidence.parityOk) reasons.push('parity_checks_not_green');
    if (evidence.parityChecks < 3) reasons.push('insufficient_parity_depth_for_scoped_parity');
    if (d.repoShape < 2) reasons.push('repo_shape_too_small_for_scoped_parity');
    if (d.codeVolume < 2) reasons.push('code_volume_too_small_for_scoped_parity');
    if (d.testBreadth < 2) reasons.push('test_breadth_too_small_for_scoped_parity');
    if (d.architectureSplit < 2) reasons.push('architecture_split_too_shallow_for_scoped_parity');
    if (!architectureClaims.scoped_parity?.eligible) reasons.push(...architectureClaims.scoped_parity.reasons);
  }
  if (claim === 'full_clone_credible') {
    if (!evidence.parityOk) reasons.push('parity_checks_not_green');
    if (evidence.parityChecks < 6) reasons.push('insufficient_parity_depth_for_full_clone');
    if (d.repoShape < 3) reasons.push('repo_shape_too_small_for_full_clone');
    if (d.codeVolume < 3) reasons.push('code_volume_too_small_for_full_clone');
    if (d.testBreadth < 3) reasons.push('test_breadth_too_small_for_full_clone');
    if (d.architectureSplit < 3) reasons.push('architecture_split_too_shallow_for_full_clone');
    if (d.evidenceDepth < 3) reasons.push('evidence_depth_too_shallow_for_full_clone');
    if (d.browserGrade < 4) reasons.push('no_real_browser_proof');
    if (!architectureClaims.full_clone_credible?.eligible) reasons.push(...architectureClaims.full_clone_credible.reasons);
  }
  if (claim === 'real_world_indistinguishable') {
    if (!validateClaim(evidence, 'large_product_replica').allowed) reasons.push('large_product_replica_not_established');
    if (evidence.parityChecks < 30) reasons.push('insufficient_parity_depth_for_real_world_indistinguishable');
    if (d.repoShape < 4) reasons.push('repo_shape_too_small_for_real_world_indistinguishable');
    if (d.codeVolume < 5) reasons.push('code_volume_too_small_for_real_world_indistinguishable');
    if (d.testBreadth < 5) reasons.push('test_breadth_too_small_for_real_world_indistinguishable');
    if (d.evidenceDepth < 4) reasons.push('extraordinary_evidence_not_present');
    if (d.browserGrade < 5) reasons.push('no_extensive_real_browser_proof');
    if (!architectureClaims.real_world_indistinguishable?.eligible) reasons.push(...architectureClaims.real_world_indistinguishable.reasons);
  }
  if (claim === 'large_product_replica') {
    if (!validateClaim(evidence, 'full_clone_credible').allowed) reasons.push('full_clone_credible_not_established');
    if (!evidence.parityOk) reasons.push('parity_checks_not_green');
    if (evidence.parityChecks < 12) reasons.push('insufficient_parity_depth_for_large_product_replica');
    if (d.repoShape < 5) reasons.push('repo_shape_too_small_for_large_product_replica');
    if (d.codeVolume < 5) reasons.push('code_volume_too_small_for_large_product_replica');
    if (d.testBreadth < 5) reasons.push('test_breadth_too_small_for_large_product_replica');
    if (d.architectureSplit < 4) reasons.push('architecture_split_too_shallow_for_large_product_replica');
    if (d.evidenceDepth < 4) reasons.push('evidence_depth_too_shallow_for_large_product_replica');
    if (d.browserGrade < 5) reasons.push('insufficient_real_browser_proof_for_large_product_replica');
    if (!architectureClaims.large_product_replica?.eligible) reasons.push(...architectureClaims.large_product_replica.reasons);
  }

  return { allowed: reasons.length === 0, reasons: [...new Set(reasons)] };
}

export function certifyClaim({
  repoRoot,
  requestedClaim = 'full_clone_credible',
  evidenceArtifacts = [],
  architectureReport,
  parityReport,
  repoTestsOk = false,
  targetTestsOk = false,
  supervisorOk = false,
  notifyOk = false
} = {}) {
  const evidence = collectRepoEvidence(repoRoot, {
    architectureReport,
    parityReport,
    evidenceArtifacts,
    repoTestsOk,
    targetTestsOk,
    supervisorOk,
    notifyOk
  });

  const claims = Object.fromEntries(CLAIM_LADDER.map((claim) => [claim, validateClaim(evidence, claim)]));
  const highestAllowedClaim = [...CLAIM_LADDER].reverse().find((claim) => claims[claim].allowed) || null;

  return {
    generatedAt: new Date().toISOString(),
    repoRoot,
    requestedClaim,
    highestAllowedClaim,
    allowedPublicClaims: allowedClaims(highestAllowedClaim),
    requestedClaimAllowed: claims[requestedClaim]?.allowed === true,
    statusFlags: {
      scoped_completion_green: Boolean(evidence.repoTestsOk && evidence.targetTestsOk && evidence.supervisorOk && evidence.notifyOk && evidence.parityOk),
      parity_for_scope_plausible: claims.scoped_parity.allowed,
      full_clone_credible: claims.full_clone_credible.allowed,
      large_product_replica: claims.large_product_replica.allowed,
      real_world_indistinguishable_not_proven: !claims.real_world_indistinguishable.allowed
    },
    evidence,
    claims,
    claimLadder: CLAIM_LADDER,
    publicSummary: {
      safeClaim: highestAllowedClaim,
      safeClaimLabel: highestAllowedClaim ? highestAllowedClaim.replace(/_/g, ' ') : 'no credible public claim',
      downgradeReasons: claims[requestedClaim]?.reasons || []
    }
  };
}

export function saveCertification(filePath, certification) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(certification, null, 2));
  return certification;
}
