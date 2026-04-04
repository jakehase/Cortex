import http from 'node:http';
import { summarizeAdminStudio, createAdminStudioDashboardRoutes } from '../../packages/admin-studio/index.mjs';
import { summarizeTrustCenter, createTrustCenterDashboardRoutes } from '../../packages/trust-center/index.mjs';

export function createServer() {
  const server = http.createServer((req, res) => {
    const summaries = [];
    const routes = [];
      summaries.push({ id: 'section-1', ...summarizeAdminStudio() });
      routes.push(...createAdminStudioDashboardRoutes());
      summaries.push({ id: 'section-2', ...summarizeTrustCenter() });
      routes.push(...createTrustCenterDashboardRoutes());

    if (req.url === '/catalog.json') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ app: 'admin-console', summaries, routes }, null, 2));
      return;
    }

    const html = '<!doctype html><html><body><h1>Admin Console</h1>' + summaries.map((summary) => '<section><h2>' + summary.name + '</h2><p>' + summary.focus + '</p><p>Active workstreams: ' + summary.activeWorkstreams + '</p></section>').join('') + '</body></html>';
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  });

  server.start = ({ port = 0 } = {}) => new Promise((resolve) => server.listen(port, () => resolve(server.address())));
  server.stop = () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return server;
}
