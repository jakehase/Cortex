import crypto from 'node:crypto';

import { canonicalJson } from '../../plugins/cortex-learning-os-live/registry.mjs';
import { atomicWriteAuthenticatedJson } from './authenticated-file-publication.mjs';
import { sha256Text } from './hash.mjs';

const DIGEST = /^[0-9a-f]{64}$/;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactObjectKeys(value, expected) {
  return isRecord(value)
    && Object.keys(value).sort().join(',') === [...expected].sort().join(',');
}

export function verifySignedControlPlaneRecord(record, signingSecret) {
  const signature = record?.controlPlaneSignature;
  if (typeof signingSecret !== 'string'
      || signingSecret.length < 32
      || !exactObjectKeys(signature, ['algorithm', 'digest', 'keyId'])
      || signature.algorithm !== 'hmac-sha256'
      || signature.keyId !== sha256Text(signingSecret).slice(0, 16)
      || !DIGEST.test(String(signature.digest || ''))) {
    return false;
  }
  try {
    const {
      controlPlaneSignature: _signature,
      ...payload
    } = record;
    const expected = crypto.createHmac('sha256', signingSecret)
      .update(canonicalJson(payload))
      .digest();
    const actual = Buffer.from(signature.digest, 'hex');
    return actual.length === expected.length
      && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function atomicWriteSignedControlPlaneRecord(
  targetPath,
  record,
  signingSecret,
  {
    authenticate = null,
    crashInjector = null,
    fixtureOnly = false,
  } = {},
) {
  if (authenticate !== null && typeof authenticate !== 'function') {
    throw new Error('signed control-plane publication authenticator is invalid');
  }
  return atomicWriteAuthenticatedJson(targetPath, record, {
    authenticate: (candidate) => (
      verifySignedControlPlaneRecord(candidate, signingSecret)
      && (authenticate === null || authenticate(candidate) === true)
    ),
    crashInjector,
    fixtureOnly,
  });
}
