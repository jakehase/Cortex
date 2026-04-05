import { createComplianceStudioWorkspace, summarizeComplianceStudioWorkspace, createComplianceStudioNarratives, createComplianceStudioCoverageGrid } from './domain-compliance-studio.mjs';
import { createComplianceStudioPolicies, validateComplianceStudioPolicies, summarizeComplianceStudioPolicies, createComplianceStudioEscalationDeck } from './policies-compliance-studio.mjs';
import { createComplianceStudioAnalyticsTimeline, createComplianceStudioForecastEnvelope, createComplianceStudioExceptionLedger, summarizeComplianceStudioAnalytics } from './analytics-compliance-studio.mjs';
import { createComplianceStudioOperationsBoard, createComplianceStudioShiftChecklist, createComplianceStudioIncidentDeck } from './operations-compliance-studio.mjs';
import { createComplianceStudioReportCards, createComplianceStudioReviewPackets, summarizeComplianceStudioReporting } from './reporting-compliance-studio.mjs';
import { createComplianceStudioAuditTrail, createComplianceStudioEvidenceManifest, createComplianceStudioReadinessAttestation } from './audit-compliance-studio.mjs';
import { createComplianceStudioPlaybooks, createComplianceStudioDecisionDeck, createComplianceStudioEscalationMoments } from './playbooks-compliance-studio.mjs';

export function buildComplianceStudioSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createComplianceStudioWorkspace(workspaceName);
  const policies = createComplianceStudioPolicies();
  return {
    workspace,
    summary: summarizeComplianceStudioWorkspace(workspace),
    narratives: createComplianceStudioNarratives(workspace),
    coverage: createComplianceStudioCoverageGrid(workspace),
    policies,
    policySummary: summarizeComplianceStudioPolicies(policies),
    validation: validateComplianceStudioPolicies(policies),
    escalationDeck: createComplianceStudioEscalationDeck(policies),
    analytics: {
      timeline: createComplianceStudioAnalyticsTimeline(),
      forecast: createComplianceStudioForecastEnvelope(),
      exceptions: createComplianceStudioExceptionLedger(),
      summary: summarizeComplianceStudioAnalytics()
    },
    operations: {
      board: createComplianceStudioOperationsBoard(),
      checklist: createComplianceStudioShiftChecklist(),
      incidents: createComplianceStudioIncidentDeck()
    },
    reporting: {
      cards: createComplianceStudioReportCards(),
      packets: createComplianceStudioReviewPackets(),
      summary: summarizeComplianceStudioReporting()
    },
    audit: {
      trail: createComplianceStudioAuditTrail(),
      manifest: createComplianceStudioEvidenceManifest(),
      attestation: createComplianceStudioReadinessAttestation()
    },
    playbooks: createComplianceStudioPlaybooks(),
    decisions: createComplianceStudioDecisionDeck(),
    escalationMoments: createComplianceStudioEscalationMoments()
  };
}

export function createComplianceStudioReadinessBoard(snapshot = buildComplianceStudioSnapshot()) {
  return [
    { id: 'compliance-studio-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'compliance-studio-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'compliance-studio-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'compliance-studio-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createComplianceStudioApiDocument(snapshot = buildComplianceStudioSnapshot()) {
  return {
    id: 'compliance-studio-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/compliance-studio/overview' },
      { method: 'GET', path: '/api/compliance-studio/reporting' },
      { method: 'POST', path: '/api/compliance-studio/validate' },
      { method: 'GET', path: '/api/compliance-studio/audit' }
    ],
    readiness: createComplianceStudioReadinessBoard(snapshot)
  };
}

export function createComplianceStudioRouteSummary(snapshot = buildComplianceStudioSnapshot()) {
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

