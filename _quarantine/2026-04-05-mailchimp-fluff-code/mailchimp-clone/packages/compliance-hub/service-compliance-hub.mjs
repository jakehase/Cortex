import { createComplianceHubWorkspace, summarizeComplianceHubWorkspace, createComplianceHubNarratives, createComplianceHubCoverageGrid } from './domain-compliance-hub.mjs';
import { createComplianceHubPolicies, validateComplianceHubPolicies, summarizeComplianceHubPolicies, createComplianceHubEscalationDeck } from './policies-compliance-hub.mjs';
import { createComplianceHubAnalyticsTimeline, createComplianceHubForecastEnvelope, createComplianceHubExceptionLedger, summarizeComplianceHubAnalytics } from './analytics-compliance-hub.mjs';
import { createComplianceHubOperationsBoard, createComplianceHubShiftChecklist, createComplianceHubIncidentDeck } from './operations-compliance-hub.mjs';
import { createComplianceHubReportCards, createComplianceHubReviewPackets, summarizeComplianceHubReporting } from './reporting-compliance-hub.mjs';
import { createComplianceHubAuditTrail, createComplianceHubEvidenceManifest, createComplianceHubReadinessAttestation } from './audit-compliance-hub.mjs';
import { createComplianceHubPlaybooks, createComplianceHubDecisionDeck, createComplianceHubEscalationMoments } from './playbooks-compliance-hub.mjs';

export function buildComplianceHubSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createComplianceHubWorkspace(workspaceName);
  const policies = createComplianceHubPolicies();
  return {
    workspace,
    summary: summarizeComplianceHubWorkspace(workspace),
    narratives: createComplianceHubNarratives(workspace),
    coverage: createComplianceHubCoverageGrid(workspace),
    policies,
    policySummary: summarizeComplianceHubPolicies(policies),
    validation: validateComplianceHubPolicies(policies),
    escalationDeck: createComplianceHubEscalationDeck(policies),
    analytics: {
      timeline: createComplianceHubAnalyticsTimeline(),
      forecast: createComplianceHubForecastEnvelope(),
      exceptions: createComplianceHubExceptionLedger(),
      summary: summarizeComplianceHubAnalytics()
    },
    operations: {
      board: createComplianceHubOperationsBoard(),
      checklist: createComplianceHubShiftChecklist(),
      incidents: createComplianceHubIncidentDeck()
    },
    reporting: {
      cards: createComplianceHubReportCards(),
      packets: createComplianceHubReviewPackets(),
      summary: summarizeComplianceHubReporting()
    },
    audit: {
      trail: createComplianceHubAuditTrail(),
      manifest: createComplianceHubEvidenceManifest(),
      attestation: createComplianceHubReadinessAttestation()
    },
    playbooks: createComplianceHubPlaybooks(),
    decisions: createComplianceHubDecisionDeck(),
    escalationMoments: createComplianceHubEscalationMoments()
  };
}

export function createComplianceHubReadinessBoard(snapshot = buildComplianceHubSnapshot()) {
  return [
    { id: 'compliance-hub-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'compliance-hub-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'compliance-hub-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'compliance-hub-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createComplianceHubApiDocument(snapshot = buildComplianceHubSnapshot()) {
  return {
    id: 'compliance-hub-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/compliance-hub/overview' },
      { method: 'GET', path: '/api/compliance-hub/reporting' },
      { method: 'POST', path: '/api/compliance-hub/validate' },
      { method: 'GET', path: '/api/compliance-hub/audit' }
    ],
    readiness: createComplianceHubReadinessBoard(snapshot)
  };
}

export function createComplianceHubRouteSummary(snapshot = buildComplianceHubSnapshot()) {
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

