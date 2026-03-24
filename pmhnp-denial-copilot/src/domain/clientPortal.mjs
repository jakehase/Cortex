import { AUTOMATION_POLICY, SNAPSHOT_PATH, TRUTHS } from '../config.mjs';
import { clone, nowIso, readJson } from '../lib/storage.mjs';
import { listApprovals } from './approvalQueue.mjs';
import { getDenialLearningStats, getDenialTaxonomy, listDenialFeedback, listDenialWorklists } from './denialWorkbench.mjs';
import { listPilotBaselines } from './pilotMetrics.mjs';
import { listProviderProfiles, listSessions, listUploadBatches } from './tebraOnboarding.mjs';

const FALLBACK_SNAPSHOT = {
  generated_at: nowIso(),
  source: { type: 'recovered-dev-fallback', run_id: 'local_recovery', finding_count: 0 },
  truths: clone(TRUTHS),
  dashboard: { today_priorities: [], claims_at_risk: [], needs_review: [] },
  ask_worklist: { suggested_prompts: [] }
};

function baseSnapshot() {
  return readJson(SNAPSHOT_PATH, FALLBACK_SNAPSHOT);
}

function toReviewItem(profile) {
  return {
    claim_ref: `tebra:${profile.profile_id}`,
    severity: profile.status === 'pending_manual_review' ? 'medium' : 'low',
    status: profile.status,
    route_to: 'onboarding_team',
    sla_due_at: profile.updated_at || profile.created_at || nowIso()
  };
}

function toPriority(profile) {
  const liveReadPath = profile.tebra?.connection_mode === 'export-upload' ? 'Review newly uploaded exports' : 'Approve admin-assisted live sync';
  return {
    title: profile.status === 'pending_manual_review'
      ? liveReadPath
      : profile.status === 'ready_for_export_ingest'
        ? 'Review export batch and map data'
        : 'Run read-only Tebra connection test',
    severity: profile.status === 'pending_manual_review' ? 'medium' : 'low',
    route_to: 'onboarding_team',
    claim_ref: `tebra:${profile.profile_id}`,
    recommendation: profile.status === 'pending_manual_review'
      ? 'Complete manual review and approve the provider profile before live-read validation.'
      : profile.status === 'ready_for_export_ingest'
        ? 'Open the uploaded exports, validate mappings, and summarize action items for the practice.'
        : 'Use connection-test and mapping-validate to confirm the recovered adapter contract.'
  };
}

function toApprovalItem(approval, session) {
  return {
    approval_id: approval.approval_id,
    type: approval.type,
    status: approval.status,
    session_id: approval.session_id,
    subject_id: approval.subject_id,
    practice_name: session?.practice?.practice_name || 'Unknown practice',
    requested_by: approval.requested_by,
    updated_at: approval.updated_at || approval.created_at || nowIso()
  };
}

function toApprovalPriority(approvalItem) {
  return {
    title: `Approve live-read access for ${approvalItem.practice_name}`,
    severity: 'medium',
    route_to: 'onboarding_team',
    claim_ref: `approval:${approvalItem.approval_id}`,
    recommendation: 'Review the provider profile and resolve the approval queue item before enabling read-only live access.'
  };
}

function toApprovalReviewItem(approvalItem) {
  return {
    claim_ref: `approval:${approvalItem.approval_id}`,
    severity: 'medium',
    status: approvalItem.status,
    route_to: 'onboarding_team',
    sla_due_at: approvalItem.updated_at
  };
}

function toSessionSummary(session, profile, approval, uploadBatch) {
  const lane = session.tebra?.connection_mode === 'export-upload' ? 'export_upload' : 'soap_api';
  const steps = lane === 'export_upload'
    ? [
        { label: 'intake captured', done: true },
        { label: 'export batch uploaded', done: Boolean(uploadBatch) },
        { label: 'export lane activated', done: session.status === 'export_upload_ready' || profile?.status === 'ready_for_export_ingest' },
        { label: 'review exports + validate mappings', done: false },
        { label: 'optional live sync upgrade later', done: false }
      ]
    : [
        { label: 'intake captured', done: true },
        { label: 'preflight passed', done: session.status !== 'intake_captured' || session.status === 'pilot_manual_connection_requested' || session.status === 'pilot_live_read_ready' || session.status === 'pilot_manual_review_rejected' },
        { label: 'admin-assisted sync requested', done: Boolean(session.provider_profile_id) },
        { label: 'awaiting manual approval', done: approval?.status === 'pending' },
        { label: 'ready for read-only connection test', done: approval?.status === 'approved' || profile?.status === 'ready_for_live_reads' }
      ];

  return {
    session_id: session.session_id,
    practice_name: session.practice?.practice_name || 'Unknown practice',
    status: session.status,
    lane,
    requested_adapter_mode: session.requested_adapter_mode,
    provider_profile_id: profile?.profile_id || session.provider_profile_id || null,
    approval_status: approval?.status || (session.approval_id ? 'pending' : 'not-required'),
    latest_upload_batch_id: uploadBatch?.batch_id || session.latest_upload_batch_id || null,
    upload_artifact_count: uploadBatch?.summary?.artifact_count || 0,
    updated_at: session.updated_at || session.created_at || nowIso(),
    steps
  };
}

