import { createCustomerWatchtowerWorkspace, summarizeCustomerWatchtowerWorkspace, createCustomerWatchtowerNarratives, createCustomerWatchtowerCoverageGrid } from './domain-customer-watchtower.mjs';
import { createCustomerWatchtowerPolicies, validateCustomerWatchtowerPolicies, summarizeCustomerWatchtowerPolicies, createCustomerWatchtowerEscalationDeck } from './policies-customer-watchtower.mjs';
import { createCustomerWatchtowerAnalyticsTimeline, createCustomerWatchtowerForecastEnvelope, createCustomerWatchtowerExceptionLedger, summarizeCustomerWatchtowerAnalytics } from './analytics-customer-watchtower.mjs';
import { createCustomerWatchtowerOperationsBoard, createCustomerWatchtowerShiftChecklist, createCustomerWatchtowerIncidentDeck } from './operations-customer-watchtower.mjs';
import { createCustomerWatchtowerReportCards, createCustomerWatchtowerReviewPackets, summarizeCustomerWatchtowerReporting } from './reporting-customer-watchtower.mjs';
import { createCustomerWatchtowerAuditTrail, createCustomerWatchtowerEvidenceManifest, createCustomerWatchtowerReadinessAttestation } from './audit-customer-watchtower.mjs';
import { createCustomerWatchtowerPlaybooks, createCustomerWatchtowerDecisionDeck, createCustomerWatchtowerEscalationMoments } from './playbooks-customer-watchtower.mjs';

export function buildCustomerWatchtowerSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCustomerWatchtowerWorkspace(workspaceName);
  const policies = createCustomerWatchtowerPolicies();
  return {
    workspace,
    summary: summarizeCustomerWatchtowerWorkspace(workspace),
    narratives: createCustomerWatchtowerNarratives(workspace),
    coverage: createCustomerWatchtowerCoverageGrid(workspace),
    policies,
    policySummary: summarizeCustomerWatchtowerPolicies(policies),
    validation: validateCustomerWatchtowerPolicies(policies),
    escalationDeck: createCustomerWatchtowerEscalationDeck(policies),
    analytics: {
      timeline: createCustomerWatchtowerAnalyticsTimeline(),
      forecast: createCustomerWatchtowerForecastEnvelope(),
      exceptions: createCustomerWatchtowerExceptionLedger(),
      summary: summarizeCustomerWatchtowerAnalytics()
    },
    operations: {
      board: createCustomerWatchtowerOperationsBoard(),
      checklist: createCustomerWatchtowerShiftChecklist(),
      incidents: createCustomerWatchtowerIncidentDeck()
    },
    reporting: {
      cards: createCustomerWatchtowerReportCards(),
      packets: createCustomerWatchtowerReviewPackets(),
      summary: summarizeCustomerWatchtowerReporting()
    },
    audit: {
      trail: createCustomerWatchtowerAuditTrail(),
      manifest: createCustomerWatchtowerEvidenceManifest(),
      attestation: createCustomerWatchtowerReadinessAttestation()
    },
    playbooks: createCustomerWatchtowerPlaybooks(),
    decisions: createCustomerWatchtowerDecisionDeck(),
    escalationMoments: createCustomerWatchtowerEscalationMoments()
  };
}

export function createCustomerWatchtowerReadinessBoard(snapshot = buildCustomerWatchtowerSnapshot()) {
  return [
    { id: 'customer-watchtower-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'customer-watchtower-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'customer-watchtower-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'customer-watchtower-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCustomerWatchtowerApiDocument(snapshot = buildCustomerWatchtowerSnapshot()) {
  return {
    id: 'customer-watchtower-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/customer-watchtower/overview' },
      { method: 'GET', path: '/api/customer-watchtower/reporting' },
      { method: 'POST', path: '/api/customer-watchtower/validate' },
      { method: 'GET', path: '/api/customer-watchtower/audit' }
    ],
    readiness: createCustomerWatchtowerReadinessBoard(snapshot)
  };
}

export function createCustomerWatchtowerRouteSummary(snapshot = buildCustomerWatchtowerSnapshot()) {
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

