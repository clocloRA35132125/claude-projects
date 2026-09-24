if (window.Chart && window['chartjs-plugin-annotation']) {
  Chart.register(window['chartjs-plugin-annotation']);
}

const REFRESH_MS = 5000;
const HISTORY_REFRESH_MS = 60000;

const el = (id) => document.getElementById(id);

let range = '1h';
let sitesMeta = [];
let selectedSiteId = null;
let latestSitesSnapshot = [];
let currentSiteRows = [];
let activeDetailMetric = 'connected_players';

let mainChart, networkChart, detailChart;
const sparklines = {};

let selectedPlayersSiteId = null;
let playersData = [];
let catalogData = { rarities: {}, kinds: [], items: [] };
let activeModalPlayer = null;
let activeCatalogTab = 'all';
let selectedBanDuration = '24h';
let banCustomValue = 1;
let banCustomUnit = 'hours';

const BAN_DURATIONS = [
  { key: '1h', ms: 60 * 60 * 1000, label: '1h' },
  { key: '24h', ms: 24 * 60 * 60 * 1000, label: '24h' },
  { key: '7d', ms: 7 * 24 * 60 * 60 * 1000, label: '7j' },
  { key: '30d', ms: 30 * 24 * 60 * 60 * 1000, label: '30j' },
];

const BAN_UNIT_MS = { minutes: 60 * 1000, hours: 60 * 60 * 1000, days: 24 * 60 * 60 * 1000 };
const BAN_UNIT_LABELS = { minutes: 'minute(s)', hours: 'heure(s)', days: 'jour(s)' };

const METRIC_DEFS = {
  connected_players: { label: 'Joueurs connectés', color: '#5b8cff', transform: (v) => v },
  response_ms: { label: 'Temps de réponse (ms)', color: '#fbbf24', transform: (v) => v },
  cpu_percent: { label: 'CPU (%)', color: '#34d399', transform: (v) => v },
  mem_rss: { label: 'Mémoire (MB)', color: '#c084fc', transform: (v) => v / (1024 * 1024) },
};

const RANGE_LABELS = { '1h': '1h', '6h': '6h', '24h': '24h', '7d': '7j' };

/* ---------------- formatting ---------------- */

