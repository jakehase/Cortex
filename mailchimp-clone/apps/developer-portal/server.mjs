import http from 'node:http';
import { summarizeDeveloperHub, createDeveloperHubDashboardRoutes } from '../../packages/developer-hub/index.mjs';
import { summarizeDataPipeline, createDataPipelineDashboardRoutes } from '../../packages/data-pipeline/index.mjs';
import { summarizePartnerExchange, createPartnerExchangeDashboardRoutes } from '../../packages/partner-exchange/index.mjs';

export function createServer() {
  const server = http.createServer((req, res) => {
    const summaries = [];
    const routes = [];
      summaries.push({ id: 'section-1', ...summarizeDeveloperHub() });
      routes.push(...createDeveloperHubDashboardRoutes());
      summaries.push({ id: 'section-2', ...summarizeDataPipeline() });
      routes.push(...createDataPipelineDashboardRoutes());
      summaries.push({ id: 'section-3', ...summarizePartnerExchange() });
      routes.push(...createPartnerExchangeDashboardRoutes());

    if (req.url === '/catalog.json') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ app: 'developer-portal', summaries, routes }, null, 2));
      return;
    }

    const html = '<!doctype html><html><body><h1>Developer Portal</h1>' + summaries.map((summary) => '<section><h2>' + summary.name + '</h2><p>' + summary.focus + '</p><p>Active workstreams: ' + summary.activeWorkstreams + '</p></section>').join('') + '</body></html>';
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  });

  server.start = ({ port = 0 } = {}) => new Promise((resolve) => server.listen(port, () => resolve(server.address())));
  server.stop = () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return server;
}
