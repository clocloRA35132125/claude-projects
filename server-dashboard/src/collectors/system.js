const si = require('systeminformation');
const os = require('os');

async function collectSystemStats() {
  const [currentLoad, mem, fsSize, networkStats, time, temp] = await Promise.all([
    si.currentLoad(),
    si.mem(),
    si.fsSize(),
    si.networkStats(),
    si.time(),
    si.cpuTemperature().catch(() => ({ main: null })),
  ]);

  const rootFs = fsSize.find((f) => f.mount === '/') || fsSize[0] || {};
  const net = networkStats[0] || {};
  const loadavg = os.loadavg();

  return {
    ts: Date.now(),
    cpu_load: currentLoad.currentLoad,
    cpu_cores_json: JSON.stringify((currentLoad.cpus || []).map((c) => Math.round(c.load * 10) / 10)),
    load1: loadavg[0],
    load5: loadavg[1],
    load15: loadavg[2],
    mem_used: mem.active,
    mem_total: mem.total,
    disk_used: rootFs.used ?? null,
    disk_total: rootFs.size ?? null,
    net_rx_sec: net.rx_sec ?? null,
    net_tx_sec: net.tx_sec ?? null,
    cpu_temp: temp.main ?? null,
    uptime_sec: Math.round(time.uptime || os.uptime()),
  };
}

module.exports = { collectSystemStats };
