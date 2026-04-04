import { createAutomationAdvisorWorkspace, summarizeAutomationAdvisorWorkspace, createAutomationAdvisorNarratives, createAutomationAdvisorCoverageGrid } from './domain-automation-advisor.mjs';
import { createAutomationAdvisorPolicies, validateAutomationAdvisorPolicies, summarizeAutomationAdvisorPolicies, createAutomationAdvisorEscalationDeck } from './policies-automation-advisor.mjs';
import { createAutomationAdvisorAnalyticsTimeline, createAutomationAdvisorForecastEnvelope, createAutomationAdvisorExceptionLedger, summarizeAutomationAdvisorAnalytics } from './analytics-automation-advisor.mjs';
import { createAutomationAdvisorOperationsBoard, createAutomationAdvisorShiftChecklist, createAutomationAdvisorIncidentDeck } from './operations-automation-advisor.mjs';
import { createAutomationAdvisorReportCards, createAutomationAdvisorReviewPackets, summarizeAutomationAdvisorReporting } from './reporting-automation-advisor.mjs';
import { createAutomationAdvisorAuditTrail, createAutomationAdvisorEvidenceManifest, createAutomationAdvisorReadinessAttestation } from './audit-automation-advisor.mjs';
import { createAutomationAdvisorPlaybooks, createAutomationAdvisorDecisionDeck, createAutomationAdvisorEscalationMoments } from './playbooks-automation-advisor.mjs';

export function buildAutomationAdvisorSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAutomationAdvisorWorkspace(workspaceName);
  const policies = createAutomationAdvisorPolicies();
  return {
    workspace,
    summary: summarizeAutomationAdvisorWorkspace(workspace),
    narratives: createAutomationAdvisorNarratives(workspace),
    coverage: createAutomationAdvisorCoverageGrid(workspace),
    policies,
    policySummary: summarizeAutomationAdvisorPolicies(policies),
    validation: validateAutomationAdvisorPolicies(policies),
    escalationDeck: createAutomationAdvisorEscalationDeck(policies),
    analytics: {
      timeline: createAutomationAdvisorAnalyticsTimeline(),
      forecast: createAutomationAdvisorForecastEnvelope(),
      exceptions: createAutomationAdvisorExceptionLedger(),
      summary: summarizeAutomationAdvisorAnalytics()
    },
    operations: {
      board: createAutomationAdvisorOperationsBoard(),
      checklist: createAutomationAdvisorShiftChecklist(),
      incidents: createAutomationAdvisorIncidentDeck()
    },
    reporting: {
      cards: createAutomationAdvisorReportCards(),
      packets: createAutomationAdvisorReviewPackets(),
      summary: summarizeAutomationAdvisorReporting()
    },
    audit: {
      trail: createAutomationAdvisorAuditTrail(),
      manifest: createAutomationAdvisorEvidenceManifest(),
      attestation: createAutomationAdvisorReadinessAttestation()
    },
    playbooks: createAutomationAdvisorPlaybooks(),
    decisions: createAutomationAdvisorDecisionDeck(),
    escalationMoments: createAutomationAdvisorEscalationMoments()
  };
}

export function createAutomationAdvisorReadinessBoard(snapshot = buildAutomationAdvisorSnapshot()) {
  return [
    { id: 'automation-advisor-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'automation-advisor-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'automation-advisor-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'automation-advisor-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAutomationAdvisorApiDocument(snapshot = buildAutomationAdvisorSnapshot()) {
  return {
    id: 'automation-advisor-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/automation-advisor/overview' },
      { method: 'GET', path: '/api/automation-advisor/reporting' },
      { method: 'POST', path: '/api/automation-advisor/validate' },
      { method: 'GET', path: '/api/automation-advisor/audit' }
    ],
    readiness: createAutomationAdvisorReadinessBoard(snapshot)
  };
}

export function createAutomationAdvisorRouteSummary(snapshot = buildAutomationAdvisorSnapshot()) {
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

