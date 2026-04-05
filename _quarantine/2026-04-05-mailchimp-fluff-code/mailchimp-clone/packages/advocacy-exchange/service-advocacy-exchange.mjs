import { createAdvocacyExchangeWorkspace, summarizeAdvocacyExchangeWorkspace, createAdvocacyExchangeNarratives, createAdvocacyExchangeCoverageGrid } from './domain-advocacy-exchange.mjs';
import { createAdvocacyExchangePolicies, validateAdvocacyExchangePolicies, summarizeAdvocacyExchangePolicies, createAdvocacyExchangeEscalationDeck } from './policies-advocacy-exchange.mjs';
import { createAdvocacyExchangeAnalyticsTimeline, createAdvocacyExchangeForecastEnvelope, createAdvocacyExchangeExceptionLedger, summarizeAdvocacyExchangeAnalytics } from './analytics-advocacy-exchange.mjs';
import { createAdvocacyExchangeOperationsBoard, createAdvocacyExchangeShiftChecklist, createAdvocacyExchangeIncidentDeck } from './operations-advocacy-exchange.mjs';
import { createAdvocacyExchangeReportCards, createAdvocacyExchangeReviewPackets, summarizeAdvocacyExchangeReporting } from './reporting-advocacy-exchange.mjs';
import { createAdvocacyExchangeAuditTrail, createAdvocacyExchangeEvidenceManifest, createAdvocacyExchangeReadinessAttestation } from './audit-advocacy-exchange.mjs';
import { createAdvocacyExchangePlaybooks, createAdvocacyExchangeDecisionDeck, createAdvocacyExchangeEscalationMoments } from './playbooks-advocacy-exchange.mjs';

export function buildAdvocacyExchangeSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAdvocacyExchangeWorkspace(workspaceName);
  const policies = createAdvocacyExchangePolicies();
  return {
    workspace,
    summary: summarizeAdvocacyExchangeWorkspace(workspace),
    narratives: createAdvocacyExchangeNarratives(workspace),
    coverage: createAdvocacyExchangeCoverageGrid(workspace),
    policies,
    policySummary: summarizeAdvocacyExchangePolicies(policies),
    validation: validateAdvocacyExchangePolicies(policies),
    escalationDeck: createAdvocacyExchangeEscalationDeck(policies),
    analytics: {
      timeline: createAdvocacyExchangeAnalyticsTimeline(),
      forecast: createAdvocacyExchangeForecastEnvelope(),
      exceptions: createAdvocacyExchangeExceptionLedger(),
      summary: summarizeAdvocacyExchangeAnalytics()
    },
    operations: {
      board: createAdvocacyExchangeOperationsBoard(),
      checklist: createAdvocacyExchangeShiftChecklist(),
      incidents: createAdvocacyExchangeIncidentDeck()
    },
    reporting: {
      cards: createAdvocacyExchangeReportCards(),
      packets: createAdvocacyExchangeReviewPackets(),
      summary: summarizeAdvocacyExchangeReporting()
    },
    audit: {
      trail: createAdvocacyExchangeAuditTrail(),
      manifest: createAdvocacyExchangeEvidenceManifest(),
      attestation: createAdvocacyExchangeReadinessAttestation()
    },
    playbooks: createAdvocacyExchangePlaybooks(),
    decisions: createAdvocacyExchangeDecisionDeck(),
    escalationMoments: createAdvocacyExchangeEscalationMoments()
  };
}

export function createAdvocacyExchangeReadinessBoard(snapshot = buildAdvocacyExchangeSnapshot()) {
  return [
    { id: 'advocacy-exchange-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'advocacy-exchange-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'advocacy-exchange-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'advocacy-exchange-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAdvocacyExchangeApiDocument(snapshot = buildAdvocacyExchangeSnapshot()) {
  return {
    id: 'advocacy-exchange-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/advocacy-exchange/overview' },
      { method: 'GET', path: '/api/advocacy-exchange/reporting' },
      { method: 'POST', path: '/api/advocacy-exchange/validate' },
      { method: 'GET', path: '/api/advocacy-exchange/audit' }
    ],
    readiness: createAdvocacyExchangeReadinessBoard(snapshot)
  };
}

export function createAdvocacyExchangeRouteSummary(snapshot = buildAdvocacyExchangeSnapshot()) {
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

