import { createAutomationCockpitWorkspace, summarizeAutomationCockpitWorkspace, createAutomationCockpitNarratives, createAutomationCockpitCoverageGrid } from './domain-automation-cockpit.mjs';
import { createAutomationCockpitPolicies, validateAutomationCockpitPolicies, summarizeAutomationCockpitPolicies, createAutomationCockpitEscalationDeck } from './policies-automation-cockpit.mjs';
import { createAutomationCockpitAnalyticsTimeline, createAutomationCockpitForecastEnvelope, createAutomationCockpitExceptionLedger, summarizeAutomationCockpitAnalytics } from './analytics-automation-cockpit.mjs';
import { createAutomationCockpitOperationsBoard, createAutomationCockpitShiftChecklist, createAutomationCockpitIncidentDeck } from './operations-automation-cockpit.mjs';
import { createAutomationCockpitReportCards, createAutomationCockpitReviewPackets, summarizeAutomationCockpitReporting } from './reporting-automation-cockpit.mjs';
import { createAutomationCockpitAuditTrail, createAutomationCockpitEvidenceManifest, createAutomationCockpitReadinessAttestation } from './audit-automation-cockpit.mjs';
import { createAutomationCockpitPlaybooks, createAutomationCockpitDecisionDeck, createAutomationCockpitEscalationMoments } from './playbooks-automation-cockpit.mjs';

export function buildAutomationCockpitSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAutomationCockpitWorkspace(workspaceName);
  const policies = createAutomationCockpitPolicies();
  return {
    workspace,
    summary: summarizeAutomationCockpitWorkspace(workspace),
    narratives: createAutomationCockpitNarratives(workspace),
    coverage: createAutomationCockpitCoverageGrid(workspace),
    policies,
    policySummary: summarizeAutomationCockpitPolicies(policies),
    validation: validateAutomationCockpitPolicies(policies),
    escalationDeck: createAutomationCockpitEscalationDeck(policies),
    analytics: {
      timeline: createAutomationCockpitAnalyticsTimeline(),
      forecast: createAutomationCockpitForecastEnvelope(),
      exceptions: createAutomationCockpitExceptionLedger(),
      summary: summarizeAutomationCockpitAnalytics()
    },
    operations: {
      board: createAutomationCockpitOperationsBoard(),
      checklist: createAutomationCockpitShiftChecklist(),
      incidents: createAutomationCockpitIncidentDeck()
    },
    reporting: {
      cards: createAutomationCockpitReportCards(),
      packets: createAutomationCockpitReviewPackets(),
      summary: summarizeAutomationCockpitReporting()
    },
    audit: {
      trail: createAutomationCockpitAuditTrail(),
      manifest: createAutomationCockpitEvidenceManifest(),
      attestation: createAutomationCockpitReadinessAttestation()
    },
    playbooks: createAutomationCockpitPlaybooks(),
    decisions: createAutomationCockpitDecisionDeck(),
    escalationMoments: createAutomationCockpitEscalationMoments()
  };
}

export function createAutomationCockpitReadinessBoard(snapshot = buildAutomationCockpitSnapshot()) {
  return [
    { id: 'automation-cockpit-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'automation-cockpit-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'automation-cockpit-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'automation-cockpit-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAutomationCockpitApiDocument(snapshot = buildAutomationCockpitSnapshot()) {
  return {
    id: 'automation-cockpit-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/automation-cockpit/overview' },
      { method: 'GET', path: '/api/automation-cockpit/reporting' },
      { method: 'POST', path: '/api/automation-cockpit/validate' },
      { method: 'GET', path: '/api/automation-cockpit/audit' }
    ],
    readiness: createAutomationCockpitReadinessBoard(snapshot)
  };
}

export function createAutomationCockpitRouteSummary(snapshot = buildAutomationCockpitSnapshot()) {
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

