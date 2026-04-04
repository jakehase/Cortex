import { createAttributionCockpitWorkspace, summarizeAttributionCockpitWorkspace, createAttributionCockpitNarratives, createAttributionCockpitCoverageGrid } from './domain-attribution-cockpit.mjs';
import { createAttributionCockpitPolicies, validateAttributionCockpitPolicies, summarizeAttributionCockpitPolicies, createAttributionCockpitEscalationDeck } from './policies-attribution-cockpit.mjs';
import { createAttributionCockpitAnalyticsTimeline, createAttributionCockpitForecastEnvelope, createAttributionCockpitExceptionLedger, summarizeAttributionCockpitAnalytics } from './analytics-attribution-cockpit.mjs';
import { createAttributionCockpitOperationsBoard, createAttributionCockpitShiftChecklist, createAttributionCockpitIncidentDeck } from './operations-attribution-cockpit.mjs';
import { createAttributionCockpitReportCards, createAttributionCockpitReviewPackets, summarizeAttributionCockpitReporting } from './reporting-attribution-cockpit.mjs';
import { createAttributionCockpitAuditTrail, createAttributionCockpitEvidenceManifest, createAttributionCockpitReadinessAttestation } from './audit-attribution-cockpit.mjs';
import { createAttributionCockpitPlaybooks, createAttributionCockpitDecisionDeck, createAttributionCockpitEscalationMoments } from './playbooks-attribution-cockpit.mjs';

export function buildAttributionCockpitSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAttributionCockpitWorkspace(workspaceName);
  const policies = createAttributionCockpitPolicies();
  return {
    workspace,
    summary: summarizeAttributionCockpitWorkspace(workspace),
    narratives: createAttributionCockpitNarratives(workspace),
    coverage: createAttributionCockpitCoverageGrid(workspace),
    policies,
    policySummary: summarizeAttributionCockpitPolicies(policies),
    validation: validateAttributionCockpitPolicies(policies),
    escalationDeck: createAttributionCockpitEscalationDeck(policies),
    analytics: {
      timeline: createAttributionCockpitAnalyticsTimeline(),
      forecast: createAttributionCockpitForecastEnvelope(),
      exceptions: createAttributionCockpitExceptionLedger(),
      summary: summarizeAttributionCockpitAnalytics()
    },
    operations: {
      board: createAttributionCockpitOperationsBoard(),
      checklist: createAttributionCockpitShiftChecklist(),
      incidents: createAttributionCockpitIncidentDeck()
    },
    reporting: {
      cards: createAttributionCockpitReportCards(),
      packets: createAttributionCockpitReviewPackets(),
      summary: summarizeAttributionCockpitReporting()
    },
    audit: {
      trail: createAttributionCockpitAuditTrail(),
      manifest: createAttributionCockpitEvidenceManifest(),
      attestation: createAttributionCockpitReadinessAttestation()
    },
    playbooks: createAttributionCockpitPlaybooks(),
    decisions: createAttributionCockpitDecisionDeck(),
    escalationMoments: createAttributionCockpitEscalationMoments()
  };
}

export function createAttributionCockpitReadinessBoard(snapshot = buildAttributionCockpitSnapshot()) {
  return [
    { id: 'attribution-cockpit-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'attribution-cockpit-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'attribution-cockpit-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'attribution-cockpit-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAttributionCockpitApiDocument(snapshot = buildAttributionCockpitSnapshot()) {
  return {
    id: 'attribution-cockpit-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/attribution-cockpit/overview' },
      { method: 'GET', path: '/api/attribution-cockpit/reporting' },
      { method: 'POST', path: '/api/attribution-cockpit/validate' },
      { method: 'GET', path: '/api/attribution-cockpit/audit' }
    ],
    readiness: createAttributionCockpitReadinessBoard(snapshot)
  };
}

export function createAttributionCockpitRouteSummary(snapshot = buildAttributionCockpitSnapshot()) {
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

