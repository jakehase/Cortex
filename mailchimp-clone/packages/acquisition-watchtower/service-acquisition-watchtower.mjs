import { createAcquisitionWatchtowerWorkspace, summarizeAcquisitionWatchtowerWorkspace, createAcquisitionWatchtowerNarratives, createAcquisitionWatchtowerCoverageGrid } from './domain-acquisition-watchtower.mjs';
import { createAcquisitionWatchtowerPolicies, validateAcquisitionWatchtowerPolicies, summarizeAcquisitionWatchtowerPolicies, createAcquisitionWatchtowerEscalationDeck } from './policies-acquisition-watchtower.mjs';
import { createAcquisitionWatchtowerAnalyticsTimeline, createAcquisitionWatchtowerForecastEnvelope, createAcquisitionWatchtowerExceptionLedger, summarizeAcquisitionWatchtowerAnalytics } from './analytics-acquisition-watchtower.mjs';
import { createAcquisitionWatchtowerOperationsBoard, createAcquisitionWatchtowerShiftChecklist, createAcquisitionWatchtowerIncidentDeck } from './operations-acquisition-watchtower.mjs';
import { createAcquisitionWatchtowerReportCards, createAcquisitionWatchtowerReviewPackets, summarizeAcquisitionWatchtowerReporting } from './reporting-acquisition-watchtower.mjs';
import { createAcquisitionWatchtowerAuditTrail, createAcquisitionWatchtowerEvidenceManifest, createAcquisitionWatchtowerReadinessAttestation } from './audit-acquisition-watchtower.mjs';
import { createAcquisitionWatchtowerPlaybooks, createAcquisitionWatchtowerDecisionDeck, createAcquisitionWatchtowerEscalationMoments } from './playbooks-acquisition-watchtower.mjs';

export function buildAcquisitionWatchtowerSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAcquisitionWatchtowerWorkspace(workspaceName);
  const policies = createAcquisitionWatchtowerPolicies();
  return {
    workspace,
    summary: summarizeAcquisitionWatchtowerWorkspace(workspace),
    narratives: createAcquisitionWatchtowerNarratives(workspace),
    coverage: createAcquisitionWatchtowerCoverageGrid(workspace),
    policies,
    policySummary: summarizeAcquisitionWatchtowerPolicies(policies),
    validation: validateAcquisitionWatchtowerPolicies(policies),
    escalationDeck: createAcquisitionWatchtowerEscalationDeck(policies),
    analytics: {
      timeline: createAcquisitionWatchtowerAnalyticsTimeline(),
      forecast: createAcquisitionWatchtowerForecastEnvelope(),
      exceptions: createAcquisitionWatchtowerExceptionLedger(),
      summary: summarizeAcquisitionWatchtowerAnalytics()
    },
    operations: {
      board: createAcquisitionWatchtowerOperationsBoard(),
      checklist: createAcquisitionWatchtowerShiftChecklist(),
      incidents: createAcquisitionWatchtowerIncidentDeck()
    },
    reporting: {
      cards: createAcquisitionWatchtowerReportCards(),
      packets: createAcquisitionWatchtowerReviewPackets(),
      summary: summarizeAcquisitionWatchtowerReporting()
    },
    audit: {
      trail: createAcquisitionWatchtowerAuditTrail(),
      manifest: createAcquisitionWatchtowerEvidenceManifest(),
      attestation: createAcquisitionWatchtowerReadinessAttestation()
    },
    playbooks: createAcquisitionWatchtowerPlaybooks(),
    decisions: createAcquisitionWatchtowerDecisionDeck(),
    escalationMoments: createAcquisitionWatchtowerEscalationMoments()
  };
}

export function createAcquisitionWatchtowerReadinessBoard(snapshot = buildAcquisitionWatchtowerSnapshot()) {
  return [
    { id: 'acquisition-watchtower-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'acquisition-watchtower-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'acquisition-watchtower-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'acquisition-watchtower-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAcquisitionWatchtowerApiDocument(snapshot = buildAcquisitionWatchtowerSnapshot()) {
  return {
    id: 'acquisition-watchtower-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/acquisition-watchtower/overview' },
      { method: 'GET', path: '/api/acquisition-watchtower/reporting' },
      { method: 'POST', path: '/api/acquisition-watchtower/validate' },
      { method: 'GET', path: '/api/acquisition-watchtower/audit' }
    ],
    readiness: createAcquisitionWatchtowerReadinessBoard(snapshot)
  };
}

export function createAcquisitionWatchtowerRouteSummary(snapshot = buildAcquisitionWatchtowerSnapshot()) {
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

