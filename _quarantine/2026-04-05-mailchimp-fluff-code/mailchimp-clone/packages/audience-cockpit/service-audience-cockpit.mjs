import { createAudienceCockpitWorkspace, summarizeAudienceCockpitWorkspace, createAudienceCockpitNarratives, createAudienceCockpitCoverageGrid } from './domain-audience-cockpit.mjs';
import { createAudienceCockpitPolicies, validateAudienceCockpitPolicies, summarizeAudienceCockpitPolicies, createAudienceCockpitEscalationDeck } from './policies-audience-cockpit.mjs';
import { createAudienceCockpitAnalyticsTimeline, createAudienceCockpitForecastEnvelope, createAudienceCockpitExceptionLedger, summarizeAudienceCockpitAnalytics } from './analytics-audience-cockpit.mjs';
import { createAudienceCockpitOperationsBoard, createAudienceCockpitShiftChecklist, createAudienceCockpitIncidentDeck } from './operations-audience-cockpit.mjs';
import { createAudienceCockpitReportCards, createAudienceCockpitReviewPackets, summarizeAudienceCockpitReporting } from './reporting-audience-cockpit.mjs';
import { createAudienceCockpitAuditTrail, createAudienceCockpitEvidenceManifest, createAudienceCockpitReadinessAttestation } from './audit-audience-cockpit.mjs';
import { createAudienceCockpitPlaybooks, createAudienceCockpitDecisionDeck, createAudienceCockpitEscalationMoments } from './playbooks-audience-cockpit.mjs';

export function buildAudienceCockpitSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAudienceCockpitWorkspace(workspaceName);
  const policies = createAudienceCockpitPolicies();
  return {
    workspace,
    summary: summarizeAudienceCockpitWorkspace(workspace),
    narratives: createAudienceCockpitNarratives(workspace),
    coverage: createAudienceCockpitCoverageGrid(workspace),
    policies,
    policySummary: summarizeAudienceCockpitPolicies(policies),
    validation: validateAudienceCockpitPolicies(policies),
    escalationDeck: createAudienceCockpitEscalationDeck(policies),
    analytics: {
      timeline: createAudienceCockpitAnalyticsTimeline(),
      forecast: createAudienceCockpitForecastEnvelope(),
      exceptions: createAudienceCockpitExceptionLedger(),
      summary: summarizeAudienceCockpitAnalytics()
    },
    operations: {
      board: createAudienceCockpitOperationsBoard(),
      checklist: createAudienceCockpitShiftChecklist(),
      incidents: createAudienceCockpitIncidentDeck()
    },
    reporting: {
      cards: createAudienceCockpitReportCards(),
      packets: createAudienceCockpitReviewPackets(),
      summary: summarizeAudienceCockpitReporting()
    },
    audit: {
      trail: createAudienceCockpitAuditTrail(),
      manifest: createAudienceCockpitEvidenceManifest(),
      attestation: createAudienceCockpitReadinessAttestation()
    },
    playbooks: createAudienceCockpitPlaybooks(),
    decisions: createAudienceCockpitDecisionDeck(),
    escalationMoments: createAudienceCockpitEscalationMoments()
  };
}

export function createAudienceCockpitReadinessBoard(snapshot = buildAudienceCockpitSnapshot()) {
  return [
    { id: 'audience-cockpit-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'audience-cockpit-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'audience-cockpit-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'audience-cockpit-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAudienceCockpitApiDocument(snapshot = buildAudienceCockpitSnapshot()) {
  return {
    id: 'audience-cockpit-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/audience-cockpit/overview' },
      { method: 'GET', path: '/api/audience-cockpit/reporting' },
      { method: 'POST', path: '/api/audience-cockpit/validate' },
      { method: 'GET', path: '/api/audience-cockpit/audit' }
    ],
    readiness: createAudienceCockpitReadinessBoard(snapshot)
  };
}

export function createAudienceCockpitRouteSummary(snapshot = buildAudienceCockpitSnapshot()) {
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

