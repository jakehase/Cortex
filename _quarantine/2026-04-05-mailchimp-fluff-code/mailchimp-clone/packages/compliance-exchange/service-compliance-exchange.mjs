import { createComplianceExchangeWorkspace, summarizeComplianceExchangeWorkspace, createComplianceExchangeNarratives, createComplianceExchangeCoverageGrid } from './domain-compliance-exchange.mjs';
import { createComplianceExchangePolicies, validateComplianceExchangePolicies, summarizeComplianceExchangePolicies, createComplianceExchangeEscalationDeck } from './policies-compliance-exchange.mjs';
import { createComplianceExchangeAnalyticsTimeline, createComplianceExchangeForecastEnvelope, createComplianceExchangeExceptionLedger, summarizeComplianceExchangeAnalytics } from './analytics-compliance-exchange.mjs';
import { createComplianceExchangeOperationsBoard, createComplianceExchangeShiftChecklist, createComplianceExchangeIncidentDeck } from './operations-compliance-exchange.mjs';
import { createComplianceExchangeReportCards, createComplianceExchangeReviewPackets, summarizeComplianceExchangeReporting } from './reporting-compliance-exchange.mjs';
import { createComplianceExchangeAuditTrail, createComplianceExchangeEvidenceManifest, createComplianceExchangeReadinessAttestation } from './audit-compliance-exchange.mjs';
import { createComplianceExchangePlaybooks, createComplianceExchangeDecisionDeck, createComplianceExchangeEscalationMoments } from './playbooks-compliance-exchange.mjs';

export function buildComplianceExchangeSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createComplianceExchangeWorkspace(workspaceName);
  const policies = createComplianceExchangePolicies();
  return {
    workspace,
    summary: summarizeComplianceExchangeWorkspace(workspace),
    narratives: createComplianceExchangeNarratives(workspace),
    coverage: createComplianceExchangeCoverageGrid(workspace),
    policies,
    policySummary: summarizeComplianceExchangePolicies(policies),
    validation: validateComplianceExchangePolicies(policies),
    escalationDeck: createComplianceExchangeEscalationDeck(policies),
    analytics: {
      timeline: createComplianceExchangeAnalyticsTimeline(),
      forecast: createComplianceExchangeForecastEnvelope(),
      exceptions: createComplianceExchangeExceptionLedger(),
      summary: summarizeComplianceExchangeAnalytics()
    },
    operations: {
      board: createComplianceExchangeOperationsBoard(),
      checklist: createComplianceExchangeShiftChecklist(),
      incidents: createComplianceExchangeIncidentDeck()
    },
    reporting: {
      cards: createComplianceExchangeReportCards(),
      packets: createComplianceExchangeReviewPackets(),
      summary: summarizeComplianceExchangeReporting()
    },
    audit: {
      trail: createComplianceExchangeAuditTrail(),
      manifest: createComplianceExchangeEvidenceManifest(),
      attestation: createComplianceExchangeReadinessAttestation()
    },
    playbooks: createComplianceExchangePlaybooks(),
    decisions: createComplianceExchangeDecisionDeck(),
    escalationMoments: createComplianceExchangeEscalationMoments()
  };
}

export function createComplianceExchangeReadinessBoard(snapshot = buildComplianceExchangeSnapshot()) {
  return [
    { id: 'compliance-exchange-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'compliance-exchange-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'compliance-exchange-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'compliance-exchange-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createComplianceExchangeApiDocument(snapshot = buildComplianceExchangeSnapshot()) {
  return {
    id: 'compliance-exchange-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/compliance-exchange/overview' },
      { method: 'GET', path: '/api/compliance-exchange/reporting' },
      { method: 'POST', path: '/api/compliance-exchange/validate' },
      { method: 'GET', path: '/api/compliance-exchange/audit' }
    ],
    readiness: createComplianceExchangeReadinessBoard(snapshot)
  };
}

export function createComplianceExchangeRouteSummary(snapshot = buildComplianceExchangeSnapshot()) {
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

