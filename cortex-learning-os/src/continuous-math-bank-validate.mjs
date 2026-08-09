#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

import { canonicalJson } from '../../plugins/cortex-learning-os-live/registry.mjs';
import { currentCommittedIdentity } from './git-product-source.mjs';
import { validateIndependentAssessmentBank } from './phd-assessment.mjs';
import { loadCanonicalPhdProgram } from './phd-program-runtime.mjs';

const [envelopeValue, contentValue, bankOutputValue, reportValue] = process.argv.slice(2);
if (![envelopeValue, contentValue, bankOutputValue, reportValue].every(Boolean)) {
  throw new Error('usage: continuous-math-bank-validate.mjs <signed-envelope> <commissioned-content> <bank-output> <report-output>');
}
const envelopePath = path.resolve(envelopeValue);
const contentPath = path.resolve(contentValue);
const bankOutputPath = path.resolve(bankOutputValue);
const reportPath = path.resolve(reportValue);
if (new Set([envelopePath, contentPath, bankOutputPath, reportPath]).size !== 4 || fs.existsSync(bankOutputPath) || fs.existsSync(reportPath)) {
  throw new Error('bank and report outputs must be fresh and distinct');
}
for (const [target, label] of [[envelopePath, 'envelope'], [contentPath, 'commissioned content']]) {
  const stat = fs.lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024 * 1024) throw new Error(`${label} is unsafe`);
}
const envelope = JSON.parse(fs.readFileSync(envelopePath, 'utf8'));
const content = JSON.parse(fs.readFileSync(contentPath, 'utf8'));
const identity = currentCommittedIdentity({ requireClean: true });
if (canonicalJson(envelope.source) !== canonicalJson(identity) || canonicalJson(content.source) !== canonicalJson(identity)) throw new Error('bank source differs from current exact commit');
const program = loadCanonicalPhdProgram({ sourceCommit: identity.sourceCommit, sourceTree: identity.sourceTree, productTree: identity.productTree });
if (!program.ok || !program.productionTrustReady) throw new Error(`canonical program is not ready: ${program.errors.join('; ')}`);
if (canonicalJson(program.trustPolicy) !== canonicalJson(envelope.trustPolicy)) throw new Error('bank trust policy differs from canonical source');
const validation = validateIndependentAssessmentBank(envelope.bank, {
  graph: program.graph,
  rubric: program.rubric,
  trustPolicy: program.trustPolicy,
  deployment: program.deployment,
  campaignBinding: envelope.bank.bindings.campaign,
});
if (!validation.ok) throw new Error(`signed bank validation failed: ${validation.errors.join('; ')}`);
if (content.schemaVersion !== 'cortex.learning_os.commissioned_assessment_content.v2'
    || content.campaignId !== envelope.bank.bankId
    || content.purpose !== envelope.bank.purpose
    || content.itemCount !== content.items.length
    || content.itemCount !== envelope.bank.items.length) throw new Error('commissioned content and signed bank identity/count differ');
const coverage = new Map();
const semanticFamilies = new Set();
for (let index = 0; index < content.items.length; index += 1) {
  const proposed = content.items[index];
  const signed = envelope.bank.items[index];
  const prompt = Buffer.from(signed.content.promptBase64, 'base64').toString('utf8');
  if (prompt !== proposed.prompt || signed.conceptId !== proposed.conceptId || signed.assessmentRole !== proposed.assessmentRole) {
    throw new Error(`signed item differs from accepted proposal at index ${index}`);
  }
  if (semanticFamilies.has(signed.semanticFamilyId)) throw new Error(`duplicate semantic family: ${signed.semanticFamilyId}`);
  semanticFamilies.add(signed.semanticFamilyId);
  const row = coverage.get(signed.conceptId) || {};
  row[signed.assessmentRole] = (row[signed.assessmentRole] || 0) + 1;
  coverage.set(signed.conceptId, row);
  if (signed.authorAttestation.authorityId === signed.reviewerAttestation.authorityId
      || signed.authorAttestation.signature.keyId === signed.reviewerAttestation.signature.keyId) throw new Error(`item authority independence collapsed: ${signed.itemId}`);
}
if (coverage.size !== content.conceptCount) throw new Error('bank concept coverage count mismatch');
for (const counts of coverage.values()) {
  for (const blueprint of content.itemBlueprints) {
    const expected = content.itemBlueprints.filter((row) => row.assessmentRole === blueprint.assessmentRole).length;
    if (counts[blueprint.assessmentRole] !== expected) throw new Error(`bank role coverage mismatch: ${blueprint.assessmentRole}`);
  }
}
if (envelope.bank.authorAttestation.authorityId === envelope.bank.reviewerAttestation.authorityId
    || envelope.bank.authorAttestation.signature.keyId === envelope.bank.reviewerAttestation.signature.keyId) throw new Error('bank authority independence collapsed');
const receipts = content.batchReceipts.flatMap((batch) => batch.receipts);
if (receipts.length < content.batchReceipts.length || receipts.some((receipt) => (
  receipt.authorThreadId === receipt.reviewerThreadId
  || Number(receipt.authorUsage?.input_tokens || 0) <= 0
  || Number(receipt.authorUsage?.output_tokens || 0) <= 0
  || Number(receipt.reviewerUsage?.input_tokens || 0) <= 0
  || Number(receipt.reviewerUsage?.output_tokens || 0) <= 0
))) throw new Error('role-separated provider receipts or positive usage are incomplete');
fs.mkdirSync(path.dirname(bankOutputPath), { recursive: true, mode: 0o700 });
fs.mkdirSync(path.dirname(reportPath), { recursive: true, mode: 0o700 });
fs.writeFileSync(bankOutputPath, `${JSON.stringify(envelope.bank, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
const report = {
  schemaVersion: 'cortex.learning_os.continuous_math_bank_validation_report.v1',
  status: 'green',
  validatedAt: new Date().toISOString(),
  source: identity,
  bankId: envelope.bank.bankId,
  purpose: envelope.bank.purpose,
  bankDigest: envelope.bank.bankDigest,
  bankPath: bankOutputPath,
  campaign: envelope.bank.bindings.campaign,
  trustBoundaryId: envelope.trustPolicy.boundaryId,
  conceptCount: coverage.size,
  itemCount: envelope.bank.items.length,
  roleCounts: Object.fromEntries([...new Set(envelope.bank.items.map((item) => item.assessmentRole))].sort().map((role) => [role, envelope.bank.items.filter((item) => item.assessmentRole === role).length])),
  providerCallCount: receipts.length * 2,
  providerInputTokens: receipts.reduce((sum, row) => sum + row.authorUsage.input_tokens + row.reviewerUsage.input_tokens, 0),
  providerOutputTokens: receipts.reduce((sum, row) => sum + row.authorUsage.output_tokens + row.reviewerUsage.output_tokens, 0),
  checks: {
    canonicalProgramValid: program.ok,
    productionTrustReady: program.productionTrustReady,
    exactTrustPolicy: true,
    signedBankValid: validation.ok,
    exactConceptAndRoleCoverage: true,
    uniqueSemanticFamilies: true,
    itemAuthorityIndependence: true,
    bankAuthorityIndependence: true,
    freshRoleSeparatedProviderSessions: true,
    positiveProviderUsage: true,
  },
  truthBoundary: `This report proves exact ${envelope.bank.purpose} bank schema, binding, signature, checker, coverage, and role-isolated machine author/reviewer mechanics. It proves no candidate result.`,
};
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
console.log(JSON.stringify(report, null, 2));
