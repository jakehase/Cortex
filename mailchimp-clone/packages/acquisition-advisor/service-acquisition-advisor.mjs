import { createAcquisitionAdvisorWorkspace, summarizeAcquisitionAdvisorWorkspace, createAcquisitionAdvisorNarratives, createAcquisitionAdvisorCoverageGrid } from './domain-acquisition-advisor.mjs';
import { createAcquisitionAdvisorPolicies, validateAcquisitionAdvisorPolicies, summarizeAcquisitionAdvisorPolicies, createAcquisitionAdvisorEscalationDeck } from './policies-acquisition-advisor.mjs';
import { createAcquisitionAdvisorAnalyticsTimeline, createAcquisitionAdvisorForecastEnvelope, createAcquisitionAdvisorExceptionLedger, summarizeAcquisitionAdvisorAnalytics } from './analytics-acquisition-advisor.mjs';
import { createAcquisitionAdvisorOperationsBoard, createAcquisitionAdvisorShiftChecklist, createAcquisitionAdvisorIncidentDeck } from './operations-acquisition-advisor.mjs';
import { createAcquisitionAdvisorReportCards, createAcquisitionAdvisorReviewPackets, summarizeAcquisitionAdvisorReporting } from './reporting-acquisition-advisor.mjs';
import { createAcquisitionAdvisorAuditTrail, createAcquisitionAdvisorEvidenceManifest, createAcquisitionAdvisorReadinessAttestation } from './audit-acquisition-advisor.mjs';
import { createAcquisitionAdvisorPlaybooks, createAcquisitionAdvisorDecisionDeck, createAcquisitionAdvisorEscalationMoments } from './playbooks-acquisition-advisor.mjs';

export function buildAcquisitionAdvisorSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAcquisitionAdvisorWorkspace(workspaceName);
  const policies = createAcquisitionAdvisorPolicies();
  return {
    workspace,
    summary: summarizeAcquisitionAdvisorWorkspace(workspace),
    narratives: createAcquisitionAdvisorNarratives(workspace),
    coverage: createAcquisitionAdvisorCoverageGrid(workspace),
    policies,
    policySummary: summarizeAcquisitionAdvisorPolicies(policies),
    validation: validateAcquisitionAdvisorPolicies(policies),
    escalationDeck: createAcquisitionAdvisorEscalationDeck(policies),
    analytics: {
      timeline: createAcquisitionAdvisorAnalyticsTimeline(),
      forecast: createAcquisitionAdvisorForecastEnvelope(),
      exceptions: createAcquisitionAdvisorExceptionLedger(),
      summary: summarizeAcquisitionAdvisorAnalytics()
    },
    operations: {
      board: createAcquisitionAdvisorOperationsBoard(),
      checklist: createAcquisitionAdvisorShiftChecklist(),
      incidents: createAcquisitionAdvisorIncidentDeck()
    },
    reporting: {
      cards: createAcquisitionAdvisorReportCards(),
      packets: createAcquisitionAdvisorReviewPackets(),
      summary: summarizeAcquisitionAdvisorReporting()
    },
    audit: {
      trail: createAcquisitionAdvisorAuditTrail(),
      manifest: createAcquisitionAdvisorEvidenceManifest(),
      attestation: createAcquisitionAdvisorReadinessAttestation()
    },
    playbooks: createAcquisitionAdvisorPlaybooks(),
    decisions: createAcquisitionAdvisorDecisionDeck(),
    escalationMoments: createAcquisitionAdvisorEscalationMoments()
  };
}

export function createAcquisitionAdvisorReadinessBoard(snapshot = buildAcquisitionAdvisorSnapshot()) {
  return [
    { id: 'acquisition-advisor-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'acquisition-advisor-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'acquisition-advisor-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'acquisition-advisor-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAcquisitionAdvisorApiDocument(snapshot = buildAcquisitionAdvisorSnapshot()) {
  return {
    id: 'acquisition-advisor-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/acquisition-advisor/overview' },
      { method: 'GET', path: '/api/acquisition-advisor/reporting' },
      { method: 'POST', path: '/api/acquisition-advisor/validate' },
      { method: 'GET', path: '/api/acquisition-advisor/audit' }
    ],
    readiness: createAcquisitionAdvisorReadinessBoard(snapshot)
  };
}

export function createAcquisitionAdvisorRouteSummary(snapshot = buildAcquisitionAdvisorSnapshot()) {
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

