const express = require('express');
const db = require('../db');
const { getConfiguredSites } = require('../sites-config');

const router = express.Router();

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
  res.json(getConfiguredSites().map((s) => ({ id: s.id, name: s.name, url: s.url })));
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

module.exports = router;
