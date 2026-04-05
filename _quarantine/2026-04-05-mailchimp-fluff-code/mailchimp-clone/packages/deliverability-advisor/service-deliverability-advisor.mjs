import { createDeliverabilityAdvisorWorkspace, summarizeDeliverabilityAdvisorWorkspace, createDeliverabilityAdvisorNarratives, createDeliverabilityAdvisorCoverageGrid } from './domain-deliverability-advisor.mjs';
import { createDeliverabilityAdvisorPolicies, validateDeliverabilityAdvisorPolicies, summarizeDeliverabilityAdvisorPolicies, createDeliverabilityAdvisorEscalationDeck } from './policies-deliverability-advisor.mjs';
import { createDeliverabilityAdvisorAnalyticsTimeline, createDeliverabilityAdvisorForecastEnvelope, createDeliverabilityAdvisorExceptionLedger, summarizeDeliverabilityAdvisorAnalytics } from './analytics-deliverability-advisor.mjs';
import { createDeliverabilityAdvisorOperationsBoard, createDeliverabilityAdvisorShiftChecklist, createDeliverabilityAdvisorIncidentDeck } from './operations-deliverability-advisor.mjs';
import { createDeliverabilityAdvisorReportCards, createDeliverabilityAdvisorReviewPackets, summarizeDeliverabilityAdvisorReporting } from './reporting-deliverability-advisor.mjs';
import { createDeliverabilityAdvisorAuditTrail, createDeliverabilityAdvisorEvidenceManifest, createDeliverabilityAdvisorReadinessAttestation } from './audit-deliverability-advisor.mjs';
import { createDeliverabilityAdvisorPlaybooks, createDeliverabilityAdvisorDecisionDeck, createDeliverabilityAdvisorEscalationMoments } from './playbooks-deliverability-advisor.mjs';

export function buildDeliverabilityAdvisorSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createDeliverabilityAdvisorWorkspace(workspaceName);
  const policies = createDeliverabilityAdvisorPolicies();
  return {
    workspace,
    summary: summarizeDeliverabilityAdvisorWorkspace(workspace),
    narratives: createDeliverabilityAdvisorNarratives(workspace),
    coverage: createDeliverabilityAdvisorCoverageGrid(workspace),
    policies,
    policySummary: summarizeDeliverabilityAdvisorPolicies(policies),
    validation: validateDeliverabilityAdvisorPolicies(policies),
    escalationDeck: createDeliverabilityAdvisorEscalationDeck(policies),
    analytics: {
      timeline: createDeliverabilityAdvisorAnalyticsTimeline(),
      forecast: createDeliverabilityAdvisorForecastEnvelope(),
      exceptions: createDeliverabilityAdvisorExceptionLedger(),
      summary: summarizeDeliverabilityAdvisorAnalytics()
    },
    operations: {
      board: createDeliverabilityAdvisorOperationsBoard(),
      checklist: createDeliverabilityAdvisorShiftChecklist(),
      incidents: createDeliverabilityAdvisorIncidentDeck()
    },
    reporting: {
      cards: createDeliverabilityAdvisorReportCards(),
      packets: createDeliverabilityAdvisorReviewPackets(),
      summary: summarizeDeliverabilityAdvisorReporting()
    },
    audit: {
      trail: createDeliverabilityAdvisorAuditTrail(),
      manifest: createDeliverabilityAdvisorEvidenceManifest(),
      attestation: createDeliverabilityAdvisorReadinessAttestation()
    },
    playbooks: createDeliverabilityAdvisorPlaybooks(),
    decisions: createDeliverabilityAdvisorDecisionDeck(),
    escalationMoments: createDeliverabilityAdvisorEscalationMoments()
  };
}

export function createDeliverabilityAdvisorReadinessBoard(snapshot = buildDeliverabilityAdvisorSnapshot()) {
  return [
    { id: 'deliverability-advisor-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'deliverability-advisor-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'deliverability-advisor-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'deliverability-advisor-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createDeliverabilityAdvisorApiDocument(snapshot = buildDeliverabilityAdvisorSnapshot()) {
  return {
    id: 'deliverability-advisor-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/deliverability-advisor/overview' },
      { method: 'GET', path: '/api/deliverability-advisor/reporting' },
      { method: 'POST', path: '/api/deliverability-advisor/validate' },
      { method: 'GET', path: '/api/deliverability-advisor/audit' }
    ],
    readiness: createDeliverabilityAdvisorReadinessBoard(snapshot)
  };
}

export function createDeliverabilityAdvisorRouteSummary(snapshot = buildDeliverabilityAdvisorSnapshot()) {
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

