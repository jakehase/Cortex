import { createCreativeCockpitWorkspace, summarizeCreativeCockpitWorkspace, createCreativeCockpitNarratives, createCreativeCockpitCoverageGrid } from './domain-creative-cockpit.mjs';
import { createCreativeCockpitPolicies, validateCreativeCockpitPolicies, summarizeCreativeCockpitPolicies, createCreativeCockpitEscalationDeck } from './policies-creative-cockpit.mjs';
import { createCreativeCockpitAnalyticsTimeline, createCreativeCockpitForecastEnvelope, createCreativeCockpitExceptionLedger, summarizeCreativeCockpitAnalytics } from './analytics-creative-cockpit.mjs';
import { createCreativeCockpitOperationsBoard, createCreativeCockpitShiftChecklist, createCreativeCockpitIncidentDeck } from './operations-creative-cockpit.mjs';
import { createCreativeCockpitReportCards, createCreativeCockpitReviewPackets, summarizeCreativeCockpitReporting } from './reporting-creative-cockpit.mjs';
import { createCreativeCockpitAuditTrail, createCreativeCockpitEvidenceManifest, createCreativeCockpitReadinessAttestation } from './audit-creative-cockpit.mjs';
import { createCreativeCockpitPlaybooks, createCreativeCockpitDecisionDeck, createCreativeCockpitEscalationMoments } from './playbooks-creative-cockpit.mjs';

export function buildCreativeCockpitSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCreativeCockpitWorkspace(workspaceName);
  const policies = createCreativeCockpitPolicies();
  return {
    workspace,
    summary: summarizeCreativeCockpitWorkspace(workspace),
    narratives: createCreativeCockpitNarratives(workspace),
    coverage: createCreativeCockpitCoverageGrid(workspace),
    policies,
    policySummary: summarizeCreativeCockpitPolicies(policies),
    validation: validateCreativeCockpitPolicies(policies),
    escalationDeck: createCreativeCockpitEscalationDeck(policies),
    analytics: {
      timeline: createCreativeCockpitAnalyticsTimeline(),
      forecast: createCreativeCockpitForecastEnvelope(),
      exceptions: createCreativeCockpitExceptionLedger(),
      summary: summarizeCreativeCockpitAnalytics()
    },
    operations: {
      board: createCreativeCockpitOperationsBoard(),
      checklist: createCreativeCockpitShiftChecklist(),
      incidents: createCreativeCockpitIncidentDeck()
    },
    reporting: {
      cards: createCreativeCockpitReportCards(),
      packets: createCreativeCockpitReviewPackets(),
      summary: summarizeCreativeCockpitReporting()
    },
    audit: {
      trail: createCreativeCockpitAuditTrail(),
      manifest: createCreativeCockpitEvidenceManifest(),
      attestation: createCreativeCockpitReadinessAttestation()
    },
    playbooks: createCreativeCockpitPlaybooks(),
    decisions: createCreativeCockpitDecisionDeck(),
    escalationMoments: createCreativeCockpitEscalationMoments()
  };
}

export function createCreativeCockpitReadinessBoard(snapshot = buildCreativeCockpitSnapshot()) {
  return [
    { id: 'creative-cockpit-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'creative-cockpit-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'creative-cockpit-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'creative-cockpit-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCreativeCockpitApiDocument(snapshot = buildCreativeCockpitSnapshot()) {
  return {
    id: 'creative-cockpit-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/creative-cockpit/overview' },
      { method: 'GET', path: '/api/creative-cockpit/reporting' },
      { method: 'POST', path: '/api/creative-cockpit/validate' },
      { method: 'GET', path: '/api/creative-cockpit/audit' }
    ],
    readiness: createCreativeCockpitReadinessBoard(snapshot)
  };
}

export function createCreativeCockpitRouteSummary(snapshot = buildCreativeCockpitSnapshot()) {
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