function fmtBytes(bytes) {
  if (bytes == null || Number.isNaN(bytes)) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = Math.abs(bytes);
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${(bytes < 0 ? -v : v).toFixed(1)} ${units[i]}`;
}

function fmtBytesPerSec(bytes) {
  return bytes == null ? '—' : `${fmtBytes(bytes)}/s`;
}

function fmtDuration(seconds) {
  if (seconds == null) return '—';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}j ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function fmtMs(ms) {
  return ms == null ? '—' : `${Math.round(ms)} ms`;
}

function statusLabel(status) {
  if (status === 'up') return { cls: 'up', text: 'En ligne' };
  if (status === 'down') return { cls: 'down', text: 'Hors ligne' };
  return { cls: 'unknown', text: 'Inconnu' };
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/* ---------------- chart helpers ---------------- */

function gradientFill(color) {
  return (ctx) => {
    const { chart } = ctx;
    const { ctx: c, chartArea } = chart;
    if (!chartArea) return color + '22';
    const g = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
    g.addColorStop(0, color + '3d');
    g.addColorStop(1, color + '00');
    return g;
  };
}

function makeSparkline(canvas, color) {
  return new Chart(canvas, {
    type: 'line',
    data: {
      datasets: [{
        data: [],
        borderColor: color,
        backgroundColor: gradientFill(color),
        fill: true,
        borderWidth: 1.5,
        pointRadius: 0,
        tension: 0.35,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      resizeDelay: 100,
      animation: false,
      scales: {
        x: { type: 'time', display: false },
        y: { display: false },
      },
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
    },
  });
}

function updateSparkline(chart, rows, field) {
  const data = rows.filter((r) => r[field] != null).map((r) => ({ x: r.ts, y: r[field] }));
  chart.data.datasets[0].data = data;
  chart.update('none');
}

function makeTimeChart(canvas, datasetDefs, opts = {}) {
  return new Chart(canvas, {
    type: 'line',
    data: {
      datasets: datasetDefs.map((d) => ({
        label: d.label,
        data: [],
        borderColor: d.color,
        backgroundColor: gradientFill(d.color),
        fill: true,
        tension: 0.3,
        pointRadius: 0,
        pointHoverRadius: 4,
        pointHoverBackgroundColor: d.color,
        borderWidth: 2,
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      resizeDelay: 100,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: {
          type: 'time',
          time: { tooltipFormat: 'dd/MM HH:mm' },
          grid: { color: '#1c202b' },
          ticks: { color: '#5c6478', maxRotation: 0, autoSkip: true, maxTicksLimit: 8 },
        },
        y: {
          beginAtZero: true,
          max: opts.yMax,
          grid: { color: '#1c202b' },
          ticks: {
            color: '#5c6478',
            callback: opts.yFormat ? (v) => opts.yFormat(v) : undefined,
          },
        },
      },
      plugins: {
        legend: {
          display: datasetDefs.length > 1,
          position: 'top',
          align: 'end',
          labels: { color: '#8892a6', boxWidth: 9, boxHeight: 9, usePointStyle: true, pointStyle: 'circle', font: { size: 11.5 }, padding: 14 },
        },
        tooltip: {
          backgroundColor: '#171b24',
          borderColor: '#242938',
          borderWidth: 1,
          titleColor: '#f1f3f7',
          bodyColor: '#c7cbd6',
          padding: 10,
          cornerRadius: 8,
        },
        annotation: { annotations: {} },
      },
    },
  });
}

/* ---------------- trend / stats ---------------- */

function trendFor(rows, field) {
  if (!rows || rows.length < 2) return { text: '—', cls: '' };
  const last = rows[rows.length - 1][field];
  const targetTs = rows[rows.length - 1].ts - 15 * 60 * 1000;
  let ref = rows[0][field];
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].ts <= targetTs) {
      ref = rows[i][field];
      break;
    }
  }
  if (last == null || ref == null) return { text: '—', cls: '' };
  const delta = last - ref;
  if (Math.abs(delta) < 0.5) return { text: 'stable', cls: '' };
  const arrow = delta > 0 ? '▲' : '▼';
  return { text: `${arrow} ${Math.abs(delta).toFixed(1)}%`, cls: delta > 0 ? 'up' : 'down' };
}

function setTrend(id, t) {
  const badge = el(id);
  if (!badge) return;
  badge.textContent = t.text;
  badge.className = 'trend-badge' + (t.cls ? ' ' + t.cls : '');
}

function computeDownSegments(rows) {
  const segments = [];
  let start = null;
  rows.forEach((r, i) => {
    if (r.status === 'down' && start == null) start = r.ts;
    if (r.status !== 'down' && start != null) {
      segments.push([start, rows[i - 1].ts]);
      start = null;
    }
  });
  if (start != null && rows.length) segments.push([start, rows[rows.length - 1].ts]);
  return segments;
}

function computeSiteStats(rows) {
  if (!rows.length) return { uptimePct: null, avgResp: null, peakPlayers: null, incidents: 0 };
  const upCount = rows.filter((r) => r.status === 'up').length;
  const uptimePct = (upCount / rows.length) * 100;
  const responses = rows.filter((r) => r.status === 'up' && r.response_ms != null).map((r) => r.response_ms);
  const avgResp = responses.length ? responses.reduce((a, b) => a + b, 0) / responses.length : null;
  const players = rows.filter((r) => r.connected_players != null).map((r) => r.connected_players);
  const peakPlayers = players.length ? players.reduce((max, v) => (v > max ? v : max), players[0]) : null;
  let incidents = 0;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].status === 'down' && rows[i - 1].status === 'up') incidents++;
  }
  return { uptimePct, avgResp, peakPlayers, incidents };
}

/* ---------------- overview KPIs ---------------- */

function setBar(elNode, pct, thresholds = [70, 90]) {
  const clamped = Math.max(0, Math.min(100, pct || 0));
  elNode.style.width = `${clamped}%`;
  elNode.classList.remove('warn', 'bad');
  if (clamped >= thresholds[1]) elNode.classList.add('bad');
  else if (clamped >= thresholds[0]) elNode.classList.add('warn');
}

function updateOverviewKpis(system) {
  if (!system) return;
  el('cpu-value').textContent = `${system.cpu_load?.toFixed(1) ?? '—'}%`;

  const memPct = system.mem_total ? (system.mem_used / system.mem_total) * 100 : null;
  el('mem-value').textContent = memPct != null ? `${memPct.toFixed(1)}%` : '—';

  const diskPct = system.disk_total ? (system.disk_used / system.disk_total) * 100 : null;
  el('disk-value').textContent = diskPct != null
    ? `${diskPct.toFixed(1)}% (${fmtBytes(system.disk_used)} / ${fmtBytes(system.disk_total)})`
    : '—';
  setBar(el('disk-bar'), diskPct);

  el('load-value').textContent = [system.load1, system.load5, system.load15]
    .map((v) => (v != null ? v.toFixed(2) : '—'))
    .join(' / ');

  el('net-value').textContent = `↓ ${fmtBytesPerSec(system.net_rx_sec)}  ↑ ${fmtBytesPerSec(system.net_tx_sec)}`;
  el('uptime-value').textContent = fmtDuration(system.uptime_sec);

  const tempCard = el('temp-card');
  if (system.cpu_temp != null) {
    tempCard.hidden = false;
    el('temp-value').textContent = `${system.cpu_temp.toFixed(1)}°C`;
  } else {
    tempCard.hidden = true;
  }
}

/* ---------------- sites: nav + cards ---------------- */

function renderNavSites() {
  const container = el('nav-sites');
  container.innerHTML = '';
  sitesMeta.forEach((site) => {
    const btn = document.createElement('button');
    btn.className = 'nav-site-item';
    btn.id = `nav-site-${site.id}`;
    btn.innerHTML = `<span class="nav-site-dot" id="nav-dot-${site.id}"></span>${site.name}`;
    btn.addEventListener('click', () => selectSite(site.id, { scroll: true }));
    container.appendChild(btn);
  });
}

function renderSiteCards() {
  const container = el('sites-container');
  container.innerHTML = '';
  sitesMeta.forEach((site) => {
    const card = document.createElement('div');
    card.className = 'site-card';
    card.id = `site-card-${site.id}`;
    card.innerHTML = `
      <div class="site-card-header">
        <span class="site-name">${site.name}</span>
        <span class="status-badge unknown" id="status-${site.id}">Inconnu</span>
      </div>
      <div class="site-metrics">
        <div>Réponse: <b id="resp-${site.id}">—</b></div>
        <div>CPU: <b id="cpu-${site.id}">—</b></div>
        <div>Mémoire: <b id="mem-${site.id}">—</b></div>
        <div>Joueurs: <b id="players-${site.id}">—</b></div>
      </div>
    `;
    card.addEventListener('click', () => selectSite(site.id, { scroll: true }));
    container.appendChild(card);
  });
}

function updateSiteCards(sites) {
  sites.forEach((s) => {
    const { cls, text } = statusLabel(s.status);
    const badge = el(`status-${s.site_id}`);
    if (badge) {
      badge.className = `status-badge ${cls}`;
      badge.textContent = text;
    }
    const dot = el(`nav-dot-${s.site_id}`);
    if (dot) dot.className = `nav-site-dot ${cls}`;
    const resp = el(`resp-${s.site_id}`);
    if (resp) resp.textContent = fmtMs(s.response_ms);
    const cpu = el(`cpu-${s.site_id}`);
    if (cpu) cpu.textContent = s.cpu_percent != null ? `${s.cpu_percent}%` : '—';
    const mem = el(`mem-${s.site_id}`);
    if (mem) mem.textContent = s.mem_rss != null ? fmtBytes(s.mem_rss) : '—';
    const players = el(`players-${s.site_id}`);
    if (players) players.textContent = s.connected_players != null ? s.connected_players : '—';
  });
}

/* ---------------- site detail panel ---------------- */

function updateDetailHeader() {
  const meta = sitesMeta.find((s) => s.id === selectedSiteId);
  if (!meta) return;
  el('detail-name').textContent = meta.name;
  el('detail-link').href = meta.url;
  const snap = latestSitesSnapshot.find((s) => s.site_id === selectedSiteId);
  const { cls, text } = statusLabel(snap ? snap.status : null);
  const badge = el('detail-status');
  badge.className = `status-badge ${cls}`;
  badge.textContent = text;
}

function renderDetailChart(rows, metric) {
  const def = METRIC_DEFS[metric];
  const data = rows.filter((r) => r[metric] != null).map((r) => ({ x: r.ts, y: def.transform(r[metric]) }));
  const ds = detailChart.data.datasets[0];
  ds.label = def.label;
  ds.data = data;
  ds.borderColor = def.color;
  ds.backgroundColor = gradientFill(def.color);

  const segments = computeDownSegments(rows);
  const annotations = {};
  segments.forEach((seg, i) => {
    annotations['down' + i] = {
      type: 'box',
      xMin: seg[0],
      xMax: seg[1],
      backgroundColor: 'rgba(248,113,113,0.10)',
      borderWidth: 0,
    };
  });
  detailChart.options.plugins.annotation.annotations = annotations;
  detailChart.update();
}

async function refreshSiteDetail() {
  if (!selectedSiteId) return;
  const rows = await fetchJson(`/api/history/site/${selectedSiteId}?range=${range}`);
  currentSiteRows = rows;
  el('detail-range-label').textContent = RANGE_LABELS[range] || range;

  const stats = computeSiteStats(rows);
  el('detail-uptime').textContent = stats.uptimePct != null ? `${stats.uptimePct.toFixed(1)}%` : '—';
  el('detail-avg-resp').textContent = stats.avgResp != null ? `${Math.round(stats.avgResp)} ms` : '—';
  el('detail-peak-players').textContent = stats.peakPlayers != null ? stats.peakPlayers : '—';
  el('detail-incidents').textContent = stats.incidents;

  renderDetailChart(rows, activeDetailMetric);
}

async function selectSite(id, { scroll } = {}) {
  selectedSiteId = id;
  document.querySelectorAll('.site-card').forEach((c) => c.classList.toggle('selected', c.id === `site-card-${id}`));
  document.querySelectorAll('.nav-site-item').forEach((b) => b.classList.toggle('active', b.id === `nav-site-${id}`));
  el('site-detail').hidden = false;
  updateDetailHeader();
  try {
    await refreshSiteDetail();
  } catch (e) {
    /* transient fetch error, next refresh cycle will retry */
  }
  if (scroll) {
    el('site-detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  closeMobileSidebar();
}

/* ---------------- main + network charts ---------------- */

function updateMainChart(rows) {
  const cpuData = rows.filter((r) => r.cpu_load != null).map((r) => ({ x: r.ts, y: r.cpu_load }));
  const memData = rows.filter((r) => r.mem_total).map((r) => ({ x: r.ts, y: (r.mem_used / r.mem_total) * 100 }));
  mainChart.data.datasets[0].data = cpuData;
  mainChart.data.datasets[1].data = memData;
  mainChart.update();
}

function updateNetworkChart(rows) {
  const rx = rows.filter((r) => r.net_rx_sec != null).map((r) => ({ x: r.ts, y: r.net_rx_sec }));
  const tx = rows.filter((r) => r.net_tx_sec != null).map((r) => ({ x: r.ts, y: r.net_tx_sec }));
  networkChart.data.datasets[0].data = rx;
  networkChart.data.datasets[1].data = tx;
  networkChart.update();
}

function updateSparklinesAndTrends(rows) {
  updateSparkline(sparklines.cpu, rows, 'cpu_load');

  const memRows = rows.map((r) => ({ ts: r.ts, pct: r.mem_total ? (r.mem_used / r.mem_total) * 100 : null }));
  updateSparkline(sparklines.mem, memRows, 'pct');

  const netRows = rows.map((r) => ({ ts: r.ts, total: (r.net_rx_sec || 0) + (r.net_tx_sec || 0) }));
  updateSparkline(sparklines.net, netRows, 'total');

  setTrend('trend-cpu', trendFor(rows, 'cpu_load'));
  setTrend('trend-mem', trendFor(memRows, 'pct'));
}

/* ---------------- players ---------------- */

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function kindLabel(kind) {
  const found = catalogData.kinds.find((k) => k.kind === kind);
  if (found) return found.label;
  return kind === 'other' ? 'Autres objets' : kind;
}

function findCatalogItem(itemId) {
  return catalogData.items.find((i) => i.id === itemId);
}

function setupPlayersSection() {
  const playersSites = sitesMeta.filter((s) => s.hasPlayers);
  if (!playersSites.length) return;

  el('nav-players').hidden = false;
  el('section-players').hidden = false;

  const select = el('players-site-select');
  if (playersSites.length > 1) {
    select.hidden = false;
    select.innerHTML = playersSites.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
    select.addEventListener('change', () => loadPlayers(select.value));
  }

  el('players-search').addEventListener('input', () => {
    renderPlayersTable(playersData, el('players-search').value);
  });

  loadPlayers(playersSites[0].id);
}

async function loadPlayers(siteId) {
  selectedPlayersSiteId = siteId;
  try {
    const data = await fetchJson(`/api/players/${siteId}`);
    playersData = data.players;
    catalogData = data.catalog;
  } catch (e) {
    playersData = [];
    catalogData = { rarities: {}, kinds: [], items: [] };
  }
  renderPlayersTable(playersData, el('players-search').value);
}

function renderPlayersTable(players, search) {
  const term = (search || '').trim().toLowerCase();
  const filtered = term ? players.filter((p) => p.username.toLowerCase().includes(term)) : players;

  const tbody = el('players-tbody');
  tbody.innerHTML = '';
  el('players-empty').hidden = filtered.length > 0;

  filtered.forEach((p) => {
    const tr = document.createElement('tr');
    tr.className = 'player-row';
    tr.dataset.id = p.id;
    tr.innerHTML = `
      <td class="player-username">${escapeHtml(p.username)}${p.ban ? '<span class="ban-badge">Banni</span>' : ''}</td>
      <td>${new Date(p.createdAt).toLocaleDateString('fr-FR')}</td>
      <td class="credits-value">${p.credits}</td>
      <td class="items-count">${p.items.length}</td>
      <td class="player-open-hint">Gérer →</td>
    `;
    tr.addEventListener('click', () => openPlayerModal(p));
    tbody.appendChild(tr);
  });
}

function updatePlayerRow(player) {
  const row = document.querySelector(`.player-row[data-id="${player.id}"]`);
  if (!row) return;
  row.querySelector('.credits-value').textContent = player.credits;
  row.querySelector('.items-count').textContent = player.items.length;
  row.querySelector('.player-username').innerHTML =
    `${escapeHtml(player.username)}${player.ban ? '<span class="ban-badge">Banni</span>' : ''}`;
}

/* ---- account edit modal ---- */

function setupPlayerModal() {
  el('pm-close').addEventListener('click', closePlayerModal);
  el('player-modal-backdrop').addEventListener('click', (e) => {
    if (e.target === el('player-modal-backdrop')) closePlayerModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !el('player-modal-backdrop').hidden) closePlayerModal();
  });
  el('pm-credits-save').addEventListener('click', saveCreditsModal);
  el('pm-credits-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveCreditsModal();
  });
  el('pm-catalog-search').addEventListener('input', () => {
    if (activeModalPlayer) renderCatalogGrid(activeModalPlayer);
  });
}

function avatarColor(username) {
  let hash = 0;
  for (let i = 0; i < username.length; i++) hash = username.charCodeAt(i) + ((hash << 5) - hash);
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 62%, 52%)`;
}

