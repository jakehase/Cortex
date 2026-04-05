import { createCommerceCockpitWorkspace, summarizeCommerceCockpitWorkspace, createCommerceCockpitNarratives, createCommerceCockpitCoverageGrid } from './domain-commerce-cockpit.mjs';
import { createCommerceCockpitPolicies, validateCommerceCockpitPolicies, summarizeCommerceCockpitPolicies, createCommerceCockpitEscalationDeck } from './policies-commerce-cockpit.mjs';
import { createCommerceCockpitAnalyticsTimeline, createCommerceCockpitForecastEnvelope, createCommerceCockpitExceptionLedger, summarizeCommerceCockpitAnalytics } from './analytics-commerce-cockpit.mjs';
import { createCommerceCockpitOperationsBoard, createCommerceCockpitShiftChecklist, createCommerceCockpitIncidentDeck } from './operations-commerce-cockpit.mjs';
import { createCommerceCockpitReportCards, createCommerceCockpitReviewPackets, summarizeCommerceCockpitReporting } from './reporting-commerce-cockpit.mjs';
import { createCommerceCockpitAuditTrail, createCommerceCockpitEvidenceManifest, createCommerceCockpitReadinessAttestation } from './audit-commerce-cockpit.mjs';
import { createCommerceCockpitPlaybooks, createCommerceCockpitDecisionDeck, createCommerceCockpitEscalationMoments } from './playbooks-commerce-cockpit.mjs';

export function buildCommerceCockpitSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCommerceCockpitWorkspace(workspaceName);
  const policies = createCommerceCockpitPolicies();
  return {
    workspace,
    summary: summarizeCommerceCockpitWorkspace(workspace),
    narratives: createCommerceCockpitNarratives(workspace),
    coverage: createCommerceCockpitCoverageGrid(workspace),
    policies,
    policySummary: summarizeCommerceCockpitPolicies(policies),
    validation: validateCommerceCockpitPolicies(policies),
    escalationDeck: createCommerceCockpitEscalationDeck(policies),
    analytics: {
      timeline: createCommerceCockpitAnalyticsTimeline(),
      forecast: createCommerceCockpitForecastEnvelope(),
      exceptions: createCommerceCockpitExceptionLedger(),
      summary: summarizeCommerceCockpitAnalytics()
    },
    operations: {
      board: createCommerceCockpitOperationsBoard(),
      checklist: createCommerceCockpitShiftChecklist(),
      incidents: createCommerceCockpitIncidentDeck()
    },
    reporting: {
      cards: createCommerceCockpitReportCards(),
      packets: createCommerceCockpitReviewPackets(),
      summary: summarizeCommerceCockpitReporting()
    },
    audit: {
      trail: createCommerceCockpitAuditTrail(),
      manifest: createCommerceCockpitEvidenceManifest(),
      attestation: createCommerceCockpitReadinessAttestation()
    },
    playbooks: createCommerceCockpitPlaybooks(),
    decisions: createCommerceCockpitDecisionDeck(),
    escalationMoments: createCommerceCockpitEscalationMoments()
  };
}

export function createCommerceCockpitReadinessBoard(snapshot = buildCommerceCockpitSnapshot()) {
  return [
    { id: 'commerce-cockpit-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'commerce-cockpit-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'commerce-cockpit-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'commerce-cockpit-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCommerceCockpitApiDocument(snapshot = buildCommerceCockpitSnapshot()) {
  return {
    id: 'commerce-cockpit-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/commerce-cockpit/overview' },
      { method: 'GET', path: '/api/commerce-cockpit/reporting' },
      { method: 'POST', path: '/api/commerce-cockpit/validate' },
      { method: 'GET', path: '/api/commerce-cockpit/audit' }
    ],
    readiness: createCommerceCockpitReadinessBoard(snapshot)
  };
}

export function createCommerceCockpitRouteSummary(snapshot = buildCommerceCockpitSnapshot()) {
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

