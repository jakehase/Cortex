import { createAudienceFoundryWorkspace, summarizeAudienceFoundryWorkspace, createAudienceFoundryNarratives, createAudienceFoundryCoverageGrid } from './domain-audience-foundry.mjs';
import { createAudienceFoundryPolicies, validateAudienceFoundryPolicies, summarizeAudienceFoundryPolicies, createAudienceFoundryEscalationDeck } from './policies-audience-foundry.mjs';
import { createAudienceFoundryAnalyticsTimeline, createAudienceFoundryForecastEnvelope, createAudienceFoundryExceptionLedger, summarizeAudienceFoundryAnalytics } from './analytics-audience-foundry.mjs';
import { createAudienceFoundryOperationsBoard, createAudienceFoundryShiftChecklist, createAudienceFoundryIncidentDeck } from './operations-audience-foundry.mjs';
import { createAudienceFoundryReportCards, createAudienceFoundryReviewPackets, summarizeAudienceFoundryReporting } from './reporting-audience-foundry.mjs';
import { createAudienceFoundryAuditTrail, createAudienceFoundryEvidenceManifest, createAudienceFoundryReadinessAttestation } from './audit-audience-foundry.mjs';
import { createAudienceFoundryPlaybooks, createAudienceFoundryDecisionDeck, createAudienceFoundryEscalationMoments } from './playbooks-audience-foundry.mjs';

export function buildAudienceFoundrySnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAudienceFoundryWorkspace(workspaceName);
  const policies = createAudienceFoundryPolicies();
  return {
    workspace,
    summary: summarizeAudienceFoundryWorkspace(workspace),
    narratives: createAudienceFoundryNarratives(workspace),
    coverage: createAudienceFoundryCoverageGrid(workspace),
    policies,
    policySummary: summarizeAudienceFoundryPolicies(policies),
    validation: validateAudienceFoundryPolicies(policies),
    escalationDeck: createAudienceFoundryEscalationDeck(policies),
    analytics: {
      timeline: createAudienceFoundryAnalyticsTimeline(),
      forecast: createAudienceFoundryForecastEnvelope(),
      exceptions: createAudienceFoundryExceptionLedger(),
      summary: summarizeAudienceFoundryAnalytics()
    },
    operations: {
      board: createAudienceFoundryOperationsBoard(),
      checklist: createAudienceFoundryShiftChecklist(),
      incidents: createAudienceFoundryIncidentDeck()
    },
    reporting: {
      cards: createAudienceFoundryReportCards(),
      packets: createAudienceFoundryReviewPackets(),
      summary: summarizeAudienceFoundryReporting()
    },
    audit: {
      trail: createAudienceFoundryAuditTrail(),
      manifest: createAudienceFoundryEvidenceManifest(),
      attestation: createAudienceFoundryReadinessAttestation()
    },
    playbooks: createAudienceFoundryPlaybooks(),
    decisions: createAudienceFoundryDecisionDeck(),
    escalationMoments: createAudienceFoundryEscalationMoments()
  };
}

export function createAudienceFoundryReadinessBoard(snapshot = buildAudienceFoundrySnapshot()) {
  return [
    { id: 'audience-foundry-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'audience-foundry-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'audience-foundry-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'audience-foundry-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAudienceFoundryApiDocument(snapshot = buildAudienceFoundrySnapshot()) {
  return {
    id: 'audience-foundry-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/audience-foundry/overview' },
      { method: 'GET', path: '/api/audience-foundry/reporting' },
      { method: 'POST', path: '/api/audience-foundry/validate' },
      { method: 'GET', path: '/api/audience-foundry/audit' }
    ],
    readiness: createAudienceFoundryReadinessBoard(snapshot)
  };
}

export function createAudienceFoundryRouteSummary(snapshot = buildAudienceFoundrySnapshot()) {
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

