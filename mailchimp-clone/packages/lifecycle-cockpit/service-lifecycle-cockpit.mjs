import { createLifecycleCockpitWorkspace, summarizeLifecycleCockpitWorkspace, createLifecycleCockpitNarratives, createLifecycleCockpitCoverageGrid } from './domain-lifecycle-cockpit.mjs';
import { createLifecycleCockpitPolicies, validateLifecycleCockpitPolicies, summarizeLifecycleCockpitPolicies, createLifecycleCockpitEscalationDeck } from './policies-lifecycle-cockpit.mjs';
import { createLifecycleCockpitAnalyticsTimeline, createLifecycleCockpitForecastEnvelope, createLifecycleCockpitExceptionLedger, summarizeLifecycleCockpitAnalytics } from './analytics-lifecycle-cockpit.mjs';
import { createLifecycleCockpitOperationsBoard, createLifecycleCockpitShiftChecklist, createLifecycleCockpitIncidentDeck } from './operations-lifecycle-cockpit.mjs';
import { createLifecycleCockpitReportCards, createLifecycleCockpitReviewPackets, summarizeLifecycleCockpitReporting } from './reporting-lifecycle-cockpit.mjs';
import { createLifecycleCockpitAuditTrail, createLifecycleCockpitEvidenceManifest, createLifecycleCockpitReadinessAttestation } from './audit-lifecycle-cockpit.mjs';
import { createLifecycleCockpitPlaybooks, createLifecycleCockpitDecisionDeck, createLifecycleCockpitEscalationMoments } from './playbooks-lifecycle-cockpit.mjs';

export function buildLifecycleCockpitSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createLifecycleCockpitWorkspace(workspaceName);
  const policies = createLifecycleCockpitPolicies();
  return {
    workspace,
    summary: summarizeLifecycleCockpitWorkspace(workspace),
    narratives: createLifecycleCockpitNarratives(workspace),
    coverage: createLifecycleCockpitCoverageGrid(workspace),
    policies,
    policySummary: summarizeLifecycleCockpitPolicies(policies),
    validation: validateLifecycleCockpitPolicies(policies),
    escalationDeck: createLifecycleCockpitEscalationDeck(policies),
    analytics: {
      timeline: createLifecycleCockpitAnalyticsTimeline(),
      forecast: createLifecycleCockpitForecastEnvelope(),
      exceptions: createLifecycleCockpitExceptionLedger(),
      summary: summarizeLifecycleCockpitAnalytics()
    },
    operations: {
      board: createLifecycleCockpitOperationsBoard(),
      checklist: createLifecycleCockpitShiftChecklist(),
      incidents: createLifecycleCockpitIncidentDeck()
    },
    reporting: {
      cards: createLifecycleCockpitReportCards(),
      packets: createLifecycleCockpitReviewPackets(),
      summary: summarizeLifecycleCockpitReporting()
    },
    audit: {
      trail: createLifecycleCockpitAuditTrail(),
      manifest: createLifecycleCockpitEvidenceManifest(),
      attestation: createLifecycleCockpitReadinessAttestation()
    },
    playbooks: createLifecycleCockpitPlaybooks(),
    decisions: createLifecycleCockpitDecisionDeck(),
    escalationMoments: createLifecycleCockpitEscalationMoments()
  };
}

export function createLifecycleCockpitReadinessBoard(snapshot = buildLifecycleCockpitSnapshot()) {
  return [
    { id: 'lifecycle-cockpit-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'lifecycle-cockpit-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'lifecycle-cockpit-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'lifecycle-cockpit-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createLifecycleCockpitApiDocument(snapshot = buildLifecycleCockpitSnapshot()) {
  return {
    id: 'lifecycle-cockpit-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/lifecycle-cockpit/overview' },
      { method: 'GET', path: '/api/lifecycle-cockpit/reporting' },
      { method: 'POST', path: '/api/lifecycle-cockpit/validate' },
      { method: 'GET', path: '/api/lifecycle-cockpit/audit' }
    ],
    readiness: createLifecycleCockpitReadinessBoard(snapshot)
  };
}

export function createLifecycleCockpitRouteSummary(snapshot = buildLifecycleCockpitSnapshot()) {
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

