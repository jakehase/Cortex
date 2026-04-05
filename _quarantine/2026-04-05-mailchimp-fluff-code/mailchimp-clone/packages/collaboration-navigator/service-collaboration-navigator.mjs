import { createCollaborationNavigatorWorkspace, summarizeCollaborationNavigatorWorkspace, createCollaborationNavigatorNarratives, createCollaborationNavigatorCoverageGrid } from './domain-collaboration-navigator.mjs';
import { createCollaborationNavigatorPolicies, validateCollaborationNavigatorPolicies, summarizeCollaborationNavigatorPolicies, createCollaborationNavigatorEscalationDeck } from './policies-collaboration-navigator.mjs';
import { createCollaborationNavigatorAnalyticsTimeline, createCollaborationNavigatorForecastEnvelope, createCollaborationNavigatorExceptionLedger, summarizeCollaborationNavigatorAnalytics } from './analytics-collaboration-navigator.mjs';
import { createCollaborationNavigatorOperationsBoard, createCollaborationNavigatorShiftChecklist, createCollaborationNavigatorIncidentDeck } from './operations-collaboration-navigator.mjs';
import { createCollaborationNavigatorReportCards, createCollaborationNavigatorReviewPackets, summarizeCollaborationNavigatorReporting } from './reporting-collaboration-navigator.mjs';
import { createCollaborationNavigatorAuditTrail, createCollaborationNavigatorEvidenceManifest, createCollaborationNavigatorReadinessAttestation } from './audit-collaboration-navigator.mjs';
import { createCollaborationNavigatorPlaybooks, createCollaborationNavigatorDecisionDeck, createCollaborationNavigatorEscalationMoments } from './playbooks-collaboration-navigator.mjs';

export function buildCollaborationNavigatorSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCollaborationNavigatorWorkspace(workspaceName);
  const policies = createCollaborationNavigatorPolicies();
  return {
    workspace,
    summary: summarizeCollaborationNavigatorWorkspace(workspace),
    narratives: createCollaborationNavigatorNarratives(workspace),
    coverage: createCollaborationNavigatorCoverageGrid(workspace),
    policies,
    policySummary: summarizeCollaborationNavigatorPolicies(policies),
    validation: validateCollaborationNavigatorPolicies(policies),
    escalationDeck: createCollaborationNavigatorEscalationDeck(policies),
    analytics: {
      timeline: createCollaborationNavigatorAnalyticsTimeline(),
      forecast: createCollaborationNavigatorForecastEnvelope(),
      exceptions: createCollaborationNavigatorExceptionLedger(),
      summary: summarizeCollaborationNavigatorAnalytics()
    },
    operations: {
      board: createCollaborationNavigatorOperationsBoard(),
      checklist: createCollaborationNavigatorShiftChecklist(),
      incidents: createCollaborationNavigatorIncidentDeck()
    },
    reporting: {
      cards: createCollaborationNavigatorReportCards(),
      packets: createCollaborationNavigatorReviewPackets(),
      summary: summarizeCollaborationNavigatorReporting()
    },
    audit: {
      trail: createCollaborationNavigatorAuditTrail(),
      manifest: createCollaborationNavigatorEvidenceManifest(),
      attestation: createCollaborationNavigatorReadinessAttestation()
    },
    playbooks: createCollaborationNavigatorPlaybooks(),
    decisions: createCollaborationNavigatorDecisionDeck(),
    escalationMoments: createCollaborationNavigatorEscalationMoments()
  };
}

export function createCollaborationNavigatorReadinessBoard(snapshot = buildCollaborationNavigatorSnapshot()) {
  return [
    { id: 'collaboration-navigator-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'collaboration-navigator-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'collaboration-navigator-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'collaboration-navigator-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCollaborationNavigatorApiDocument(snapshot = buildCollaborationNavigatorSnapshot()) {
  return {
    id: 'collaboration-navigator-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/collaboration-navigator/overview' },
      { method: 'GET', path: '/api/collaboration-navigator/reporting' },
      { method: 'POST', path: '/api/collaboration-navigator/validate' },
      { method: 'GET', path: '/api/collaboration-navigator/audit' }
    ],
    readiness: createCollaborationNavigatorReadinessBoard(snapshot)
  };
}

export function createCollaborationNavigatorRouteSummary(snapshot = buildCollaborationNavigatorSnapshot()) {
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

