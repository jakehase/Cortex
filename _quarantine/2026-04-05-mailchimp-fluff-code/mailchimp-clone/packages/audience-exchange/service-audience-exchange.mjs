import { createAudienceExchangeWorkspace, summarizeAudienceExchangeWorkspace, createAudienceExchangeNarratives, createAudienceExchangeCoverageGrid } from './domain-audience-exchange.mjs';
import { createAudienceExchangePolicies, validateAudienceExchangePolicies, summarizeAudienceExchangePolicies, createAudienceExchangeEscalationDeck } from './policies-audience-exchange.mjs';
import { createAudienceExchangeAnalyticsTimeline, createAudienceExchangeForecastEnvelope, createAudienceExchangeExceptionLedger, summarizeAudienceExchangeAnalytics } from './analytics-audience-exchange.mjs';
import { createAudienceExchangeOperationsBoard, createAudienceExchangeShiftChecklist, createAudienceExchangeIncidentDeck } from './operations-audience-exchange.mjs';
import { createAudienceExchangeReportCards, createAudienceExchangeReviewPackets, summarizeAudienceExchangeReporting } from './reporting-audience-exchange.mjs';
import { createAudienceExchangeAuditTrail, createAudienceExchangeEvidenceManifest, createAudienceExchangeReadinessAttestation } from './audit-audience-exchange.mjs';
import { createAudienceExchangePlaybooks, createAudienceExchangeDecisionDeck, createAudienceExchangeEscalationMoments } from './playbooks-audience-exchange.mjs';

export function buildAudienceExchangeSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAudienceExchangeWorkspace(workspaceName);
  const policies = createAudienceExchangePolicies();
  return {
    workspace,
    summary: summarizeAudienceExchangeWorkspace(workspace),
    narratives: createAudienceExchangeNarratives(workspace),
    coverage: createAudienceExchangeCoverageGrid(workspace),
    policies,
    policySummary: summarizeAudienceExchangePolicies(policies),
    validation: validateAudienceExchangePolicies(policies),
    escalationDeck: createAudienceExchangeEscalationDeck(policies),
    analytics: {
      timeline: createAudienceExchangeAnalyticsTimeline(),
      forecast: createAudienceExchangeForecastEnvelope(),
      exceptions: createAudienceExchangeExceptionLedger(),
      summary: summarizeAudienceExchangeAnalytics()
    },
    operations: {
      board: createAudienceExchangeOperationsBoard(),
      checklist: createAudienceExchangeShiftChecklist(),
      incidents: createAudienceExchangeIncidentDeck()
    },
    reporting: {
      cards: createAudienceExchangeReportCards(),
      packets: createAudienceExchangeReviewPackets(),
      summary: summarizeAudienceExchangeReporting()
    },
    audit: {
      trail: createAudienceExchangeAuditTrail(),
      manifest: createAudienceExchangeEvidenceManifest(),
      attestation: createAudienceExchangeReadinessAttestation()
    },
    playbooks: createAudienceExchangePlaybooks(),
    decisions: createAudienceExchangeDecisionDeck(),
    escalationMoments: createAudienceExchangeEscalationMoments()
  };
}

export function createAudienceExchangeReadinessBoard(snapshot = buildAudienceExchangeSnapshot()) {
  return [
    { id: 'audience-exchange-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'audience-exchange-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'audience-exchange-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'audience-exchange-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAudienceExchangeApiDocument(snapshot = buildAudienceExchangeSnapshot()) {
  return {
    id: 'audience-exchange-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/audience-exchange/overview' },
      { method: 'GET', path: '/api/audience-exchange/reporting' },
      { method: 'POST', path: '/api/audience-exchange/validate' },
      { method: 'GET', path: '/api/audience-exchange/audit' }
    ],
    readiness: createAudienceExchangeReadinessBoard(snapshot)
  };
}

export function createAudienceExchangeRouteSummary(snapshot = buildAudienceExchangeSnapshot()) {
  return {
    id: snapshot.workspace.id,
    title: snapshot.summary.title,
    focus: snapshot.workspace.focus,
    groupTitle: snapshot.summary.groupTitle,
    metricCount: snapshot.summary.metricCount,
    policyCount: snapshot.policySummary.total,
    executiveCards: snapshot.reporting.summary.executiveCards
  };
}

