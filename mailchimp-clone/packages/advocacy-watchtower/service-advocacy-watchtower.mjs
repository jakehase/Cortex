import { createAdvocacyWatchtowerWorkspace, summarizeAdvocacyWatchtowerWorkspace, createAdvocacyWatchtowerNarratives, createAdvocacyWatchtowerCoverageGrid } from './domain-advocacy-watchtower.mjs';
import { createAdvocacyWatchtowerPolicies, validateAdvocacyWatchtowerPolicies, summarizeAdvocacyWatchtowerPolicies, createAdvocacyWatchtowerEscalationDeck } from './policies-advocacy-watchtower.mjs';
import { createAdvocacyWatchtowerAnalyticsTimeline, createAdvocacyWatchtowerForecastEnvelope, createAdvocacyWatchtowerExceptionLedger, summarizeAdvocacyWatchtowerAnalytics } from './analytics-advocacy-watchtower.mjs';
import { createAdvocacyWatchtowerOperationsBoard, createAdvocacyWatchtowerShiftChecklist, createAdvocacyWatchtowerIncidentDeck } from './operations-advocacy-watchtower.mjs';
import { createAdvocacyWatchtowerReportCards, createAdvocacyWatchtowerReviewPackets, summarizeAdvocacyWatchtowerReporting } from './reporting-advocacy-watchtower.mjs';
import { createAdvocacyWatchtowerAuditTrail, createAdvocacyWatchtowerEvidenceManifest, createAdvocacyWatchtowerReadinessAttestation } from './audit-advocacy-watchtower.mjs';
import { createAdvocacyWatchtowerPlaybooks, createAdvocacyWatchtowerDecisionDeck, createAdvocacyWatchtowerEscalationMoments } from './playbooks-advocacy-watchtower.mjs';

export function buildAdvocacyWatchtowerSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAdvocacyWatchtowerWorkspace(workspaceName);
  const policies = createAdvocacyWatchtowerPolicies();
  return {
    workspace,
    summary: summarizeAdvocacyWatchtowerWorkspace(workspace),
    narratives: createAdvocacyWatchtowerNarratives(workspace),
    coverage: createAdvocacyWatchtowerCoverageGrid(workspace),
    policies,
    policySummary: summarizeAdvocacyWatchtowerPolicies(policies),
    validation: validateAdvocacyWatchtowerPolicies(policies),
    escalationDeck: createAdvocacyWatchtowerEscalationDeck(policies),
    analytics: {
      timeline: createAdvocacyWatchtowerAnalyticsTimeline(),
      forecast: createAdvocacyWatchtowerForecastEnvelope(),
      exceptions: createAdvocacyWatchtowerExceptionLedger(),
      summary: summarizeAdvocacyWatchtowerAnalytics()
    },
    operations: {
      board: createAdvocacyWatchtowerOperationsBoard(),
      checklist: createAdvocacyWatchtowerShiftChecklist(),
      incidents: createAdvocacyWatchtowerIncidentDeck()
    },
    reporting: {
      cards: createAdvocacyWatchtowerReportCards(),
      packets: createAdvocacyWatchtowerReviewPackets(),
      summary: summarizeAdvocacyWatchtowerReporting()
    },
    audit: {
      trail: createAdvocacyWatchtowerAuditTrail(),
      manifest: createAdvocacyWatchtowerEvidenceManifest(),
      attestation: createAdvocacyWatchtowerReadinessAttestation()
    },
    playbooks: createAdvocacyWatchtowerPlaybooks(),
    decisions: createAdvocacyWatchtowerDecisionDeck(),
    escalationMoments: createAdvocacyWatchtowerEscalationMoments()
  };
}

export function createAdvocacyWatchtowerReadinessBoard(snapshot = buildAdvocacyWatchtowerSnapshot()) {
  return [
    { id: 'advocacy-watchtower-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'advocacy-watchtower-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'advocacy-watchtower-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'advocacy-watchtower-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAdvocacyWatchtowerApiDocument(snapshot = buildAdvocacyWatchtowerSnapshot()) {
  return {
    id: 'advocacy-watchtower-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/advocacy-watchtower/overview' },
      { method: 'GET', path: '/api/advocacy-watchtower/reporting' },
      { method: 'POST', path: '/api/advocacy-watchtower/validate' },
      { method: 'GET', path: '/api/advocacy-watchtower/audit' }
    ],
    readiness: createAdvocacyWatchtowerReadinessBoard(snapshot)
  };
}

export function createAdvocacyWatchtowerRouteSummary(snapshot = buildAdvocacyWatchtowerSnapshot()) {
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

