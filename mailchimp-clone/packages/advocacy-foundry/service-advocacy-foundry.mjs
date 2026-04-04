import { createAdvocacyFoundryWorkspace, summarizeAdvocacyFoundryWorkspace, createAdvocacyFoundryNarratives, createAdvocacyFoundryCoverageGrid } from './domain-advocacy-foundry.mjs';
import { createAdvocacyFoundryPolicies, validateAdvocacyFoundryPolicies, summarizeAdvocacyFoundryPolicies, createAdvocacyFoundryEscalationDeck } from './policies-advocacy-foundry.mjs';
import { createAdvocacyFoundryAnalyticsTimeline, createAdvocacyFoundryForecastEnvelope, createAdvocacyFoundryExceptionLedger, summarizeAdvocacyFoundryAnalytics } from './analytics-advocacy-foundry.mjs';
import { createAdvocacyFoundryOperationsBoard, createAdvocacyFoundryShiftChecklist, createAdvocacyFoundryIncidentDeck } from './operations-advocacy-foundry.mjs';
import { createAdvocacyFoundryReportCards, createAdvocacyFoundryReviewPackets, summarizeAdvocacyFoundryReporting } from './reporting-advocacy-foundry.mjs';
import { createAdvocacyFoundryAuditTrail, createAdvocacyFoundryEvidenceManifest, createAdvocacyFoundryReadinessAttestation } from './audit-advocacy-foundry.mjs';
import { createAdvocacyFoundryPlaybooks, createAdvocacyFoundryDecisionDeck, createAdvocacyFoundryEscalationMoments } from './playbooks-advocacy-foundry.mjs';

export function buildAdvocacyFoundrySnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAdvocacyFoundryWorkspace(workspaceName);
  const policies = createAdvocacyFoundryPolicies();
  return {
    workspace,
    summary: summarizeAdvocacyFoundryWorkspace(workspace),
    narratives: createAdvocacyFoundryNarratives(workspace),
    coverage: createAdvocacyFoundryCoverageGrid(workspace),
    policies,
    policySummary: summarizeAdvocacyFoundryPolicies(policies),
    validation: validateAdvocacyFoundryPolicies(policies),
    escalationDeck: createAdvocacyFoundryEscalationDeck(policies),
    analytics: {
      timeline: createAdvocacyFoundryAnalyticsTimeline(),
      forecast: createAdvocacyFoundryForecastEnvelope(),
      exceptions: createAdvocacyFoundryExceptionLedger(),
      summary: summarizeAdvocacyFoundryAnalytics()
    },
    operations: {
      board: createAdvocacyFoundryOperationsBoard(),
      checklist: createAdvocacyFoundryShiftChecklist(),
      incidents: createAdvocacyFoundryIncidentDeck()
    },
    reporting: {
      cards: createAdvocacyFoundryReportCards(),
      packets: createAdvocacyFoundryReviewPackets(),
      summary: summarizeAdvocacyFoundryReporting()
    },
    audit: {
      trail: createAdvocacyFoundryAuditTrail(),
      manifest: createAdvocacyFoundryEvidenceManifest(),
      attestation: createAdvocacyFoundryReadinessAttestation()
    },
    playbooks: createAdvocacyFoundryPlaybooks(),
    decisions: createAdvocacyFoundryDecisionDeck(),
    escalationMoments: createAdvocacyFoundryEscalationMoments()
  };
}

export function createAdvocacyFoundryReadinessBoard(snapshot = buildAdvocacyFoundrySnapshot()) {
  return [
    { id: 'advocacy-foundry-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'advocacy-foundry-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'advocacy-foundry-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'advocacy-foundry-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAdvocacyFoundryApiDocument(snapshot = buildAdvocacyFoundrySnapshot()) {
  return {
    id: 'advocacy-foundry-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/advocacy-foundry/overview' },
      { method: 'GET', path: '/api/advocacy-foundry/reporting' },
      { method: 'POST', path: '/api/advocacy-foundry/validate' },
      { method: 'GET', path: '/api/advocacy-foundry/audit' }
    ],
    readiness: createAdvocacyFoundryReadinessBoard(snapshot)
  };
}

export function createAdvocacyFoundryRouteSummary(snapshot = buildAdvocacyFoundrySnapshot()) {
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