function openPlayerModal(player) {
  activeModalPlayer = player;
  activeCatalogTab = 'all';

  el('pm-avatar').textContent = player.username.slice(0, 1);
  el('pm-avatar').style.background = avatarColor(player.username);
  el('pm-username').textContent = player.username;
  el('pm-created').textContent = `Créé le ${new Date(player.createdAt).toLocaleDateString('fr-FR')}`;
  el('pm-credits-input').value = player.credits;
  el('pm-credits-feedback').textContent = '';
  el('pm-credits-feedback').className = 'pm-save-feedback';
  el('pm-catalog-search').value = '';
  selectedBanDuration = '24h';
  banCustomValue = 1;
  banCustomUnit = 'hours';

  renderOwnedGroups(player);
  renderCatalogTabs();
  renderCatalogGrid(player);
  renderBanSection(player);

  el('player-modal-backdrop').hidden = false;
  document.body.style.overflow = 'hidden';
}

function closePlayerModal() {
  el('player-modal-backdrop').hidden = true;
  document.body.style.overflow = '';
  activeModalPlayer = null;
}

/* ---- moderation / bans ---- */

function banDeviceNote(ban) {
  const bits = [];
  if (ban.fingerprint) bits.push('appareil');
  if (ban.ip) bits.push(`IP (${ban.ip})`);
  if (!bits.length) return '';
  return `<div class="pm-ban-device-note">🔒 ${escapeHtml(bits.join(' + '))} également bloqué${bits.length > 1 ? 's' : ''}</div>`;
}

