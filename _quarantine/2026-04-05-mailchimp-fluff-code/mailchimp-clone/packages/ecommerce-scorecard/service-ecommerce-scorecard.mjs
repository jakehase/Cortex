import { createEcommerceScorecardWorkspace, summarizeEcommerceScorecardWorkspace, createEcommerceScorecardNarratives, createEcommerceScorecardCoverageGrid } from './domain-ecommerce-scorecard.mjs';
import { createEcommerceScorecardPolicies, validateEcommerceScorecardPolicies, summarizeEcommerceScorecardPolicies, createEcommerceScorecardEscalationDeck } from './policies-ecommerce-scorecard.mjs';
import { createEcommerceScorecardAnalyticsTimeline, createEcommerceScorecardForecastEnvelope, createEcommerceScorecardExceptionLedger, summarizeEcommerceScorecardAnalytics } from './analytics-ecommerce-scorecard.mjs';
import { createEcommerceScorecardOperationsBoard, createEcommerceScorecardShiftChecklist, createEcommerceScorecardIncidentDeck } from './operations-ecommerce-scorecard.mjs';
import { createEcommerceScorecardReportCards, createEcommerceScorecardReviewPackets, summarizeEcommerceScorecardReporting } from './reporting-ecommerce-scorecard.mjs';
import { createEcommerceScorecardAuditTrail, createEcommerceScorecardEvidenceManifest, createEcommerceScorecardReadinessAttestation } from './audit-ecommerce-scorecard.mjs';
import { createEcommerceScorecardPlaybooks, createEcommerceScorecardDecisionDeck, createEcommerceScorecardEscalationMoments } from './playbooks-ecommerce-scorecard.mjs';

export function buildEcommerceScorecardSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createEcommerceScorecardWorkspace(workspaceName);
  const policies = createEcommerceScorecardPolicies();
  return {
    workspace,
    summary: summarizeEcommerceScorecardWorkspace(workspace),
    narratives: createEcommerceScorecardNarratives(workspace),
    coverage: createEcommerceScorecardCoverageGrid(workspace),
    policies,
    policySummary: summarizeEcommerceScorecardPolicies(policies),
    validation: validateEcommerceScorecardPolicies(policies),
    escalationDeck: createEcommerceScorecardEscalationDeck(policies),
    analytics: {
      timeline: createEcommerceScorecardAnalyticsTimeline(),
      forecast: createEcommerceScorecardForecastEnvelope(),
      exceptions: createEcommerceScorecardExceptionLedger(),
      summary: summarizeEcommerceScorecardAnalytics()
    },
    operations: {
      board: createEcommerceScorecardOperationsBoard(),
      checklist: createEcommerceScorecardShiftChecklist(),
      incidents: createEcommerceScorecardIncidentDeck()
    },
    reporting: {
      cards: createEcommerceScorecardReportCards(),
      packets: createEcommerceScorecardReviewPackets(),
      summary: summarizeEcommerceScorecardReporting()
    },
    audit: {
      trail: createEcommerceScorecardAuditTrail(),
      manifest: createEcommerceScorecardEvidenceManifest(),
      attestation: createEcommerceScorecardReadinessAttestation()
    },
    playbooks: createEcommerceScorecardPlaybooks(),
    decisions: createEcommerceScorecardDecisionDeck(),
    escalationMoments: createEcommerceScorecardEscalationMoments()
  };
}

export function createEcommerceScorecardReadinessBoard(snapshot = buildEcommerceScorecardSnapshot()) {
  return [
    { id: 'ecommerce-scorecard-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'ecommerce-scorecard-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'ecommerce-scorecard-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'ecommerce-scorecard-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createEcommerceScorecardApiDocument(snapshot = buildEcommerceScorecardSnapshot()) {
  return {
    id: 'ecommerce-scorecard-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/ecommerce-scorecard/overview' },
      { method: 'GET', path: '/api/ecommerce-scorecard/reporting' },
      { method: 'POST', path: '/api/ecommerce-scorecard/validate' },
      { method: 'GET', path: '/api/ecommerce-scorecard/audit' }
    ],
    readiness: createEcommerceScorecardReadinessBoard(snapshot)
  };
}

export function createEcommerceScorecardRouteSummary(snapshot = buildEcommerceScorecardSnapshot()) {
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

