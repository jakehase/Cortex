#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { canonicalJson } from '../../plugins/cortex-learning-os-live/registry.mjs';
import {
  independentAssessmentAttestationPayload,
  independentAssessmentBankAttestationPayload,
  independentAssessmentBankDigest,
} from './phd-assessment.mjs';
import { verifyAuthorityAttestation } from './phd-trust.mjs';

const [role, inputValue, outputValue, privateKeyValue] = process.argv.slice(2);
if (![role, inputValue, outputValue, privateKeyValue].every(Boolean)
    || !['item-author', 'item-reviewer', 'bank-author', 'bank-reviewer'].includes(role)) {
  throw new Error('usage: continuous-math-bank-sign.mjs <item-author|item-reviewer|bank-author|bank-reviewer> <input> <output> <private-key>');
}
const inputPath = path.resolve(inputValue);
const outputPath = path.resolve(outputValue);
const privateKeyPath = path.resolve(privateKeyValue);
if (inputPath === outputPath || fs.existsSync(outputPath)) throw new Error('signer requires a fresh distinct output');
for (const [target, label] of [[inputPath, 'input'], [privateKeyPath, 'private key']]) {
  const stat = fs.lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular non-symlink file`);
  if (label === 'private key' && (stat.mode & 0o077) !== 0) throw new Error('private key must be owner-only');
}
const envelope = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const bank = envelope.bank;
const trustPolicy = envelope.trustPolicy;
const capability = role.includes('author') ? 'bank_authoring' : 'bank_review';
const authority = trustPolicy?.authorities?.find((row) => row.capabilities.length === 1 && row.capabilities[0] === capability);
if (!authority) throw new Error(`missing unique ${capability} authority`);
const privateKey = crypto.createPrivateKey(fs.readFileSync(privateKeyPath));
const derivedPublicPem = crypto.createPublicKey(privateKey).export({ format: 'pem', type: 'spki' }).toString();
if (derivedPublicPem !== authority.publicKeyPem) throw new Error(`${role} private key does not match committed authority`);
function attest(attestationId, payload) {
  const core = { schemaVersion: 'cortex.learning_os.authority_attestation.v1', attestationId, authorityId: authority.authorityId, payload };
  return {
    ...core,
    signature: { algorithm: 'ed25519', keyId: authority.keyId, valueBase64: crypto.sign(null, Buffer.from(canonicalJson(core), 'utf8'), privateKey).toString('base64') },
  };
}
if (role === 'item-author') {
  if (bank.items.some((item) => item.authorAttestation !== null || item.reviewerAttestation !== null)
      || bank.bankDigest !== null || bank.authorAttestation !== null || bank.reviewerAttestation !== null) throw new Error('item-author input is not unsigned');
  for (const item of bank.items) {
    item.authorAttestation = attest(`item-author-${item.contentDigest.slice(0, 32)}`, independentAssessmentAttestationPayload(item, 'author'));
    if (!verifyAuthorityAttestation(item.authorAttestation, { trustPolicy, capability })) throw new Error(`item author signature failed: ${item.itemId}`);
  }
} else if (role === 'item-reviewer') {
  if (bank.items.some((item) => item.authorAttestation === null || item.reviewerAttestation !== null)
      || bank.bankDigest !== null || bank.authorAttestation !== null || bank.reviewerAttestation !== null) throw new Error('item-reviewer sequencing is invalid');
  for (const item of bank.items) {
    if (!verifyAuthorityAttestation(item.authorAttestation, { trustPolicy, capability: 'bank_authoring' })) throw new Error(`item author signature invalid: ${item.itemId}`);
    item.reviewerAttestation = attest(`item-review-${item.contentDigest.slice(0, 32)}`, independentAssessmentAttestationPayload(item, 'reviewer'));
    if (!verifyAuthorityAttestation(item.reviewerAttestation, { trustPolicy, capability })) throw new Error(`item reviewer signature failed: ${item.itemId}`);
  }
} else if (role === 'bank-author') {
  if (bank.items.some((item) => item.authorAttestation === null || item.reviewerAttestation === null)
      || bank.bankDigest !== null || bank.authorAttestation !== null || bank.reviewerAttestation !== null) throw new Error('bank-author sequencing is invalid');
  bank.bankDigest = independentAssessmentBankDigest(bank);
  bank.authorAttestation = attest(`bank-author-${bank.bankDigest.slice(0, 32)}`, independentAssessmentBankAttestationPayload(bank, 'author'));
  if (!verifyAuthorityAttestation(bank.authorAttestation, { trustPolicy, capability })) throw new Error('bank author signature failed');
} else {
  if (bank.items.some((item) => item.authorAttestation === null || item.reviewerAttestation === null)
      || bank.bankDigest !== independentAssessmentBankDigest(bank)
      || bank.authorAttestation === null || bank.reviewerAttestation !== null) throw new Error('bank-reviewer sequencing is invalid');
  if (!verifyAuthorityAttestation(bank.authorAttestation, { trustPolicy, capability: 'bank_authoring' })) throw new Error('bank author signature invalid');
  bank.reviewerAttestation = attest(`bank-review-${bank.bankDigest.slice(0, 32)}`, independentAssessmentBankAttestationPayload(bank, 'reviewer'));
  if (!verifyAuthorityAttestation(bank.reviewerAttestation, { trustPolicy, capability })) throw new Error('bank reviewer signature failed');
}
envelope.signingHistory = [...(envelope.signingHistory || []), { role, capability, authorityId: authority.authorityId, keyId: authority.keyId, signedAt: new Date().toISOString() }];
fs.mkdirSync(path.dirname(outputPath), { recursive: true, mode: 0o700 });
fs.writeFileSync(outputPath, `${JSON.stringify(envelope, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
console.log(JSON.stringify({ ok: true, role, outputPath, authorityId: authority.authorityId, keyId: authority.keyId, itemCount: bank.items.length, bankDigest: bank.bankDigest }, null, 2));
