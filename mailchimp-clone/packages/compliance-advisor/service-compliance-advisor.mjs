import { createComplianceAdvisorWorkspace, summarizeComplianceAdvisorWorkspace, createComplianceAdvisorNarratives, createComplianceAdvisorCoverageGrid } from './domain-compliance-advisor.mjs';
import { createComplianceAdvisorPolicies, validateComplianceAdvisorPolicies, summarizeComplianceAdvisorPolicies, createComplianceAdvisorEscalationDeck } from './policies-compliance-advisor.mjs';
import { createComplianceAdvisorAnalyticsTimeline, createComplianceAdvisorForecastEnvelope, createComplianceAdvisorExceptionLedger, summarizeComplianceAdvisorAnalytics } from './analytics-compliance-advisor.mjs';
import { createComplianceAdvisorOperationsBoard, createComplianceAdvisorShiftChecklist, createComplianceAdvisorIncidentDeck } from './operations-compliance-advisor.mjs';
import { createComplianceAdvisorReportCards, createComplianceAdvisorReviewPackets, summarizeComplianceAdvisorReporting } from './reporting-compliance-advisor.mjs';
import { createComplianceAdvisorAuditTrail, createComplianceAdvisorEvidenceManifest, createComplianceAdvisorReadinessAttestation } from './audit-compliance-advisor.mjs';
import { createComplianceAdvisorPlaybooks, createComplianceAdvisorDecisionDeck, createComplianceAdvisorEscalationMoments } from './playbooks-compliance-advisor.mjs';

export function buildComplianceAdvisorSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createComplianceAdvisorWorkspace(workspaceName);
  const policies = createComplianceAdvisorPolicies();
  return {
    workspace,
    summary: summarizeComplianceAdvisorWorkspace(workspace),
    narratives: createComplianceAdvisorNarratives(workspace),
    coverage: createComplianceAdvisorCoverageGrid(workspace),
    policies,
    policySummary: summarizeComplianceAdvisorPolicies(policies),
    validation: validateComplianceAdvisorPolicies(policies),
    escalationDeck: createComplianceAdvisorEscalationDeck(policies),
    analytics: {
      timeline: createComplianceAdvisorAnalyticsTimeline(),
      forecast: createComplianceAdvisorForecastEnvelope(),
      exceptions: createComplianceAdvisorExceptionLedger(),
      summary: summarizeComplianceAdvisorAnalytics()
    },
    operations: {
      board: createComplianceAdvisorOperationsBoard(),
      checklist: createComplianceAdvisorShiftChecklist(),
      incidents: createComplianceAdvisorIncidentDeck()
    },
    reporting: {
      cards: createComplianceAdvisorReportCards(),
      packets: createComplianceAdvisorReviewPackets(),
      summary: summarizeComplianceAdvisorReporting()
    },
    audit: {
      trail: createComplianceAdvisorAuditTrail(),
      manifest: createComplianceAdvisorEvidenceManifest(),
      attestation: createComplianceAdvisorReadinessAttestation()
    },
    playbooks: createComplianceAdvisorPlaybooks(),
    decisions: createComplianceAdvisorDecisionDeck(),
    escalationMoments: createComplianceAdvisorEscalationMoments()
  };
}

export function createComplianceAdvisorReadinessBoard(snapshot = buildComplianceAdvisorSnapshot()) {
  return [
    { id: 'compliance-advisor-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'compliance-advisor-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'compliance-advisor-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'compliance-advisor-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createComplianceAdvisorApiDocument(snapshot = buildComplianceAdvisorSnapshot()) {
  return {
    id: 'compliance-advisor-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/compliance-advisor/overview' },
      { method: 'GET', path: '/api/compliance-advisor/reporting' },
      { method: 'POST', path: '/api/compliance-advisor/validate' },
      { method: 'GET', path: '/api/compliance-advisor/audit' }
    ],
    readiness: createComplianceAdvisorReadinessBoard(snapshot)
  };
}

export function createComplianceAdvisorRouteSummary(snapshot = buildComplianceAdvisorSnapshot()) {
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

