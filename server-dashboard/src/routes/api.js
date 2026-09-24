const path = require('path');
const express = require('express');
const db = require('../db');
const { getConfiguredSites } = require('../sites-config');
const { listPlayers, accountExists, setCredits, removeItem, loadCatalog, grantItem, setBan, clearBan, clearBanIp } = require('../players');

const router = express.Router();
const CONFIG_DIR = path.join(__dirname, '..', '..', 'config');

function getSiteConfig(siteId) {
  return getConfiguredSites().find((s) => s.id === siteId);
}

function getCatalogForSite(site) {
  if (!site.itemCatalog) return { rarities: {}, kinds: [], items: [] };
  return loadCatalog(path.join(CONFIG_DIR, site.itemCatalog));
}

function rangeToMs(range) {
  switch (range) {
    case '1h': return 60 * 60 * 1000;
    case '6h': return 6 * 60 * 60 * 1000;
    case '24h': return 24 * 60 * 60 * 1000;
    case '7d': return 7 * 24 * 60 * 60 * 1000;
    default: return 60 * 60 * 1000;
  }
}

router.get('/sites', (req, res) => {
  res.json(getConfiguredSites().map((s) => ({ id: s.id, name: s.name, url: s.url, hasPlayers: !!s.playersDataDir })));
});

router.get('/overview', (req, res) => {
  res.json({
    system: db.getLatestSystem() || null,
    sites: db.getLatestSiteSnapshots(),
  });
});

router.get('/history/system', (req, res) => {
  const since = Date.now() - rangeToMs(req.query.range);
  res.json(db.getSystemHistory(since));
});

router.get('/history/site/:id', (req, res) => {
  const since = Date.now() - rangeToMs(req.query.range);
  res.json(db.getSiteHistory(req.params.id, since));
});

router.get('/players/:siteId', (req, res) => {
  const site = getSiteConfig(req.params.siteId);
  if (!site || !site.playersDataDir) {
    return res.status(404).json({ error: 'Pas de données joueurs pour ce site.' });
  }
  try {
    res.json({
      players: listPlayers(site.playersDataDir),
      catalog: getCatalogForSite(site),
    });
  } catch (err) {
    res.status(500).json({ error: 'Lecture des données joueurs impossible.' });
  }
});

router.post('/players/:siteId/:accountId/credits', (req, res) => {
  const site = getSiteConfig(req.params.siteId);
  if (!site || !site.playersDataDir) {
    return res.status(404).json({ error: 'Pas de données joueurs pour ce site.' });
  }
  if (!accountExists(site.playersDataDir, req.params.accountId)) {
    return res.status(404).json({ error: 'Compte introuvable.' });
  }
  const amount = Number(req.body?.amount);
  try {
    const credits = setCredits(site.playersDataDir, req.params.accountId, amount);
    res.json({ credits });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/players/:siteId/:accountId/items', (req, res) => {
  const site = getSiteConfig(req.params.siteId);
  if (!site || !site.playersDataDir) {
    return res.status(404).json({ error: 'Pas de données joueurs pour ce site.' });
  }
  if (!accountExists(site.playersDataDir, req.params.accountId)) {
    return res.status(404).json({ error: 'Compte introuvable.' });
  }
  const itemId = String(req.body?.itemId || '');
  try {
    const items = grantItem(site.playersDataDir, req.params.accountId, itemId, getCatalogForSite(site));
    res.json({ items });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/players/:siteId/:accountId/items/:itemId', (req, res) => {
  const site = getSiteConfig(req.params.siteId);
  if (!site || !site.playersDataDir) {
    return res.status(404).json({ error: 'Pas de données joueurs pour ce site.' });
  }
  if (!accountExists(site.playersDataDir, req.params.accountId)) {
    return res.status(404).json({ error: 'Compte introuvable.' });
  }
  const items = removeItem(site.playersDataDir, req.params.accountId, req.params.itemId);
  res.json({ items });
});

router.post('/players/:siteId/:accountId/ban', (req, res) => {
  const site = getSiteConfig(req.params.siteId);
  if (!site || !site.playersDataDir) {
    return res.status(404).json({ error: 'Pas de données joueurs pour ce site.' });
  }
  if (!accountExists(site.playersDataDir, req.params.accountId)) {
    return res.status(404).json({ error: 'Compte introuvable.' });
  }
  const { permanent, durationMs, reason, includeIp } = req.body || {};
  const until = permanent ? null : Date.now() + Number(durationMs);
  try {
    const ban = setBan(site.playersDataDir, req.params.accountId, until, reason, !!includeIp);
    res.json({ ban });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/players/:siteId/:accountId/ban/ip', (req, res) => {
  const site = getSiteConfig(req.params.siteId);
  if (!site || !site.playersDataDir) {
    return res.status(404).json({ error: 'Pas de données joueurs pour ce site.' });
  }
  if (!accountExists(site.playersDataDir, req.params.accountId)) {
    return res.status(404).json({ error: 'Compte introuvable.' });
  }
  const ban = clearBanIp(site.playersDataDir, req.params.accountId);
  res.json({ ban });
});

router.delete('/players/:siteId/:accountId/ban', (req, res) => {
  const site = getSiteConfig(req.params.siteId);
  if (!site || !site.playersDataDir) {
    return res.status(404).json({ error: 'Pas de données joueurs pour ce site.' });
  }
  if (!accountExists(site.playersDataDir, req.params.accountId)) {
    return res.status(404).json({ error: 'Compte introuvable.' });
  }
  clearBan(site.playersDataDir, req.params.accountId);
  res.json({ ban: null });
});

module.exports = router;
