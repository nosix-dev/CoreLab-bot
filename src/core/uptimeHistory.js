// src/core/uptimeHistory.js
// Historique d'uptime pour la page de statut : 1 échantillon / minute, agrégé par jour (UTC), 90 jours.
// Les minutes où le bot était éteint (redéploiement, crash, veille Render) comptent comme « indisponibles ».
const fs = require('fs');
const path = require('path');

const HIST_DAYS = 90;
const TICK = 60 * 1000;

// Dossier data/ : persistant (DATA_DIR) et inclus dans la sauvegarde / restauration Discord.
let FILE;
try { FILE = path.join(require('./persistentPath').dossierPersistant('data'), 'uptime_history.json'); }
catch { FILE = path.join(__dirname, '..', '..', 'data', 'uptime_history.json'); }
try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); } catch {}

let hist = { last: 0, days: {} };
try {
  const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  if (raw && typeof raw.days === 'object') hist = { last: Number(raw.last) || 0, days: raw.days };
} catch {}

const record = (ms, up) => {
  const k = new Date(ms).toISOString().slice(0, 10);
  const d = hist.days[k] || (hist.days[k] = { u: 0, t: 0 });
  d.t++; if (up) d.u++;
};
const keys = () => Object.keys(hist.days).sort().slice(-HIST_DAYS);
const save = () => {
  const keep = {}; keys().forEach((k) => { keep[k] = hist.days[k]; });
  hist.days = keep;
  try {
    fs.writeFileSync(FILE + '.tmp', JSON.stringify(hist));
    fs.renameSync(FILE + '.tmp', FILE);
  } catch (e) { console.error('[Uptime] sauvegarde :', e.message); }
};

function start(client) {
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
}

const getHistory = () => keys().map((k) => ({ d: k, u: hist.days[k].u, t: hist.days[k].t }));

module.exports = { start, getHistory };