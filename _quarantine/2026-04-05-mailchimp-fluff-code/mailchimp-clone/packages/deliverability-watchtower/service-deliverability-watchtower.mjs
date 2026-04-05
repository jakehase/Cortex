import { createDeliverabilityWatchtowerWorkspace, summarizeDeliverabilityWatchtowerWorkspace, createDeliverabilityWatchtowerNarratives, createDeliverabilityWatchtowerCoverageGrid } from './domain-deliverability-watchtower.mjs';
import { createDeliverabilityWatchtowerPolicies, validateDeliverabilityWatchtowerPolicies, summarizeDeliverabilityWatchtowerPolicies, createDeliverabilityWatchtowerEscalationDeck } from './policies-deliverability-watchtower.mjs';
import { createDeliverabilityWatchtowerAnalyticsTimeline, createDeliverabilityWatchtowerForecastEnvelope, createDeliverabilityWatchtowerExceptionLedger, summarizeDeliverabilityWatchtowerAnalytics } from './analytics-deliverability-watchtower.mjs';
import { createDeliverabilityWatchtowerOperationsBoard, createDeliverabilityWatchtowerShiftChecklist, createDeliverabilityWatchtowerIncidentDeck } from './operations-deliverability-watchtower.mjs';
import { createDeliverabilityWatchtowerReportCards, createDeliverabilityWatchtowerReviewPackets, summarizeDeliverabilityWatchtowerReporting } from './reporting-deliverability-watchtower.mjs';
import { createDeliverabilityWatchtowerAuditTrail, createDeliverabilityWatchtowerEvidenceManifest, createDeliverabilityWatchtowerReadinessAttestation } from './audit-deliverability-watchtower.mjs';
import { createDeliverabilityWatchtowerPlaybooks, createDeliverabilityWatchtowerDecisionDeck, createDeliverabilityWatchtowerEscalationMoments } from './playbooks-deliverability-watchtower.mjs';

export function buildDeliverabilityWatchtowerSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createDeliverabilityWatchtowerWorkspace(workspaceName);
  const policies = createDeliverabilityWatchtowerPolicies();
  return {
    workspace,
    summary: summarizeDeliverabilityWatchtowerWorkspace(workspace),
    narratives: createDeliverabilityWatchtowerNarratives(workspace),
    coverage: createDeliverabilityWatchtowerCoverageGrid(workspace),
    policies,
    policySummary: summarizeDeliverabilityWatchtowerPolicies(policies),
    validation: validateDeliverabilityWatchtowerPolicies(policies),
    escalationDeck: createDeliverabilityWatchtowerEscalationDeck(policies),
    analytics: {
      timeline: createDeliverabilityWatchtowerAnalyticsTimeline(),
      forecast: createDeliverabilityWatchtowerForecastEnvelope(),
      exceptions: createDeliverabilityWatchtowerExceptionLedger(),
      summary: summarizeDeliverabilityWatchtowerAnalytics()
    },
    operations: {
      board: createDeliverabilityWatchtowerOperationsBoard(),
      checklist: createDeliverabilityWatchtowerShiftChecklist(),
      incidents: createDeliverabilityWatchtowerIncidentDeck()
    },
    reporting: {
      cards: createDeliverabilityWatchtowerReportCards(),
      packets: createDeliverabilityWatchtowerReviewPackets(),
      summary: summarizeDeliverabilityWatchtowerReporting()
    },
    audit: {
      trail: createDeliverabilityWatchtowerAuditTrail(),
      manifest: createDeliverabilityWatchtowerEvidenceManifest(),
      attestation: createDeliverabilityWatchtowerReadinessAttestation()
    },
    playbooks: createDeliverabilityWatchtowerPlaybooks(),
    decisions: createDeliverabilityWatchtowerDecisionDeck(),
    escalationMoments: createDeliverabilityWatchtowerEscalationMoments()
  };
}

export function createDeliverabilityWatchtowerReadinessBoard(snapshot = buildDeliverabilityWatchtowerSnapshot()) {
  return [
    { id: 'deliverability-watchtower-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'deliverability-watchtower-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'deliverability-watchtower-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'deliverability-watchtower-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createDeliverabilityWatchtowerApiDocument(snapshot = buildDeliverabilityWatchtowerSnapshot()) {
  return {
    id: 'deliverability-watchtower-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/deliverability-watchtower/overview' },
      { method: 'GET', path: '/api/deliverability-watchtower/reporting' },
      { method: 'POST', path: '/api/deliverability-watchtower/validate' },
      { method: 'GET', path: '/api/deliverability-watchtower/audit' }
    ],
    readiness: createDeliverabilityWatchtowerReadinessBoard(snapshot)
  };
}

export function createDeliverabilityWatchtowerRouteSummary(snapshot = buildDeliverabilityWatchtowerSnapshot()) {
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

