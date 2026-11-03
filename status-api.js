// status-api.js — à ajouter dans le dossier du bot, puis dans index.js :
//   require('./status-api')(client);        (ou (client, app) si tu as déjà Express)
// Expose GET /status et /statut (JSON) avec les vraies stats de CoreLab. Aucune dépendance.
const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');

module.exports = (client, app) => {
  // CPU du process, échantillonné toutes les 5 s
  let lastUsage = process.cpuUsage(), lastTime = Date.now(), cpu = 0;
  setInterval(() => {
    const t = Date.now() - lastTime;
    const u = process.cpuUsage(lastUsage);
    cpu = ((u.user + u.system) / 1000 / t / os.cpus().length) * 100;
    lastUsage = process.cpuUsage();
    lastTime = Date.now();
  }, 5000).unref();

  // ── Historique d'uptime : 1 échantillon / minute, agrégé par jour (UTC), 90 jours ──
  // Fichier modifiable via UPTIME_FILE (à placer sur un disque persistant si ton hébergeur efface les fichiers au redéploiement).
  const HIST_FILE = process.env.UPTIME_FILE || path.join(__dirname, 'uptime-history.json');
  const HIST_DAYS = 90, TICK = 60 * 1000;
  let hist = { last: 0, days: {} };
  try {
    const raw = JSON.parse(fs.readFileSync(HIST_FILE, 'utf8'));
    if (raw && typeof raw.days === 'object') hist = { last: Number(raw.last) || 0, days: raw.days };
  } catch {}

  const record = (ms, up) => {
    const k = new Date(ms).toISOString().slice(0, 10);
    const d = hist.days[k] || (hist.days[k] = { u: 0, t: 0 });
    d.t++; if (up) d.u++;
  };
  const days = () => Object.keys(hist.days).sort().slice(-HIST_DAYS);
  const save = () => {
    const keep = {}; days().forEach((k) => { keep[k] = hist.days[k]; });
    hist.days = keep;
    try {
      fs.writeFileSync(HIST_FILE + '.tmp', JSON.stringify(hist));
      fs.renameSync(HIST_FILE + '.tmp', HIST_FILE);
    } catch (e) { console.error('[status-api] sauvegarde uptime :', e.message); }
  };

  // Au démarrage : les minutes où le bot était éteint comptent comme « indisponible ».
  const boot = Date.now();
  if (hist.last) {
    for (let t = Math.max(hist.last + TICK, boot - HIST_DAYS * 864e5); t <= boot; t += TICK) record(t, false);
  }
  hist.last = boot; save();

  setInterval(() => {
    const t = Date.now();
    record(t, client.isReady() && client.ws.status === 0);
    hist.last = t; save();
  }, TICK).unref();

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
      history: days().map((k) => ({ d: k, u: hist.days[k].u, t: hist.days[k].t })),
    };
  };

  const send = (res) => {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify(build()));
  };

  // Option A : tu as déjà un serveur Express -> require('./status-api')(client, app);
  // (supprime ton ancienne route /statut qui renvoie « CoreLab en ligne », sinon elle gagne)
  if (app && typeof app.get === 'function') {
    app.get(['/status', '/statut'], (req, res) => send(res));
    return;
  }

  // Option B : pas de serveur existant -> on en crée un.
  http.createServer((req, res) => {
    if (!['/status', '/statut'].includes(req.url.split('?')[0])) { res.writeHead(404); return res.end(); }
    send(res);
  }).listen(process.env.PORT || 3000);
};