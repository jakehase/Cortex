import { createLoyaltyWatchtowerWorkspace, summarizeLoyaltyWatchtowerWorkspace, createLoyaltyWatchtowerNarratives, createLoyaltyWatchtowerCoverageGrid } from './domain-loyalty-watchtower.mjs';
import { createLoyaltyWatchtowerPolicies, validateLoyaltyWatchtowerPolicies, summarizeLoyaltyWatchtowerPolicies, createLoyaltyWatchtowerEscalationDeck } from './policies-loyalty-watchtower.mjs';
import { createLoyaltyWatchtowerAnalyticsTimeline, createLoyaltyWatchtowerForecastEnvelope, createLoyaltyWatchtowerExceptionLedger, summarizeLoyaltyWatchtowerAnalytics } from './analytics-loyalty-watchtower.mjs';
import { createLoyaltyWatchtowerOperationsBoard, createLoyaltyWatchtowerShiftChecklist, createLoyaltyWatchtowerIncidentDeck } from './operations-loyalty-watchtower.mjs';
import { createLoyaltyWatchtowerReportCards, createLoyaltyWatchtowerReviewPackets, summarizeLoyaltyWatchtowerReporting } from './reporting-loyalty-watchtower.mjs';
import { createLoyaltyWatchtowerAuditTrail, createLoyaltyWatchtowerEvidenceManifest, createLoyaltyWatchtowerReadinessAttestation } from './audit-loyalty-watchtower.mjs';
import { createLoyaltyWatchtowerPlaybooks, createLoyaltyWatchtowerDecisionDeck, createLoyaltyWatchtowerEscalationMoments } from './playbooks-loyalty-watchtower.mjs';

export function buildLoyaltyWatchtowerSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createLoyaltyWatchtowerWorkspace(workspaceName);
  const policies = createLoyaltyWatchtowerPolicies();
  return {
    workspace,
    summary: summarizeLoyaltyWatchtowerWorkspace(workspace),
    narratives: createLoyaltyWatchtowerNarratives(workspace),
    coverage: createLoyaltyWatchtowerCoverageGrid(workspace),
    policies,
    policySummary: summarizeLoyaltyWatchtowerPolicies(policies),
    validation: validateLoyaltyWatchtowerPolicies(policies),
    escalationDeck: createLoyaltyWatchtowerEscalationDeck(policies),
    analytics: {
      timeline: createLoyaltyWatchtowerAnalyticsTimeline(),
      forecast: createLoyaltyWatchtowerForecastEnvelope(),
      exceptions: createLoyaltyWatchtowerExceptionLedger(),
      summary: summarizeLoyaltyWatchtowerAnalytics()
    },
    operations: {
      board: createLoyaltyWatchtowerOperationsBoard(),
      checklist: createLoyaltyWatchtowerShiftChecklist(),
      incidents: createLoyaltyWatchtowerIncidentDeck()
    },
    reporting: {
      cards: createLoyaltyWatchtowerReportCards(),
      packets: createLoyaltyWatchtowerReviewPackets(),
      summary: summarizeLoyaltyWatchtowerReporting()
    },
    audit: {
      trail: createLoyaltyWatchtowerAuditTrail(),
      manifest: createLoyaltyWatchtowerEvidenceManifest(),
      attestation: createLoyaltyWatchtowerReadinessAttestation()
    },
    playbooks: createLoyaltyWatchtowerPlaybooks(),
    decisions: createLoyaltyWatchtowerDecisionDeck(),
    escalationMoments: createLoyaltyWatchtowerEscalationMoments()
  };
}

export function createLoyaltyWatchtowerReadinessBoard(snapshot = buildLoyaltyWatchtowerSnapshot()) {
  return [
    { id: 'loyalty-watchtower-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'loyalty-watchtower-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'loyalty-watchtower-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'loyalty-watchtower-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createLoyaltyWatchtowerApiDocument(snapshot = buildLoyaltyWatchtowerSnapshot()) {
  return {
    id: 'loyalty-watchtower-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/loyalty-watchtower/overview' },
      { method: 'GET', path: '/api/loyalty-watchtower/reporting' },
      { method: 'POST', path: '/api/loyalty-watchtower/validate' },
      { method: 'GET', path: '/api/loyalty-watchtower/audit' }
    ],
    readiness: createLoyaltyWatchtowerReadinessBoard(snapshot)
  };
}

export function createLoyaltyWatchtowerRouteSummary(snapshot = buildLoyaltyWatchtowerSnapshot()) {
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

