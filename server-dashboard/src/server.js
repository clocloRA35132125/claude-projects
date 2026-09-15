require('dotenv').config();
const path = require('path');
const express = require('express');
const db = require('./db');
const { collectSystemStats } = require('./collectors/system');
const { collectAllSites } = require('./collectors/sites');
const { getConfiguredSites } = require('./sites-config');
const apiRouter = require('./routes/api');

const app = express();
const PORT = process.env.PORT || 4500;
const HOST = process.env.HOST || '127.0.0.1';
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 10000);
const RETENTION_DAYS = Number(process.env.RETENTION_DAYS || 30);

app.use('/api', apiRouter);
app.use(express.static(path.join(__dirname, '..', 'public')));

async function pollOnce() {
  try {
    const systemStats = await collectSystemStats();
    db.insertSystemSnapshot(systemStats);
  } catch (err) {
    console.error('[dashboard] system collection failed:', err.message);
  }

  try {
    const sites = getConfiguredSites();
    const results = await collectAllSites(sites);
    for (const r of results) db.insertSiteSnapshot(r);
  } catch (err) {
    console.error('[dashboard] site collection failed:', err.message);
  }
}

function prune() {
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  db.pruneOlderThan(cutoff);
}

pollOnce();
setInterval(pollOnce, POLL_INTERVAL_MS);
setInterval(prune, 24 * 60 * 60 * 1000);

app.listen(PORT, HOST, () => {
  console.log(`[dashboard] listening on http://${HOST}:${PORT}`);
  if (HOST === '0.0.0.0') {
    console.warn('[dashboard] WARNING: bound to 0.0.0.0 — this exposes the dashboard beyond Tailscale. Set HOST in .env to your Tailscale IP.');
  }
});
