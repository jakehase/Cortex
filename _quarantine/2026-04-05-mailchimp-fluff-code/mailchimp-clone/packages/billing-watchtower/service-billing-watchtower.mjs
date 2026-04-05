import { createBillingWatchtowerWorkspace, summarizeBillingWatchtowerWorkspace, createBillingWatchtowerNarratives, createBillingWatchtowerCoverageGrid } from './domain-billing-watchtower.mjs';
import { createBillingWatchtowerPolicies, validateBillingWatchtowerPolicies, summarizeBillingWatchtowerPolicies, createBillingWatchtowerEscalationDeck } from './policies-billing-watchtower.mjs';
import { createBillingWatchtowerAnalyticsTimeline, createBillingWatchtowerForecastEnvelope, createBillingWatchtowerExceptionLedger, summarizeBillingWatchtowerAnalytics } from './analytics-billing-watchtower.mjs';
import { createBillingWatchtowerOperationsBoard, createBillingWatchtowerShiftChecklist, createBillingWatchtowerIncidentDeck } from './operations-billing-watchtower.mjs';
import { createBillingWatchtowerReportCards, createBillingWatchtowerReviewPackets, summarizeBillingWatchtowerReporting } from './reporting-billing-watchtower.mjs';
import { createBillingWatchtowerAuditTrail, createBillingWatchtowerEvidenceManifest, createBillingWatchtowerReadinessAttestation } from './audit-billing-watchtower.mjs';
import { createBillingWatchtowerPlaybooks, createBillingWatchtowerDecisionDeck, createBillingWatchtowerEscalationMoments } from './playbooks-billing-watchtower.mjs';

export function buildBillingWatchtowerSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createBillingWatchtowerWorkspace(workspaceName);
  const policies = createBillingWatchtowerPolicies();
  return {
    workspace,
    summary: summarizeBillingWatchtowerWorkspace(workspace),
    narratives: createBillingWatchtowerNarratives(workspace),
    coverage: createBillingWatchtowerCoverageGrid(workspace),
    policies,
    policySummary: summarizeBillingWatchtowerPolicies(policies),
    validation: validateBillingWatchtowerPolicies(policies),
    escalationDeck: createBillingWatchtowerEscalationDeck(policies),
    analytics: {
      timeline: createBillingWatchtowerAnalyticsTimeline(),
      forecast: createBillingWatchtowerForecastEnvelope(),
      exceptions: createBillingWatchtowerExceptionLedger(),
      summary: summarizeBillingWatchtowerAnalytics()
    },
    operations: {
      board: createBillingWatchtowerOperationsBoard(),
      checklist: createBillingWatchtowerShiftChecklist(),
      incidents: createBillingWatchtowerIncidentDeck()
    },
    reporting: {
      cards: createBillingWatchtowerReportCards(),
      packets: createBillingWatchtowerReviewPackets(),
      summary: summarizeBillingWatchtowerReporting()
    },
    audit: {
      trail: createBillingWatchtowerAuditTrail(),
      manifest: createBillingWatchtowerEvidenceManifest(),
      attestation: createBillingWatchtowerReadinessAttestation()
    },
    playbooks: createBillingWatchtowerPlaybooks(),
    decisions: createBillingWatchtowerDecisionDeck(),
    escalationMoments: createBillingWatchtowerEscalationMoments()
  };
}

export function createBillingWatchtowerReadinessBoard(snapshot = buildBillingWatchtowerSnapshot()) {
  return [
    { id: 'billing-watchtower-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'billing-watchtower-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'billing-watchtower-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'billing-watchtower-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createBillingWatchtowerApiDocument(snapshot = buildBillingWatchtowerSnapshot()) {
  return {
    id: 'billing-watchtower-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/billing-watchtower/overview' },
      { method: 'GET', path: '/api/billing-watchtower/reporting' },
      { method: 'POST', path: '/api/billing-watchtower/validate' },
      { method: 'GET', path: '/api/billing-watchtower/audit' }
    ],
    readiness: createBillingWatchtowerReadinessBoard(snapshot)
  };
}

export function createBillingWatchtowerRouteSummary(snapshot = buildBillingWatchtowerSnapshot()) {
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

