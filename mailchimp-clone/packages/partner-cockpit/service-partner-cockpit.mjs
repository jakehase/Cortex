import { createPartnerCockpitWorkspace, summarizePartnerCockpitWorkspace, createPartnerCockpitNarratives, createPartnerCockpitCoverageGrid } from './domain-partner-cockpit.mjs';
import { createPartnerCockpitPolicies, validatePartnerCockpitPolicies, summarizePartnerCockpitPolicies, createPartnerCockpitEscalationDeck } from './policies-partner-cockpit.mjs';
import { createPartnerCockpitAnalyticsTimeline, createPartnerCockpitForecastEnvelope, createPartnerCockpitExceptionLedger, summarizePartnerCockpitAnalytics } from './analytics-partner-cockpit.mjs';
import { createPartnerCockpitOperationsBoard, createPartnerCockpitShiftChecklist, createPartnerCockpitIncidentDeck } from './operations-partner-cockpit.mjs';
import { createPartnerCockpitReportCards, createPartnerCockpitReviewPackets, summarizePartnerCockpitReporting } from './reporting-partner-cockpit.mjs';
import { createPartnerCockpitAuditTrail, createPartnerCockpitEvidenceManifest, createPartnerCockpitReadinessAttestation } from './audit-partner-cockpit.mjs';
import { createPartnerCockpitPlaybooks, createPartnerCockpitDecisionDeck, createPartnerCockpitEscalationMoments } from './playbooks-partner-cockpit.mjs';

export function buildPartnerCockpitSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createPartnerCockpitWorkspace(workspaceName);
  const policies = createPartnerCockpitPolicies();
  return {
    workspace,
    summary: summarizePartnerCockpitWorkspace(workspace),
    narratives: createPartnerCockpitNarratives(workspace),
    coverage: createPartnerCockpitCoverageGrid(workspace),
    policies,
    policySummary: summarizePartnerCockpitPolicies(policies),
    validation: validatePartnerCockpitPolicies(policies),
    escalationDeck: createPartnerCockpitEscalationDeck(policies),
    analytics: {
      timeline: createPartnerCockpitAnalyticsTimeline(),
      forecast: createPartnerCockpitForecastEnvelope(),
      exceptions: createPartnerCockpitExceptionLedger(),
      summary: summarizePartnerCockpitAnalytics()
    },
    operations: {
      board: createPartnerCockpitOperationsBoard(),
      checklist: createPartnerCockpitShiftChecklist(),
      incidents: createPartnerCockpitIncidentDeck()
    },
    reporting: {
      cards: createPartnerCockpitReportCards(),
      packets: createPartnerCockpitReviewPackets(),
      summary: summarizePartnerCockpitReporting()
    },
    audit: {
      trail: createPartnerCockpitAuditTrail(),
      manifest: createPartnerCockpitEvidenceManifest(),
      attestation: createPartnerCockpitReadinessAttestation()
    },
    playbooks: createPartnerCockpitPlaybooks(),
    decisions: createPartnerCockpitDecisionDeck(),
    escalationMoments: createPartnerCockpitEscalationMoments()
  };
}

export function createPartnerCockpitReadinessBoard(snapshot = buildPartnerCockpitSnapshot()) {
  return [
    { id: 'partner-cockpit-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'partner-cockpit-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'partner-cockpit-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'partner-cockpit-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createPartnerCockpitApiDocument(snapshot = buildPartnerCockpitSnapshot()) {
  return {
    id: 'partner-cockpit-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/partner-cockpit/overview' },
      { method: 'GET', path: '/api/partner-cockpit/reporting' },
      { method: 'POST', path: '/api/partner-cockpit/validate' },
      { method: 'GET', path: '/api/partner-cockpit/audit' }
    ],
    readiness: createPartnerCockpitReadinessBoard(snapshot)
  };
}

export function createPartnerCockpitRouteSummary(snapshot = buildPartnerCockpitSnapshot()) {
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

