import { createLoyaltyCockpitWorkspace, summarizeLoyaltyCockpitWorkspace, createLoyaltyCockpitNarratives, createLoyaltyCockpitCoverageGrid } from './domain-loyalty-cockpit.mjs';
import { createLoyaltyCockpitPolicies, validateLoyaltyCockpitPolicies, summarizeLoyaltyCockpitPolicies, createLoyaltyCockpitEscalationDeck } from './policies-loyalty-cockpit.mjs';
import { createLoyaltyCockpitAnalyticsTimeline, createLoyaltyCockpitForecastEnvelope, createLoyaltyCockpitExceptionLedger, summarizeLoyaltyCockpitAnalytics } from './analytics-loyalty-cockpit.mjs';
import { createLoyaltyCockpitOperationsBoard, createLoyaltyCockpitShiftChecklist, createLoyaltyCockpitIncidentDeck } from './operations-loyalty-cockpit.mjs';
import { createLoyaltyCockpitReportCards, createLoyaltyCockpitReviewPackets, summarizeLoyaltyCockpitReporting } from './reporting-loyalty-cockpit.mjs';
import { createLoyaltyCockpitAuditTrail, createLoyaltyCockpitEvidenceManifest, createLoyaltyCockpitReadinessAttestation } from './audit-loyalty-cockpit.mjs';
import { createLoyaltyCockpitPlaybooks, createLoyaltyCockpitDecisionDeck, createLoyaltyCockpitEscalationMoments } from './playbooks-loyalty-cockpit.mjs';

export function buildLoyaltyCockpitSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createLoyaltyCockpitWorkspace(workspaceName);
  const policies = createLoyaltyCockpitPolicies();
  return {
    workspace,
    summary: summarizeLoyaltyCockpitWorkspace(workspace),
    narratives: createLoyaltyCockpitNarratives(workspace),
    coverage: createLoyaltyCockpitCoverageGrid(workspace),
    policies,
    policySummary: summarizeLoyaltyCockpitPolicies(policies),
    validation: validateLoyaltyCockpitPolicies(policies),
    escalationDeck: createLoyaltyCockpitEscalationDeck(policies),
    analytics: {
      timeline: createLoyaltyCockpitAnalyticsTimeline(),
      forecast: createLoyaltyCockpitForecastEnvelope(),
      exceptions: createLoyaltyCockpitExceptionLedger(),
      summary: summarizeLoyaltyCockpitAnalytics()
    },
    operations: {
      board: createLoyaltyCockpitOperationsBoard(),
      checklist: createLoyaltyCockpitShiftChecklist(),
      incidents: createLoyaltyCockpitIncidentDeck()
    },
    reporting: {
      cards: createLoyaltyCockpitReportCards(),
      packets: createLoyaltyCockpitReviewPackets(),
      summary: summarizeLoyaltyCockpitReporting()
    },
    audit: {
      trail: createLoyaltyCockpitAuditTrail(),
      manifest: createLoyaltyCockpitEvidenceManifest(),
      attestation: createLoyaltyCockpitReadinessAttestation()
    },
    playbooks: createLoyaltyCockpitPlaybooks(),
    decisions: createLoyaltyCockpitDecisionDeck(),
    escalationMoments: createLoyaltyCockpitEscalationMoments()
  };
}

export function createLoyaltyCockpitReadinessBoard(snapshot = buildLoyaltyCockpitSnapshot()) {
  return [
    { id: 'loyalty-cockpit-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'loyalty-cockpit-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'loyalty-cockpit-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'loyalty-cockpit-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createLoyaltyCockpitApiDocument(snapshot = buildLoyaltyCockpitSnapshot()) {
  return {
    id: 'loyalty-cockpit-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/loyalty-cockpit/overview' },
      { method: 'GET', path: '/api/loyalty-cockpit/reporting' },
      { method: 'POST', path: '/api/loyalty-cockpit/validate' },
      { method: 'GET', path: '/api/loyalty-cockpit/audit' }
    ],
    readiness: createLoyaltyCockpitReadinessBoard(snapshot)
  };
}

export function createLoyaltyCockpitRouteSummary(snapshot = buildLoyaltyCockpitSnapshot()) {
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