function renderBanSection(player) {
  const container = el('pm-ban-section');

  if (player.ban) {
    const untilText = player.ban.until == null
      ? 'Banni définitivement'
      : `Banni jusqu'au ${new Date(player.ban.until).toLocaleString('fr-FR')}`;
    container.innerHTML = `
      <div class="pm-ban-active-card">
        <span class="pm-ban-icon">🚫</span>
        <div class="pm-ban-info">
          <div class="pm-ban-until">${escapeHtml(untilText)}</div>
          ${player.ban.reason ? `<div class="pm-ban-reason-display">${escapeHtml(player.ban.reason)}</div>` : ''}
          ${banDeviceNote(player.ban)}
          ${player.ban.ip ? '<button class="pm-ban-ip-remove" id="pm-ban-ip-remove">Retirer le blocage IP</button>' : ''}
        </div>
        <button class="btn-secondary" id="pm-unban-btn">Lever le bannissement</button>
      </div>
    `;
    el('pm-unban-btn').addEventListener('click', () => unbanPlayer(player));
    const ipRemoveBtn = el('pm-ban-ip-remove');
    if (ipRemoveBtn) ipRemoveBtn.addEventListener('click', () => removeBanIp(player));
    return;
  }

  container.innerHTML = `
    <div class="pm-ban-form">
      <div class="ban-duration-pills" id="ban-duration-pills">
        ${BAN_DURATIONS.map((d) => `<button type="button" data-key="${d.key}" class="ban-pill${d.key === selectedBanDuration ? ' active' : ''}">${d.label}</button>`).join('')}
        <button type="button" data-key="custom" class="ban-pill${selectedBanDuration === 'custom' ? ' active' : ''}">Personnalisé</button>
        <button type="button" data-key="permanent" class="ban-pill ban-pill-danger${selectedBanDuration === 'permanent' ? ' active' : ''}">Permanent</button>
      </div>
      <div class="pm-ban-custom-row" id="pm-ban-custom-row"${selectedBanDuration === 'custom' ? '' : ' hidden'}>
        <input type="number" id="pm-ban-custom-value" class="pm-ban-custom-value" min="1" step="1" value="${banCustomValue}" />
        <select id="pm-ban-custom-unit" class="pm-ban-custom-unit">
          <option value="minutes"${banCustomUnit === 'minutes' ? ' selected' : ''}>minutes</option>
          <option value="hours"${banCustomUnit === 'hours' ? ' selected' : ''}>heures</option>
          <option value="days"${banCustomUnit === 'days' ? ' selected' : ''}>jours</option>
        </select>
      </div>
      <label class="pm-ban-ip-toggle">
        <input type="checkbox" id="pm-ban-include-ip" />
        Bannir aussi l'IP <span class="muted">— peut bloquer d'autres joueurs sur le même réseau (WiFi partagé, soirée...)</span>
      </label>
      <div class="pm-ban-row">
        <input type="text" id="pm-ban-reason" class="pm-ban-reason-input" placeholder="Raison (optionnel)" maxlength="200" />
        <button class="btn-danger" id="pm-ban-submit">Bannir</button>
      </div>
    </div>
  `;

  container.querySelectorAll('.ban-pill').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectedBanDuration = btn.dataset.key;
      container.querySelectorAll('.ban-pill').forEach((b) => b.classList.toggle('active', b === btn));
      el('pm-ban-custom-row').hidden = selectedBanDuration !== 'custom';
    });
  });
  el('pm-ban-custom-value').addEventListener('input', (e) => {
    banCustomValue = Math.max(1, Number(e.target.value) || 1);
  });
  el('pm-ban-custom-unit').addEventListener('change', (e) => {
    banCustomUnit = e.target.value;
  });
  el('pm-ban-submit').addEventListener('click', () => banPlayer(player));
}

