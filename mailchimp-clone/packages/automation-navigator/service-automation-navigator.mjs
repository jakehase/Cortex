import { createAutomationNavigatorWorkspace, summarizeAutomationNavigatorWorkspace, createAutomationNavigatorNarratives, createAutomationNavigatorCoverageGrid } from './domain-automation-navigator.mjs';
import { createAutomationNavigatorPolicies, validateAutomationNavigatorPolicies, summarizeAutomationNavigatorPolicies, createAutomationNavigatorEscalationDeck } from './policies-automation-navigator.mjs';
import { createAutomationNavigatorAnalyticsTimeline, createAutomationNavigatorForecastEnvelope, createAutomationNavigatorExceptionLedger, summarizeAutomationNavigatorAnalytics } from './analytics-automation-navigator.mjs';
import { createAutomationNavigatorOperationsBoard, createAutomationNavigatorShiftChecklist, createAutomationNavigatorIncidentDeck } from './operations-automation-navigator.mjs';
import { createAutomationNavigatorReportCards, createAutomationNavigatorReviewPackets, summarizeAutomationNavigatorReporting } from './reporting-automation-navigator.mjs';
import { createAutomationNavigatorAuditTrail, createAutomationNavigatorEvidenceManifest, createAutomationNavigatorReadinessAttestation } from './audit-automation-navigator.mjs';
import { createAutomationNavigatorPlaybooks, createAutomationNavigatorDecisionDeck, createAutomationNavigatorEscalationMoments } from './playbooks-automation-navigator.mjs';

export function buildAutomationNavigatorSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAutomationNavigatorWorkspace(workspaceName);
  const policies = createAutomationNavigatorPolicies();
  return {
    workspace,
    summary: summarizeAutomationNavigatorWorkspace(workspace),
    narratives: createAutomationNavigatorNarratives(workspace),
    coverage: createAutomationNavigatorCoverageGrid(workspace),
    policies,
    policySummary: summarizeAutomationNavigatorPolicies(policies),
    validation: validateAutomationNavigatorPolicies(policies),
    escalationDeck: createAutomationNavigatorEscalationDeck(policies),
    analytics: {
      timeline: createAutomationNavigatorAnalyticsTimeline(),
      forecast: createAutomationNavigatorForecastEnvelope(),
      exceptions: createAutomationNavigatorExceptionLedger(),
      summary: summarizeAutomationNavigatorAnalytics()
    },
    operations: {
      board: createAutomationNavigatorOperationsBoard(),
      checklist: createAutomationNavigatorShiftChecklist(),
      incidents: createAutomationNavigatorIncidentDeck()
    },
    reporting: {
      cards: createAutomationNavigatorReportCards(),
      packets: createAutomationNavigatorReviewPackets(),
      summary: summarizeAutomationNavigatorReporting()
    },
    audit: {
      trail: createAutomationNavigatorAuditTrail(),
      manifest: createAutomationNavigatorEvidenceManifest(),
      attestation: createAutomationNavigatorReadinessAttestation()
    },
    playbooks: createAutomationNavigatorPlaybooks(),
    decisions: createAutomationNavigatorDecisionDeck(),
    escalationMoments: createAutomationNavigatorEscalationMoments()
  };
}

export function createAutomationNavigatorReadinessBoard(snapshot = buildAutomationNavigatorSnapshot()) {
  return [
    { id: 'automation-navigator-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'automation-navigator-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'automation-navigator-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'automation-navigator-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAutomationNavigatorApiDocument(snapshot = buildAutomationNavigatorSnapshot()) {
  return {
    id: 'automation-navigator-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/automation-navigator/overview' },
      { method: 'GET', path: '/api/automation-navigator/reporting' },
      { method: 'POST', path: '/api/automation-navigator/validate' },
      { method: 'GET', path: '/api/automation-navigator/audit' }
    ],
    readiness: createAutomationNavigatorReadinessBoard(snapshot)
  };
}

export function createAutomationNavigatorRouteSummary(snapshot = buildAutomationNavigatorSnapshot()) {
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

