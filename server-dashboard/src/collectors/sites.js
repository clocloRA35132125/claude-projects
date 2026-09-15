const http = require('http');
const https = require('https');
const si = require('systeminformation');

function httpGetJson(url, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const lib = url.startsWith('https') ? https : http;
    const start = Date.now();
    const req = lib.get(url, { timeout: timeoutMs }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        const elapsed = Date.now() - start;
        if (res.statusCode && res.statusCode < 500) {
          let json = null;
          try {
            json = JSON.parse(data);
          } catch (e) {
            // response wasn't JSON, fine for a plain health check
          }
          resolve({ ok: true, elapsed, statusCode: res.statusCode, json });
        } else {
          resolve({ ok: false, elapsed, statusCode: res.statusCode, json: null });
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (err) => {
      resolve({ ok: false, elapsed: Date.now() - start, error: err.message, json: null });
    });
  });
}

async function collectSiteStats(site, processList) {
  const health = await httpGetJson(site.healthCheck.target);

  let stats = null;
  if (site.statsEndpoint) {
    const statsRes = await httpGetJson(site.statsEndpoint);
    if (statsRes.ok) stats = statsRes.json;
  }

  const matching = site.process && site.process.match
    ? processList.filter((p) => p.full && p.full.includes(site.process.match))
    : [];
  const cpuPercent = matching.reduce((sum, p) => sum + (p.cpu || 0), 0);
  const memRssBytes = matching.reduce((sum, p) => sum + (p.memRssKb || 0), 0) * 1024;

  return {
    ts: Date.now(),
    site_id: site.id,
    status: health.ok ? 'up' : 'down',
    response_ms: health.elapsed,
    cpu_percent: matching.length ? Math.round(cpuPercent * 10) / 10 : null,
    mem_rss: matching.length ? Math.round(memRssBytes) : null,
    connected_players: stats && typeof stats.connectedPlayers === 'number' ? stats.connectedPlayers : null,
    extra_json: stats ? JSON.stringify(stats) : null,
  };
}

async function collectAllSites(sites) {
  const processes = await si.processes();
  const list = processes.list.map((p) => ({
    full: [p.name, p.command, p.params, p.path].filter(Boolean).join(' '),
    cpu: p.cpu,
    memRssKb: p.memRss,
  }));
  return Promise.all(sites.map((site) => collectSiteStats(site, list)));
}

module.exports = { collectAllSites };