async function banPlayer(player) {
  const permanent = selectedBanDuration === 'permanent';
  let durationMs = null;
  let durationLabel = '';

  if (!permanent) {
    if (selectedBanDuration === 'custom') {
      durationMs = banCustomValue * BAN_UNIT_MS[banCustomUnit];
      durationLabel = `${banCustomValue} ${BAN_UNIT_LABELS[banCustomUnit]}`;
    } else {
      const duration = BAN_DURATIONS.find((d) => d.key === selectedBanDuration);
      durationMs = duration.ms;
      durationLabel = duration.label;
    }
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      alert('Durée invalide.');
      return;
    }
  }

  const reason = (el('pm-ban-reason')?.value || '').trim();
  const includeIp = !!el('pm-ban-include-ip')?.checked;
  const confirmMsg = permanent
    ? `Bannir ${player.username} définitivement ?`
    : `Bannir ${player.username} pendant ${durationLabel} ?`;
  if (!confirm(confirmMsg)) return;

  try {
    const res = await fetch(`/api/players/${selectedPlayersSiteId}/${player.id}/ban`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ permanent, durationMs: permanent ? null : durationMs, reason, includeIp }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'ban failed');
    }
    const data = await res.json();
    player.ban = data.ban;
    renderBanSection(player);
    updatePlayerRow(player);
  } catch (e) {
    alert(e.message && e.message !== 'ban failed' ? e.message : 'Impossible de bannir ce joueur.');
  }
}

