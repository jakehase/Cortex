import { createAudienceWatchtowerWorkspace, summarizeAudienceWatchtowerWorkspace, createAudienceWatchtowerNarratives, createAudienceWatchtowerCoverageGrid } from './domain-audience-watchtower.mjs';
import { createAudienceWatchtowerPolicies, validateAudienceWatchtowerPolicies, summarizeAudienceWatchtowerPolicies, createAudienceWatchtowerEscalationDeck } from './policies-audience-watchtower.mjs';
import { createAudienceWatchtowerAnalyticsTimeline, createAudienceWatchtowerForecastEnvelope, createAudienceWatchtowerExceptionLedger, summarizeAudienceWatchtowerAnalytics } from './analytics-audience-watchtower.mjs';
import { createAudienceWatchtowerOperationsBoard, createAudienceWatchtowerShiftChecklist, createAudienceWatchtowerIncidentDeck } from './operations-audience-watchtower.mjs';
import { createAudienceWatchtowerReportCards, createAudienceWatchtowerReviewPackets, summarizeAudienceWatchtowerReporting } from './reporting-audience-watchtower.mjs';
import { createAudienceWatchtowerAuditTrail, createAudienceWatchtowerEvidenceManifest, createAudienceWatchtowerReadinessAttestation } from './audit-audience-watchtower.mjs';
import { createAudienceWatchtowerPlaybooks, createAudienceWatchtowerDecisionDeck, createAudienceWatchtowerEscalationMoments } from './playbooks-audience-watchtower.mjs';

export function buildAudienceWatchtowerSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAudienceWatchtowerWorkspace(workspaceName);
  const policies = createAudienceWatchtowerPolicies();
  return {
    workspace,
    summary: summarizeAudienceWatchtowerWorkspace(workspace),
    narratives: createAudienceWatchtowerNarratives(workspace),
    coverage: createAudienceWatchtowerCoverageGrid(workspace),
    policies,
    policySummary: summarizeAudienceWatchtowerPolicies(policies),
    validation: validateAudienceWatchtowerPolicies(policies),
    escalationDeck: createAudienceWatchtowerEscalationDeck(policies),
    analytics: {
      timeline: createAudienceWatchtowerAnalyticsTimeline(),
      forecast: createAudienceWatchtowerForecastEnvelope(),
      exceptions: createAudienceWatchtowerExceptionLedger(),
      summary: summarizeAudienceWatchtowerAnalytics()
    },
    operations: {
      board: createAudienceWatchtowerOperationsBoard(),
      checklist: createAudienceWatchtowerShiftChecklist(),
      incidents: createAudienceWatchtowerIncidentDeck()
    },
    reporting: {
      cards: createAudienceWatchtowerReportCards(),
      packets: createAudienceWatchtowerReviewPackets(),
      summary: summarizeAudienceWatchtowerReporting()
    },
    audit: {
      trail: createAudienceWatchtowerAuditTrail(),
      manifest: createAudienceWatchtowerEvidenceManifest(),
      attestation: createAudienceWatchtowerReadinessAttestation()
    },
    playbooks: createAudienceWatchtowerPlaybooks(),
    decisions: createAudienceWatchtowerDecisionDeck(),
    escalationMoments: createAudienceWatchtowerEscalationMoments()
  };
}

export function createAudienceWatchtowerReadinessBoard(snapshot = buildAudienceWatchtowerSnapshot()) {
  return [
    { id: 'audience-watchtower-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'audience-watchtower-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'audience-watchtower-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'audience-watchtower-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAudienceWatchtowerApiDocument(snapshot = buildAudienceWatchtowerSnapshot()) {
  return {
    id: 'audience-watchtower-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/audience-watchtower/overview' },
      { method: 'GET', path: '/api/audience-watchtower/reporting' },
      { method: 'POST', path: '/api/audience-watchtower/validate' },
      { method: 'GET', path: '/api/audience-watchtower/audit' }
    ],
    readiness: createAudienceWatchtowerReadinessBoard(snapshot)
  };
}

export function createAudienceWatchtowerRouteSummary(snapshot = buildAudienceWatchtowerSnapshot()) {
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

