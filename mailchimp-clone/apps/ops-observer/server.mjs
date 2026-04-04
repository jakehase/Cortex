import http from 'node:http';
import { buildBrandGovernanceSnapshot } from '../../packages/brand-governance/index.mjs';
import { buildOpsObservabilitySnapshot } from '../../packages/ops-observability/index.mjs';
import { buildCampaignCalendarSnapshot } from '../../packages/campaign-calendar/index.mjs';
import { buildWorkspaceCatalogSnapshot } from '../../packages/workspace-catalog/index.mjs';

export function createServer() {
  const server = http.createServer((req, res) => {
    const snapshots = [buildBrandGovernanceSnapshot(), buildOpsObservabilitySnapshot(), buildCampaignCalendarSnapshot(), buildWorkspaceCatalogSnapshot()];
    if (req.url === '/catalog.json') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ app: 'ops-observer', snapshots }, null, 2));
      return;
    }
    const html = '<!doctype html><html><body><h1>Ops Observer</h1>' + snapshots.map((snapshot) => '<section><h2>' + snapshot.summary.name + '</h2><p>' + snapshot.summary.focus + '</p><p>Policies: ' + snapshot.policySummary.total + '</p></section>').join('') + '</body></html>';
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  server.start = ({ port = 0 } = {}) => new Promise((resolve) => server.listen(port, () => resolve(server.address())));
  server.stop = () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return server;
}
