import http from 'node:http';
import { summarizeAudienceIntelligence, createAudienceIntelligenceDashboardRoutes } from '../../packages/audience-intelligence/index.mjs';
import { summarizeRevenueOps, createRevenueOpsDashboardRoutes } from '../../packages/revenue-ops/index.mjs';
import { summarizeContentLibrary, createContentLibraryDashboardRoutes } from '../../packages/content-library/index.mjs';
import { summarizeCampaignBriefs, createCampaignBriefsDashboardRoutes } from '../../packages/campaign-briefs/index.mjs';
import { summarizeExperimentLab, createExperimentLabDashboardRoutes } from '../../packages/experiment-lab/index.mjs';

export function createServer() {
  const server = http.createServer((req, res) => {
    const summaries = [];
    const routes = [];
      summaries.push({ id: 'section-1', ...summarizeAudienceIntelligence() });
      routes.push(...createAudienceIntelligenceDashboardRoutes());
      summaries.push({ id: 'section-2', ...summarizeRevenueOps() });
      routes.push(...createRevenueOpsDashboardRoutes());
      summaries.push({ id: 'section-3', ...summarizeContentLibrary() });
      routes.push(...createContentLibraryDashboardRoutes());
      summaries.push({ id: 'section-4', ...summarizeCampaignBriefs() });
      routes.push(...createCampaignBriefsDashboardRoutes());
      summaries.push({ id: 'section-5', ...summarizeExperimentLab() });
      routes.push(...createExperimentLabDashboardRoutes());

    if (req.url === '/catalog.json') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ app: 'customer-success', summaries, routes }, null, 2));
      return;
    }

    const html = '<!doctype html><html><body><h1>Customer Success Console</h1>' + summaries.map((summary) => '<section><h2>' + summary.name + '</h2><p>' + summary.focus + '</p><p>Active workstreams: ' + summary.activeWorkstreams + '</p></section>').join('') + '</body></html>';
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  });

  server.start = ({ port = 0 } = {}) => new Promise((resolve) => server.listen(port, () => resolve(server.address())));
  server.stop = () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return server;
}
