import test from 'node:test';
import assert from 'node:assert/strict';

import { audienceLifecycleSummary, buildAudienceSegmentRecommendations } from '../packages/app/domain-audience.mjs';
import { buildCampaignEditorLayoutPreset, buildCampaignEditorNarrativeOutline, buildCampaignFollowupPlan, campaignLaunchChecklist, campaignPerformanceSnapshot, summarizeCampaignEditorReadiness } from '../packages/app/domain-campaigns.mjs';
import { buildCampaignOptimizationBrief, buildJourneyChannelMix, buildWebsiteExperimentCopyPack } from '../packages/app/ai-provider.mjs';
import { buildWebsitePublishingChecklist, websiteExperienceSummary, websiteRevisionSummary } from '../packages/app/domain-website-builder.mjs';
import { createTemplateVariantExperimentMatrix, summarizeVariantPromotionQueue } from '../packages/template-variants/domain-template-variants.mjs';
import { createTemplateApprovalLoadboard, summarizeApprovalCoverage } from '../packages/template-approvals/domain-template-approvals.mjs';

function baseState() {
  return {
    db: {
      contacts: [
        {
          id: 'contact-1',
          workspaceId: 'ws-1',
          audienceId: 'aud-1',
          email: 'vip@example.com',
          status: 'subscribed',
          phone: '555-1111',
          tags: ['VIP', 'Retail'],
          interests: ['Shoes'],
          groups: { tier: 'gold' },
          activity: [{ at: new Date().toISOString(), message: 'Clicked latest campaign' }]
        },
        {
          id: 'contact-2',
          workspaceId: 'ws-1',
          audienceId: 'aud-1',
          email: 'cleaned@example.com',
          status: 'cleaned',
          tags: ['Retail'],
          interests: ['Accessories'],
          groups: { tier: 'silver' },
          activity: [{ at: new Date(Date.now() - (1000 * 60 * 60 * 24 * 10)).toISOString(), message: 'Opened newsletter' }]
        }
      ],
      segments: [],
      approvalRequests: [],
      campaigns: [{
        id: 'camp-1',
        workspaceId: 'ws-1',
        name: 'Spring launch',
        audienceId: 'aud-1',
        subject: 'Spring launch',
        preheader: 'Preview the launch',
        templateId: 'tpl-1',
        blocks: [{ type: 'text', title: 'Hero', body: 'Hello world' }],
        setupComplete: true,
        recipientsComplete: true,
        status: 'draft',
        report: {
          opens: 1,
          clicks: 0,
          bounces: 0,
          unsubscribes: 0,
          funnel: { attributedAutomationRuns: 0, formSubmissions: 0, landingSubmissions: 0 },
          history: [{ at: new Date().toISOString(), event: 'draft' }]
        }
      }],
      automations: [{ id: 'auto-1', workspaceId: 'ws-1', sourceCampaignId: 'camp-1', trigger: 'campaign_sent', status: 'live' }],
      automationRuns: [{ id: 'run-1', automationId: 'auto-1', campaignId: 'camp-1', status: 'completed', createdAt: new Date().toISOString() }],
      websites: [{
        id: 'site-1',
        workspaceId: 'ws-1',
        name: 'Demo site',
        slug: 'demo-site',
        seoTitle: 'Demo Site',
        seoDescription: 'Demo description',
        analyticsEnabled: true,
        status: 'draft',
        analytics: { views: 12, signups: 2, ctaClicks: 3, byPage: {} },
        revisions: { undo: [{ id: 'rev-1', pageId: 'page-1' }], redo: [] }
      }],
      websitePages: [{
        id: 'page-1',
        websiteId: 'site-1',
        name: 'Home',
        slug: '',
        showInNav: true,
        order: 1,
        analytics: { views: 12, signups: 2, ctaClicks: 3 }
      }]
    }
  };
}

test('parity expansion helpers expose richer real-surface summaries', () => {
  const state = baseState();
  const audience = { id: 'aud-1', name: 'Retail audience' };
  const workspace = { settings: { senderEmail: 'team@example.com', address: '123 Market St' } };
  const campaign = state.db.campaigns[0];
  const website = state.db.websites[0];

  const lifecycle = audienceLifecycleSummary(state, audience);
  const recommendations = buildAudienceSegmentRecommendations(state, audience);
  const checklist = campaignLaunchChecklist(state, campaign, workspace);
  const performance = campaignPerformanceSnapshot(state, campaign);
  const followup = buildCampaignFollowupPlan(state, campaign);
  const editorReadiness = summarizeCampaignEditorReadiness(campaign);
  const editorOutline = buildCampaignEditorNarrativeOutline(campaign);
  const editorLayout = buildCampaignEditorLayoutPreset({ ...campaign, editorSettings: { brandTone: 'editorial', audienceAngle: 'education', layoutDensity: 'balanced', heroStyle: 'story-led' } }, { preset: 'launch_story' });
  const optimization = buildCampaignOptimizationBrief(campaign, { goal: 'conversion' });
  const channelMix = buildJourneyChannelMix(state.db.automations[0], { goal: 'retention' });
  const copyPack = buildWebsiteExperimentCopyPack(website, { goal: 'lead capture' });
  const websiteSummary = websiteExperienceSummary(state, website);
  const publishingChecklist = buildWebsitePublishingChecklist(state, website);
  const revisionSummary = websiteRevisionSummary(website);
  const variantMatrix = createTemplateVariantExperimentMatrix();
  const variantQueue = summarizeVariantPromotionQueue();
  const approvalLoadboard = createTemplateApprovalLoadboard();
  const approvalCoverage = summarizeApprovalCoverage();

  assert.equal(lifecycle.totalContacts, 2);
  assert.ok(recommendations.recommendations.length >= 2);
  assert.equal(checklist.ready, true);
  assert.ok(performance.openRate > 0);
  assert.ok(Array.isArray(followup.plan));
  assert.ok(editorReadiness.score < 100);
  assert.equal(editorOutline[0].sectionName, 'Section 1');
  assert.equal(editorLayout.length, 4);
  assert.equal(editorLayout[0].sectionName, 'Launch hero');
  assert.ok(optimization.subjectSummary.average > 0);
  assert.equal(channelMix.primaryChannel, 'email');
  assert.equal(copyPack.variants.length, 2);
  assert.equal(websiteSummary.pageCount, 1);
  assert.equal(publishingChecklist.ready, true);
  assert.equal(revisionSummary.undoDepth, 1);
  assert.equal(variantMatrix.length, 4);
  assert.ok(variantQueue.activeExperiments >= 1);
  assert.equal(approvalLoadboard.length, 4);
  assert.ok(approvalCoverage.totalTemplatesWaiting > 0);
});
