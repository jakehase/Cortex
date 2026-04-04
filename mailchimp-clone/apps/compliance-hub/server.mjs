import http from 'node:http';
import { summarizeConsentLedger, createConsentLedgerDashboardRoutes } from '../../packages/consent-ledger/index.mjs';
import { summarizeComplianceIncidents, createComplianceIncidentsDashboardRoutes } from '../../packages/compliance-incidents/index.mjs';
import { summarizeTrustAutomation, createTrustAutomationDashboardRoutes } from '../../packages/trust-automation/index.mjs';
import { summarizeServiceRecovery, createServiceRecoveryDashboardRoutes } from '../../packages/service-recovery/index.mjs';

export function createServer() {
  const server = http.createServer((req, res) => {
    const summaries = [];
    const routes = [];
    summaries.push({ id: 'section-1', ...summarizeConsentLedger() });
    routes.push(...createConsentLedgerDashboardRoutes());
    summaries.push({ id: 'section-2', ...summarizeComplianceIncidents() });
    routes.push(...createComplianceIncidentsDashboardRoutes());
    summaries.push({ id: 'section-3', ...summarizeTrustAutomation() });
    routes.push(...createTrustAutomationDashboardRoutes());
    summaries.push({ id: 'section-4', ...summarizeServiceRecovery() });
    routes.push(...createServiceRecoveryDashboardRoutes());

    if (req.url === '/catalog.json') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ app: 'compliance-hub', summaries, routes }, null, 2));
      return;
    }

    const html = '<!doctype html><html><body><h1>Compliance Hub</h1>' + summaries.map((summary) => '<section><h2>' + summary.name + '</h2><p>' + summary.focus + '</p><p>Active workstreams: ' + summary.activePrograms + '</p></section>').join('') + '</body></html>';
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  });

  server.start = ({ port = 0 } = {}) => new Promise((resolve) => server.listen(port, () => resolve(server.address())));
  server.stop = () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return server;
}

