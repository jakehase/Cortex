import { createCreativeWatchtowerWorkspace, summarizeCreativeWatchtowerWorkspace, createCreativeWatchtowerNarratives, createCreativeWatchtowerCoverageGrid } from './domain-creative-watchtower.mjs';
import { createCreativeWatchtowerPolicies, validateCreativeWatchtowerPolicies, summarizeCreativeWatchtowerPolicies, createCreativeWatchtowerEscalationDeck } from './policies-creative-watchtower.mjs';
import { createCreativeWatchtowerAnalyticsTimeline, createCreativeWatchtowerForecastEnvelope, createCreativeWatchtowerExceptionLedger, summarizeCreativeWatchtowerAnalytics } from './analytics-creative-watchtower.mjs';
import { createCreativeWatchtowerOperationsBoard, createCreativeWatchtowerShiftChecklist, createCreativeWatchtowerIncidentDeck } from './operations-creative-watchtower.mjs';
import { createCreativeWatchtowerReportCards, createCreativeWatchtowerReviewPackets, summarizeCreativeWatchtowerReporting } from './reporting-creative-watchtower.mjs';
import { createCreativeWatchtowerAuditTrail, createCreativeWatchtowerEvidenceManifest, createCreativeWatchtowerReadinessAttestation } from './audit-creative-watchtower.mjs';
import { createCreativeWatchtowerPlaybooks, createCreativeWatchtowerDecisionDeck, createCreativeWatchtowerEscalationMoments } from './playbooks-creative-watchtower.mjs';

export function buildCreativeWatchtowerSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCreativeWatchtowerWorkspace(workspaceName);
  const policies = createCreativeWatchtowerPolicies();
  return {
    workspace,
    summary: summarizeCreativeWatchtowerWorkspace(workspace),
    narratives: createCreativeWatchtowerNarratives(workspace),
    coverage: createCreativeWatchtowerCoverageGrid(workspace),
    policies,
    policySummary: summarizeCreativeWatchtowerPolicies(policies),
    validation: validateCreativeWatchtowerPolicies(policies),
    escalationDeck: createCreativeWatchtowerEscalationDeck(policies),
    analytics: {
      timeline: createCreativeWatchtowerAnalyticsTimeline(),
      forecast: createCreativeWatchtowerForecastEnvelope(),
      exceptions: createCreativeWatchtowerExceptionLedger(),
      summary: summarizeCreativeWatchtowerAnalytics()
    },
    operations: {
      board: createCreativeWatchtowerOperationsBoard(),
      checklist: createCreativeWatchtowerShiftChecklist(),
      incidents: createCreativeWatchtowerIncidentDeck()
    },
    reporting: {
      cards: createCreativeWatchtowerReportCards(),
      packets: createCreativeWatchtowerReviewPackets(),
      summary: summarizeCreativeWatchtowerReporting()
    },
    audit: {
      trail: createCreativeWatchtowerAuditTrail(),
      manifest: createCreativeWatchtowerEvidenceManifest(),
      attestation: createCreativeWatchtowerReadinessAttestation()
    },
    playbooks: createCreativeWatchtowerPlaybooks(),
    decisions: createCreativeWatchtowerDecisionDeck(),
    escalationMoments: createCreativeWatchtowerEscalationMoments()
  };
}

export function createCreativeWatchtowerReadinessBoard(snapshot = buildCreativeWatchtowerSnapshot()) {
  return [
    { id: 'creative-watchtower-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'creative-watchtower-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'creative-watchtower-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'creative-watchtower-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCreativeWatchtowerApiDocument(snapshot = buildCreativeWatchtowerSnapshot()) {
  return {
    id: 'creative-watchtower-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/creative-watchtower/overview' },
      { method: 'GET', path: '/api/creative-watchtower/reporting' },
      { method: 'POST', path: '/api/creative-watchtower/validate' },
      { method: 'GET', path: '/api/creative-watchtower/audit' }
    ],
    readiness: createCreativeWatchtowerReadinessBoard(snapshot)
  };
}

export function createCreativeWatchtowerRouteSummary(snapshot = buildCreativeWatchtowerSnapshot()) {
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