function toUploadSummary(batch, session) {
  return {
    batch_id: batch.batch_id,
    session_id: batch.session_id,
    practice_name: session?.practice?.practice_name || batch.practice_name || 'Unknown practice',
    status: batch.status,
    artifact_count: batch.summary?.artifact_count || 0,
    total_bytes: batch.summary?.total_bytes || 0,
    categories_found: batch.summary?.categories_found || [],
    missing_recommended_categories: batch.summary?.missing_recommended_categories || [],
    updated_at: batch.updated_at || batch.created_at || nowIso()
  };
}

export function loadSnapshotForClient() {
  const snapshot = clone(baseSnapshot());
  const sessions = listSessions();
  const profiles = listProviderProfiles();
  const approvals = listApprovals();
  const uploadBatches = listUploadBatches();
  const pendingApprovals = approvals.filter((item) => item.status === 'pending');
  const approvedApprovals = approvals.filter((item) => item.status === 'approved');
  const rejectedApprovals = approvals.filter((item) => item.status === 'rejected');
  const denialTaxonomy = getDenialTaxonomy();
  const denialFeedback = listDenialFeedback();
  const denialLearning = getDenialLearningStats();
  const denialWorklists = listDenialWorklists();
  const pilotBaselines = listPilotBaselines();

  snapshot.generated_at = nowIso();
  snapshot.truths = { ...clone(TRUTHS), ...(snapshot.truths || {}) };
  snapshot.source = {
    ...(snapshot.source || {}),
    type: 'operational-api-client-live',
    run_id: `run_${Date.now()}`,
    finding_count: Number(snapshot.source?.finding_count || 0) + profiles.length + sessions.length + approvals.length + uploadBatches.length
  };

  snapshot.dashboard = snapshot.dashboard || { today_priorities: [], claims_at_risk: [], needs_review: [] };
  snapshot.dashboard.today_priorities = [...(snapshot.dashboard.today_priorities || [])];
  snapshot.dashboard.claims_at_risk = [...(snapshot.dashboard.claims_at_risk || [])];
  snapshot.dashboard.needs_review = [...(snapshot.dashboard.needs_review || [])];

  profiles.forEach((profile) => {
    snapshot.dashboard.needs_review.unshift(toReviewItem(profile));
    snapshot.dashboard.today_priorities.unshift(toPriority(profile));
  });

  const approvalItems = pendingApprovals.map((approval) => {
    const session = sessions.find((item) => item.session_id === approval.session_id) || null;
    return toApprovalItem(approval, session);
  });

  approvalItems.forEach((approvalItem) => {
    snapshot.dashboard.needs_review.unshift(toApprovalReviewItem(approvalItem));
    snapshot.dashboard.today_priorities.unshift(toApprovalPriority(approvalItem));
  });

  const uploadItems = uploadBatches.slice(0, 10).map((batch) => {
    const session = sessions.find((item) => item.session_id === batch.session_id) || null;
    return toUploadSummary(batch, session);
  });

  snapshot.automation = {
    policy: clone(AUTOMATION_POLICY),
    approvals: {
      pending_count: pendingApprovals.length,
      approved_count: approvedApprovals.length,
      rejected_count: rejectedApprovals.length,
      pending_items: approvalItems
    },
    denial_intelligence: {
      specialty: denialTaxonomy.specialty,
      use_case: denialTaxonomy.use_case,
      taxonomy_count: denialTaxonomy.buckets.length,
      feedback_count: denialFeedback.length,
      worklist_count: denialWorklists.length,
      reviewer_confirmed_outcomes: denialLearning.totals?.reviewer_confirmed_outcomes || 0,
      label_drift_pairs: Object.entries(denialLearning.label_drift || {}).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([transition, count]) => ({ transition, count })),
      taxonomy_preview: denialTaxonomy.buckets.slice(0, 4).map((item) => ({
        code: item.code,
        title: item.title,
        route_to: item.route_to,
        severity: item.severity
      }))
    },
    pilot_roi: {
      baseline_count: pilotBaselines.length,
      tracked_practices: pilotBaselines.map((item) => item.practice_name)
    }
  };

  snapshot.onboarding = {
    sessions: sessions.slice(0, 10).map((session) => {
      const profile = profiles.find((item) => item.session_id === session.session_id) || null;
      const approval = approvals.find((item) => item.session_id === session.session_id) || null;
      const uploadBatch = uploadBatches.find((item) => item.session_id === session.session_id) || null;
      return toSessionSummary(session, profile, approval, uploadBatch);
    }),
    upload_batches: uploadItems
  };

  if (denialWorklists.length) {
    const latestWorklist = denialWorklists[0];
    snapshot.dashboard.claims_at_risk = latestWorklist.items.slice(0, 12).map((item) => ({
      claim_ref: item.claim_ref,
      highest_severity: item.highest_severity,
      finding_count: item.categories.length,
      categories: item.categories,
      recommended_next_step: item.recommended_next_step
    }));
  }

  snapshot.ask_worklist = snapshot.ask_worklist || {};
  snapshot.ask_worklist.suggested_prompts = Array.from(new Set([
    ...(snapshot.ask_worklist.suggested_prompts || []),
    'What onboarding sessions are waiting on manual review?',
    'What export uploads are ready for review?',
    'Which PMHNP denial buckets are driving work right now?',
    'How do we prove ROI from this Claim Guard pilot?',
    'Should this practice use upload-first or live sync first?',
    'Is the recovered Tebra attach path ready for live-read testing yet?'
  ]));

  if (approvalItems.length) {
    const top = approvalItems[0];
    snapshot.ask_worklist.top_finding_preview = {
      what_happened: `There are ${approvalItems.length} approval queue item(s) waiting before live reads can proceed.`,
      why_it_matters: 'Automation can prepare the onboarding flow, but read-only live access stays blocked until a human signs off.',
      recommended_next_steps: [
        `Review ${top.practice_name}`,
        'Approve or reject the live-read request',
        'Run connection test only after approval'
      ],
      confidence: 'high',
      main_uncertainty: 'The recovered backend preserves the safety contract, but it is still a reconstructed source tree rather than the original lost private backend.'
    };
  } else if (uploadItems.length) {
    const topUpload = uploadItems[0];
    snapshot.ask_worklist.top_finding_preview = {
      what_happened: `${topUpload.practice_name} uploaded ${topUpload.artifact_count} Tebra export file(s).`,
      why_it_matters: 'That practice can move forward immediately on the easiest lane without waiting for live SOAP access.',
      recommended_next_steps: [
        'Review the uploaded exports',
        'Validate mappings against provider, rendering NPI, billing NPI, and service location',
        'Offer live sync upgrade later if the office wants continuous updates'
      ],
      confidence: 'high',
      main_uncertainty: 'Missing export categories can limit how much the agent can summarize until more files arrive.'
    };
  } else if (pilotBaselines.length) {
    const baseline = pilotBaselines[0];
    snapshot.ask_worklist.top_finding_preview = {
      what_happened: `${baseline.practice_name} has pilot ROI instrumentation enabled for PMHNP Claim Guard worklists.`,
      why_it_matters: 'This product now has a concrete way to measure dollars recovered, denials prevented, and staff time saved instead of only describing workflow automation.',
      recommended_next_steps: ['Record weekly pilot events', 'Generate a pilot ROI report', 'Use denial feedback to tighten the PMHNP ruleset'],
      confidence: 'medium',
      main_uncertainty: 'Live ROI still depends on real pilot data entry and cannot be fabricated by the repo alone.'
    };
  } else if (profiles.length) {
    const pending = profiles.find((item) => item.status === 'pending_manual_review') || profiles[0];
    snapshot.ask_worklist.top_finding_preview = {
      what_happened: `Recovered backend has ${profiles.length} provider profile(s) tracked locally.`,
      why_it_matters: pending.status === 'pending_manual_review'
        ? 'At least one admin-assisted live sync is still blocked on manual review before connection tests should pass.'
        : 'At least one provider profile is approved for read-only live-read testing.',
      recommended_next_steps: pending.status === 'pending_manual_review'
        ? ['Approve manual review', 'Run connection test', 'Validate mappings']
        : ['Run connection test', 'Validate mappings', 'Keep claim submission disabled'],
      confidence: 'medium',
      main_uncertainty: 'This recovered backend mirrors verified behavior and archived contracts, not the lost original private source tree.'
    };
  }

  return snapshot;
}
