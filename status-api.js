// status-api.js — à ajouter dans le dossier du bot, puis dans index.js :
//   require('./status-api')(client);
// Expose GET /status (JSON) avec les vraies stats de CoreLab. Aucune dépendance.
const http = require('http');
const os = require('os');
const fs = require('fs');

module.exports = (client) => {
  // CPU du process, échantillonné toutes les 5 s
  let lastUsage = process.cpuUsage(), lastTime = Date.now(), cpu = 0;
  setInterval(() => {
    const t = Date.now() - lastTime;
    const u = process.cpuUsage(lastUsage);
    cpu = ((u.user + u.system) / 1000 / t / os.cpus().length) * 100;
    lastUsage = process.cpuUsage();
    lastTime = Date.now();
  }, 5000).unref();

  const build = () => {
    let storage = { used: 0, total: 0 };
    try {
      const s = fs.statfsSync('/');
      storage = { total: s.bsize * s.blocks, used: s.bsize * (s.blocks - s.bavail) };
    } catch {}
    return {
      bot: client.isReady() ? 'online' : 'offline',
      discord: client.ws.status === 0 ? 'ok' : 'down',
      latency_ms: Math.max(0, Math.round(client.ws.ping)),
      uptime_s: Math.floor((client.uptime || 0) / 1000),
      servers: client.guilds.cache.size,
      users: client.guilds.cache.reduce((a, g) => a + (g.memberCount || 0), 0),
      commands: client.commands?.size ?? client.application?.commands?.cache?.size ?? 0,
      cpu: { percent: Math.min(100, +cpu.toFixed(1)), cores: os.cpus().length, model: os.cpus()[0]?.model || '' },
      memory: { used: os.totalmem() - os.freemem(), total: os.totalmem() },
      storage,
    };
  };

  http.createServer((req, res) => {
    if (req.url.split('?')[0] !== '/status') { res.writeHead(404); return res.end(); }
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify(build()));
  }).listen(process.env.PORT || 3000);
};
