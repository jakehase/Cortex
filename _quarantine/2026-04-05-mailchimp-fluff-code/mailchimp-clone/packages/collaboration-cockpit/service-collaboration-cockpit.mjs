import { createCollaborationCockpitWorkspace, summarizeCollaborationCockpitWorkspace, createCollaborationCockpitNarratives, createCollaborationCockpitCoverageGrid } from './domain-collaboration-cockpit.mjs';
import { createCollaborationCockpitPolicies, validateCollaborationCockpitPolicies, summarizeCollaborationCockpitPolicies, createCollaborationCockpitEscalationDeck } from './policies-collaboration-cockpit.mjs';
import { createCollaborationCockpitAnalyticsTimeline, createCollaborationCockpitForecastEnvelope, createCollaborationCockpitExceptionLedger, summarizeCollaborationCockpitAnalytics } from './analytics-collaboration-cockpit.mjs';
import { createCollaborationCockpitOperationsBoard, createCollaborationCockpitShiftChecklist, createCollaborationCockpitIncidentDeck } from './operations-collaboration-cockpit.mjs';
import { createCollaborationCockpitReportCards, createCollaborationCockpitReviewPackets, summarizeCollaborationCockpitReporting } from './reporting-collaboration-cockpit.mjs';
import { createCollaborationCockpitAuditTrail, createCollaborationCockpitEvidenceManifest, createCollaborationCockpitReadinessAttestation } from './audit-collaboration-cockpit.mjs';
import { createCollaborationCockpitPlaybooks, createCollaborationCockpitDecisionDeck, createCollaborationCockpitEscalationMoments } from './playbooks-collaboration-cockpit.mjs';

export function buildCollaborationCockpitSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCollaborationCockpitWorkspace(workspaceName);
  const policies = createCollaborationCockpitPolicies();
  return {
    workspace,
    summary: summarizeCollaborationCockpitWorkspace(workspace),
    narratives: createCollaborationCockpitNarratives(workspace),
    coverage: createCollaborationCockpitCoverageGrid(workspace),
    policies,
    policySummary: summarizeCollaborationCockpitPolicies(policies),
    validation: validateCollaborationCockpitPolicies(policies),
    escalationDeck: createCollaborationCockpitEscalationDeck(policies),
    analytics: {
      timeline: createCollaborationCockpitAnalyticsTimeline(),
      forecast: createCollaborationCockpitForecastEnvelope(),
      exceptions: createCollaborationCockpitExceptionLedger(),
      summary: summarizeCollaborationCockpitAnalytics()
    },
    operations: {
      board: createCollaborationCockpitOperationsBoard(),
      checklist: createCollaborationCockpitShiftChecklist(),
      incidents: createCollaborationCockpitIncidentDeck()
    },
    reporting: {
      cards: createCollaborationCockpitReportCards(),
      packets: createCollaborationCockpitReviewPackets(),
      summary: summarizeCollaborationCockpitReporting()
    },
    audit: {
      trail: createCollaborationCockpitAuditTrail(),
      manifest: createCollaborationCockpitEvidenceManifest(),
      attestation: createCollaborationCockpitReadinessAttestation()
    },
    playbooks: createCollaborationCockpitPlaybooks(),
    decisions: createCollaborationCockpitDecisionDeck(),
    escalationMoments: createCollaborationCockpitEscalationMoments()
  };
}

export function createCollaborationCockpitReadinessBoard(snapshot = buildCollaborationCockpitSnapshot()) {
  return [
    { id: 'collaboration-cockpit-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'collaboration-cockpit-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'collaboration-cockpit-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'collaboration-cockpit-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCollaborationCockpitApiDocument(snapshot = buildCollaborationCockpitSnapshot()) {
  return {
    id: 'collaboration-cockpit-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/collaboration-cockpit/overview' },
      { method: 'GET', path: '/api/collaboration-cockpit/reporting' },
      { method: 'POST', path: '/api/collaboration-cockpit/validate' },
      { method: 'GET', path: '/api/collaboration-cockpit/audit' }
    ],
    readiness: createCollaborationCockpitReadinessBoard(snapshot)
  };
}

export function createCollaborationCockpitRouteSummary(snapshot = buildCollaborationCockpitSnapshot()) {
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

