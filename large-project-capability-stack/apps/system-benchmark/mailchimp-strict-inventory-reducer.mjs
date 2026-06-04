#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function readJson(filePath, fallback = null) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return fallback; }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function findStrictInventoryPath(mailchimpRoot) {
  const candidates = [
    path.join(mailchimpRoot, 'artifacts/full_audit_campaign/strict_1to1_gap_inventory.json'),
    path.join(mailchimpRoot, 'docs/MAILCHIMP_STRICT_1TO1_GAP_INVENTORY_2026-05-08.json')
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function existingEvidenceOk(entries = []) {
  return Array.isArray(entries) && entries.length > 0 && entries.every((entry) => entry?.exists === true && Number(entry?.bytes || 0) > 0);
}

function creditDecision({ credit, summary, inventoryGap, seenGapIds }) {
  const reasons = [];
  const globalGapId = credit?.globalGapId || summary?.selectedGlobalGapId || null;
  const semanticWorkGate = credit?.semanticWorkGate || summary?.semanticWorkGate || {};
  const productChangedFiles = Array.isArray(semanticWorkGate.productChangedFiles)
    ? semanticWorkGate.productChangedFiles.filter(Boolean)
    : [];
  const productDiffProof = productChangedFiles.length > 0;
  const productStateProof = credit?.productStateProof || semanticWorkGate.productStateProof || summary?.semanticWorkGate?.productStateProof || null;
  const explicitProductStateProof = semanticWorkGate.explicitProductStateProof === true && productStateProof?.ok === true;
  const productStateEvidenceOk = explicitProductStateProof
    && existingEvidenceOk(productStateProof.productEvidence)
    && existingEvidenceOk(productStateProof.testEvidence)
    && Number(productStateProof.assertionCount || 0) > 0;

  if (!globalGapId) reasons.push('missing_global_gap_id');
  if (!inventoryGap) reasons.push('global_gap_not_in_remaining_inventory');
  if (seenGapIds.has(globalGapId)) reasons.push('duplicate_global_gap_credit');
  if (credit?.thresholdPass !== true) reasons.push('credit_threshold_not_passed');
  if (summary?.thresholdPass !== true) reasons.push('iteration_threshold_not_passed');
  if (summary?.testsPassed !== true) reasons.push('iteration_tests_not_passed');
  if (summary?.honestyGate?.ok !== true) reasons.push('honesty_gate_not_green');
  if (semanticWorkGate.ok !== true) reasons.push('semantic_work_gate_not_green');
  if (!productDiffProof && !productStateEvidenceOk) reasons.push('no_product_diff_or_valid_explicit_product_state_proof');

  const ok = reasons.length === 0;
  return {
    ok,
    reasons,
    globalGapId,
    globalGapLabel: credit?.globalGapLabel || summary?.selectedGlobalGapLabel || inventoryGap?.label || null,
    creditMode: productDiffProof ? 'product_diff' : (productStateEvidenceOk ? 'explicit_product_state_proof' : 'none'),
    productChangedFiles,
    productStateProofFiles: productStateEvidenceOk
      ? (productStateProof.productEvidence || []).map((entry) => entry.relPath).filter(Boolean)
      : [],
    testFiles: productStateEvidenceOk
      ? (productStateProof.testEvidence || []).map((entry) => entry.relPath).filter(Boolean)
      : [],
    selectedSurfaceId: credit?.selectedSurfaceId || summary?.selectedSurfaceId || null,
    selectedStrictGap: credit?.selectedStrictGap || summary?.selectedStrictGap || null
  };
}

export function buildStrictInventoryReduction({ mailchimpRoot, artifactRoot, iterations = [], generatedAt = new Date().toISOString() }) {
  const inventoryPath = findStrictInventoryPath(mailchimpRoot);
  const inventory = inventoryPath ? readJson(inventoryPath, {}) : {};
  const inventoryGaps = Array.isArray(inventory.gaps) ? inventory.gaps : [];
  const remainingInventoryGaps = inventoryGaps.filter((gap) => String(gap.status || 'remaining_gap') === 'remaining_gap');
  const remainingById = new Map(remainingInventoryGaps.map((gap) => [gap.id, gap]));

  const creditedGaps = [];
  const rejectedCredits = [];
  const seenGapIds = new Set();
  const globalCreditAttempts = [];

  for (const iteration of iterations || []) {
    const iterationArtifactRoot = iteration?.artifactRoot;
    if (!iterationArtifactRoot) continue;
    const summary = readJson(path.join(iterationArtifactRoot, 'completion_summary.json'), {}) || iteration.summary || {};
    const creditPath = path.join(iterationArtifactRoot, 'global_gap_credit.json');
    const credit = readJson(creditPath, null);
    if (!credit && !summary.selectedGlobalGapId) continue;
    globalCreditAttempts.push({ iterationArtifactRoot, creditPath, selectedGlobalGapId: summary.selectedGlobalGapId || credit?.globalGapId || null });
    if (!credit) {
      rejectedCredits.push({ iterationArtifactRoot, creditPath, globalGapId: summary.selectedGlobalGapId || null, reasons: ['missing_global_gap_credit_artifact'] });
      continue;
    }
    const decision = creditDecision({ credit, summary, inventoryGap: remainingById.get(credit.globalGapId), seenGapIds });
    const record = {
      iterationArtifactRoot,
      creditPath,
      globalGapId: decision.globalGapId,
      globalGapLabel: decision.globalGapLabel,
      selectedSurfaceId: decision.selectedSurfaceId,
      selectedStrictGap: decision.selectedStrictGap,
      creditMode: decision.creditMode,
      productChangedFiles: decision.productChangedFiles,
      productStateProofFiles: decision.productStateProofFiles,
      testFiles: decision.testFiles,
      thresholdPass: credit.thresholdPass === true && summary.thresholdPass === true,
      testsPassed: summary.testsPassed === true,
      honestyOk: summary.honestyGate?.ok === true,
      semanticWorkGateOk: (credit.semanticWorkGate || summary.semanticWorkGate || {}).ok === true
    };
    if (decision.ok) {
      creditedGaps.push(record);
      seenGapIds.add(decision.globalGapId);
    } else {
      rejectedCredits.push({ ...record, reasons: decision.reasons });
    }
  }

  const creditedIds = new Set(creditedGaps.map((entry) => entry.globalGapId));
  const remainingGaps = remainingInventoryGaps
    .filter((gap) => !creditedIds.has(gap.id))
    .map((gap) => ({ id: gap.id, label: gap.label || null, status: gap.status || 'remaining_gap' }));
  const runCreditOk = rejectedCredits.length === 0 && creditedGaps.length === globalCreditAttempts.length;
  const allInventoryGapsCredited = remainingInventoryGaps.length > 0 && remainingGaps.length === 0;

  return {
    schemaVersion: 'clawd.mailchimp.strict_1to1_inventory_reduction.v1',
    generatedAt,
    artifactRoot,
    targetPath: mailchimpRoot,
    inventoryPath,
    baselineGapCount: Number(inventory.gapCount ?? inventoryGaps.length),
    baselineRemainingGapCount: remainingInventoryGaps.length,
    globalCreditAttemptCount: globalCreditAttempts.length,
    creditedGapCount: creditedGaps.length,
    rejectedCreditCount: rejectedCredits.length,
    remainingGapCount: remainingGaps.length,
    runCreditOk,
    allInventoryGapsCredited,
    status: allInventoryGapsCredited ? 'all_inventory_gaps_credited' : (creditedGaps.length ? 'partial_inventory_reduction' : 'no_inventory_reduction'),
    creditedGaps,
    rejectedCredits,
    remainingGaps,
    truthBoundary: 'This reducer only decrements strict_1to1_gap_inventory entries from admitted global_gap_credit artifacts. It is not by itself a Mailchimp full-clone completion claim.'
  };
}

function parseCli(argv) {
  const args = { mailchimpRoot: null, artifactRoot: null, output: null };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const next = argv[i + 1];
    if (token === '--mailchimp-root') { args.mailchimpRoot = path.resolve(next); i += 1; continue; }
    if (token === '--artifact-root') { args.artifactRoot = path.resolve(next); i += 1; continue; }
    if (token === '--output') { args.output = path.resolve(next); i += 1; continue; }
  }
  if (!args.mailchimpRoot) throw new Error('Missing --mailchimp-root');
  if (!args.artifactRoot) throw new Error('Missing --artifact-root');
  return args;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = parseCli(process.argv.slice(2));
  const completion = readJson(path.join(args.artifactRoot, 'completion_summary.json'), {}) || {};
  const reduction = buildStrictInventoryReduction({ mailchimpRoot: args.mailchimpRoot, artifactRoot: args.artifactRoot, iterations: completion.iterations || [] });
  const output = args.output || path.join(args.artifactRoot, 'strict_1to1_gap_inventory_reduction.json');
  writeJson(output, reduction);
  console.log(JSON.stringify({ ok: reduction.runCreditOk, status: reduction.status, creditedGapCount: reduction.creditedGapCount, remainingGapCount: reduction.remainingGapCount, rejectedCreditCount: reduction.rejectedCreditCount, output }, null, 2));
  process.exit(reduction.runCreditOk ? 0 : 1);
}
