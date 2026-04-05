import { createAutomationExchangeWorkspace, summarizeAutomationExchangeWorkspace, createAutomationExchangeNarratives, createAutomationExchangeCoverageGrid } from './domain-automation-exchange.mjs';
import { createAutomationExchangePolicies, validateAutomationExchangePolicies, summarizeAutomationExchangePolicies, createAutomationExchangeEscalationDeck } from './policies-automation-exchange.mjs';
import { createAutomationExchangeAnalyticsTimeline, createAutomationExchangeForecastEnvelope, createAutomationExchangeExceptionLedger, summarizeAutomationExchangeAnalytics } from './analytics-automation-exchange.mjs';
import { createAutomationExchangeOperationsBoard, createAutomationExchangeShiftChecklist, createAutomationExchangeIncidentDeck } from './operations-automation-exchange.mjs';
import { createAutomationExchangeReportCards, createAutomationExchangeReviewPackets, summarizeAutomationExchangeReporting } from './reporting-automation-exchange.mjs';
import { createAutomationExchangeAuditTrail, createAutomationExchangeEvidenceManifest, createAutomationExchangeReadinessAttestation } from './audit-automation-exchange.mjs';
import { createAutomationExchangePlaybooks, createAutomationExchangeDecisionDeck, createAutomationExchangeEscalationMoments } from './playbooks-automation-exchange.mjs';

export function buildAutomationExchangeSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAutomationExchangeWorkspace(workspaceName);
  const policies = createAutomationExchangePolicies();
  return {
    workspace,
    summary: summarizeAutomationExchangeWorkspace(workspace),
    narratives: createAutomationExchangeNarratives(workspace),
    coverage: createAutomationExchangeCoverageGrid(workspace),
    policies,
    policySummary: summarizeAutomationExchangePolicies(policies),
    validation: validateAutomationExchangePolicies(policies),
    escalationDeck: createAutomationExchangeEscalationDeck(policies),
    analytics: {
      timeline: createAutomationExchangeAnalyticsTimeline(),
      forecast: createAutomationExchangeForecastEnvelope(),
      exceptions: createAutomationExchangeExceptionLedger(),
      summary: summarizeAutomationExchangeAnalytics()
    },
    operations: {
      board: createAutomationExchangeOperationsBoard(),
      checklist: createAutomationExchangeShiftChecklist(),
      incidents: createAutomationExchangeIncidentDeck()
    },
    reporting: {
      cards: createAutomationExchangeReportCards(),
      packets: createAutomationExchangeReviewPackets(),
      summary: summarizeAutomationExchangeReporting()
    },
    audit: {
      trail: createAutomationExchangeAuditTrail(),
      manifest: createAutomationExchangeEvidenceManifest(),
      attestation: createAutomationExchangeReadinessAttestation()
    },
    playbooks: createAutomationExchangePlaybooks(),
    decisions: createAutomationExchangeDecisionDeck(),
    escalationMoments: createAutomationExchangeEscalationMoments()
  };
}

export function createAutomationExchangeReadinessBoard(snapshot = buildAutomationExchangeSnapshot()) {
  return [
    { id: 'automation-exchange-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'automation-exchange-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'automation-exchange-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'automation-exchange-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAutomationExchangeApiDocument(snapshot = buildAutomationExchangeSnapshot()) {
  return {
    id: 'automation-exchange-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/automation-exchange/overview' },
      { method: 'GET', path: '/api/automation-exchange/reporting' },
      { method: 'POST', path: '/api/automation-exchange/validate' },
      { method: 'GET', path: '/api/automation-exchange/audit' }
    ],
    readiness: createAutomationExchangeReadinessBoard(snapshot)
  };
}

export function createAutomationExchangeRouteSummary(snapshot = buildAutomationExchangeSnapshot()) {
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

