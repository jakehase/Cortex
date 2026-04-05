import { createConsentExchangeWorkspace, summarizeConsentExchangeWorkspace, createConsentExchangeNarratives, createConsentExchangeCoverageGrid } from './domain-consent-exchange.mjs';
import { createConsentExchangePolicies, validateConsentExchangePolicies, summarizeConsentExchangePolicies, createConsentExchangeEscalationDeck } from './policies-consent-exchange.mjs';
import { createConsentExchangeAnalyticsTimeline, createConsentExchangeForecastEnvelope, createConsentExchangeExceptionLedger, summarizeConsentExchangeAnalytics } from './analytics-consent-exchange.mjs';
import { createConsentExchangeOperationsBoard, createConsentExchangeShiftChecklist, createConsentExchangeIncidentDeck } from './operations-consent-exchange.mjs';
import { createConsentExchangeReportCards, createConsentExchangeReviewPackets, summarizeConsentExchangeReporting } from './reporting-consent-exchange.mjs';
import { createConsentExchangeAuditTrail, createConsentExchangeEvidenceManifest, createConsentExchangeReadinessAttestation } from './audit-consent-exchange.mjs';
import { createConsentExchangePlaybooks, createConsentExchangeDecisionDeck, createConsentExchangeEscalationMoments } from './playbooks-consent-exchange.mjs';

export function buildConsentExchangeSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createConsentExchangeWorkspace(workspaceName);
  const policies = createConsentExchangePolicies();
  return {
    workspace,
    summary: summarizeConsentExchangeWorkspace(workspace),
    narratives: createConsentExchangeNarratives(workspace),
    coverage: createConsentExchangeCoverageGrid(workspace),
    policies,
    policySummary: summarizeConsentExchangePolicies(policies),
    validation: validateConsentExchangePolicies(policies),
    escalationDeck: createConsentExchangeEscalationDeck(policies),
    analytics: {
      timeline: createConsentExchangeAnalyticsTimeline(),
      forecast: createConsentExchangeForecastEnvelope(),
      exceptions: createConsentExchangeExceptionLedger(),
      summary: summarizeConsentExchangeAnalytics()
    },
    operations: {
      board: createConsentExchangeOperationsBoard(),
      checklist: createConsentExchangeShiftChecklist(),
      incidents: createConsentExchangeIncidentDeck()
    },
    reporting: {
      cards: createConsentExchangeReportCards(),
      packets: createConsentExchangeReviewPackets(),
      summary: summarizeConsentExchangeReporting()
    },
    audit: {
      trail: createConsentExchangeAuditTrail(),
      manifest: createConsentExchangeEvidenceManifest(),
      attestation: createConsentExchangeReadinessAttestation()
    },
    playbooks: createConsentExchangePlaybooks(),
    decisions: createConsentExchangeDecisionDeck(),
    escalationMoments: createConsentExchangeEscalationMoments()
  };
}

export function createConsentExchangeReadinessBoard(snapshot = buildConsentExchangeSnapshot()) {
  return [
    { id: 'consent-exchange-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'consent-exchange-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'consent-exchange-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'consent-exchange-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createConsentExchangeApiDocument(snapshot = buildConsentExchangeSnapshot()) {
  return {
    id: 'consent-exchange-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/consent-exchange/overview' },
      { method: 'GET', path: '/api/consent-exchange/reporting' },
      { method: 'POST', path: '/api/consent-exchange/validate' },
      { method: 'GET', path: '/api/consent-exchange/audit' }
    ],
    readiness: createConsentExchangeReadinessBoard(snapshot)
  };
}

export function createConsentExchangeRouteSummary(snapshot = buildConsentExchangeSnapshot()) {
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

