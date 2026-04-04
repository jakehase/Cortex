import { createAttributionWatchtowerWorkspace, summarizeAttributionWatchtowerWorkspace, createAttributionWatchtowerNarratives, createAttributionWatchtowerCoverageGrid } from './domain-attribution-watchtower.mjs';
import { createAttributionWatchtowerPolicies, validateAttributionWatchtowerPolicies, summarizeAttributionWatchtowerPolicies, createAttributionWatchtowerEscalationDeck } from './policies-attribution-watchtower.mjs';
import { createAttributionWatchtowerAnalyticsTimeline, createAttributionWatchtowerForecastEnvelope, createAttributionWatchtowerExceptionLedger, summarizeAttributionWatchtowerAnalytics } from './analytics-attribution-watchtower.mjs';
import { createAttributionWatchtowerOperationsBoard, createAttributionWatchtowerShiftChecklist, createAttributionWatchtowerIncidentDeck } from './operations-attribution-watchtower.mjs';
import { createAttributionWatchtowerReportCards, createAttributionWatchtowerReviewPackets, summarizeAttributionWatchtowerReporting } from './reporting-attribution-watchtower.mjs';
import { createAttributionWatchtowerAuditTrail, createAttributionWatchtowerEvidenceManifest, createAttributionWatchtowerReadinessAttestation } from './audit-attribution-watchtower.mjs';
import { createAttributionWatchtowerPlaybooks, createAttributionWatchtowerDecisionDeck, createAttributionWatchtowerEscalationMoments } from './playbooks-attribution-watchtower.mjs';

export function buildAttributionWatchtowerSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAttributionWatchtowerWorkspace(workspaceName);
  const policies = createAttributionWatchtowerPolicies();
  return {
    workspace,
    summary: summarizeAttributionWatchtowerWorkspace(workspace),
    narratives: createAttributionWatchtowerNarratives(workspace),
    coverage: createAttributionWatchtowerCoverageGrid(workspace),
    policies,
    policySummary: summarizeAttributionWatchtowerPolicies(policies),
    validation: validateAttributionWatchtowerPolicies(policies),
    escalationDeck: createAttributionWatchtowerEscalationDeck(policies),
    analytics: {
      timeline: createAttributionWatchtowerAnalyticsTimeline(),
      forecast: createAttributionWatchtowerForecastEnvelope(),
      exceptions: createAttributionWatchtowerExceptionLedger(),
      summary: summarizeAttributionWatchtowerAnalytics()
    },
    operations: {
      board: createAttributionWatchtowerOperationsBoard(),
      checklist: createAttributionWatchtowerShiftChecklist(),
      incidents: createAttributionWatchtowerIncidentDeck()
    },
    reporting: {
      cards: createAttributionWatchtowerReportCards(),
      packets: createAttributionWatchtowerReviewPackets(),
      summary: summarizeAttributionWatchtowerReporting()
    },
    audit: {
      trail: createAttributionWatchtowerAuditTrail(),
      manifest: createAttributionWatchtowerEvidenceManifest(),
      attestation: createAttributionWatchtowerReadinessAttestation()
    },
    playbooks: createAttributionWatchtowerPlaybooks(),
    decisions: createAttributionWatchtowerDecisionDeck(),
    escalationMoments: createAttributionWatchtowerEscalationMoments()
  };
}

export function createAttributionWatchtowerReadinessBoard(snapshot = buildAttributionWatchtowerSnapshot()) {
  return [
    { id: 'attribution-watchtower-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'attribution-watchtower-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'attribution-watchtower-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'attribution-watchtower-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAttributionWatchtowerApiDocument(snapshot = buildAttributionWatchtowerSnapshot()) {
  return {
    id: 'attribution-watchtower-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/attribution-watchtower/overview' },
      { method: 'GET', path: '/api/attribution-watchtower/reporting' },
      { method: 'POST', path: '/api/attribution-watchtower/validate' },
      { method: 'GET', path: '/api/attribution-watchtower/audit' }
    ],
    readiness: createAttributionWatchtowerReadinessBoard(snapshot)
  };
}

export function createAttributionWatchtowerRouteSummary(snapshot = buildAttributionWatchtowerSnapshot()) {
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

