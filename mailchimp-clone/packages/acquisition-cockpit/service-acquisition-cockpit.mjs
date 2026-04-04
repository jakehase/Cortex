import { createAcquisitionCockpitWorkspace, summarizeAcquisitionCockpitWorkspace, createAcquisitionCockpitNarratives, createAcquisitionCockpitCoverageGrid } from './domain-acquisition-cockpit.mjs';
import { createAcquisitionCockpitPolicies, validateAcquisitionCockpitPolicies, summarizeAcquisitionCockpitPolicies, createAcquisitionCockpitEscalationDeck } from './policies-acquisition-cockpit.mjs';
import { createAcquisitionCockpitAnalyticsTimeline, createAcquisitionCockpitForecastEnvelope, createAcquisitionCockpitExceptionLedger, summarizeAcquisitionCockpitAnalytics } from './analytics-acquisition-cockpit.mjs';
import { createAcquisitionCockpitOperationsBoard, createAcquisitionCockpitShiftChecklist, createAcquisitionCockpitIncidentDeck } from './operations-acquisition-cockpit.mjs';
import { createAcquisitionCockpitReportCards, createAcquisitionCockpitReviewPackets, summarizeAcquisitionCockpitReporting } from './reporting-acquisition-cockpit.mjs';
import { createAcquisitionCockpitAuditTrail, createAcquisitionCockpitEvidenceManifest, createAcquisitionCockpitReadinessAttestation } from './audit-acquisition-cockpit.mjs';
import { createAcquisitionCockpitPlaybooks, createAcquisitionCockpitDecisionDeck, createAcquisitionCockpitEscalationMoments } from './playbooks-acquisition-cockpit.mjs';

export function buildAcquisitionCockpitSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAcquisitionCockpitWorkspace(workspaceName);
  const policies = createAcquisitionCockpitPolicies();
  return {
    workspace,
    summary: summarizeAcquisitionCockpitWorkspace(workspace),
    narratives: createAcquisitionCockpitNarratives(workspace),
    coverage: createAcquisitionCockpitCoverageGrid(workspace),
    policies,
    policySummary: summarizeAcquisitionCockpitPolicies(policies),
    validation: validateAcquisitionCockpitPolicies(policies),
    escalationDeck: createAcquisitionCockpitEscalationDeck(policies),
    analytics: {
      timeline: createAcquisitionCockpitAnalyticsTimeline(),
      forecast: createAcquisitionCockpitForecastEnvelope(),
      exceptions: createAcquisitionCockpitExceptionLedger(),
      summary: summarizeAcquisitionCockpitAnalytics()
    },
    operations: {
      board: createAcquisitionCockpitOperationsBoard(),
      checklist: createAcquisitionCockpitShiftChecklist(),
      incidents: createAcquisitionCockpitIncidentDeck()
    },
    reporting: {
      cards: createAcquisitionCockpitReportCards(),
      packets: createAcquisitionCockpitReviewPackets(),
      summary: summarizeAcquisitionCockpitReporting()
    },
    audit: {
      trail: createAcquisitionCockpitAuditTrail(),
      manifest: createAcquisitionCockpitEvidenceManifest(),
      attestation: createAcquisitionCockpitReadinessAttestation()
    },
    playbooks: createAcquisitionCockpitPlaybooks(),
    decisions: createAcquisitionCockpitDecisionDeck(),
    escalationMoments: createAcquisitionCockpitEscalationMoments()
  };
}

export function createAcquisitionCockpitReadinessBoard(snapshot = buildAcquisitionCockpitSnapshot()) {
  return [
    { id: 'acquisition-cockpit-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'acquisition-cockpit-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'acquisition-cockpit-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'acquisition-cockpit-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAcquisitionCockpitApiDocument(snapshot = buildAcquisitionCockpitSnapshot()) {
  return {
    id: 'acquisition-cockpit-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/acquisition-cockpit/overview' },
      { method: 'GET', path: '/api/acquisition-cockpit/reporting' },
      { method: 'POST', path: '/api/acquisition-cockpit/validate' },
      { method: 'GET', path: '/api/acquisition-cockpit/audit' }
    ],
    readiness: createAcquisitionCockpitReadinessBoard(snapshot)
  };
}

export function createAcquisitionCockpitRouteSummary(snapshot = buildAcquisitionCockpitSnapshot()) {
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

