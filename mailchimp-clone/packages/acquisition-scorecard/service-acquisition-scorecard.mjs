import { createAcquisitionScorecardWorkspace, summarizeAcquisitionScorecardWorkspace, createAcquisitionScorecardNarratives, createAcquisitionScorecardCoverageGrid } from './domain-acquisition-scorecard.mjs';
import { createAcquisitionScorecardPolicies, validateAcquisitionScorecardPolicies, summarizeAcquisitionScorecardPolicies, createAcquisitionScorecardEscalationDeck } from './policies-acquisition-scorecard.mjs';
import { createAcquisitionScorecardAnalyticsTimeline, createAcquisitionScorecardForecastEnvelope, createAcquisitionScorecardExceptionLedger, summarizeAcquisitionScorecardAnalytics } from './analytics-acquisition-scorecard.mjs';
import { createAcquisitionScorecardOperationsBoard, createAcquisitionScorecardShiftChecklist, createAcquisitionScorecardIncidentDeck } from './operations-acquisition-scorecard.mjs';
import { createAcquisitionScorecardReportCards, createAcquisitionScorecardReviewPackets, summarizeAcquisitionScorecardReporting } from './reporting-acquisition-scorecard.mjs';
import { createAcquisitionScorecardAuditTrail, createAcquisitionScorecardEvidenceManifest, createAcquisitionScorecardReadinessAttestation } from './audit-acquisition-scorecard.mjs';
import { createAcquisitionScorecardPlaybooks, createAcquisitionScorecardDecisionDeck, createAcquisitionScorecardEscalationMoments } from './playbooks-acquisition-scorecard.mjs';

export function buildAcquisitionScorecardSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAcquisitionScorecardWorkspace(workspaceName);
  const policies = createAcquisitionScorecardPolicies();
  return {
    workspace,
    summary: summarizeAcquisitionScorecardWorkspace(workspace),
    narratives: createAcquisitionScorecardNarratives(workspace),
    coverage: createAcquisitionScorecardCoverageGrid(workspace),
    policies,
    policySummary: summarizeAcquisitionScorecardPolicies(policies),
    validation: validateAcquisitionScorecardPolicies(policies),
    escalationDeck: createAcquisitionScorecardEscalationDeck(policies),
    analytics: {
      timeline: createAcquisitionScorecardAnalyticsTimeline(),
      forecast: createAcquisitionScorecardForecastEnvelope(),
      exceptions: createAcquisitionScorecardExceptionLedger(),
      summary: summarizeAcquisitionScorecardAnalytics()
    },
    operations: {
      board: createAcquisitionScorecardOperationsBoard(),
      checklist: createAcquisitionScorecardShiftChecklist(),
      incidents: createAcquisitionScorecardIncidentDeck()
    },
    reporting: {
      cards: createAcquisitionScorecardReportCards(),
      packets: createAcquisitionScorecardReviewPackets(),
      summary: summarizeAcquisitionScorecardReporting()
    },
    audit: {
      trail: createAcquisitionScorecardAuditTrail(),
      manifest: createAcquisitionScorecardEvidenceManifest(),
      attestation: createAcquisitionScorecardReadinessAttestation()
    },
    playbooks: createAcquisitionScorecardPlaybooks(),
    decisions: createAcquisitionScorecardDecisionDeck(),
    escalationMoments: createAcquisitionScorecardEscalationMoments()
  };
}

export function createAcquisitionScorecardReadinessBoard(snapshot = buildAcquisitionScorecardSnapshot()) {
  return [
    { id: 'acquisition-scorecard-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'acquisition-scorecard-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'acquisition-scorecard-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'acquisition-scorecard-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAcquisitionScorecardApiDocument(snapshot = buildAcquisitionScorecardSnapshot()) {
  return {
    id: 'acquisition-scorecard-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/acquisition-scorecard/overview' },
      { method: 'GET', path: '/api/acquisition-scorecard/reporting' },
      { method: 'POST', path: '/api/acquisition-scorecard/validate' },
      { method: 'GET', path: '/api/acquisition-scorecard/audit' }
    ],
    readiness: createAcquisitionScorecardReadinessBoard(snapshot)
  };
}

export function createAcquisitionScorecardRouteSummary(snapshot = buildAcquisitionScorecardSnapshot()) {
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

