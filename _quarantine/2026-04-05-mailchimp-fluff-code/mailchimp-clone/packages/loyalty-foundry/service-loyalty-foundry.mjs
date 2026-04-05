import { createLoyaltyFoundryWorkspace, summarizeLoyaltyFoundryWorkspace, createLoyaltyFoundryNarratives, createLoyaltyFoundryCoverageGrid } from './domain-loyalty-foundry.mjs';
import { createLoyaltyFoundryPolicies, validateLoyaltyFoundryPolicies, summarizeLoyaltyFoundryPolicies, createLoyaltyFoundryEscalationDeck } from './policies-loyalty-foundry.mjs';
import { createLoyaltyFoundryAnalyticsTimeline, createLoyaltyFoundryForecastEnvelope, createLoyaltyFoundryExceptionLedger, summarizeLoyaltyFoundryAnalytics } from './analytics-loyalty-foundry.mjs';
import { createLoyaltyFoundryOperationsBoard, createLoyaltyFoundryShiftChecklist, createLoyaltyFoundryIncidentDeck } from './operations-loyalty-foundry.mjs';
import { createLoyaltyFoundryReportCards, createLoyaltyFoundryReviewPackets, summarizeLoyaltyFoundryReporting } from './reporting-loyalty-foundry.mjs';
import { createLoyaltyFoundryAuditTrail, createLoyaltyFoundryEvidenceManifest, createLoyaltyFoundryReadinessAttestation } from './audit-loyalty-foundry.mjs';
import { createLoyaltyFoundryPlaybooks, createLoyaltyFoundryDecisionDeck, createLoyaltyFoundryEscalationMoments } from './playbooks-loyalty-foundry.mjs';

export function buildLoyaltyFoundrySnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createLoyaltyFoundryWorkspace(workspaceName);
  const policies = createLoyaltyFoundryPolicies();
  return {
    workspace,
    summary: summarizeLoyaltyFoundryWorkspace(workspace),
    narratives: createLoyaltyFoundryNarratives(workspace),
    coverage: createLoyaltyFoundryCoverageGrid(workspace),
    policies,
    policySummary: summarizeLoyaltyFoundryPolicies(policies),
    validation: validateLoyaltyFoundryPolicies(policies),
    escalationDeck: createLoyaltyFoundryEscalationDeck(policies),
    analytics: {
      timeline: createLoyaltyFoundryAnalyticsTimeline(),
      forecast: createLoyaltyFoundryForecastEnvelope(),
      exceptions: createLoyaltyFoundryExceptionLedger(),
      summary: summarizeLoyaltyFoundryAnalytics()
    },
    operations: {
      board: createLoyaltyFoundryOperationsBoard(),
      checklist: createLoyaltyFoundryShiftChecklist(),
      incidents: createLoyaltyFoundryIncidentDeck()
    },
    reporting: {
      cards: createLoyaltyFoundryReportCards(),
      packets: createLoyaltyFoundryReviewPackets(),
      summary: summarizeLoyaltyFoundryReporting()
    },
    audit: {
      trail: createLoyaltyFoundryAuditTrail(),
      manifest: createLoyaltyFoundryEvidenceManifest(),
      attestation: createLoyaltyFoundryReadinessAttestation()
    },
    playbooks: createLoyaltyFoundryPlaybooks(),
    decisions: createLoyaltyFoundryDecisionDeck(),
    escalationMoments: createLoyaltyFoundryEscalationMoments()
  };
}

export function createLoyaltyFoundryReadinessBoard(snapshot = buildLoyaltyFoundrySnapshot()) {
  return [
    { id: 'loyalty-foundry-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'loyalty-foundry-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'loyalty-foundry-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'loyalty-foundry-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createLoyaltyFoundryApiDocument(snapshot = buildLoyaltyFoundrySnapshot()) {
  return {
    id: 'loyalty-foundry-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/loyalty-foundry/overview' },
      { method: 'GET', path: '/api/loyalty-foundry/reporting' },
      { method: 'POST', path: '/api/loyalty-foundry/validate' },
      { method: 'GET', path: '/api/loyalty-foundry/audit' }
    ],
    readiness: createLoyaltyFoundryReadinessBoard(snapshot)
  };
}

export function createLoyaltyFoundryRouteSummary(snapshot = buildLoyaltyFoundrySnapshot()) {
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

