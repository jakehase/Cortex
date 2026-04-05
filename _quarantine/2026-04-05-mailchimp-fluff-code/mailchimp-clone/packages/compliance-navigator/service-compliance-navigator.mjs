import { createComplianceNavigatorWorkspace, summarizeComplianceNavigatorWorkspace, createComplianceNavigatorNarratives, createComplianceNavigatorCoverageGrid } from './domain-compliance-navigator.mjs';
import { createComplianceNavigatorPolicies, validateComplianceNavigatorPolicies, summarizeComplianceNavigatorPolicies, createComplianceNavigatorEscalationDeck } from './policies-compliance-navigator.mjs';
import { createComplianceNavigatorAnalyticsTimeline, createComplianceNavigatorForecastEnvelope, createComplianceNavigatorExceptionLedger, summarizeComplianceNavigatorAnalytics } from './analytics-compliance-navigator.mjs';
import { createComplianceNavigatorOperationsBoard, createComplianceNavigatorShiftChecklist, createComplianceNavigatorIncidentDeck } from './operations-compliance-navigator.mjs';
import { createComplianceNavigatorReportCards, createComplianceNavigatorReviewPackets, summarizeComplianceNavigatorReporting } from './reporting-compliance-navigator.mjs';
import { createComplianceNavigatorAuditTrail, createComplianceNavigatorEvidenceManifest, createComplianceNavigatorReadinessAttestation } from './audit-compliance-navigator.mjs';
import { createComplianceNavigatorPlaybooks, createComplianceNavigatorDecisionDeck, createComplianceNavigatorEscalationMoments } from './playbooks-compliance-navigator.mjs';

export function buildComplianceNavigatorSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createComplianceNavigatorWorkspace(workspaceName);
  const policies = createComplianceNavigatorPolicies();
  return {
    workspace,
    summary: summarizeComplianceNavigatorWorkspace(workspace),
    narratives: createComplianceNavigatorNarratives(workspace),
    coverage: createComplianceNavigatorCoverageGrid(workspace),
    policies,
    policySummary: summarizeComplianceNavigatorPolicies(policies),
    validation: validateComplianceNavigatorPolicies(policies),
    escalationDeck: createComplianceNavigatorEscalationDeck(policies),
    analytics: {
      timeline: createComplianceNavigatorAnalyticsTimeline(),
      forecast: createComplianceNavigatorForecastEnvelope(),
      exceptions: createComplianceNavigatorExceptionLedger(),
      summary: summarizeComplianceNavigatorAnalytics()
    },
    operations: {
      board: createComplianceNavigatorOperationsBoard(),
      checklist: createComplianceNavigatorShiftChecklist(),
      incidents: createComplianceNavigatorIncidentDeck()
    },
    reporting: {
      cards: createComplianceNavigatorReportCards(),
      packets: createComplianceNavigatorReviewPackets(),
      summary: summarizeComplianceNavigatorReporting()
    },
    audit: {
      trail: createComplianceNavigatorAuditTrail(),
      manifest: createComplianceNavigatorEvidenceManifest(),
      attestation: createComplianceNavigatorReadinessAttestation()
    },
    playbooks: createComplianceNavigatorPlaybooks(),
    decisions: createComplianceNavigatorDecisionDeck(),
    escalationMoments: createComplianceNavigatorEscalationMoments()
  };
}

export function createComplianceNavigatorReadinessBoard(snapshot = buildComplianceNavigatorSnapshot()) {
  return [
    { id: 'compliance-navigator-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'compliance-navigator-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'compliance-navigator-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'compliance-navigator-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createComplianceNavigatorApiDocument(snapshot = buildComplianceNavigatorSnapshot()) {
  return {
    id: 'compliance-navigator-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/compliance-navigator/overview' },
      { method: 'GET', path: '/api/compliance-navigator/reporting' },
      { method: 'POST', path: '/api/compliance-navigator/validate' },
      { method: 'GET', path: '/api/compliance-navigator/audit' }
    ],
    readiness: createComplianceNavigatorReadinessBoard(snapshot)
  };
}

export function createComplianceNavigatorRouteSummary(snapshot = buildComplianceNavigatorSnapshot()) {
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

