const fs = require('fs');
const path = require('path');

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data), 'utf-8');
}

function accountWalletKey(accountId) {
  return `acc:${accountId}`;
}

function loadAccounts(dataDir) {
  const store = readJson(path.join(dataDir, 'accounts.json'), { accounts: {}, sessions: {} });
  return store.accounts || {};
}

function loadBans(dataDir) {
  return readJson(path.join(dataDir, 'bans.json'), {});
}

/** Returns the ban record if it's still in effect, otherwise null (a past
 * `until` is treated as not banned — nothing needs to clean it up). */
function activeBan(dataDir, accountId) {
  const ban = loadBans(dataDir)[accountId];
  if (!ban) return null;
  if (ban.until != null && ban.until <= Date.now()) return null;
  return ban;
}

/** Public account fields only — never returns salt/hash. */
function listPlayers(dataDir) {
  const accounts = loadAccounts(dataDir);
  const credits = readJson(path.join(dataDir, 'credits.json'), {});
  const inventory = readJson(path.join(dataDir, 'inventory.json'), {});

  return Object.values(accounts)
    .map((acc) => {
      const key = accountWalletKey(acc.id);
      return {
        id: acc.id,
        username: acc.username,
        createdAt: acc.createdAt,
        credits: credits[key] ?? 0,
        items: inventory[key] ?? [],
        ban: activeBan(dataDir, acc.id),
      };
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

function accountExists(dataDir, accountId) {
  return Object.values(loadAccounts(dataDir)).some((a) => a.id === accountId);
}

function setCredits(dataDir, accountId, amount) {
  if (!Number.isFinite(amount) || amount < 0 || amount > 10_000_000) {
    throw new Error('Montant de crédits invalide (doit être entre 0 et 10 000 000).');
  }
  const key = accountWalletKey(accountId);
  const filePath = path.join(dataDir, 'credits.json');
  const data = readJson(filePath, {});
  data[key] = Math.round(amount);
  writeJson(filePath, data);
  return data[key];
}

function removeItem(dataDir, accountId, itemId) {
  const key = accountWalletKey(accountId);
  const filePath = path.join(dataDir, 'inventory.json');
  const data = readJson(filePath, {});
  const owned = data[key] ?? [];
  data[key] = owned.filter((i) => i !== itemId);
  writeJson(filePath, data);
  return data[key];
}

function loadCatalog(catalogPath) {
  return readJson(catalogPath, { rarities: {}, kinds: [], items: [] });
}

function grantItem(dataDir, accountId, itemId, catalog) {
  if (!catalog.items.some((i) => i.id === itemId)) {
    throw new Error("Objet inconnu dans le catalogue.");
  }
  const key = accountWalletKey(accountId);
  const filePath = path.join(dataDir, 'inventory.json');
  const data = readJson(filePath, {});
  const owned = data[key] ?? [];
  if (!owned.includes(itemId)) {
    owned.push(itemId);
    data[key] = owned;
    writeJson(filePath, data);
  }
  return data[key] ?? owned;
}

const MAX_BAN_MS = 20 * 365 * 24 * 60 * 60 * 1000; // ~20 years — use "permanent" beyond this

/** The device fingerprint / IP blindtest last saw for this account (recorded
 * on every authenticated socket connection — see server.ts's
 * recordConnection). null if it's never connected since tracking was added. */
function getLastFingerprint(dataDir, accountId) {
  const data = readJson(path.join(dataDir, 'fingerprints.json'), {});
  return data[accountId] || null;
}

function getLastIp(dataDir, accountId) {
  const data = readJson(path.join(dataDir, 'ips.json'), {});
  return data[accountId] || null;
}

/** `includeIp` is opt-in: unlike the device fingerprint (tied to one browser
 * install), the IP is shared by everyone behind the same router — checking
 * it by default would ban a whole household or party over one troublemaker.
 * The admin decides per-ban whether that tradeoff is acceptable. */
function setBan(dataDir, accountId, until, reason, includeIp) {
  if (until != null) {
    if (!Number.isFinite(until) || until <= Date.now()) {
      throw new Error('Date de fin de bannissement invalide.');
    }
    if (until - Date.now() > MAX_BAN_MS) {
      throw new Error('Durée trop longue — utilise "Permanent" pour un bannissement sans limite.');
    }
  }
  const filePath = path.join(dataDir, 'bans.json');
  const data = readJson(filePath, {});
  const fingerprint = getLastFingerprint(dataDir, accountId);
  const ip = includeIp ? getLastIp(dataDir, accountId) : null;
  data[accountId] = { until, reason: reason || null, bannedAt: Date.now(), fingerprint, ip };
  writeJson(filePath, data);
  return data[accountId];
}

function clearBan(dataDir, accountId) {
  const filePath = path.join(dataDir, 'bans.json');
  const data = readJson(filePath, {});
  delete data[accountId];
  writeJson(filePath, data);
}

/** Removes just the IP from an active ban (account + device stay blocked) —
 * for when an admin realizes after the fact that the IP block caught other
 * people on the same network. */
function clearBanIp(dataDir, accountId) {
  const filePath = path.join(dataDir, 'bans.json');
  const data = readJson(filePath, {});
  if (!data[accountId]) return null;
  data[accountId] = { ...data[accountId], ip: null };
  writeJson(filePath, data);
  return data[accountId];
}

module.exports = {
  listPlayers,
  accountExists,
  setCredits,
  removeItem,
  loadCatalog,
  grantItem,
  activeBan,
  setBan,
  clearBan,
  clearBanIp,
};
