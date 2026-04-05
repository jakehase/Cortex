import { createComplianceIndexWorkspace, summarizeComplianceIndexWorkspace, createComplianceIndexNarratives, createComplianceIndexCoverageGrid } from './domain-compliance-index.mjs';
import { createComplianceIndexPolicies, validateComplianceIndexPolicies, summarizeComplianceIndexPolicies, createComplianceIndexEscalationDeck } from './policies-compliance-index.mjs';
import { createComplianceIndexAnalyticsTimeline, createComplianceIndexForecastEnvelope, createComplianceIndexExceptionLedger, summarizeComplianceIndexAnalytics } from './analytics-compliance-index.mjs';
import { createComplianceIndexOperationsBoard, createComplianceIndexShiftChecklist, createComplianceIndexIncidentDeck } from './operations-compliance-index.mjs';
import { createComplianceIndexReportCards, createComplianceIndexReviewPackets, summarizeComplianceIndexReporting } from './reporting-compliance-index.mjs';
import { createComplianceIndexAuditTrail, createComplianceIndexEvidenceManifest, createComplianceIndexReadinessAttestation } from './audit-compliance-index.mjs';
import { createComplianceIndexPlaybooks, createComplianceIndexDecisionDeck, createComplianceIndexEscalationMoments } from './playbooks-compliance-index.mjs';

export function buildComplianceIndexSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createComplianceIndexWorkspace(workspaceName);
  const policies = createComplianceIndexPolicies();
  return {
    workspace,
    summary: summarizeComplianceIndexWorkspace(workspace),
    narratives: createComplianceIndexNarratives(workspace),
    coverage: createComplianceIndexCoverageGrid(workspace),
    policies,
    policySummary: summarizeComplianceIndexPolicies(policies),
    validation: validateComplianceIndexPolicies(policies),
    escalationDeck: createComplianceIndexEscalationDeck(policies),
    analytics: {
      timeline: createComplianceIndexAnalyticsTimeline(),
      forecast: createComplianceIndexForecastEnvelope(),
      exceptions: createComplianceIndexExceptionLedger(),
      summary: summarizeComplianceIndexAnalytics()
    },
    operations: {
      board: createComplianceIndexOperationsBoard(),
      checklist: createComplianceIndexShiftChecklist(),
      incidents: createComplianceIndexIncidentDeck()
    },
    reporting: {
      cards: createComplianceIndexReportCards(),
      packets: createComplianceIndexReviewPackets(),
      summary: summarizeComplianceIndexReporting()
    },
    audit: {
      trail: createComplianceIndexAuditTrail(),
      manifest: createComplianceIndexEvidenceManifest(),
      attestation: createComplianceIndexReadinessAttestation()
    },
    playbooks: createComplianceIndexPlaybooks(),
    decisions: createComplianceIndexDecisionDeck(),
    escalationMoments: createComplianceIndexEscalationMoments()
  };
}

export function createComplianceIndexReadinessBoard(snapshot = buildComplianceIndexSnapshot()) {
  return [
    { id: 'compliance-index-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'compliance-index-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'compliance-index-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'compliance-index-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createComplianceIndexApiDocument(snapshot = buildComplianceIndexSnapshot()) {
  return {
    id: 'compliance-index-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/compliance-index/overview' },
      { method: 'GET', path: '/api/compliance-index/reporting' },
      { method: 'POST', path: '/api/compliance-index/validate' },
      { method: 'GET', path: '/api/compliance-index/audit' }
    ],
    readiness: createComplianceIndexReadinessBoard(snapshot)
  };
}

export function createComplianceIndexRouteSummary(snapshot = buildComplianceIndexSnapshot()) {
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

