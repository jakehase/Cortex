import { createContentCockpitWorkspace, summarizeContentCockpitWorkspace, createContentCockpitNarratives, createContentCockpitCoverageGrid } from './domain-content-cockpit.mjs';
import { createContentCockpitPolicies, validateContentCockpitPolicies, summarizeContentCockpitPolicies, createContentCockpitEscalationDeck } from './policies-content-cockpit.mjs';
import { createContentCockpitAnalyticsTimeline, createContentCockpitForecastEnvelope, createContentCockpitExceptionLedger, summarizeContentCockpitAnalytics } from './analytics-content-cockpit.mjs';
import { createContentCockpitOperationsBoard, createContentCockpitShiftChecklist, createContentCockpitIncidentDeck } from './operations-content-cockpit.mjs';
import { createContentCockpitReportCards, createContentCockpitReviewPackets, summarizeContentCockpitReporting } from './reporting-content-cockpit.mjs';
import { createContentCockpitAuditTrail, createContentCockpitEvidenceManifest, createContentCockpitReadinessAttestation } from './audit-content-cockpit.mjs';
import { createContentCockpitPlaybooks, createContentCockpitDecisionDeck, createContentCockpitEscalationMoments } from './playbooks-content-cockpit.mjs';

export function buildContentCockpitSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createContentCockpitWorkspace(workspaceName);
  const policies = createContentCockpitPolicies();
  return {
    workspace,
    summary: summarizeContentCockpitWorkspace(workspace),
    narratives: createContentCockpitNarratives(workspace),
    coverage: createContentCockpitCoverageGrid(workspace),
    policies,
    policySummary: summarizeContentCockpitPolicies(policies),
    validation: validateContentCockpitPolicies(policies),
    escalationDeck: createContentCockpitEscalationDeck(policies),
    analytics: {
      timeline: createContentCockpitAnalyticsTimeline(),
      forecast: createContentCockpitForecastEnvelope(),
      exceptions: createContentCockpitExceptionLedger(),
      summary: summarizeContentCockpitAnalytics()
    },
    operations: {
      board: createContentCockpitOperationsBoard(),
      checklist: createContentCockpitShiftChecklist(),
      incidents: createContentCockpitIncidentDeck()
    },
    reporting: {
      cards: createContentCockpitReportCards(),
      packets: createContentCockpitReviewPackets(),
      summary: summarizeContentCockpitReporting()
    },
    audit: {
      trail: createContentCockpitAuditTrail(),
      manifest: createContentCockpitEvidenceManifest(),
      attestation: createContentCockpitReadinessAttestation()
    },
    playbooks: createContentCockpitPlaybooks(),
    decisions: createContentCockpitDecisionDeck(),
    escalationMoments: createContentCockpitEscalationMoments()
  };
}

export function createContentCockpitReadinessBoard(snapshot = buildContentCockpitSnapshot()) {
  return [
    { id: 'content-cockpit-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'content-cockpit-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'content-cockpit-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'content-cockpit-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createContentCockpitApiDocument(snapshot = buildContentCockpitSnapshot()) {
  return {
    id: 'content-cockpit-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/content-cockpit/overview' },
      { method: 'GET', path: '/api/content-cockpit/reporting' },
      { method: 'POST', path: '/api/content-cockpit/validate' },
      { method: 'GET', path: '/api/content-cockpit/audit' }
    ],
    readiness: createContentCockpitReadinessBoard(snapshot)
  };
}

export function createContentCockpitRouteSummary(snapshot = buildContentCockpitSnapshot()) {
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