async function unbanPlayer(player) {
  if (!confirm(`Lever le bannissement de ${player.username} ?`)) return;
  try {
    const res = await fetch(`/api/players/${selectedPlayersSiteId}/${player.id}/ban`, { method: 'DELETE' });
    if (!res.ok) throw new Error('unban failed');
    player.ban = null;
    renderBanSection(player);
    updatePlayerRow(player);
  } catch (e) {
    alert('Impossible de lever le bannissement.');
  }
}

async function removeBanIp(player) {
  try {
    const res = await fetch(`/api/players/${selectedPlayersSiteId}/${player.id}/ban/ip`, { method: 'DELETE' });
    if (!res.ok) throw new Error('remove ip failed');
    const data = await res.json();
    player.ban = data.ban;
    renderBanSection(player);
  } catch (e) {
    alert("Impossible de retirer le blocage IP.");
  }
}

function groupOwnedItems(player) {
  const groups = {};
  player.items.forEach((itemId) => {
    const item = findCatalogItem(itemId);
    const kind = item ? item.kind : 'other';
    if (!groups[kind]) groups[kind] = [];
    groups[kind].push({ id: itemId, item });
  });
  return groups;
}

function renderOwnedGroups(player) {
  const container = el('pm-owned-groups');
  el('pm-owned-count').textContent = player.items.length;

  if (!player.items.length) {
    container.innerHTML = '<p class="pm-owned-empty">Aucun objet possédé.</p>';
    return;
  }

  const groups = groupOwnedItems(player);
  const order = [...catalogData.kinds.map((k) => k.kind), 'other'];

  container.innerHTML = order
    .filter((k) => groups[k] && groups[k].length)
    .map((k) => {
      const chips = groups[k]
        .map(({ id, item }) => {
          const name = item ? item.label : id;
          const color = item && item.rarity ? catalogData.rarities[item.rarity]?.color : '';
          const style = color ? ` style="--rarity-color:${color}"` : '';
          return `<span class="owned-item-chip"${style}>${escapeHtml(name)}<button class="owned-item-remove" data-item="${escapeHtml(id)}" title="Retirer">×</button></span>`;
        })
        .join('');
      return `<div><div class="owned-group-title">${escapeHtml(kindLabel(k))} (${groups[k].length})</div><div class="owned-items-grid">${chips}</div></div>`;
    })
    .join('');

  container.querySelectorAll('.owned-item-remove').forEach((btn) => {
    btn.addEventListener('click', () => removeOwnedItem(player, btn.dataset.item));
  });
}

