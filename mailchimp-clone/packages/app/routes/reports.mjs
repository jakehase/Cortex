import { automationRunSummary, campaignGrowthFunnel } from '../domain-growth.mjs';
import { page } from '../view.mjs';
import { analyticsSeries, workspaceSummary } from '../domain-growth.mjs';
import { revenueSummary } from '../domain-commerce-revenue.mjs';
import { csv, text } from '../utils.mjs';

export function registerReportRoutes(router, deps) {
  const { requireAuth } = deps;

  router.register('GET', '/reports', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res); if (!actor) return; const summary = workspaceSummary(state, actor.workspace.id); const trends = analyticsSeries(state, actor.workspace.id); const revenue = revenueSummary(state, actor.workspace.id);
    text(res, 200, page('Reports overview', actor, `<div class="grid"><div class="card"><h3>Workspace metrics</h3><pre>${JSON.stringify(summary, null, 2)}</pre></div><div class="card"><h3>Trend cards</h3><ul>${trends.map((entry) => `<li>${entry.label}: ${entry.value}</li>`).join('')}</ul></div><div class="card"><h3>Revenue attribution</h3><pre>${JSON.stringify(revenue, null, 2)}</pre></div><div class="card"><h3>Current-product reports</h3><p><a href="/reports/optimization">Optimization outcomes</a></p><p><a href="/reports/omnichannel">Omnichannel performance</a></p></div></div><div class="card"><h3>Report drilldown</h3><ul>${state.db.campaigns.filter((entry) => entry.workspaceId === actor.workspace.id).map((campaign) => `<li><a href="/reports/campaigns/${campaign.id}">${campaign.name}</a>${state.db.campaignExperiments?.find((experiment) => experiment.campaignId === campaign.id) ? ` · <a href="/reports/experiments/${state.db.campaignExperiments.find((experiment) => experiment.campaignId === campaign.id).id}">experiment</a>` : ''}</li>`).join('')}${state.db.automations.filter((entry) => entry.workspaceId === actor.workspace.id).map((automation) => `<li><a href="/reports/automations/${automation.id}">${automation.name}</a></li>`).join('')}</ul></div>`));
  });

  router.register('GET', '/reports/campaigns/:id', async ({ state, req, params, res }) => {
    const actor = requireAuth(state, req, res); if (!actor) return; const campaign = state.db.campaigns.find((entry) => entry.id === params.id && entry.workspaceId === actor.workspace.id); const funnel = campaignGrowthFunnel(state, campaign.id);
    text(res, 200, page(`Campaign report: ${campaign.name}`, actor, `<div class="grid"><div class="card"><h3>Performance</h3><pre>${JSON.stringify(campaign.report || {}, null, 2)}</pre></div><div class="card"><h3>Drilldown</h3><p>Recipients: ${campaign.report?.history?.[0]?.recipients || 0}</p><p>Opens: ${campaign.report?.opens || 0}</p><p>Clicks: ${campaign.report?.clicks || 0}</p><p><a href="/reports/export.csv?kind=campaign&id=${campaign.id}">Export CSV</a></p></div><div class="card"><h3>Linked growth funnel</h3><p>Landing pages: ${funnel.landingPages}</p><p>Landing views: ${funnel.landingViews}</p><p>Landing submissions: ${funnel.landingSubmissions}</p><p>Form submissions: ${funnel.formSubmissions}</p><p>Attributed automation runs: ${funnel.attributedAutomationRuns}</p></div></div>`));
  });

  router.register('GET', '/reports/automations/:id', async ({ state, req, params, res }) => {
    const actor = requireAuth(state, req, res); if (!actor) return; const automation = state.db.automations.find((entry) => entry.id === params.id && entry.workspaceId === actor.workspace.id); const runSummary = automationRunSummary(state, automation);
    text(res, 200, page(`Automation report: ${automation.name}`, actor, `<div class="grid"><div class="card"><pre>${JSON.stringify(automation.report || {}, null, 2)}</pre></div><div class="card"><h3>Lifecycle</h3><p>Status: ${automation.status}</p><p>History events: ${(automation.report?.history || []).length}</p><p>Runs: ${runSummary.totalRuns}</p><p>Re-entry: ${automation.reentryPolicy || 'once_per_contact'}</p><p>Goal: ${automation.goal || '—'}</p></div></div><div class="card"><h3>Recent runs</h3><table><tr><th>Trigger</th><th>Form</th><th>Campaign</th><th>Goal</th><th>Completed</th></tr>${runSummary.latestRuns.map((run) => `<tr><td>${run.trigger}</td><td>${run.formId || '—'}</td><td>${run.campaignId || '—'}</td><td>${run.goalReached ? 'yes' : 'no'}</td><td>${run.completedAt}</td></tr>`).join('') || '<tr><td colspan="5">No runs yet.</td></tr>'}</table></div>`));
  });

  router.register('GET', '/reports/export.csv', async ({ state, req, res, url }) => {
    const actor = requireAuth(state, req, res); if (!actor) return; const kind = url.searchParams.get('kind'); const id = url.searchParams.get('id');
    if (kind === 'campaign') {
      const campaign = state.db.campaigns.find((entry) => entry.id === id && entry.workspaceId === actor.workspace.id);
      const funnel = campaignGrowthFunnel(state, campaign.id);
      return csv(res, 'campaign-report.csv', `metric,value\nopens,${campaign.report?.opens || 0}\nclicks,${campaign.report?.clicks || 0}\nrecipients,${campaign.report?.history?.[0]?.recipients || 0}\nlanding_views,${funnel.landingViews}\nform_submissions,${funnel.formSubmissions}\nautomation_runs,${funnel.attributedAutomationRuns}`);
    }
    csv(res, 'workspace-report.csv', ['kind,label,value', ...analyticsSeries(state, actor.workspace.id).map((entry) => `trend,${entry.label},${entry.value}`)].join('\n'));
  });
}
