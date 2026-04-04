import { createActivationCockpitWorkspace, summarizeActivationCockpitWorkspace, createActivationCockpitNarratives, createActivationCockpitCoverageGrid } from './domain-activation-cockpit.mjs';
import { createActivationCockpitPolicies, validateActivationCockpitPolicies, summarizeActivationCockpitPolicies, createActivationCockpitEscalationDeck } from './policies-activation-cockpit.mjs';
import { createActivationCockpitAnalyticsTimeline, createActivationCockpitForecastEnvelope, createActivationCockpitExceptionLedger, summarizeActivationCockpitAnalytics } from './analytics-activation-cockpit.mjs';
import { createActivationCockpitOperationsBoard, createActivationCockpitShiftChecklist, createActivationCockpitIncidentDeck } from './operations-activation-cockpit.mjs';
import { createActivationCockpitReportCards, createActivationCockpitReviewPackets, summarizeActivationCockpitReporting } from './reporting-activation-cockpit.mjs';
import { createActivationCockpitAuditTrail, createActivationCockpitEvidenceManifest, createActivationCockpitReadinessAttestation } from './audit-activation-cockpit.mjs';
import { createActivationCockpitPlaybooks, createActivationCockpitDecisionDeck, createActivationCockpitEscalationMoments } from './playbooks-activation-cockpit.mjs';

export function buildActivationCockpitSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createActivationCockpitWorkspace(workspaceName);
  const policies = createActivationCockpitPolicies();
  return {
    workspace,
    summary: summarizeActivationCockpitWorkspace(workspace),
    narratives: createActivationCockpitNarratives(workspace),
    coverage: createActivationCockpitCoverageGrid(workspace),
    policies,
    policySummary: summarizeActivationCockpitPolicies(policies),
    validation: validateActivationCockpitPolicies(policies),
    escalationDeck: createActivationCockpitEscalationDeck(policies),
    analytics: {
      timeline: createActivationCockpitAnalyticsTimeline(),
      forecast: createActivationCockpitForecastEnvelope(),
      exceptions: createActivationCockpitExceptionLedger(),
      summary: summarizeActivationCockpitAnalytics()
    },
    operations: {
      board: createActivationCockpitOperationsBoard(),
      checklist: createActivationCockpitShiftChecklist(),
      incidents: createActivationCockpitIncidentDeck()
    },
    reporting: {
      cards: createActivationCockpitReportCards(),
      packets: createActivationCockpitReviewPackets(),
      summary: summarizeActivationCockpitReporting()
    },
    audit: {
      trail: createActivationCockpitAuditTrail(),
      manifest: createActivationCockpitEvidenceManifest(),
      attestation: createActivationCockpitReadinessAttestation()
    },
    playbooks: createActivationCockpitPlaybooks(),
    decisions: createActivationCockpitDecisionDeck(),
    escalationMoments: createActivationCockpitEscalationMoments()
  };
}

export function createActivationCockpitReadinessBoard(snapshot = buildActivationCockpitSnapshot()) {
  return [
    { id: 'activation-cockpit-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'activation-cockpit-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'activation-cockpit-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'activation-cockpit-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createActivationCockpitApiDocument(snapshot = buildActivationCockpitSnapshot()) {
  return {
    id: 'activation-cockpit-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/activation-cockpit/overview' },
      { method: 'GET', path: '/api/activation-cockpit/reporting' },
      { method: 'POST', path: '/api/activation-cockpit/validate' },
      { method: 'GET', path: '/api/activation-cockpit/audit' }
    ],
    readiness: createActivationCockpitReadinessBoard(snapshot)
  };
}

export function createActivationCockpitRouteSummary(snapshot = buildActivationCockpitSnapshot()) {
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