function renderCatalogTabs() {
  const container = el('pm-catalog-tabs');
  const tabs = [{ kind: 'all', label: 'Tous' }, ...catalogData.kinds];
  container.innerHTML = tabs
    .map((t) => `<button class="pm-catalog-tab${t.kind === activeCatalogTab ? ' active' : ''}" data-kind="${t.kind}">${escapeHtml(t.label)}</button>`)
    .join('');

  container.querySelectorAll('.pm-catalog-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeCatalogTab = btn.dataset.kind;
      container.querySelectorAll('.pm-catalog-tab').forEach((b) => b.classList.toggle('active', b === btn));
      renderCatalogGrid(activeModalPlayer);
    });
  });
}

function renderCatalogGrid(player) {
  const search = el('pm-catalog-search').value.trim().toLowerCase();
  const owned = new Set(player.items);

  const items = catalogData.items.filter((item) => {
    if (owned.has(item.id)) return false;
    if (activeCatalogTab !== 'all' && item.kind !== activeCatalogTab) return false;
    if (search && !item.label.toLowerCase().includes(search)) return false;
    return true;
  });

  const grid = el('pm-catalog-grid');
  if (!items.length) {
    grid.innerHTML = '<p class="pm-catalog-empty">Aucun objet trouvé.</p>';
    return;
  }

  grid.innerHTML = items
    .map((item) => {
      const color = item.rarity ? catalogData.rarities[item.rarity]?.color : '';
      const style = color ? ` style="--rarity-color:${color}"` : '';
      const rarityLabel = item.rarity ? catalogData.rarities[item.rarity]?.label : null;
      const meta = [kindLabel(item.kind), rarityLabel || (item.cost ? `${item.cost} crédits` : 'Exclusif booster')]
        .filter(Boolean)
        .join(' · ');
      return `
        <div class="catalog-item-card"${style}>
          <div class="catalog-item-label">${escapeHtml(item.label)}</div>
          <div class="catalog-item-meta">${escapeHtml(meta)}</div>
          <button class="catalog-item-add" data-item="${escapeHtml(item.id)}">+ Ajouter</button>
        </div>
      `;
    })
    .join('');

  grid.querySelectorAll('.catalog-item-add').forEach((btn) => {
    btn.addEventListener('click', () => addOwnedItem(player, btn.dataset.item, btn));
  });
}

