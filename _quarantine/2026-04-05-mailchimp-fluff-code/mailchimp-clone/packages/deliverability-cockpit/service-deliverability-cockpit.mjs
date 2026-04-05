import { createDeliverabilityCockpitWorkspace, summarizeDeliverabilityCockpitWorkspace, createDeliverabilityCockpitNarratives, createDeliverabilityCockpitCoverageGrid } from './domain-deliverability-cockpit.mjs';
import { createDeliverabilityCockpitPolicies, validateDeliverabilityCockpitPolicies, summarizeDeliverabilityCockpitPolicies, createDeliverabilityCockpitEscalationDeck } from './policies-deliverability-cockpit.mjs';
import { createDeliverabilityCockpitAnalyticsTimeline, createDeliverabilityCockpitForecastEnvelope, createDeliverabilityCockpitExceptionLedger, summarizeDeliverabilityCockpitAnalytics } from './analytics-deliverability-cockpit.mjs';
import { createDeliverabilityCockpitOperationsBoard, createDeliverabilityCockpitShiftChecklist, createDeliverabilityCockpitIncidentDeck } from './operations-deliverability-cockpit.mjs';
import { createDeliverabilityCockpitReportCards, createDeliverabilityCockpitReviewPackets, summarizeDeliverabilityCockpitReporting } from './reporting-deliverability-cockpit.mjs';
import { createDeliverabilityCockpitAuditTrail, createDeliverabilityCockpitEvidenceManifest, createDeliverabilityCockpitReadinessAttestation } from './audit-deliverability-cockpit.mjs';
import { createDeliverabilityCockpitPlaybooks, createDeliverabilityCockpitDecisionDeck, createDeliverabilityCockpitEscalationMoments } from './playbooks-deliverability-cockpit.mjs';

export function buildDeliverabilityCockpitSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createDeliverabilityCockpitWorkspace(workspaceName);
  const policies = createDeliverabilityCockpitPolicies();
  return {
    workspace,
    summary: summarizeDeliverabilityCockpitWorkspace(workspace),
    narratives: createDeliverabilityCockpitNarratives(workspace),
    coverage: createDeliverabilityCockpitCoverageGrid(workspace),
    policies,
    policySummary: summarizeDeliverabilityCockpitPolicies(policies),
    validation: validateDeliverabilityCockpitPolicies(policies),
    escalationDeck: createDeliverabilityCockpitEscalationDeck(policies),
    analytics: {
      timeline: createDeliverabilityCockpitAnalyticsTimeline(),
      forecast: createDeliverabilityCockpitForecastEnvelope(),
      exceptions: createDeliverabilityCockpitExceptionLedger(),
      summary: summarizeDeliverabilityCockpitAnalytics()
    },
    operations: {
      board: createDeliverabilityCockpitOperationsBoard(),
      checklist: createDeliverabilityCockpitShiftChecklist(),
      incidents: createDeliverabilityCockpitIncidentDeck()
    },
    reporting: {
      cards: createDeliverabilityCockpitReportCards(),
      packets: createDeliverabilityCockpitReviewPackets(),
      summary: summarizeDeliverabilityCockpitReporting()
    },
    audit: {
      trail: createDeliverabilityCockpitAuditTrail(),
      manifest: createDeliverabilityCockpitEvidenceManifest(),
      attestation: createDeliverabilityCockpitReadinessAttestation()
    },
    playbooks: createDeliverabilityCockpitPlaybooks(),
    decisions: createDeliverabilityCockpitDecisionDeck(),
    escalationMoments: createDeliverabilityCockpitEscalationMoments()
  };
}

export function createDeliverabilityCockpitReadinessBoard(snapshot = buildDeliverabilityCockpitSnapshot()) {
  return [
    { id: 'deliverability-cockpit-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'deliverability-cockpit-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'deliverability-cockpit-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'deliverability-cockpit-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createDeliverabilityCockpitApiDocument(snapshot = buildDeliverabilityCockpitSnapshot()) {
  return {
    id: 'deliverability-cockpit-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/deliverability-cockpit/overview' },
      { method: 'GET', path: '/api/deliverability-cockpit/reporting' },
      { method: 'POST', path: '/api/deliverability-cockpit/validate' },
      { method: 'GET', path: '/api/deliverability-cockpit/audit' }
    ],
    readiness: createDeliverabilityCockpitReadinessBoard(snapshot)
  };
}

export function createDeliverabilityCockpitRouteSummary(snapshot = buildDeliverabilityCockpitSnapshot()) {
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

