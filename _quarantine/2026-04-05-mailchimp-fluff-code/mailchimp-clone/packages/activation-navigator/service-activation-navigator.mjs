import { createActivationNavigatorWorkspace, summarizeActivationNavigatorWorkspace, createActivationNavigatorNarratives, createActivationNavigatorCoverageGrid } from './domain-activation-navigator.mjs';
import { createActivationNavigatorPolicies, validateActivationNavigatorPolicies, summarizeActivationNavigatorPolicies, createActivationNavigatorEscalationDeck } from './policies-activation-navigator.mjs';
import { createActivationNavigatorAnalyticsTimeline, createActivationNavigatorForecastEnvelope, createActivationNavigatorExceptionLedger, summarizeActivationNavigatorAnalytics } from './analytics-activation-navigator.mjs';
import { createActivationNavigatorOperationsBoard, createActivationNavigatorShiftChecklist, createActivationNavigatorIncidentDeck } from './operations-activation-navigator.mjs';
import { createActivationNavigatorReportCards, createActivationNavigatorReviewPackets, summarizeActivationNavigatorReporting } from './reporting-activation-navigator.mjs';
import { createActivationNavigatorAuditTrail, createActivationNavigatorEvidenceManifest, createActivationNavigatorReadinessAttestation } from './audit-activation-navigator.mjs';
import { createActivationNavigatorPlaybooks, createActivationNavigatorDecisionDeck, createActivationNavigatorEscalationMoments } from './playbooks-activation-navigator.mjs';

export function buildActivationNavigatorSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createActivationNavigatorWorkspace(workspaceName);
  const policies = createActivationNavigatorPolicies();
  return {
    workspace,
    summary: summarizeActivationNavigatorWorkspace(workspace),
    narratives: createActivationNavigatorNarratives(workspace),
    coverage: createActivationNavigatorCoverageGrid(workspace),
    policies,
    policySummary: summarizeActivationNavigatorPolicies(policies),
    validation: validateActivationNavigatorPolicies(policies),
    escalationDeck: createActivationNavigatorEscalationDeck(policies),
    analytics: {
      timeline: createActivationNavigatorAnalyticsTimeline(),
      forecast: createActivationNavigatorForecastEnvelope(),
      exceptions: createActivationNavigatorExceptionLedger(),
      summary: summarizeActivationNavigatorAnalytics()
    },
    operations: {
      board: createActivationNavigatorOperationsBoard(),
      checklist: createActivationNavigatorShiftChecklist(),
      incidents: createActivationNavigatorIncidentDeck()
    },
    reporting: {
      cards: createActivationNavigatorReportCards(),
      packets: createActivationNavigatorReviewPackets(),
      summary: summarizeActivationNavigatorReporting()
    },
    audit: {
      trail: createActivationNavigatorAuditTrail(),
      manifest: createActivationNavigatorEvidenceManifest(),
      attestation: createActivationNavigatorReadinessAttestation()
    },
    playbooks: createActivationNavigatorPlaybooks(),
    decisions: createActivationNavigatorDecisionDeck(),
    escalationMoments: createActivationNavigatorEscalationMoments()
  };
}

export function createActivationNavigatorReadinessBoard(snapshot = buildActivationNavigatorSnapshot()) {
  return [
    { id: 'activation-navigator-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'activation-navigator-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'activation-navigator-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'activation-navigator-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createActivationNavigatorApiDocument(snapshot = buildActivationNavigatorSnapshot()) {
  return {
    id: 'activation-navigator-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/activation-navigator/overview' },
      { method: 'GET', path: '/api/activation-navigator/reporting' },
      { method: 'POST', path: '/api/activation-navigator/validate' },
      { method: 'GET', path: '/api/activation-navigator/audit' }
    ],
    readiness: createActivationNavigatorReadinessBoard(snapshot)
  };
}

export function createActivationNavigatorRouteSummary(snapshot = buildActivationNavigatorSnapshot()) {
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

