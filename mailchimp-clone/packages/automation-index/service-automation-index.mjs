import { createAutomationIndexWorkspace, summarizeAutomationIndexWorkspace, createAutomationIndexNarratives, createAutomationIndexCoverageGrid } from './domain-automation-index.mjs';
import { createAutomationIndexPolicies, validateAutomationIndexPolicies, summarizeAutomationIndexPolicies, createAutomationIndexEscalationDeck } from './policies-automation-index.mjs';
import { createAutomationIndexAnalyticsTimeline, createAutomationIndexForecastEnvelope, createAutomationIndexExceptionLedger, summarizeAutomationIndexAnalytics } from './analytics-automation-index.mjs';
import { createAutomationIndexOperationsBoard, createAutomationIndexShiftChecklist, createAutomationIndexIncidentDeck } from './operations-automation-index.mjs';
import { createAutomationIndexReportCards, createAutomationIndexReviewPackets, summarizeAutomationIndexReporting } from './reporting-automation-index.mjs';
import { createAutomationIndexAuditTrail, createAutomationIndexEvidenceManifest, createAutomationIndexReadinessAttestation } from './audit-automation-index.mjs';
import { createAutomationIndexPlaybooks, createAutomationIndexDecisionDeck, createAutomationIndexEscalationMoments } from './playbooks-automation-index.mjs';

export function buildAutomationIndexSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAutomationIndexWorkspace(workspaceName);
  const policies = createAutomationIndexPolicies();
  return {
    workspace,
    summary: summarizeAutomationIndexWorkspace(workspace),
    narratives: createAutomationIndexNarratives(workspace),
    coverage: createAutomationIndexCoverageGrid(workspace),
    policies,
    policySummary: summarizeAutomationIndexPolicies(policies),
    validation: validateAutomationIndexPolicies(policies),
    escalationDeck: createAutomationIndexEscalationDeck(policies),
    analytics: {
      timeline: createAutomationIndexAnalyticsTimeline(),
      forecast: createAutomationIndexForecastEnvelope(),
      exceptions: createAutomationIndexExceptionLedger(),
      summary: summarizeAutomationIndexAnalytics()
    },
    operations: {
      board: createAutomationIndexOperationsBoard(),
      checklist: createAutomationIndexShiftChecklist(),
      incidents: createAutomationIndexIncidentDeck()
    },
    reporting: {
      cards: createAutomationIndexReportCards(),
      packets: createAutomationIndexReviewPackets(),
      summary: summarizeAutomationIndexReporting()
    },
    audit: {
      trail: createAutomationIndexAuditTrail(),
      manifest: createAutomationIndexEvidenceManifest(),
      attestation: createAutomationIndexReadinessAttestation()
    },
    playbooks: createAutomationIndexPlaybooks(),
    decisions: createAutomationIndexDecisionDeck(),
    escalationMoments: createAutomationIndexEscalationMoments()
  };
}

export function createAutomationIndexReadinessBoard(snapshot = buildAutomationIndexSnapshot()) {
  return [
    { id: 'automation-index-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'automation-index-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'automation-index-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'automation-index-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAutomationIndexApiDocument(snapshot = buildAutomationIndexSnapshot()) {
  return {
    id: 'automation-index-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/automation-index/overview' },
      { method: 'GET', path: '/api/automation-index/reporting' },
      { method: 'POST', path: '/api/automation-index/validate' },
      { method: 'GET', path: '/api/automation-index/audit' }
    ],
    readiness: createAutomationIndexReadinessBoard(snapshot)
  };
}

export function createAutomationIndexRouteSummary(snapshot = buildAutomationIndexSnapshot()) {
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

