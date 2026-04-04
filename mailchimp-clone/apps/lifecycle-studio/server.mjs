import http from 'node:http';
import { summarizeCustomerHealth, createCustomerHealthDashboardRoutes } from '../../packages/customer-health/index.mjs';
import { summarizeEngagementForecasting, createEngagementForecastingDashboardRoutes } from '../../packages/engagement-forecasting/index.mjs';
import { summarizeRetentionOffers, createRetentionOffersDashboardRoutes } from '../../packages/retention-offers/index.mjs';
import { summarizeSubscriptionIntelligence, createSubscriptionIntelligenceDashboardRoutes } from '../../packages/subscription-intelligence/index.mjs';

export function createServer() {
  const server = http.createServer((req, res) => {
    const summaries = [];
    const routes = [];
    summaries.push({ id: 'section-1', ...summarizeCustomerHealth() });
    routes.push(...createCustomerHealthDashboardRoutes());
    summaries.push({ id: 'section-2', ...summarizeEngagementForecasting() });
    routes.push(...createEngagementForecastingDashboardRoutes());
    summaries.push({ id: 'section-3', ...summarizeRetentionOffers() });
    routes.push(...createRetentionOffersDashboardRoutes());
    summaries.push({ id: 'section-4', ...summarizeSubscriptionIntelligence() });
    routes.push(...createSubscriptionIntelligenceDashboardRoutes());

    if (req.url === '/catalog.json') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ app: 'lifecycle-studio', summaries, routes }, null, 2));
      return;
    }

    const html = '<!doctype html><html><body><h1>Lifecycle Studio</h1>' + summaries.map((summary) => '<section><h2>' + summary.name + '</h2><p>' + summary.focus + '</p><p>Active workstreams: ' + summary.activePrograms + '</p></section>').join('') + '</body></html>';
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  });

  server.start = ({ port = 0 } = {}) => new Promise((resolve) => server.listen(port, () => resolve(server.address())));
  server.stop = () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return server;
}

