import { createEcommerceWatchtowerWorkspace, summarizeEcommerceWatchtowerWorkspace, createEcommerceWatchtowerNarratives, createEcommerceWatchtowerCoverageGrid } from './domain-ecommerce-watchtower.mjs';
import { createEcommerceWatchtowerPolicies, validateEcommerceWatchtowerPolicies, summarizeEcommerceWatchtowerPolicies, createEcommerceWatchtowerEscalationDeck } from './policies-ecommerce-watchtower.mjs';
import { createEcommerceWatchtowerAnalyticsTimeline, createEcommerceWatchtowerForecastEnvelope, createEcommerceWatchtowerExceptionLedger, summarizeEcommerceWatchtowerAnalytics } from './analytics-ecommerce-watchtower.mjs';
import { createEcommerceWatchtowerOperationsBoard, createEcommerceWatchtowerShiftChecklist, createEcommerceWatchtowerIncidentDeck } from './operations-ecommerce-watchtower.mjs';
import { createEcommerceWatchtowerReportCards, createEcommerceWatchtowerReviewPackets, summarizeEcommerceWatchtowerReporting } from './reporting-ecommerce-watchtower.mjs';
import { createEcommerceWatchtowerAuditTrail, createEcommerceWatchtowerEvidenceManifest, createEcommerceWatchtowerReadinessAttestation } from './audit-ecommerce-watchtower.mjs';
import { createEcommerceWatchtowerPlaybooks, createEcommerceWatchtowerDecisionDeck, createEcommerceWatchtowerEscalationMoments } from './playbooks-ecommerce-watchtower.mjs';

export function buildEcommerceWatchtowerSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createEcommerceWatchtowerWorkspace(workspaceName);
  const policies = createEcommerceWatchtowerPolicies();
  return {
    workspace,
    summary: summarizeEcommerceWatchtowerWorkspace(workspace),
    narratives: createEcommerceWatchtowerNarratives(workspace),
    coverage: createEcommerceWatchtowerCoverageGrid(workspace),
    policies,
    policySummary: summarizeEcommerceWatchtowerPolicies(policies),
    validation: validateEcommerceWatchtowerPolicies(policies),
    escalationDeck: createEcommerceWatchtowerEscalationDeck(policies),
    analytics: {
      timeline: createEcommerceWatchtowerAnalyticsTimeline(),
      forecast: createEcommerceWatchtowerForecastEnvelope(),
      exceptions: createEcommerceWatchtowerExceptionLedger(),
      summary: summarizeEcommerceWatchtowerAnalytics()
    },
    operations: {
      board: createEcommerceWatchtowerOperationsBoard(),
      checklist: createEcommerceWatchtowerShiftChecklist(),
      incidents: createEcommerceWatchtowerIncidentDeck()
    },
    reporting: {
      cards: createEcommerceWatchtowerReportCards(),
      packets: createEcommerceWatchtowerReviewPackets(),
      summary: summarizeEcommerceWatchtowerReporting()
    },
    audit: {
      trail: createEcommerceWatchtowerAuditTrail(),
      manifest: createEcommerceWatchtowerEvidenceManifest(),
      attestation: createEcommerceWatchtowerReadinessAttestation()
    },
    playbooks: createEcommerceWatchtowerPlaybooks(),
    decisions: createEcommerceWatchtowerDecisionDeck(),
    escalationMoments: createEcommerceWatchtowerEscalationMoments()
  };
}

export function createEcommerceWatchtowerReadinessBoard(snapshot = buildEcommerceWatchtowerSnapshot()) {
  return [
    { id: 'ecommerce-watchtower-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'ecommerce-watchtower-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'ecommerce-watchtower-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'ecommerce-watchtower-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createEcommerceWatchtowerApiDocument(snapshot = buildEcommerceWatchtowerSnapshot()) {
  return {
    id: 'ecommerce-watchtower-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/ecommerce-watchtower/overview' },
      { method: 'GET', path: '/api/ecommerce-watchtower/reporting' },
      { method: 'POST', path: '/api/ecommerce-watchtower/validate' },
      { method: 'GET', path: '/api/ecommerce-watchtower/audit' }
    ],
    readiness: createEcommerceWatchtowerReadinessBoard(snapshot)
  };
}

export function createEcommerceWatchtowerRouteSummary(snapshot = buildEcommerceWatchtowerSnapshot()) {
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

