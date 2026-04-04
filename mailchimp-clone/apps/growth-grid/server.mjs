import http from 'node:http';
import { createScaleWaveSevenCatalog } from '../../packages/scale-wave-seven/index.mjs';

const GROUP_IDS = ["growth"];

export function createServer() {
  const server = http.createServer((req, res) => {
    const groups = createScaleWaveSevenCatalog().filter((group) => GROUP_IDS.includes(group.id));
    const modules = groups.flatMap((group) => group.modules);
    if (req.url === '/catalog.json') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ app: "growth-grid", title: "Growth Grid", groupCount: groups.length, moduleCount: modules.length, groups }, null, 2));
      return;
    }

    const html = '<!doctype html><html><body><h1>Growth Grid</h1><p>Groups: ' + groups.length + ' · Modules: ' + modules.length + '</p>' + groups.map((group) => '<section><h2>' + group.title + '</h2><p>' + group.description + '</p><ul>' + group.modules.slice(0, 10).map((module) => '<li>' + module.title + '</li>').join('') + '</ul></section>').join('') + '</body></html>';
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  });

  server.start = ({ port = 0 } = {}) => new Promise((resolve) => server.listen(port, () => resolve(server.address())));
  server.stop = () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return server;
}

