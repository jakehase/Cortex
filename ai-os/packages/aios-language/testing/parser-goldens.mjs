import { compileMailchimpStatusContract } from '../api/status-api.mjs';

const MAILCHIMP_STATUS_SOURCES = Object.freeze([
  Object.freeze({
    name: 'healthy-list-status-runtime-handoff',
    source: Object.freeze({
      provider: Object.freeze({ accountId: 'golden-account', region: 'us19' }),
      state: 'healthy',
      capabilities: Object.freeze(['listStatus']),
      sync: Object.freeze({
        cursor: 'golden-cursor-healthy',
        sourceUpdatedAt: '2026-07-03T08:00:00.000Z',
        batchSize: 50,
      }),
      runtime: Object.freeze({
        requestId: 'golden-request-healthy',
        sessionId: 'golden-session',
        actorId: 'golden-actor',
        workflowId: 'golden-workflow',
        continuationId: 'golden-continuation',
        surface: 'mailchimp-status-panel',
      }),
    }),
  }),
  Object.freeze({
    name: 'recovering-webhook-status-runtime-handoff',
    source: Object.freeze({
      provider: Object.freeze({ accountId: 'golden-account', region: 'us19' }),
      status: 'recovering',
      requestedCapabilities: Object.freeze(['webhookHealth', 'unknownCapability']),
      syncMetadata: Object.freeze({
        syncCursor: 'golden-cursor-recovery',
        retryAfterSeconds: 45,
        lastChangedAt: '2026-07-03T08:15:00.000Z',
      }),
      requestContext: Object.freeze({
        requestId: 'golden-request-recovery',
        sessionId: 'golden-session',
        workflowId: 'golden-workflow',
        continuationId: 'golden-continuation-recovery',
        intent: 'recover-webhook-status',
      }),
    }),
  }),
]);

function goldenProjection(entry) {
  const contract = compileMailchimpStatusContract(entry.source);
  return Object.freeze({
    name: entry.name,
    contractId: contract.contractId,
    state: contract.state,
    acceptedCapabilities: contract.capabilities.accepted,
    rejectedCapabilities: contract.capabilities.rejected.map((item) => item.capability),
    readiness: contract.readiness.status,
    runtimeResumeAction: contract.runtimeHandoff.workflow.resumeAction,
    runtimeResumeToken: contract.runtimeHandoff.resumeToken,
    nextStepIds: contract.nextSteps.map((step) => step.id),
    validationBadge: contract.preview.validationBadge,
  });
}

export function listMailchimpParserGoldens() {
  return Object.freeze(MAILCHIMP_STATUS_SOURCES.map(goldenProjection));
}

export function findMailchimpParserGolden(name) {
  const token = String(name ?? '').trim();
  return listMailchimpParserGoldens().find((golden) => golden.name === token) || null;
}

export function selfCheckMailchimpParserGoldens() {
  const goldens = listMailchimpParserGoldens();
  return Object.freeze({
    pass: goldens.length === 2
      && goldens[0].runtimeResumeAction === 'resume-mailchimp-status-workflow'
      && goldens[1].readiness === 'recovery-ready'
      && goldens[1].rejectedCapabilities.includes('unknownCapability'),
    goldenCount: goldens.length,
    contractIds: goldens.map((golden) => golden.contractId),
  });
}

export const mailchimpParserGoldens = Object.freeze({
  sources: MAILCHIMP_STATUS_SOURCES,
  list: listMailchimpParserGoldens,
  find: findMailchimpParserGolden,
  selfCheck: selfCheckMailchimpParserGoldens,
});

export default mailchimpParserGoldens;
