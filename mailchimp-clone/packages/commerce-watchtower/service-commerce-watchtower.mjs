import { createCommerceWatchtowerWorkspace, summarizeCommerceWatchtowerWorkspace, createCommerceWatchtowerNarratives, createCommerceWatchtowerCoverageGrid } from './domain-commerce-watchtower.mjs';
import { createCommerceWatchtowerPolicies, validateCommerceWatchtowerPolicies, summarizeCommerceWatchtowerPolicies, createCommerceWatchtowerEscalationDeck } from './policies-commerce-watchtower.mjs';
import { createCommerceWatchtowerAnalyticsTimeline, createCommerceWatchtowerForecastEnvelope, createCommerceWatchtowerExceptionLedger, summarizeCommerceWatchtowerAnalytics } from './analytics-commerce-watchtower.mjs';
import { createCommerceWatchtowerOperationsBoard, createCommerceWatchtowerShiftChecklist, createCommerceWatchtowerIncidentDeck } from './operations-commerce-watchtower.mjs';
import { createCommerceWatchtowerReportCards, createCommerceWatchtowerReviewPackets, summarizeCommerceWatchtowerReporting } from './reporting-commerce-watchtower.mjs';
import { createCommerceWatchtowerAuditTrail, createCommerceWatchtowerEvidenceManifest, createCommerceWatchtowerReadinessAttestation } from './audit-commerce-watchtower.mjs';
import { createCommerceWatchtowerPlaybooks, createCommerceWatchtowerDecisionDeck, createCommerceWatchtowerEscalationMoments } from './playbooks-commerce-watchtower.mjs';

export function buildCommerceWatchtowerSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCommerceWatchtowerWorkspace(workspaceName);
  const policies = createCommerceWatchtowerPolicies();
  return {
    workspace,
    summary: summarizeCommerceWatchtowerWorkspace(workspace),
    narratives: createCommerceWatchtowerNarratives(workspace),
    coverage: createCommerceWatchtowerCoverageGrid(workspace),
    policies,
    policySummary: summarizeCommerceWatchtowerPolicies(policies),
    validation: validateCommerceWatchtowerPolicies(policies),
    escalationDeck: createCommerceWatchtowerEscalationDeck(policies),
    analytics: {
      timeline: createCommerceWatchtowerAnalyticsTimeline(),
      forecast: createCommerceWatchtowerForecastEnvelope(),
      exceptions: createCommerceWatchtowerExceptionLedger(),
      summary: summarizeCommerceWatchtowerAnalytics()
    },
    operations: {
      board: createCommerceWatchtowerOperationsBoard(),
      checklist: createCommerceWatchtowerShiftChecklist(),
      incidents: createCommerceWatchtowerIncidentDeck()
    },
    reporting: {
      cards: createCommerceWatchtowerReportCards(),
      packets: createCommerceWatchtowerReviewPackets(),
      summary: summarizeCommerceWatchtowerReporting()
    },
    audit: {
      trail: createCommerceWatchtowerAuditTrail(),
      manifest: createCommerceWatchtowerEvidenceManifest(),
      attestation: createCommerceWatchtowerReadinessAttestation()
    },
    playbooks: createCommerceWatchtowerPlaybooks(),
    decisions: createCommerceWatchtowerDecisionDeck(),
    escalationMoments: createCommerceWatchtowerEscalationMoments()
  };
}

export function createCommerceWatchtowerReadinessBoard(snapshot = buildCommerceWatchtowerSnapshot()) {
  return [
    { id: 'commerce-watchtower-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'commerce-watchtower-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'commerce-watchtower-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'commerce-watchtower-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCommerceWatchtowerApiDocument(snapshot = buildCommerceWatchtowerSnapshot()) {
  return {
    id: 'commerce-watchtower-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/commerce-watchtower/overview' },
      { method: 'GET', path: '/api/commerce-watchtower/reporting' },
      { method: 'POST', path: '/api/commerce-watchtower/validate' },
      { method: 'GET', path: '/api/commerce-watchtower/audit' }
    ],
    readiness: createCommerceWatchtowerReadinessBoard(snapshot)
  };
}

export function createCommerceWatchtowerRouteSummary(snapshot = buildCommerceWatchtowerSnapshot()) {
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

