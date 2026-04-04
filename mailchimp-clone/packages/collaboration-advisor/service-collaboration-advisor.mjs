import { createCollaborationAdvisorWorkspace, summarizeCollaborationAdvisorWorkspace, createCollaborationAdvisorNarratives, createCollaborationAdvisorCoverageGrid } from './domain-collaboration-advisor.mjs';
import { createCollaborationAdvisorPolicies, validateCollaborationAdvisorPolicies, summarizeCollaborationAdvisorPolicies, createCollaborationAdvisorEscalationDeck } from './policies-collaboration-advisor.mjs';
import { createCollaborationAdvisorAnalyticsTimeline, createCollaborationAdvisorForecastEnvelope, createCollaborationAdvisorExceptionLedger, summarizeCollaborationAdvisorAnalytics } from './analytics-collaboration-advisor.mjs';
import { createCollaborationAdvisorOperationsBoard, createCollaborationAdvisorShiftChecklist, createCollaborationAdvisorIncidentDeck } from './operations-collaboration-advisor.mjs';
import { createCollaborationAdvisorReportCards, createCollaborationAdvisorReviewPackets, summarizeCollaborationAdvisorReporting } from './reporting-collaboration-advisor.mjs';
import { createCollaborationAdvisorAuditTrail, createCollaborationAdvisorEvidenceManifest, createCollaborationAdvisorReadinessAttestation } from './audit-collaboration-advisor.mjs';
import { createCollaborationAdvisorPlaybooks, createCollaborationAdvisorDecisionDeck, createCollaborationAdvisorEscalationMoments } from './playbooks-collaboration-advisor.mjs';

export function buildCollaborationAdvisorSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCollaborationAdvisorWorkspace(workspaceName);
  const policies = createCollaborationAdvisorPolicies();
  return {
    workspace,
    summary: summarizeCollaborationAdvisorWorkspace(workspace),
    narratives: createCollaborationAdvisorNarratives(workspace),
    coverage: createCollaborationAdvisorCoverageGrid(workspace),
    policies,
    policySummary: summarizeCollaborationAdvisorPolicies(policies),
    validation: validateCollaborationAdvisorPolicies(policies),
    escalationDeck: createCollaborationAdvisorEscalationDeck(policies),
    analytics: {
      timeline: createCollaborationAdvisorAnalyticsTimeline(),
      forecast: createCollaborationAdvisorForecastEnvelope(),
      exceptions: createCollaborationAdvisorExceptionLedger(),
      summary: summarizeCollaborationAdvisorAnalytics()
    },
    operations: {
      board: createCollaborationAdvisorOperationsBoard(),
      checklist: createCollaborationAdvisorShiftChecklist(),
      incidents: createCollaborationAdvisorIncidentDeck()
    },
    reporting: {
      cards: createCollaborationAdvisorReportCards(),
      packets: createCollaborationAdvisorReviewPackets(),
      summary: summarizeCollaborationAdvisorReporting()
    },
    audit: {
      trail: createCollaborationAdvisorAuditTrail(),
      manifest: createCollaborationAdvisorEvidenceManifest(),
      attestation: createCollaborationAdvisorReadinessAttestation()
    },
    playbooks: createCollaborationAdvisorPlaybooks(),
    decisions: createCollaborationAdvisorDecisionDeck(),
    escalationMoments: createCollaborationAdvisorEscalationMoments()
  };
}

export function createCollaborationAdvisorReadinessBoard(snapshot = buildCollaborationAdvisorSnapshot()) {
  return [
    { id: 'collaboration-advisor-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'collaboration-advisor-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'collaboration-advisor-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'collaboration-advisor-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCollaborationAdvisorApiDocument(snapshot = buildCollaborationAdvisorSnapshot()) {
  return {
    id: 'collaboration-advisor-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/collaboration-advisor/overview' },
      { method: 'GET', path: '/api/collaboration-advisor/reporting' },
      { method: 'POST', path: '/api/collaboration-advisor/validate' },
      { method: 'GET', path: '/api/collaboration-advisor/audit' }
    ],
    readiness: createCollaborationAdvisorReadinessBoard(snapshot)
  };
}

export function createCollaborationAdvisorRouteSummary(snapshot = buildCollaborationAdvisorSnapshot()) {
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

