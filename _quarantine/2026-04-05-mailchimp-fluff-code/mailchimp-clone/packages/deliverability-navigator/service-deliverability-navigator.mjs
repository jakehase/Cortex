import { createDeliverabilityNavigatorWorkspace, summarizeDeliverabilityNavigatorWorkspace, createDeliverabilityNavigatorNarratives, createDeliverabilityNavigatorCoverageGrid } from './domain-deliverability-navigator.mjs';
import { createDeliverabilityNavigatorPolicies, validateDeliverabilityNavigatorPolicies, summarizeDeliverabilityNavigatorPolicies, createDeliverabilityNavigatorEscalationDeck } from './policies-deliverability-navigator.mjs';
import { createDeliverabilityNavigatorAnalyticsTimeline, createDeliverabilityNavigatorForecastEnvelope, createDeliverabilityNavigatorExceptionLedger, summarizeDeliverabilityNavigatorAnalytics } from './analytics-deliverability-navigator.mjs';
import { createDeliverabilityNavigatorOperationsBoard, createDeliverabilityNavigatorShiftChecklist, createDeliverabilityNavigatorIncidentDeck } from './operations-deliverability-navigator.mjs';
import { createDeliverabilityNavigatorReportCards, createDeliverabilityNavigatorReviewPackets, summarizeDeliverabilityNavigatorReporting } from './reporting-deliverability-navigator.mjs';
import { createDeliverabilityNavigatorAuditTrail, createDeliverabilityNavigatorEvidenceManifest, createDeliverabilityNavigatorReadinessAttestation } from './audit-deliverability-navigator.mjs';
import { createDeliverabilityNavigatorPlaybooks, createDeliverabilityNavigatorDecisionDeck, createDeliverabilityNavigatorEscalationMoments } from './playbooks-deliverability-navigator.mjs';

export function buildDeliverabilityNavigatorSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createDeliverabilityNavigatorWorkspace(workspaceName);
  const policies = createDeliverabilityNavigatorPolicies();
  return {
    workspace,
    summary: summarizeDeliverabilityNavigatorWorkspace(workspace),
    narratives: createDeliverabilityNavigatorNarratives(workspace),
    coverage: createDeliverabilityNavigatorCoverageGrid(workspace),
    policies,
    policySummary: summarizeDeliverabilityNavigatorPolicies(policies),
    validation: validateDeliverabilityNavigatorPolicies(policies),
    escalationDeck: createDeliverabilityNavigatorEscalationDeck(policies),
    analytics: {
      timeline: createDeliverabilityNavigatorAnalyticsTimeline(),
      forecast: createDeliverabilityNavigatorForecastEnvelope(),
      exceptions: createDeliverabilityNavigatorExceptionLedger(),
      summary: summarizeDeliverabilityNavigatorAnalytics()
    },
    operations: {
      board: createDeliverabilityNavigatorOperationsBoard(),
      checklist: createDeliverabilityNavigatorShiftChecklist(),
      incidents: createDeliverabilityNavigatorIncidentDeck()
    },
    reporting: {
      cards: createDeliverabilityNavigatorReportCards(),
      packets: createDeliverabilityNavigatorReviewPackets(),
      summary: summarizeDeliverabilityNavigatorReporting()
    },
    audit: {
      trail: createDeliverabilityNavigatorAuditTrail(),
      manifest: createDeliverabilityNavigatorEvidenceManifest(),
      attestation: createDeliverabilityNavigatorReadinessAttestation()
    },
    playbooks: createDeliverabilityNavigatorPlaybooks(),
    decisions: createDeliverabilityNavigatorDecisionDeck(),
    escalationMoments: createDeliverabilityNavigatorEscalationMoments()
  };
}

export function createDeliverabilityNavigatorReadinessBoard(snapshot = buildDeliverabilityNavigatorSnapshot()) {
  return [
    { id: 'deliverability-navigator-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'deliverability-navigator-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'deliverability-navigator-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'deliverability-navigator-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createDeliverabilityNavigatorApiDocument(snapshot = buildDeliverabilityNavigatorSnapshot()) {
  return {
    id: 'deliverability-navigator-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/deliverability-navigator/overview' },
      { method: 'GET', path: '/api/deliverability-navigator/reporting' },
      { method: 'POST', path: '/api/deliverability-navigator/validate' },
      { method: 'GET', path: '/api/deliverability-navigator/audit' }
    ],
    readiness: createDeliverabilityNavigatorReadinessBoard(snapshot)
  };
}

export function createDeliverabilityNavigatorRouteSummary(snapshot = buildDeliverabilityNavigatorSnapshot()) {
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

