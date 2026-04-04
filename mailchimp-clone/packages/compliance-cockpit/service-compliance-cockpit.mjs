import { createComplianceCockpitWorkspace, summarizeComplianceCockpitWorkspace, createComplianceCockpitNarratives, createComplianceCockpitCoverageGrid } from './domain-compliance-cockpit.mjs';
import { createComplianceCockpitPolicies, validateComplianceCockpitPolicies, summarizeComplianceCockpitPolicies, createComplianceCockpitEscalationDeck } from './policies-compliance-cockpit.mjs';
import { createComplianceCockpitAnalyticsTimeline, createComplianceCockpitForecastEnvelope, createComplianceCockpitExceptionLedger, summarizeComplianceCockpitAnalytics } from './analytics-compliance-cockpit.mjs';
import { createComplianceCockpitOperationsBoard, createComplianceCockpitShiftChecklist, createComplianceCockpitIncidentDeck } from './operations-compliance-cockpit.mjs';
import { createComplianceCockpitReportCards, createComplianceCockpitReviewPackets, summarizeComplianceCockpitReporting } from './reporting-compliance-cockpit.mjs';
import { createComplianceCockpitAuditTrail, createComplianceCockpitEvidenceManifest, createComplianceCockpitReadinessAttestation } from './audit-compliance-cockpit.mjs';
import { createComplianceCockpitPlaybooks, createComplianceCockpitDecisionDeck, createComplianceCockpitEscalationMoments } from './playbooks-compliance-cockpit.mjs';

export function buildComplianceCockpitSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createComplianceCockpitWorkspace(workspaceName);
  const policies = createComplianceCockpitPolicies();
  return {
    workspace,
    summary: summarizeComplianceCockpitWorkspace(workspace),
    narratives: createComplianceCockpitNarratives(workspace),
    coverage: createComplianceCockpitCoverageGrid(workspace),
    policies,
    policySummary: summarizeComplianceCockpitPolicies(policies),
    validation: validateComplianceCockpitPolicies(policies),
    escalationDeck: createComplianceCockpitEscalationDeck(policies),
    analytics: {
      timeline: createComplianceCockpitAnalyticsTimeline(),
      forecast: createComplianceCockpitForecastEnvelope(),
      exceptions: createComplianceCockpitExceptionLedger(),
      summary: summarizeComplianceCockpitAnalytics()
    },
    operations: {
      board: createComplianceCockpitOperationsBoard(),
      checklist: createComplianceCockpitShiftChecklist(),
      incidents: createComplianceCockpitIncidentDeck()
    },
    reporting: {
      cards: createComplianceCockpitReportCards(),
      packets: createComplianceCockpitReviewPackets(),
      summary: summarizeComplianceCockpitReporting()
    },
    audit: {
      trail: createComplianceCockpitAuditTrail(),
      manifest: createComplianceCockpitEvidenceManifest(),
      attestation: createComplianceCockpitReadinessAttestation()
    },
    playbooks: createComplianceCockpitPlaybooks(),
    decisions: createComplianceCockpitDecisionDeck(),
    escalationMoments: createComplianceCockpitEscalationMoments()
  };
}

export function createComplianceCockpitReadinessBoard(snapshot = buildComplianceCockpitSnapshot()) {
  return [
    { id: 'compliance-cockpit-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'compliance-cockpit-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'compliance-cockpit-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'compliance-cockpit-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createComplianceCockpitApiDocument(snapshot = buildComplianceCockpitSnapshot()) {
  return {
    id: 'compliance-cockpit-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/compliance-cockpit/overview' },
      { method: 'GET', path: '/api/compliance-cockpit/reporting' },
      { method: 'POST', path: '/api/compliance-cockpit/validate' },
      { method: 'GET', path: '/api/compliance-cockpit/audit' }
    ],
    readiness: createComplianceCockpitReadinessBoard(snapshot)
  };
}

export function createComplianceCockpitRouteSummary(snapshot = buildComplianceCockpitSnapshot()) {
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

