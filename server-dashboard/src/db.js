const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'dashboard.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS system_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  cpu_load REAL,
  cpu_cores_json TEXT,
  load1 REAL,
  load5 REAL,
  load15 REAL,
  mem_used INTEGER,
  mem_total INTEGER,
  disk_used INTEGER,
  disk_total INTEGER,
  net_rx_sec REAL,
  net_tx_sec REAL,
  cpu_temp REAL,
  uptime_sec INTEGER
);
CREATE INDEX IF NOT EXISTS idx_system_ts ON system_snapshots(ts);

CREATE TABLE IF NOT EXISTS site_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  site_id TEXT NOT NULL,
  status TEXT NOT NULL,
  response_ms INTEGER,
  cpu_percent REAL,
  mem_rss INTEGER,
  connected_players INTEGER,
  extra_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_site_ts ON site_snapshots(site_id, ts);
`);

const insertSystemStmt = db.prepare(`INSERT INTO system_snapshots
  (ts, cpu_load, cpu_cores_json, load1, load5, load15, mem_used, mem_total, disk_used, disk_total, net_rx_sec, net_tx_sec, cpu_temp, uptime_sec)
  VALUES (@ts, @cpu_load, @cpu_cores_json, @load1, @load5, @load15, @mem_used, @mem_total, @disk_used, @disk_total, @net_rx_sec, @net_tx_sec, @cpu_temp, @uptime_sec)`);

const insertSiteStmt = db.prepare(`INSERT INTO site_snapshots
  (ts, site_id, status, response_ms, cpu_percent, mem_rss, connected_players, extra_json)
  VALUES (@ts, @site_id, @status, @response_ms, @cpu_percent, @mem_rss, @connected_players, @extra_json)`);

function insertSystemSnapshot(s) {
  insertSystemStmt.run(s);
}

function insertSiteSnapshot(s) {
  insertSiteStmt.run(s);
}

function getSystemHistory(sinceTs) {
  return db.prepare(`SELECT * FROM system_snapshots WHERE ts >= ? ORDER BY ts ASC`).all(sinceTs);
}

function getSiteHistory(siteId, sinceTs) {
  return db.prepare(`SELECT * FROM site_snapshots WHERE site_id = ? AND ts >= ? ORDER BY ts ASC`).all(siteId, sinceTs);
}

function getLatestSystem() {
  return db.prepare(`SELECT * FROM system_snapshots ORDER BY ts DESC LIMIT 1`).get();
}

function getLatestSiteSnapshots() {
  return db.prepare(`
    SELECT s.* FROM site_snapshots s
    INNER JOIN (SELECT site_id, MAX(ts) AS max_ts FROM site_snapshots GROUP BY site_id) m
    ON s.site_id = m.site_id AND s.ts = m.max_ts
  `).all();
}

function pruneOlderThan(ts) {
  db.prepare(`DELETE FROM system_snapshots WHERE ts < ?`).run(ts);
  db.prepare(`DELETE FROM site_snapshots WHERE ts < ?`).run(ts);
}

module.exports = {
  insertSystemSnapshot,
  insertSiteSnapshot,
  getSystemHistory,
  getSiteHistory,
  getLatestSystem,
  getLatestSiteSnapshots,
  pruneOlderThan,
};
