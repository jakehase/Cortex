import { compileMailchimpStatusContract } from './status-api.mjs';

const CLAIM_CONTRACT_VERSION = 'aios.claim-api.v1';
const DEFAULT_ISSUER = 'aios.mailchimp.claims';

const CLAIM_STATES = new Set([
  'asserted',
  'pending-recovery',
  'blocked',
  'retracted',
]);

function asRecord(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  return value;
}

function cleanToken(value) {
  return String(value ?? '').trim();
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function hashClaim(value) {
  const text = stableStringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `mc-claim-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function normalizeClaimOptions(options = {}) {
  const raw = options && typeof options === 'object' ? options : {};
  const issuer = cleanToken(raw.issuer || raw.issuedBy || DEFAULT_ISSUER);
  const audience = cleanToken(raw.audience || raw.targetAudience || 'aios-runtime');
  const issuedAt = cleanToken(raw.issuedAt || raw.observedAt || '');
  const expiresAt = cleanToken(raw.expiresAt || '');
  const includeRecoveryEvidence = raw.includeRecoveryEvidence !== false;
  const requireReadyStatus = raw.requireReadyStatus === true;
  return Object.freeze({
    issuer,
    audience,
    issuedAt: issuedAt || null,
    expiresAt: expiresAt || null,
    includeRecoveryEvidence,
    requireReadyStatus,
  });
}

function claimStateForStatus(statusContract, options) {
  if (statusContract.validationSummary.blockingCount > 0) {
    return 'blocked';
  }
  if (statusContract.acceptance.recoveryAccepted) {
    return 'pending-recovery';
  }
  if (options.requireReadyStatus && !statusContract.readiness.ready) {
    return 'blocked';
  }
  return statusContract.acceptance.previewAccepted ? 'asserted' : 'blocked';
}

function buildClaimValidation(statusContract, claimState, options) {
  const issues = [];
  if (!CLAIM_STATES.has(claimState)) {
    issues.push({
      severity: 'blocking',
      code: 'unknown_claim_state',
      field: 'state',
      message: 'Claim state could not be mapped to a deterministic Mailchimp status claim state.',
    });
  }
  if (options.requireReadyStatus && !statusContract.readiness.ready) {
    issues.push({
      severity: 'blocking',
      code: 'status_not_ready',
      field: 'status.readiness',
      message: 'Claim issuance requires a ready or recovery-ready Mailchimp status contract.',
    });
  }
  if (statusContract.validationSummary.blockingCount > 0) {
    for (const issue of statusContract.validationSummary.issues) {
      if (issue.severity === 'blocking') {
        issues.push({
          severity: 'blocking',
          code: `status_${issue.code}`,
          field: `status.${issue.field}`,
          message: issue.message,
        });
      }
    }
  }
  if (statusContract.capabilities.rejected.length > 0) {
    issues.push({
      severity: 'warning',
      code: 'partial_capability_claim',
      field: 'status.capabilities.rejected',
      message: 'Claim will preserve rejected Mailchimp capabilities as non-blocking evidence.',
    });
  }
  const blockingCount = issues.filter((issue) => issue.severity === 'blocking').length;
  const warningCount = issues.filter((issue) => issue.severity === 'warning').length;
  return Object.freeze({
    pass: blockingCount === 0,
    blockingCount,
    warningCount,
    issueCount: issues.length,
    issues: Object.freeze(issues),
  });
}

function buildEvidence(statusContract, options) {
  const baseEvidence = {
    statusContractId: statusContract.contractId,
    provider: statusContract.provider,
    state: statusContract.state,
    readiness: statusContract.readiness,
    acceptedCapabilities: statusContract.capabilities.accepted,
    rejectedCapabilities: statusContract.capabilities.rejected,
    verifier: statusContract.verifierSummary,
    sync: statusContract.syncMetadata,
    runtime: statusContract.runtimeHandoff,
  };
  if (!options.includeRecoveryEvidence) {
    return Object.freeze(baseEvidence);
  }
  return Object.freeze({
    ...baseEvidence,
    recovery: Object.freeze({
      eligible: statusContract.kernelJob.recovery.eligible,
      handoffReason: statusContract.kernelJob.recovery.handoffReason,
      retryAfterSeconds: statusContract.kernelJob.recovery.retryAfterSeconds,
      resumeToken: statusContract.runtimeHandoff.resumeToken,
    }),
  });
}

function buildClaimRecords(statusContract, options, claimState, evidence) {
  const subject = `${statusContract.provider.id}:${statusContract.provider.accountId}`;
  const statusClaim = {
    type: 'mailchimp.status.claim',
    subject,
    predicate: statusContract.state,
    state: claimState,
    issuer: options.issuer,
    audience: options.audience,
    issuedAt: options.issuedAt,
    expiresAt: options.expiresAt,
    evidence,
  };
  const runtimeClaim = {
    type: 'mailchimp.runtime-handoff.claim',
    subject: evidence.runtime.resumeToken,
    predicate: evidence.runtime.workflow.resumeAction,
    state: claimState === 'blocked' ? 'blocked' : 'asserted',
    issuer: options.issuer,
    audience: options.audience,
    issuedAt: options.issuedAt,
    expiresAt: options.expiresAt,
    evidence: {
      statusContractId: statusContract.contractId,
      request: evidence.runtime.request,
      client: evidence.runtime.client,
      workflow: evidence.runtime.workflow,
      userVisible: evidence.runtime.userVisible,
    },
  };
  return Object.freeze([statusClaim, runtimeClaim].map((claim) => Object.freeze({
    ...claim,
    claimId: hashClaim({
      audience: claim.audience,
      evidence: claim.evidence,
      issuer: claim.issuer,
      predicate: claim.predicate,
      state: claim.state,
      subject: claim.subject,
      type: claim.type,
    }),
  })));
}

function buildClaimLedger(statusContract, claims, validation) {
  const acceptedClaims = claims.filter((claim) => claim.state !== 'blocked');
  const blockedClaims = claims.filter((claim) => claim.state === 'blocked');
  return Object.freeze({
    ledgerId: hashClaim({
      claims: claims.map((claim) => claim.claimId),
      statusContractId: statusContract.contractId,
      validationPass: validation.pass,
    }),
    statusContractId: statusContract.contractId,
    appendOnly: true,
    acceptedClaimIds: Object.freeze(acceptedClaims.map((claim) => claim.claimId)),
    blockedClaimIds: Object.freeze(blockedClaims.map((claim) => claim.claimId)),
    nextAction: validation.pass
      ? statusContract.runtimeHandoff.workflow.resumeAction
      : 'show-mailchimp-claim-review',
  });
}

export function compileMailchimpClaimContract(source = {}, options = {}) {
  const input = asRecord(source, 'source');
  const claimOptions = normalizeClaimOptions(options);
  const statusContract = input.contractVersion === 'aios.status-api.v1'
    ? input
    : compileMailchimpStatusContract(input);
  const state = claimStateForStatus(statusContract, claimOptions);
  const evidence = buildEvidence(statusContract, claimOptions);
  const validation = buildClaimValidation(statusContract, state, claimOptions);
  const claims = buildClaimRecords(statusContract, claimOptions, state, evidence);
  const ledger = buildClaimLedger(statusContract, claims, validation);
  const contract = {
    contractVersion: CLAIM_CONTRACT_VERSION,
    state,
    statusContractId: statusContract.contractId,
    options: claimOptions,
    validation,
    evidence,
    claims,
    ledger,
  };
  return Object.freeze({
    ...contract,
    contractId: hashClaim(contract),
  });
}

export function previewMailchimpClaimContract(source = {}, options = {}) {
  const contract = compileMailchimpClaimContract(source, options);
  return Object.freeze({
    contractId: contract.contractId,
    state: contract.state,
    validation: contract.validation,
    ledger: contract.ledger,
    claims: contract.claims.map((claim) => Object.freeze({
      claimId: claim.claimId,
      type: claim.type,
      subject: claim.subject,
      predicate: claim.predicate,
      state: claim.state,
    })),
  });
}

export function selfCheckMailchimpClaimApi() {
  const contract = compileMailchimpClaimContract({
    provider: { accountId: 'claim-self-check' },
    state: 'recovering',
    capabilities: ['listStatus', 'webhookHealth'],
    sync: { cursor: 'claim-cursor', retryAfterSeconds: 15 },
    runtime: {
      requestId: 'claim-request',
      sessionId: 'claim-session',
      workflowId: 'claim-workflow',
      continuationId: 'claim-continuation',
    },
  }, {
    issuedAt: '2026-07-03T00:00:00.000Z',
    requireReadyStatus: true,
  });
  return Object.freeze({
    pass: contract.state === 'pending-recovery'
      && contract.validation.pass
      && contract.claims.length === 2
      && contract.ledger.acceptedClaimIds.length === 2
      && contract.ledger.nextAction === 'resume-mailchimp-status-workflow',
    contractId: contract.contractId,
    ledgerId: contract.ledger.ledgerId,
    claimIds: contract.claims.map((claim) => claim.claimId),
    state: contract.state,
  });
}

export const mailchimpClaimApi = Object.freeze({
  compile: compileMailchimpClaimContract,
  preview: previewMailchimpClaimContract,
  selfCheck: selfCheckMailchimpClaimApi,
});

export default mailchimpClaimApi;
