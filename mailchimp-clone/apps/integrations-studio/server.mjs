import http from 'node:http';
import { summarizeWebhookInspector, createWebhookInspectorDashboardRoutes } from '../../packages/webhook-inspector/index.mjs';
import { summarizePartnerCertification, createPartnerCertificationDashboardRoutes } from '../../packages/partner-certification/index.mjs';
import { summarizeDataActivation, createDataActivationDashboardRoutes } from '../../packages/data-activation/index.mjs';
import { summarizePredictiveSegments, createPredictiveSegmentsDashboardRoutes } from '../../packages/predictive-segments/index.mjs';

export function createServer() {
  const server = http.createServer((req, res) => {
    const summaries = [];
    const routes = [];
    summaries.push({ id: 'section-1', ...summarizeWebhookInspector() });
    routes.push(...createWebhookInspectorDashboardRoutes());
    summaries.push({ id: 'section-2', ...summarizePartnerCertification() });
    routes.push(...createPartnerCertificationDashboardRoutes());
    summaries.push({ id: 'section-3', ...summarizeDataActivation() });
    routes.push(...createDataActivationDashboardRoutes());
    summaries.push({ id: 'section-4', ...summarizePredictiveSegments() });
    routes.push(...createPredictiveSegmentsDashboardRoutes());

    if (req.url === '/catalog.json') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ app: 'integrations-studio', summaries, routes }, null, 2));
      return;
    }

    const html = '<!doctype html><html><body><h1>Integrations Studio</h1>' + summaries.map((summary) => '<section><h2>' + summary.name + '</h2><p>' + summary.focus + '</p><p>Active workstreams: ' + summary.activePrograms + '</p></section>').join('') + '</body></html>';
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  });

  server.start = ({ port = 0 } = {}) => new Promise((resolve) => server.listen(port, () => resolve(server.address())));
  server.stop = () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return server;
}

