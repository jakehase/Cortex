import { createPartnerAdvisorWorkspace, summarizePartnerAdvisorWorkspace, createPartnerAdvisorNarratives, createPartnerAdvisorCoverageGrid } from './domain-partner-advisor.mjs';
import { createPartnerAdvisorPolicies, validatePartnerAdvisorPolicies, summarizePartnerAdvisorPolicies, createPartnerAdvisorEscalationDeck } from './policies-partner-advisor.mjs';
import { createPartnerAdvisorAnalyticsTimeline, createPartnerAdvisorForecastEnvelope, createPartnerAdvisorExceptionLedger, summarizePartnerAdvisorAnalytics } from './analytics-partner-advisor.mjs';
import { createPartnerAdvisorOperationsBoard, createPartnerAdvisorShiftChecklist, createPartnerAdvisorIncidentDeck } from './operations-partner-advisor.mjs';
import { createPartnerAdvisorReportCards, createPartnerAdvisorReviewPackets, summarizePartnerAdvisorReporting } from './reporting-partner-advisor.mjs';
import { createPartnerAdvisorAuditTrail, createPartnerAdvisorEvidenceManifest, createPartnerAdvisorReadinessAttestation } from './audit-partner-advisor.mjs';
import { createPartnerAdvisorPlaybooks, createPartnerAdvisorDecisionDeck, createPartnerAdvisorEscalationMoments } from './playbooks-partner-advisor.mjs';

export function buildPartnerAdvisorSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createPartnerAdvisorWorkspace(workspaceName);
  const policies = createPartnerAdvisorPolicies();
  return {
    workspace,
    summary: summarizePartnerAdvisorWorkspace(workspace),
    narratives: createPartnerAdvisorNarratives(workspace),
    coverage: createPartnerAdvisorCoverageGrid(workspace),
    policies,
    policySummary: summarizePartnerAdvisorPolicies(policies),
    validation: validatePartnerAdvisorPolicies(policies),
    escalationDeck: createPartnerAdvisorEscalationDeck(policies),
    analytics: {
      timeline: createPartnerAdvisorAnalyticsTimeline(),
      forecast: createPartnerAdvisorForecastEnvelope(),
      exceptions: createPartnerAdvisorExceptionLedger(),
      summary: summarizePartnerAdvisorAnalytics()
    },
    operations: {
      board: createPartnerAdvisorOperationsBoard(),
      checklist: createPartnerAdvisorShiftChecklist(),
      incidents: createPartnerAdvisorIncidentDeck()
    },
    reporting: {
      cards: createPartnerAdvisorReportCards(),
      packets: createPartnerAdvisorReviewPackets(),
      summary: summarizePartnerAdvisorReporting()
    },
    audit: {
      trail: createPartnerAdvisorAuditTrail(),
      manifest: createPartnerAdvisorEvidenceManifest(),
      attestation: createPartnerAdvisorReadinessAttestation()
    },
    playbooks: createPartnerAdvisorPlaybooks(),
    decisions: createPartnerAdvisorDecisionDeck(),
    escalationMoments: createPartnerAdvisorEscalationMoments()
  };
}

export function createPartnerAdvisorReadinessBoard(snapshot = buildPartnerAdvisorSnapshot()) {
  return [
    { id: 'partner-advisor-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'partner-advisor-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'partner-advisor-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'partner-advisor-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createPartnerAdvisorApiDocument(snapshot = buildPartnerAdvisorSnapshot()) {
  return {
    id: 'partner-advisor-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/partner-advisor/overview' },
      { method: 'GET', path: '/api/partner-advisor/reporting' },
      { method: 'POST', path: '/api/partner-advisor/validate' },
      { method: 'GET', path: '/api/partner-advisor/audit' }
    ],
    readiness: createPartnerAdvisorReadinessBoard(snapshot)
  };
}

export function createPartnerAdvisorRouteSummary(snapshot = buildPartnerAdvisorSnapshot()) {
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

