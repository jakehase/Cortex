import { createAdvocacyCockpitWorkspace, summarizeAdvocacyCockpitWorkspace, createAdvocacyCockpitNarratives, createAdvocacyCockpitCoverageGrid } from './domain-advocacy-cockpit.mjs';
import { createAdvocacyCockpitPolicies, validateAdvocacyCockpitPolicies, summarizeAdvocacyCockpitPolicies, createAdvocacyCockpitEscalationDeck } from './policies-advocacy-cockpit.mjs';
import { createAdvocacyCockpitAnalyticsTimeline, createAdvocacyCockpitForecastEnvelope, createAdvocacyCockpitExceptionLedger, summarizeAdvocacyCockpitAnalytics } from './analytics-advocacy-cockpit.mjs';
import { createAdvocacyCockpitOperationsBoard, createAdvocacyCockpitShiftChecklist, createAdvocacyCockpitIncidentDeck } from './operations-advocacy-cockpit.mjs';
import { createAdvocacyCockpitReportCards, createAdvocacyCockpitReviewPackets, summarizeAdvocacyCockpitReporting } from './reporting-advocacy-cockpit.mjs';
import { createAdvocacyCockpitAuditTrail, createAdvocacyCockpitEvidenceManifest, createAdvocacyCockpitReadinessAttestation } from './audit-advocacy-cockpit.mjs';
import { createAdvocacyCockpitPlaybooks, createAdvocacyCockpitDecisionDeck, createAdvocacyCockpitEscalationMoments } from './playbooks-advocacy-cockpit.mjs';

export function buildAdvocacyCockpitSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAdvocacyCockpitWorkspace(workspaceName);
  const policies = createAdvocacyCockpitPolicies();
  return {
    workspace,
    summary: summarizeAdvocacyCockpitWorkspace(workspace),
    narratives: createAdvocacyCockpitNarratives(workspace),
    coverage: createAdvocacyCockpitCoverageGrid(workspace),
    policies,
    policySummary: summarizeAdvocacyCockpitPolicies(policies),
    validation: validateAdvocacyCockpitPolicies(policies),
    escalationDeck: createAdvocacyCockpitEscalationDeck(policies),
    analytics: {
      timeline: createAdvocacyCockpitAnalyticsTimeline(),
      forecast: createAdvocacyCockpitForecastEnvelope(),
      exceptions: createAdvocacyCockpitExceptionLedger(),
      summary: summarizeAdvocacyCockpitAnalytics()
    },
    operations: {
      board: createAdvocacyCockpitOperationsBoard(),
      checklist: createAdvocacyCockpitShiftChecklist(),
      incidents: createAdvocacyCockpitIncidentDeck()
    },
    reporting: {
      cards: createAdvocacyCockpitReportCards(),
      packets: createAdvocacyCockpitReviewPackets(),
      summary: summarizeAdvocacyCockpitReporting()
    },
    audit: {
      trail: createAdvocacyCockpitAuditTrail(),
      manifest: createAdvocacyCockpitEvidenceManifest(),
      attestation: createAdvocacyCockpitReadinessAttestation()
    },
    playbooks: createAdvocacyCockpitPlaybooks(),
    decisions: createAdvocacyCockpitDecisionDeck(),
    escalationMoments: createAdvocacyCockpitEscalationMoments()
  };
}

export function createAdvocacyCockpitReadinessBoard(snapshot = buildAdvocacyCockpitSnapshot()) {
  return [
    { id: 'advocacy-cockpit-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'advocacy-cockpit-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'advocacy-cockpit-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'advocacy-cockpit-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAdvocacyCockpitApiDocument(snapshot = buildAdvocacyCockpitSnapshot()) {
  return {
    id: 'advocacy-cockpit-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/advocacy-cockpit/overview' },
      { method: 'GET', path: '/api/advocacy-cockpit/reporting' },
      { method: 'POST', path: '/api/advocacy-cockpit/validate' },
      { method: 'GET', path: '/api/advocacy-cockpit/audit' }
    ],
    readiness: createAdvocacyCockpitReadinessBoard(snapshot)
  };
}

export function createAdvocacyCockpitRouteSummary(snapshot = buildAdvocacyCockpitSnapshot()) {
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