async function saveCreditsModal() {
  if (!activeModalPlayer) return;
  const input = el('pm-credits-input');
  const btn = el('pm-credits-save');
  const feedback = el('pm-credits-feedback');
  const amount = Number(input.value);
  if (!Number.isFinite(amount) || amount < 0) return;

  btn.disabled = true;
  try {
    const res = await fetch(`/api/players/${selectedPlayersSiteId}/${activeModalPlayer.id}/credits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount }),
    });
    if (!res.ok) throw new Error('save failed');
    const data = await res.json();
    activeModalPlayer.credits = data.credits;
    input.value = data.credits;
    feedback.textContent = 'Enregistré ✓';
    feedback.className = 'pm-save-feedback show';
    updatePlayerRow(activeModalPlayer);
  } catch (e) {
    feedback.textContent = "Erreur lors de l'enregistrement";
    feedback.className = 'pm-save-feedback show error';
  } finally {
    btn.disabled = false;
    setTimeout(() => feedback.classList.remove('show'), 2500);
  }
}

async function removeOwnedItem(player, itemId) {
  try {
    const res = await fetch(`/api/players/${selectedPlayersSiteId}/${player.id}/items/${encodeURIComponent(itemId)}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('remove failed');
    const data = await res.json();
    player.items = data.items;
    renderOwnedGroups(player);
    renderCatalogGrid(player);
    updatePlayerRow(player);
  } catch (e) {
    alert("Impossible de retirer l'objet.");
  }
}

async function addOwnedItem(player, itemId, btn) {
  btn.disabled = true;
  try {
    const res = await fetch(`/api/players/${selectedPlayersSiteId}/${player.id}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemId }),
    });
    if (!res.ok) throw new Error('add failed');
    const data = await res.json();
    player.items = data.items;
    renderOwnedGroups(player);
    renderCatalogGrid(player);
    updatePlayerRow(player);
  } catch (e) {
    alert("Impossible d'ajouter l'objet.");
    btn.disabled = false;
  }
}

/* ---------------- refresh cycles ---------------- */

async function refreshOverview() {
  try {
    const data = await fetchJson('/api/overview');
    updateOverviewKpis(data.system);
    latestSitesSnapshot = data.sites || [];
    updateSiteCards(latestSitesSnapshot);
    if (selectedSiteId) updateDetailHeader();
    el('last-updated').textContent = `Maj ${new Date().toLocaleTimeString('fr-FR')}`;
  } catch (e) {
    el('last-updated').textContent = 'Connexion perdue';
  }
}

async function refreshHistory() {
  try {
    const sys1h = await fetchJson('/api/history/system?range=1h');
    const sysRange = range === '1h' ? sys1h : await fetchJson(`/api/history/system?range=${range}`);

    updateSparklinesAndTrends(sys1h);
    updateMainChart(sysRange);
    updateNetworkChart(sysRange);

    if (selectedSiteId) await refreshSiteDetail();
  } catch (e) {
    /* transient fetch error, next cycle will retry */
  }
}

/* ---------------- nav / layout wiring ---------------- */

function scrollToSection(id) {
  const target = el(id);
  if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeMobileSidebar() {
  el('sidebar').classList.remove('open');
  el('sidebar-backdrop').classList.remove('open');
}

function setupSidebar() {
  const sidebar = el('sidebar');
  const backdrop = el('sidebar-backdrop');
  el('sidebar-toggle').addEventListener('click', () => {
    sidebar.classList.toggle('open');
    backdrop.classList.toggle('open');
  });
  backdrop.addEventListener('click', closeMobileSidebar);

  document.querySelectorAll('.nav-item[data-scroll]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      scrollToSection(btn.dataset.scroll);
      closeMobileSidebar();
    });
  });
}

function setupRangeButtons() {
  document.querySelectorAll('#range-select button').forEach((btn) => {
    btn.addEventListener('click', async () => {
      document.querySelectorAll('#range-select button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      range = btn.dataset.range;
      await refreshHistory();
    });
  });
}

function setupTabs() {
  document.querySelectorAll('#detail-tabs button').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#detail-tabs button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      activeDetailMetric = btn.dataset.metric;
      if (currentSiteRows.length) renderDetailChart(currentSiteRows, activeDetailMetric);
    });
  });
}

/* ---------------- init ---------------- */

async function init() {
  setupSidebar();
  setupRangeButtons();
  setupTabs();
  setupPlayerModal();

  mainChart = makeTimeChart(el('chart-main'), [
    { label: 'CPU %', color: '#5b8cff' },
    { label: 'Mémoire %', color: '#34d399' },
  ], { yMax: 100 });

  networkChart = makeTimeChart(el('chart-network'), [
    { label: 'Réception', color: '#5b8cff' },
    { label: 'Émission', color: '#c084fc' },
  ], { yFormat: fmtBytesPerSec });

  detailChart = makeTimeChart(el('chart-detail'), [
    { label: 'Joueurs connectés', color: '#5b8cff' },
  ]);

  sparklines.cpu = makeSparkline(el('spark-cpu'), '#5b8cff');
  sparklines.mem = makeSparkline(el('spark-mem'), '#34d399');
  sparklines.net = makeSparkline(el('spark-net'), '#c084fc');

  try {
    sitesMeta = await fetchJson('/api/sites');
  } catch (e) {
    sitesMeta = [];
  }
  renderNavSites();
  renderSiteCards();
  setupPlayersSection();

  await refreshOverview();
  await refreshHistory();
  if (sitesMeta.length) await selectSite(sitesMeta[0].id, { scroll: false });

  setInterval(refreshOverview, REFRESH_MS);
  setInterval(refreshHistory, HISTORY_REFRESH_MS);
}

init();
