import { createCustomerSentinelWorkspace, summarizeCustomerSentinelWorkspace, createCustomerSentinelNarratives, createCustomerSentinelCoverageGrid } from './domain-customer-sentinel.mjs';
import { createCustomerSentinelPolicies, validateCustomerSentinelPolicies, summarizeCustomerSentinelPolicies, createCustomerSentinelEscalationDeck } from './policies-customer-sentinel.mjs';
import { createCustomerSentinelAnalyticsTimeline, createCustomerSentinelForecastEnvelope, createCustomerSentinelExceptionLedger, summarizeCustomerSentinelAnalytics } from './analytics-customer-sentinel.mjs';
import { createCustomerSentinelOperationsBoard, createCustomerSentinelShiftChecklist, createCustomerSentinelIncidentDeck } from './operations-customer-sentinel.mjs';
import { createCustomerSentinelReportCards, createCustomerSentinelReviewPackets, summarizeCustomerSentinelReporting } from './reporting-customer-sentinel.mjs';
import { createCustomerSentinelAuditTrail, createCustomerSentinelEvidenceManifest, createCustomerSentinelReadinessAttestation } from './audit-customer-sentinel.mjs';
import { createCustomerSentinelPlaybooks, createCustomerSentinelDecisionDeck, createCustomerSentinelEscalationMoments } from './playbooks-customer-sentinel.mjs';

export function buildCustomerSentinelSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCustomerSentinelWorkspace(workspaceName);
  const policies = createCustomerSentinelPolicies();
  return {
    workspace,
    summary: summarizeCustomerSentinelWorkspace(workspace),
    narratives: createCustomerSentinelNarratives(workspace),
    coverage: createCustomerSentinelCoverageGrid(workspace),
    policies,
    policySummary: summarizeCustomerSentinelPolicies(policies),
    validation: validateCustomerSentinelPolicies(policies),
    escalationDeck: createCustomerSentinelEscalationDeck(policies),
    analytics: {
      timeline: createCustomerSentinelAnalyticsTimeline(),
      forecast: createCustomerSentinelForecastEnvelope(),
      exceptions: createCustomerSentinelExceptionLedger(),
      summary: summarizeCustomerSentinelAnalytics()
    },
    operations: {
      board: createCustomerSentinelOperationsBoard(),
      checklist: createCustomerSentinelShiftChecklist(),
      incidents: createCustomerSentinelIncidentDeck()
    },
    reporting: {
      cards: createCustomerSentinelReportCards(),
      packets: createCustomerSentinelReviewPackets(),
      summary: summarizeCustomerSentinelReporting()
    },
    audit: {
      trail: createCustomerSentinelAuditTrail(),
      manifest: createCustomerSentinelEvidenceManifest(),
      attestation: createCustomerSentinelReadinessAttestation()
    },
    playbooks: createCustomerSentinelPlaybooks(),
    decisions: createCustomerSentinelDecisionDeck(),
    escalationMoments: createCustomerSentinelEscalationMoments()
  };
}

export function createCustomerSentinelReadinessBoard(snapshot = buildCustomerSentinelSnapshot()) {
  return [
    { id: 'customer-sentinel-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'customer-sentinel-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'customer-sentinel-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'customer-sentinel-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCustomerSentinelApiDocument(snapshot = buildCustomerSentinelSnapshot()) {
  return {
    id: 'customer-sentinel-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/customer-sentinel/overview' },
      { method: 'GET', path: '/api/customer-sentinel/reporting' },
      { method: 'POST', path: '/api/customer-sentinel/validate' },
      { method: 'GET', path: '/api/customer-sentinel/audit' }
    ],
    readiness: createCustomerSentinelReadinessBoard(snapshot)
  };
}

export function createCustomerSentinelRouteSummary(snapshot = buildCustomerSentinelSnapshot()) {
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

