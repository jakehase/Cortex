import { createComplianceScorecardWorkspace, summarizeComplianceScorecardWorkspace, createComplianceScorecardNarratives, createComplianceScorecardCoverageGrid } from './domain-compliance-scorecard.mjs';
import { createComplianceScorecardPolicies, validateComplianceScorecardPolicies, summarizeComplianceScorecardPolicies, createComplianceScorecardEscalationDeck } from './policies-compliance-scorecard.mjs';
import { createComplianceScorecardAnalyticsTimeline, createComplianceScorecardForecastEnvelope, createComplianceScorecardExceptionLedger, summarizeComplianceScorecardAnalytics } from './analytics-compliance-scorecard.mjs';
import { createComplianceScorecardOperationsBoard, createComplianceScorecardShiftChecklist, createComplianceScorecardIncidentDeck } from './operations-compliance-scorecard.mjs';
import { createComplianceScorecardReportCards, createComplianceScorecardReviewPackets, summarizeComplianceScorecardReporting } from './reporting-compliance-scorecard.mjs';
import { createComplianceScorecardAuditTrail, createComplianceScorecardEvidenceManifest, createComplianceScorecardReadinessAttestation } from './audit-compliance-scorecard.mjs';
import { createComplianceScorecardPlaybooks, createComplianceScorecardDecisionDeck, createComplianceScorecardEscalationMoments } from './playbooks-compliance-scorecard.mjs';

export function buildComplianceScorecardSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createComplianceScorecardWorkspace(workspaceName);
  const policies = createComplianceScorecardPolicies();
  return {
    workspace,
    summary: summarizeComplianceScorecardWorkspace(workspace),
    narratives: createComplianceScorecardNarratives(workspace),
    coverage: createComplianceScorecardCoverageGrid(workspace),
    policies,
    policySummary: summarizeComplianceScorecardPolicies(policies),
    validation: validateComplianceScorecardPolicies(policies),
    escalationDeck: createComplianceScorecardEscalationDeck(policies),
    analytics: {
      timeline: createComplianceScorecardAnalyticsTimeline(),
      forecast: createComplianceScorecardForecastEnvelope(),
      exceptions: createComplianceScorecardExceptionLedger(),
      summary: summarizeComplianceScorecardAnalytics()
    },
    operations: {
      board: createComplianceScorecardOperationsBoard(),
      checklist: createComplianceScorecardShiftChecklist(),
      incidents: createComplianceScorecardIncidentDeck()
    },
    reporting: {
      cards: createComplianceScorecardReportCards(),
      packets: createComplianceScorecardReviewPackets(),
      summary: summarizeComplianceScorecardReporting()
    },
    audit: {
      trail: createComplianceScorecardAuditTrail(),
      manifest: createComplianceScorecardEvidenceManifest(),
      attestation: createComplianceScorecardReadinessAttestation()
    },
    playbooks: createComplianceScorecardPlaybooks(),
    decisions: createComplianceScorecardDecisionDeck(),
    escalationMoments: createComplianceScorecardEscalationMoments()
  };
}

export function createComplianceScorecardReadinessBoard(snapshot = buildComplianceScorecardSnapshot()) {
  return [
    { id: 'compliance-scorecard-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'compliance-scorecard-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'compliance-scorecard-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'compliance-scorecard-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createComplianceScorecardApiDocument(snapshot = buildComplianceScorecardSnapshot()) {
  return {
    id: 'compliance-scorecard-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/compliance-scorecard/overview' },
      { method: 'GET', path: '/api/compliance-scorecard/reporting' },
      { method: 'POST', path: '/api/compliance-scorecard/validate' },
      { method: 'GET', path: '/api/compliance-scorecard/audit' }
    ],
    readiness: createComplianceScorecardReadinessBoard(snapshot)
  };
}

export function createComplianceScorecardRouteSummary(snapshot = buildComplianceScorecardSnapshot()) {
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

