import { compileMailchimpClaimContract } from '../api/claim-api.mjs';
import { compileMailchimpStatusContract } from '../api/status-api.mjs';

const MAILCHIMP_COMPILER_GOLDEN_INPUTS = Object.freeze([
  Object.freeze({
    name: 'status-to-claim-ready-ledger',
    statusSource: Object.freeze({
      provider: Object.freeze({ accountId: 'compiler-ready-account', region: 'us20' }),
      providerState: 'healthy',
      capabilities: Object.freeze(['campaignStatus', 'listStatus']),
      sync: Object.freeze({
        cursor: 'compiler-ready-cursor',
        sourceUpdatedAt: '2026-07-03T09:00:00.000Z',
      }),
      runtime: Object.freeze({
        requestId: 'compiler-ready-request',
        sessionId: 'compiler-session',
        workflowId: 'compiler-workflow',
        continuationId: 'compiler-ready-continuation',
      }),
    }),
    claimOptions: Object.freeze({
      issuedAt: '2026-07-03T09:01:00.000Z',
      requireReadyStatus: true,
    }),
  }),
  Object.freeze({
    name: 'status-to-claim-recovery-ledger',
    statusSource: Object.freeze({
      provider: Object.freeze({ accountId: 'compiler-recovery-account', region: 'us20' }),
      state: 'degraded',
      requestedCapabilities: Object.freeze(['automationStatus']),
      syncMetadata: Object.freeze({
        cursor: 'compiler-recovery-cursor',
        retryAfterSeconds: 90,
      }),
      clientRuntime: Object.freeze({
        requestId: 'compiler-recovery-request',
        sessionId: 'compiler-session',
        workflowId: 'compiler-workflow',
        continuationId: 'compiler-recovery-continuation',
        intent: 'continue-automation-recovery',
      }),
    }),
    claimOptions: Object.freeze({
      issuedAt: '2026-07-03T09:02:00.000Z',
      requireReadyStatus: true,
    }),
  }),
]);

function compileGolden(entry) {
  const status = compileMailchimpStatusContract(entry.statusSource);
  const claim = compileMailchimpClaimContract(status, entry.claimOptions);
  return Object.freeze({
    name: entry.name,
    statusContractId: status.contractId,
    claimContractId: claim.contractId,
    statusReadiness: status.readiness.status,
    claimState: claim.state,
    ledgerId: claim.ledger.ledgerId,
    ledgerNextAction: claim.ledger.nextAction,
    acceptedClaimIds: claim.ledger.acceptedClaimIds,
    blockedClaimIds: claim.ledger.blockedClaimIds,
    resumeToken: status.runtimeHandoff.resumeToken,
  });
}

export function listMailchimpCompilerGoldens() {
  return Object.freeze(MAILCHIMP_COMPILER_GOLDEN_INPUTS.map(compileGolden));
}

export function findMailchimpCompilerGolden(name) {
  const token = String(name ?? '').trim();
  return listMailchimpCompilerGoldens().find((golden) => golden.name === token) || null;
}

export function selfCheckMailchimpCompilerGoldens() {
  const goldens = listMailchimpCompilerGoldens();
  return Object.freeze({
    pass: goldens.length === 2
      && goldens[0].claimState === 'asserted'
      && goldens[0].acceptedClaimIds.length === 2
      && goldens[1].claimState === 'pending-recovery'
      && goldens[1].ledgerNextAction === 'resume-mailchimp-status-workflow',
    goldenCount: goldens.length,
    claimContractIds: goldens.map((golden) => golden.claimContractId),
  });
}

export const mailchimpCompilerGoldens = Object.freeze({
  inputs: MAILCHIMP_COMPILER_GOLDEN_INPUTS,
  list: listMailchimpCompilerGoldens,
  find: findMailchimpCompilerGolden,
  selfCheck: selfCheckMailchimpCompilerGoldens,
});

export default mailchimpCompilerGoldens;
